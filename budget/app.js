(function () {
  const STORAGE_KEY = "budget-stitch-demo-v2";
  const FORM_DRAFT_PREFIX = `${STORAGE_KEY}:draft`;
  const COLORS = ["#1B4332", "#F5B700", "#EE6055", "#3A7CA5", "#7D5BA6", "#2A9D8F", "#9B5D3A", "#6C757D"];
  const EXPENSE_DEFAULTS = ["Groceries", "Milk", "Medicine", "Education", "Fuel", "Temple", "Dining"];
  const INCOME_DEFAULTS = ["Salary", "Rent", "Pension", "Business"];
  const TERMS_VERSION = "2026-06-21";
  const KEY_CHECK_TEXT = "budget-padmanabham-family-key-v1";
  const KEY_FINGERPRINT_CONTEXT = "budget-join-v1";

  const config = window.BUDGET_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  // A demo session lasts as long as the tab does. Safari reloading the tab -- or a
  // stray refresh mid-presentation -- drops the query string, and without this the
  // presenter lands on the sign-in screen with no way back. Kept in sessionStorage
  // so it dies with the tab and can never follow a real user into a real session.
  const previewParam = params.get("preview") === "1";
  let previewRemembered = false;
  try {
    if (previewParam) window.sessionStorage.setItem("bp_preview", "1");
    previewRemembered = window.sessionStorage.getItem("bp_preview") === "1";
  } catch {
    previewRemembered = false;   // private mode / storage disabled
  }
  const previewMode = previewParam || previewRemembered;
  const visualMode = previewMode && params.get("visual") === "activity";
  const initialTab = ["dashboard", "expenses", "insights", "income", "categories", "family", "goals"].includes(params.get("tab"))
    ? params.get("tab")
    : "dashboard";
  const initialModal = ["expense", "income", "category", "person"].includes(params.get("modal"))
    ? { type: params.get("modal") }
    : null;
  const initialMonth = /^\d{4}-\d{2}$/.test(params.get("month") || "") ? params.get("month") : null;
  // Visual baselines need a fixed clock, otherwise preview data shifts daily and rolls over
  // at month boundaries. Only honoured in preview mode so the real app can never be pinned.
  const frozenToday = previewMode && /^\d{4}-\d{2}-\d{2}$/.test(params.get("today") || "")
    ? params.get("today")
    : null;
  // Renders a signed-in-but-family-less state so the onboarding screen can be
  // reviewed and screenshotted without a real Supabase session.
  const previewSetup = previewMode && params.get("screen") === "setup";
  const hasSupabase = Boolean(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY && window.supabase);
  const client = hasSupabase
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true
        }
      })
    : null;

  const state = {
    user: null,
    family: null,
    membership: null,
    people: [],
    categories: [],
    expenses: [],
    incomes: [],
    analyticsSnapshots: [],
    invites: [],
    familyKey: null,
    privacyLocked: false,
    insightTab: "overview",
    tab: initialTab,
    modal: initialModal,
    sort: "date",
    expenseSearch: "",
    rangeMode: "month",
    selectedMonth: initialMonth,
    dateFrom: null,
    dateTo: null,
    scope: "EXPENSE",
    busy: false,
    checkingSession: hasSupabase && !previewMode,
    error: "",
    notice: "",
    demo: previewMode,
    preview: previewMode
  };

  const app = document.getElementById("app");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let realtimeChannel = null;
  let realtimeFamilyId = "";
  let refreshTimer = null;
  let refreshInterval = null;
  let refreshAfterModal = false;
  const analyticsSnapshotMonths = new Set();
  let privacyMigrationRunning = false;
  let viewportWatcherInstalled = false;
  let noticeTimer = null;
  let tourState = null;

  const todayKey = () => {
    if (frozenToday) return frozenToday;
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const monthKey = (dateKey) => (dateKey || todayKey()).slice(0, 7);
  const currentMonth = () => monthKey(todayKey());
  const selectedMonth = () => state.selectedMonth || currentMonth();

  const money = (value) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: state.family?.currency_code || "INR",
      maximumFractionDigits: 0
    }).format(Number(value || 0));

  const niceDate = (dateKey) => {
    const date = new Date(`${dateKey || todayKey()}T00:00:00`);
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
  };

  const shortDate = (dateKey) => {
    const date = new Date(`${dateKey || todayKey()}T00:00:00`);
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
  };

  const monthLabel = (key) => {
    const date = new Date(`${key || currentMonth()}-01T00:00:00`);
    return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(date);
  };

  function shiftMonth(key, delta) {
    const date = new Date(`${key || currentMonth()}-01T00:00:00`);
    date.setMonth(date.getMonth() + delta);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 7);
  }

  function monthStart(key = selectedMonth()) {
    return `${key || currentMonth()}-01`;
  }

  function monthEnd(key = selectedMonth()) {
    const date = new Date(`${key || currentMonth()}-01T00:00:00`);
    date.setMonth(date.getMonth() + 1, 0);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function rangeStart() {
    return state.dateFrom || monthStart(selectedMonth());
  }

  function rangeEnd() {
    return state.dateTo || monthEnd(selectedMonth());
  }

  /* Backdating support.

     Nothing ever blocked a past date -- safeDate takes any valid one and there is
     no DB constraint. The problem was that a backdated expense then disappeared:
     the form defaulted to today, the view never followed the saved row, and the
     dashboard was pinned to the real-world current month. */

  // Date to prefill in the entry form. Within the viewed month, keep today's day
  // where that makes sense, otherwise fall back to the 1st.
  /* One password field for all four sites (join, create, unlock, set up).

     A family password is long, shared verbally or over chat, and typed on a
     phone keyboard -- and getting it wrong on the unlock screen just says the
     password is incorrect. Being able to check what you typed matters more here
     than on a normal login. */
  function passwordField(label, value, options = {}) {
    const { isNew = false, hint = "" } = options;
    return `
      <label class="field">${escapeHtml(label)}
        <span class="password-wrap">
          <input class="input" name="privacy" type="password"
                 ${isNew ? 'minlength="8"' : ""}
                 autocomplete="${isNew ? "new-password" : "current-password"}"
                 value="${escapeHtml(value || "")}" required>
          <button class="password-toggle" type="button" data-toggle-password
                  aria-label="Show password" aria-pressed="false" title="Show password">
            ${EYE_ICON}
          </button>
        </span>
        ${hint ? `<small>${hint}</small>` : ""}
      </label>
    `;
  }

  const EYE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7c2 0 3.7.7 5.1 1.6M22 12s-3.6 7-10 7c-2 0-3.7-.7-5.1-1.6"></path><path d="M4 4l16 16"></path></svg>`;

  function defaultEntryDate() {
    const viewing = selectedMonth();
    if (viewing === currentMonth()) return todayKey();
    const today = todayKey();
    const candidate = `${viewing}-${today.slice(8, 10)}`;
    return candidate <= monthEnd(viewing) ? candidate : monthEnd(viewing);
  }

  // Point the whole app at the month a date belongs to.
  function focusMonthOf(dateKey) {
    const key = monthKey(dateKey);
    if (!key || key === selectedMonth()) return;
    state.selectedMonth = key;
    state.dateFrom = monthStart(key);
    state.dateTo = monthEnd(key);
    state.rangeMode = "month";
  }

  function expensesForRange(start = rangeStart(), end = rangeEnd()) {
    return state.expenses.filter((expense) => {
      const spentOn = expense.spent_on || todayKey();
      return spentOn >= start && spentOn <= end;
    });
  }

  function readDemo() {
    if (state.preview) return null;
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function writeDemo() {
    if (!state.demo || state.preview) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        family: state.family,
        membership: state.membership,
        people: state.people,
        categories: state.categories,
        expenses: state.expenses,
        incomes: state.incomes,
        analyticsSnapshots: state.analyticsSnapshots,
        invites: state.invites
      })
    );
  }

  function seedDemo() {
    const saved = readDemo();
    state.user = { id: "demo-user", email: "ramesh@example.com", user_metadata: { full_name: "Ramesh Padmanabham" } };
    if (previewSetup) return; // signed in, no family -> setupScreen()
    if (!saved && state.preview) {
      const seeded = seededPreviewData();
      state.family = seeded.family;
      state.membership = seeded.membership;
      state.people = seeded.people;
      state.categories = seeded.categories;
      state.expenses = seeded.expenses;
      state.incomes = seeded.incomes;
      state.invites = seeded.invites;
      return;
    }
    state.family = saved?.family || null;
    state.membership = saved?.membership || (state.family ? { role: "OWNER" } : null);
    state.people = saved?.people || [];
    state.categories = saved?.categories || [];
    state.expenses = saved?.expenses || [];
    state.incomes = saved?.incomes || [];
    state.analyticsSnapshots = saved?.analyticsSnapshots || [];
    state.invites = saved?.invites || [];
  }

  function seededPreviewData() {
    const family = {
      id: "preview-family",
      name: "Padmanabham Family",
      currency_code: "INR",
      monthly_budget: 129723,
      savings_goal_amount: 120000,
      owner_id: "demo-user",
      invite_code: "BUDGET-2048",
      invite_locked: false,
      encryption_salt: "",
      encryption_check: ""
    };
    const people = [
      { id: "p-ramesh", family_id: family.id, display_name: "Ramesh", linked_user_id: "demo-user" },
      { id: "p-lakshmi", family_id: family.id, display_name: "Lakshmi" },
      { id: "p-amma", family_id: family.id, display_name: "Amma" },
      { id: "p-arjun", family_id: family.id, display_name: "Arjun" }
    ];
    const categories = [
      ...EXPENSE_DEFAULTS.map((name, index) => ({
        id: `c-exp-${index}`,
        family_id: family.id,
        name,
        scope: "EXPENSE",
        color: COLORS[index % COLORS.length],
        // No category ships with a limit. Seeded categories are created with
        // monthly_limit 0 for real families, and the demo data must match that
        // or the Goals screen shows limits nobody set.
        monthly_limit: 0
      })),
      ...INCOME_DEFAULTS.map((name, index) => ({
        id: `c-inc-${index}`,
        family_id: family.id,
        name,
        scope: "INCOME",
        color: COLORS[(index + 3) % COLORS.length],
        monthly_limit: 0
      }))
    ];
    const expenses = [
      ["Spencer's Retail", 4280, "p-ramesh", "c-exp-0", todayKey(), ""],
      ["Urban Company", 1200, "p-lakshmi", "c-exp-6", daysAgo(1), ""],
      ["Monthly groceries", 18450, "p-amma", "c-exp-0", daysAgo(2), ""],
      ["Dining", 12400, "p-arjun", "c-exp-6", daysAgo(3), ""],
      ["Utilities", 9800, "p-ramesh", "c-exp-4", daysAgo(4), "", "MONTHLY", "ACTIVE"],
      ["Medicine", 7600, "p-lakshmi", "c-exp-2", daysAgo(6), ""],
      ["Education", 10590, "p-arjun", "c-exp-3", daysAgo(8), ""],
      ["Household items", 20000, "p-lakshmi", "c-exp-0", daysAgo(14), ""],
      ["Tuition fee", 12000, "p-arjun", "c-exp-3", lastMonthDay(12), "", "QUARTERLY", "ACTIVE"],
      ["Gym membership", 2200, "p-arjun", "c-exp-6", daysAgo(10), "", "MONTHLY", "PAUSED"],
      ["Newspaper", 450, "p-amma", "c-exp-0", daysAgo(20), "", "MONTHLY", "STOPPED"]
    ].map(([title, amount, person_id, category_id, spent_on, note, recurrence, lifecycle], index) => ({
      id: `e-${index}`,
      family_id: family.id,
      title,
      amount,
      person_id,
      category_id,
      spent_on,
      note,
      recurrence: recurrence || "NONE",
      lifecycle: lifecycle || "ACTIVE",
      anchor_on: spent_on,
      entered_by: "demo-user",
      created_at: new Date(Date.now() - index * 3600000).toISOString()
    }));
    const incomes = [
      { id: "i-0", family_id: family.id, title: "Primary Salary", amount: 120000, day_of_month: 1, cadence: "MONTHLY", anchor_on: "2026-01-01", lifecycle: "ACTIVE", is_active: true, category_id: "c-inc-0", created_by: "demo-user" },
      { id: "i-1", family_id: family.id, title: "Rental Income", amount: 45000, day_of_month: 5, cadence: "MONTHLY", anchor_on: "2026-01-05", lifecycle: "ACTIVE", is_active: true, category_id: "c-inc-1", created_by: "demo-user" },
      { id: "i-2", family_id: family.id, title: "Weekend Tutoring", amount: 2500, day_of_month: 4, cadence: "WEEKLY", anchor_on: "2026-07-04", lifecycle: "ACTIVE", is_active: true, category_id: "c-inc-3", created_by: "demo-user" },
      { id: "i-3", family_id: family.id, title: "FD Dividends", amount: 4500, day_of_month: 1, cadence: "QUARTERLY", anchor_on: "2026-01-01", lifecycle: "ACTIVE", is_active: true, category_id: "c-inc-2", created_by: "demo-user" },
      { id: "i-4", family_id: family.id, title: "LIC Maturity", amount: 60000, day_of_month: 20, cadence: "YEARLY", anchor_on: "2026-03-20", lifecycle: "ACTIVE", is_active: true, category_id: "c-inc-2", created_by: "demo-user" },
      { id: "i-5", family_id: family.id, title: "Freelance Projects", amount: 15000, day_of_month: 12, cadence: "MONTHLY", anchor_on: "2026-02-12", lifecycle: "PAUSED", is_active: false, category_id: "c-inc-3", created_by: "demo-user" },
      { id: "i-6", family_id: family.id, title: "Old Consulting Retainer", amount: 25000, day_of_month: 1, cadence: "MONTHLY", anchor_on: "2025-06-01", lifecycle: "STOPPED", is_active: false, category_id: "c-inc-3", created_by: "demo-user" }
    ];
    return {
      family,
      membership: { family_id: family.id, role: "OWNER" },
      people,
      categories,
      expenses,
      incomes,
      invites: []
    };
  }

  // Anchored to todayKey() so a frozen preview clock makes seeded demo dates deterministic.
  function daysAgo(days) {
    const date = new Date(`${todayKey()}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  function lastMonthDay(day) {
    const date = new Date(`${todayKey()}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1, day);
    return date.toISOString().slice(0, 10);
  }

  async function init() {
    if (state.demo) {
      seedDemo();
      state.checkingSession = false;
      render();
      return;
    }

    if (!hasSupabase) {
      state.checkingSession = false;
      render();
      return;
    }

    const { data } = await client.auth.getSession();
    state.user = data.session ? await getValidatedUser() : null;
    client.auth.onAuthStateChange(async (_event, session) => {
      state.user = session ? await getValidatedUser() : null;
      state.checkingSession = false;
      load().catch(showError);
    });
    setupAutoRefresh();
    state.checkingSession = false;
    await load();
  }

  async function getValidatedUser() {
    const { data, error } = await client.auth.getUser();
    if (error) {
      await client.auth.signOut();
      return null;
    }
    return data.user || null;
  }

  async function load() {
    state.error = "";
    if (!state.user) {
      state.family = null;
      state.analyticsSnapshots = [];
      stopRealtime();
      render();
      return;
    }

    if (state.demo) {
      render();
      return;
    }

    await upsertProfile();
    const { data: memberships, error: membershipError } = await client
      .from("budget_family_users")
      .select("family_id, role")
      .eq("user_id", state.user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    if (membershipError) throw membershipError;

    // No membership means the setup screen. There is no longer a pending state to
    // check for: joining is immediate, so you are either in a family or you are not.
    if (!memberships?.length) {
      state.family = null;
      state.membership = null;
      state.people = [];
      state.categories = [];
      state.expenses = [];
      state.incomes = [];
      state.analyticsSnapshots = [];
      state.invites = [];
      state.privacyLocked = false;
      stopRealtime();
      render();
      return;
    }

    state.membership = memberships[0];
    const familyId = memberships[0].family_id;
    const [familyRes, peopleRes, categoriesRes, expensesRes, incomesRes, snapshotsRes] = await Promise.all([
      client.from("budget_families").select("*").eq("id", familyId).single(),
      client.from("budget_people").select("*").eq("family_id", familyId).order("created_at"),
      client.from("budget_categories").select("*").eq("family_id", familyId).order("scope").order("name"),
      client
        .from("budget_expenses")
        .select("*")
        .eq("family_id", familyId)
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false }),
      client
        .from("budget_incomes")
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false }),
      client
        .from("budget_analytics_snapshots")
        .select("*")
        .eq("family_id", familyId)
        .order("month_key", { ascending: false })
    ]);

    if (familyRes.error) throw familyRes.error;
    if (peopleRes.error) throw peopleRes.error;
    if (categoriesRes.error) throw categoriesRes.error;
    if (expensesRes.error) throw expensesRes.error;
    if (incomesRes.error) throw incomesRes.error;
    if (snapshotsRes.error) throw snapshotsRes.error;

    state.family = familyRes.data;
    await loadFamilyKey();
    // Self-heal pre-existing families so new members can join (owner-only write).
    if (state.familyKey && !familyRes.data?.key_fingerprint) await backfillKeyFingerprint(state.familyKey);
    state.family = await hydrateFamily(familyRes.data);
    state.people = await hydratePeople(peopleRes.data || []);
    state.categories = await hydrateCategories(categoriesRes.data || []);
    state.expenses = await hydrateExpenses(expensesRes.data || []);
    state.incomes = await hydrateIncomes(incomesRes.data || []);
    state.analyticsSnapshots = await hydrateAnalyticsSnapshots(snapshotsRes.data || []);
    state.invites = [];
    ensureRealtime(familyId);
    if (state.familyKey && !state.analyticsSnapshots.some((snapshot) => snapshot.month_key === currentMonth())) {
      queueAnalyticsSnapshot(currentMonth());
    }
    render();
    flushAnalyticsSnapshotQueue();
    migratePlaintextPrivacyRows();
    maybeStartTour();
  }

  function setupAutoRefresh() {
    if (refreshInterval || state.demo) return;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.user) queueRefresh(50);
    });
    window.addEventListener("focus", () => {
      if (state.user) queueRefresh(50);
    });
    refreshInterval = window.setInterval(() => {
      if (state.user && !document.hidden) queueRefresh(0);
    }, 20000);
    installViewportWatcher();
  }

  // Five screens branch on isDesktopMode() into entirely different render
  // functions, but nothing re-rendered on resize -- rotating a tablet across the
  // breakpoint left desktop markup under mobile styles until an unrelated render.
  // Only re-renders when the breakpoint actually flips, not on every resize pixel.
  function installViewportWatcher() {
    if (viewportWatcherInstalled) return;
    viewportWatcherInstalled = true;
    let wasDesktop = isDesktopMode();
    let resizeTimer = 0;
    const check = () => {
      const isDesktop = isDesktopMode();
      if (isDesktop === wasDesktop) return;
      wasDesktop = isDesktop;
      render();
    };
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(check, 150);
    });
    window.addEventListener("orientationchange", check);
  }

  function queueRefresh(delay = 400) {
    if (state.demo || !state.user || state.checkingSession) return;
    // A refresh rebuilds the whole DOM. Mid-tour that would strand the spotlight
    // over a detached node, so defer exactly as we already do for open modals.
    // endTour() drains this in a finally -- if it did not, refreshAfterModal
    // would latch true and the app would silently stop updating for the session.
    if (state.modal || tourActive()) {
      refreshAfterModal = true;
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      load().catch(showError);
    }, delay);
  }

  function stopRealtime() {
    if (realtimeChannel && client) client.removeChannel(realtimeChannel);
    realtimeChannel = null;
    realtimeFamilyId = "";
  }

  function ensureRealtime(familyId) {
    if (!client || state.demo || !familyId || realtimeFamilyId === familyId) return;
    stopRealtime();
    const reload = () => queueRefresh(250);
    realtimeFamilyId = familyId;
    realtimeChannel = client
      .channel(`budget-family-${familyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_families", filter: `id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_family_users", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_people", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_categories", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_expenses", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_incomes", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_analytics_snapshots", filter: `family_id=eq.${familyId}` }, reload)
      .subscribe();
  }

  async function upsertProfile() {
    const fullName = state.user.user_metadata?.full_name || state.user.email?.split("@")[0] || "Family member";
    const { error } = await client.from("budget_profiles").upsert({
      id: state.user.id,
      full_name: fullName,
      email: state.user.email
    });
    if (error) throw error;
  }

  async function signInWithGoogle() {
    if (!hasSupabase) {
      state.error = "Supabase is not configured for this deployment.";
      render();
      return;
    }
    if (!document.querySelector("[data-accept-terms]")?.checked) {
      throw new Error("Please accept the Terms and Data Collection Policy to continue.");
    }

    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
  }

  async function signOut() {
    if (state.demo) {
      state.user = null;
      state.family = null;
      render();
      return;
    }
    await client.auth.signOut();
  }

  function activeExpenseCategories() {
    return state.categories.filter((category) => category.scope === "EXPENSE");
  }

  function activeIncomeCategories() {
    return state.categories.filter((category) => category.scope === "INCOME");
  }

  function monthExpenses() {
    return expensesForMonth(currentMonth());
  }

  function expensesForMonth(key) {
    return state.expenses.filter((expense) => monthKey(expense.spent_on) === key);
  }

  function spendForMonth(key) {
    return expensesForMonth(key).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  }

  function availableMonthKeys() {
    const months = new Set([currentMonth(), selectedMonth()]);
    state.expenses.forEach((expense) => months.add(monthKey(expense.spent_on)));
    return [...months].filter(Boolean).sort((a, b) => b.localeCompare(a));
  }

  function previousMonthSummaries(limit = 6) {
    return availableMonthKeys()
      .filter((key) => key < currentMonth())
      .map((key) => {
        const rows = expensesForMonth(key);
        return { key, total: rows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0), count: rows.length };
      })
      .filter((row) => row.count > 0)
      .slice(0, limit);
  }

  // A recurring income counts unless it has been explicitly paused. Treat undefined
  // as active: filters used `!== false` while display used plain truthiness, so an
  // undefined row was counted in the monthly total yet drawn as Paused.
  function isIncomeActive(income) {
    return lifecycleOf(income) === "ACTIVE";
  }

  // --- Cadence and lifecycle -------------------------------------------------
  //
  // Both live inside the encrypted payload, never in a column: hydrate spreads
  // the decrypted object over the row, so a new field needs no migration and
  // stays as private as the amount it describes.
  //
  // Anything saved before this existed has neither field. Those rows must keep
  // behaving exactly as they did, so the defaults below reproduce the old
  // meaning: no cadence is monthly, and the old is_active boolean maps onto the
  // new three states.
  const CADENCES = [
    { value: "WEEKLY", label: "Weekly", short: "Weekly", months: 0 },
    { value: "MONTHLY", label: "Monthly", short: "Monthly", months: 1 },
    { value: "QUARTERLY", label: "Every 3 months", short: "3-monthly", months: 3 },
    { value: "HALF_YEARLY", label: "Every 6 months", short: "6-monthly", months: 6 },
    { value: "YEARLY", label: "Every year", short: "Yearly", months: 12 }
  ];

  const LIFECYCLES = [
    { value: "ACTIVE", label: "Active" },
    { value: "PAUSED", label: "Paused" },
    { value: "STOPPED", label: "Stopped" }
  ];

  // Incomes call it cadence, expenses call it recurrence: an income always
  // repeats, whereas an expense is a one-off unless it says otherwise, and the
  // two forms read better with their own word. One accessor serves both.
  function cadenceOf(item) {
    const value = String(item?.cadence || item?.recurrence || "").toUpperCase();
    return CADENCES.some((c) => c.value === value) ? value : "MONTHLY";
  }

  function cadenceLabel(item) {
    const value = cadenceOf(item);
    return CADENCES.find((c) => c.value === value)?.label || "Monthly";
  }

  function cadenceShort(item) {
    const value = cadenceOf(item);
    return CADENCES.find((c) => c.value === value)?.short || "Monthly";
  }

  // Paused and stopped both stop counting. They differ in intent, and the UI
  // treats them differently: paused is a temporary hold you expect to undo,
  // stopped is an ending you keep for the record.
  function lifecycleOf(item) {
    const explicit = String(item?.lifecycle || "").toUpperCase();
    if (LIFECYCLES.some((l) => l.value === explicit)) return explicit;
    return item?.is_active === false ? "STOPPED" : "ACTIVE";
  }

  function isCounting(item) {
    return lifecycleOf(item) === "ACTIVE";
  }

  function anchorDateOf(item, fallback) {
    if (isDateKey(item?.anchor_on)) return item.anchor_on;
    if (isDateKey(item?.spent_on)) return item.spent_on;
    const day = Math.min(Math.max(Number(item?.day_of_month || 1), 1), 28);
    const base = fallback || currentMonth();
    return `${base}-${String(day).padStart(2, "0")}`;
  }

  function isDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function monthsBetween(fromKey, toKey) {
    const [fy, fm] = fromKey.split("-").map(Number);
    const [ty, tm] = toKey.split("-").map(Number);
    return (ty - fy) * 12 + (tm - fm);
  }

  // How many times this item lands in the given month. Weekly is the reason
  // this returns a count rather than a boolean: a weekly amount arrives four or
  // five times depending on the month, and averaging it to 4.33 would show a
  // total the family never actually receives.
  function occurrencesInMonth(item, key = currentMonth()) {
    if (!isCounting(item)) return 0;
    const cadence = cadenceOf(item);
    const anchor = anchorDateOf(item, key);
    const anchorMonth = anchor.slice(0, 7);
    if (monthsBetween(anchorMonth, key) < 0) return 0;   // not started yet

    if (cadence === "WEEKLY") {
      const weekday = new Date(`${anchor}T00:00:00`).getDay();
      const [year, month] = key.split("-").map(Number);
      const days = new Date(year, month, 0).getDate();
      let count = 0;
      for (let day = 1; day <= days; day += 1) {
        if (new Date(year, month - 1, day).getDay() === weekday) count += 1;
      }
      return count;
    }

    const period = CADENCES.find((c) => c.value === cadence)?.months || 1;
    return monthsBetween(anchorMonth, key) % period === 0 ? 1 : 0;
  }

  function amountForMonth(item, key = currentMonth()) {
    return Number(item?.amount || 0) * occurrencesInMonth(item, key);
  }

  /* Occurrence handling for an ARBITRARY date range, not a whole month.
     Everything above is month-keyed, which is fine while every screen shows one
     calendar month, but the expenses screen supports a custom From/To range and
     had no way to state the income for it.

     This works from actual occurrence DATES rather than per-month counts, so a
     range covering half of March gets only the deposits that fall in that half. */
  function occurrenceDatesInMonth(item, key) {
    if (!isCounting(item)) return [];
    const cadence = cadenceOf(item);
    const anchor = anchorDateOf(item, key);
    const anchorMonth = anchor.slice(0, 7);
    if (monthsBetween(anchorMonth, key) < 0) return [];

    const [year, month] = key.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const pad = (n) => String(n).padStart(2, "0");

    if (cadence === "WEEKLY") {
      const weekday = new Date(`${anchor}T00:00:00`).getDay();
      const dates = [];
      for (let day = 1; day <= daysInMonth; day += 1) {
        if (new Date(year, month - 1, day).getDay() === weekday) dates.push(`${key}-${pad(day)}`);
      }
      return dates;
    }

    const period = CADENCES.find((c) => c.value === cadence)?.months || 1;
    if (monthsBetween(anchorMonth, key) % period !== 0) return [];
    // Clamp so a 31st anchor still lands in a 30-day month.
    const day = Math.min(Number(anchor.slice(8, 10)) || 1, daysInMonth);
    return [`${key}-${pad(day)}`];
  }

  function monthKeysBetween(start, end) {
    if (!start || !end || start > end) return [];
    const keys = [];
    let key = monthKey(start);
    const last = monthKey(end);
    // Bounded so a malformed range cannot spin forever.
    for (let guard = 0; key <= last && guard < 600; guard += 1) {
      keys.push(key);
      key = shiftMonth(key, 1);
    }
    return keys;
  }

  function occurrencesInRange(item, start, end) {
    return monthKeysBetween(start, end)
      .flatMap((key) => occurrenceDatesInMonth(item, key))
      .filter((date) => date >= start && date <= end)
      .length;
  }

  function incomeForRange(start = rangeStart(), end = rangeEnd()) {
    return state.incomes
      .filter((income) => !income.locked)
      .reduce((sum, income) => sum + Number(income.amount || 0) * occurrencesInRange(income, start, end), 0);
  }

  function monthlyIncome() {
    return incomeForMonth(currentMonth());
  }

  function monthlySpend() {
    return spendForMonth(currentMonth());
  }

  function categoryName(id) {
    return state.categories.find((category) => category.id === id)?.name || "Unassigned";
  }

  function categoryColor(id, fallback) {
    return state.categories.find((category) => category.id === id)?.color || fallback || COLORS[0];
  }

  function topExpenseCategories(limit = 6) {
    const categories = activeExpenseCategories();
    const byId = new Map(categories.map((category) => [category.id, category]));
    const scores = new Map();
    const now = new Date(`${todayKey()}T00:00:00`);

    state.expenses.forEach((expense) => {
      if (!expense.category_id || !byId.has(expense.category_id)) return;
      const spentOn = new Date(`${expense.spent_on || todayKey()}T00:00:00`);
      const ageDays = Math.max(0, Math.round((now - spentOn) / 86400000));
      const recencyBoost = ageDays <= 30 ? (30 - ageDays) / 30 : 0;
      const previous = scores.get(expense.category_id) || { count: 0, score: 0, lastUsed: "" };
      previous.count += 1;
      previous.score += 1 + recencyBoost;
      previous.lastUsed = previous.lastUsed > expense.spent_on ? previous.lastUsed : expense.spent_on;
      scores.set(expense.category_id, previous);
    });

    const ranked = [...scores.entries()]
      .map(([id, stats]) => ({ ...byId.get(id), ...stats }))
      .sort((a, b) => b.score - a.score || String(b.lastUsed).localeCompare(String(a.lastUsed)) || a.name.localeCompare(b.name));
    const selected = ranked.slice(0, limit);
    categories.forEach((category) => {
      if (selected.length < limit && !selected.some((item) => item.id === category.id)) selected.push(category);
    });
    return selected.slice(0, limit);
  }

  function personName(id) {
    return state.people.find((person) => person.id === id)?.display_name || "Family";
  }

  function currentUserPerson() {
    if (!state.user) return null;
    const emailName = state.user.email?.split("@")[0] || "";
    const fullName = state.user.user_metadata?.full_name || emailName;
    return (
      state.people.find((person) => person.linked_user_id === state.user.id) ||
      state.people.find((person) => comparableText(person.display_name) === comparableText(fullName)) ||
      state.people.find((person) => comparableText(person.display_name) === comparableText(emailName)) ||
      null
    );
  }

  function defaultExpensePersonId(expense) {
    return expense?.person_id || currentUserPerson()?.id || state.people[0]?.id || "";
  }

  function personInitial(idOrName) {
    const name = state.people.find((person) => person.id === idOrName)?.display_name || idOrName || "?";
    return String(name).trim().slice(0, 1).toUpperCase();
  }

  function personColor(id) {
    const index = Math.max(0, state.people.findIndex((person) => person.id === id));
    return COLORS[(index + 1) % COLORS.length];
  }

  function totalsBy(list, getKey, getName, getColor) {
    const map = new Map();
    list.forEach((item) => {
      const key = getKey(item);
      const previous = map.get(key) || { key, name: getName(item), color: getColor(item), total: 0, count: 0 };
      previous.total += Number(item.amount || 0);
      previous.count += 1;
      map.set(key, previous);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  // Now genuinely month-aware. It used to ignore its argument and return the
  // same figure for every month, which was harmless while every income was
  // monthly and is wrong the moment one arrives yearly.
  //
  // Rows saved before cadence existed anchor to whichever month is being asked
  // about, so they still count in all of them and no historical total moves.
  function incomeForMonth(key = currentMonth()) {
    return state.incomes
      .filter((income) => !income.locked)
      .reduce((sum, income) => sum + amountForMonth(income, key), 0);
  }

  // What the family has committed to per month through recurring expenses.
  // Deliberately separate from actual spend: marking an expense as repeating
  // records an intention, it does not invent expense rows nobody entered.
  function recurringExpenseCommitment(key = currentMonth()) {
    return recurringExpenses().reduce((sum, expense) => sum + amountForMonth(expense, key), 0);
  }

  function recurringExpenses() {
    return state.expenses.filter((expense) => isRecurringExpense(expense) && !expense.locked);
  }

  function isRecurringExpense(expense) {
    return Boolean(expense?.recurrence) && expense.recurrence !== "NONE";
  }

  function snapshotPayloadForMonth(key) {
    return state.analyticsSnapshots.find((snapshot) => snapshot.month_key === key && snapshot.payload)?.payload || null;
  }

  function percentChange(current, previous) {
    if (!Number.isFinite(previous) || previous <= 0) return null;
    return ((Number(current || 0) - previous) / previous) * 100;
  }

  function trendLabel(value, noun = "last month") {
    if (value === null || value === undefined || !Number.isFinite(value)) return "Not enough data yet";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}% vs ${noun}`;
  }

  function analyticsForMonth(key = selectedMonth()) {
    const month = key || currentMonth();
    const expenses = expensesForMonth(month).filter((expense) => !expense.locked);
    const spend = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const income = incomeForMonth(month);
    const previousKey = shiftMonth(month, -1);
    const previousSnapshot = snapshotPayloadForMonth(previousKey);
    const previousSpendRows = expensesForMonth(previousKey).filter((expense) => !expense.locked);
    const previousSpend = previousSpendRows.length
      ? previousSpendRows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      : previousSnapshot?.totals?.spend ?? null;
    const previousIncome = previousSnapshot?.totals?.income ?? null;
    const categories = totalsBy(expenses, (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id)).map((row) => {
      const category = state.categories.find((item) => item.id === row.key);
      const limit = Number(category?.monthly_limit || 0);
      return {
        ...row,
        monthly_limit: limit,
        percent: spend ? (row.total / spend) * 100 : 0,
        limit_used_percent: limit ? (row.total / limit) * 100 : null,
        budget_status: limit ? (row.total > limit ? "OVER" : "WITHIN") : "NO_LIMIT"
      };
    });
    const members = totalsBy(expenses, (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const monthlyBudget = Number(state.family?.monthly_budget || 0);
    const savingsGoal = Number(state.family?.savings_goal_amount || 0);
    const savings = income - spend;
    const trendMonths = Array.from({ length: 6 }, (_, index) => shiftMonth(month, index - 5)).map((trendMonth) => ({
      month: trendMonth,
      name: monthLabel(trendMonth).slice(0, 3).toUpperCase(),
      spend: spendForMonth(trendMonth),
      income: incomeForMonth(trendMonth)
    }));
    return {
      month_key: month,
      computed_at: new Date().toISOString(),
      totals: {
        income,
        spend,
        savings,
        monthly_budget: monthlyBudget,
        savings_goal_amount: savingsGoal,
        budget_used_percent: monthlyBudget ? (spend / monthlyBudget) * 100 : null,
        savings_progress_percent: savingsGoal ? (Math.max(savings, 0) / savingsGoal) * 100 : null
      },
      previous: {
        month_key: previousKey,
        income: previousIncome,
        spend: previousSpend,
        income_change_percent: percentChange(income, previousIncome),
        spend_change_percent: percentChange(spend, previousSpend)
      },
      categories,
      members,
      trend_months: trendMonths,
      labels: {
        income_change: trendLabel(percentChange(income, previousIncome)),
        spend_change: trendLabel(percentChange(spend, previousSpend)),
        budget_status: monthlyBudget ? (spend > monthlyBudget ? `Over by ${money(spend - monthlyBudget)}` : "Within monthly budget") : "Monthly budget not set",
        savings_progress: savingsGoal ? `${Math.min(100, Math.round((Math.max(savings, 0) / savingsGoal) * 100))}% achieved` : "Set savings goal"
      }
    };
  }

  function categoryBudgetRows(analytics, limit = 2) {
    const limited = analytics.categories
      .filter((row) => row.monthly_limit > 0)
      .sort((a, b) => {
        const aOver = a.budget_status === "OVER" ? 1 : 0;
        const bOver = b.budget_status === "OVER" ? 1 : 0;
        return bOver - aOver || (b.limit_used_percent || 0) - (a.limit_used_percent || 0);
      });
    if (limited.length) return limited.slice(0, limit);
    return analytics.categories.slice(0, limit);
  }

  function analyticsSnapshotPayload(month) {
    const analytics = analyticsForMonth(month);
    return {
      month_key: analytics.month_key,
      computed_at: analytics.computed_at,
      totals: analytics.totals,
      previous: analytics.previous,
      categories: analytics.categories.map(({ key, name, total, count, monthly_limit, percent, limit_used_percent, budget_status }) => ({
        key,
        name,
        total,
        count,
        monthly_limit,
        percent,
        limit_used_percent,
        budget_status
      })),
      members: analytics.members.map(({ key, name, total, count }) => ({ key, name, total, count })),
      trend_months: analytics.trend_months,
      labels: analytics.labels
    };
  }

  function queueAnalyticsSnapshot(month = selectedMonth()) {
    if (state.demo || !month) return;
    analyticsSnapshotMonths.add(month);
  }

  function flushAnalyticsSnapshotQueue() {
    if (state.demo || !analyticsSnapshotMonths.size) return;
    const months = [...analyticsSnapshotMonths];
    analyticsSnapshotMonths.clear();
    persistAnalyticsSnapshots(months).catch(showError);
  }

  async function persistAnalyticsSnapshots(months) {
    if (!state.family?.id || !state.user?.id || !state.familyKey || state.privacyLocked) return;
    const uniqueMonths = [...new Set(months.filter((month) => /^\d{4}-\d{2}$/.test(month)))];
    for (const month of uniqueMonths) {
      const payload = analyticsSnapshotPayload(month);
      const encryptedPayload = await encryptJson(state.familyKey, payload);
      const { error } = await client.from("budget_analytics_snapshots").upsert({
        family_id: state.family.id,
        month_key: month,
        encrypted_payload: encryptedPayload,
        encryption_version: 1,
        computed_at: new Date().toISOString(),
        computed_by: state.user.id
      }, { onConflict: "family_id,month_key" });
      if (error) throw error;
    }
  }

  function render() {
    if (visualMode) {
      app.innerHTML = visualActivityScreen();
      bind();
      return;
    }

    const needsConfig = !hasSupabase && !state.preview;
    const needsAuth = !state.user;
    const needsSetup = state.user && !state.family;
    app.innerHTML = `
      <div class="shell ${state.family ? "has-family" : ""}">
        ${state.family ? sidebar() : ""}
        <main class="app">
          ${topbar()}
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
          ${state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ""}
          ${needsConfig ? configScreen() : state.checkingSession ? loadingScreen() : needsAuth ? authScreen() : needsSetup ? setupScreen() : appScreen()}
        </main>
      </div>
      ${state.user && state.family ? bottomNav() : ""}
      ${state.modal ? modal() : ""}
    `;
    bind();
    if (!state.modal && !tourActive() && refreshAfterModal) {
      refreshAfterModal = false;
      queueRefresh(0);
    }
    // Last, and every render: the tour lives outside #app so it survives the
    // innerHTML wipe, but its target element does not. Re-resolve, never cache.
    syncTour();
  }

  function visualActivityScreen() {
    return `
      <main class="visual-stage">
        <div class="activity-block">
          <div class="activity-head">
            <h2>Recent Activity</h2>
            <button class="activity-link" type="button">SEE ALL</button>
          </div>
          <div class="card activity-list-card stitch-reference-card">
            <div class="activity-list">
              ${stitchActivityRow("S", "Spencer's Retail", "Groceries", "Today, 2:14 PM", "-₹4,280", "#dce7e7", "#0b3d2c")}
              ${stitchActivityRow("U", "Urban Company", "Services", "Yesterday", "-₹1,200", "#dfe5e5", "#0b3d2c")}
              ${stitchActivityRow("M", "Monthly Salary", "Income", "Oct 01", "+₹1,25,000", "#dce7e0", "#0b3d2c", true)}
            </div>
          </div>
        </div>
      </main>
    `;
  }

  function stitchActivityRow(initial, title, category, when, amount, background, color, positive = false) {
    return `
      <article class="activity-row">
        <span class="activity-spender stitch-icon" style="background:${background};color:${color}">${escapeHtml(initial)}</span>
        <div class="activity-main">
          <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
          <span>${escapeHtml(category)} · ${escapeHtml(when)}</span>
        </div>
        <div class="activity-side">
          <strong class="${positive ? "positive" : ""}">${escapeHtml(amount)}</strong>
        </div>
      </article>
    `;
  }

  function topbar() {
    const title = isDesktopMode() ? (state.family ? state.family.name : "Budget Padmanabham") : screenTitle();
    return `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">₹</div>
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${state.family ? "Family ledger" : "Family expense tracker"}</p>
          </div>
        </div>
        ${state.user ? `
          <div class="top-actions">
            ${state.family ? `<button class="topbar-chip ${state.tab === "family" ? "active" : ""}" data-tab="family">Fam</button>` : ""}
            ${state.preview ? "" : `<button class="icon-button" data-action="signout" title="Sign out">↪</button>`}
          </div>
        ` : ""}
      </header>
    `;
  }

  function screenTitle() {
    if (!state.family) return "Budget Padmanabham";
    if (state.tab === "dashboard") return "Dashboard";
    if (state.tab === "expenses") return "Expenses";
    if (state.tab === "insights") return "Insights";
    if (state.tab === "income") return "Income";
    if (state.tab === "categories") return "Categories";
    if (state.tab === "family") return "Family & Account";
    return state.family.name;
  }

  function loadingScreen() {
    return `
      <section class="auth card">
        <div class="auth-mark">₹</div>
        <h2>Opening your family tracker</h2>
        <p>Checking your saved Gmail login. You only need to sign in again if the previous session has expired or you signed out.</p>
      </section>
    `;
  }

  function authScreen() {
    return `
      <section class="auth card">
        <div class="auth-mark">₹</div>
        <h2>Budget Padmanabham</h2>
        <p>Shared family expenses with Gmail login and browser-side encrypted expense entries.</p>
        <label class="terms-check">
          <input type="checkbox" data-accept-terms>
          <span>I accept the Terms and Data Collection Policy.</span>
        </label>
        <div class="legal-copy">
          <strong>Simple terms</strong>
          <p>This app stores your Gmail profile and the minimum membership records needed to let approved family members sign in. Family content such as family name, member display names, category names, category limits, monthly plan, expenses, income, and analytics is encrypted in your browser with the family privacy password before it is sent to Supabase. Supabase can still see sign-in emails, user ids, row ids, timestamps, invite/request status, and encrypted text, but it cannot read the family financial content. We do not collect bank logins, card numbers, location, or the family privacy password. If all approved members lose the privacy password, encrypted records cannot be recovered. <a href="./terms.html" target="_blank" rel="noreferrer">Read full terms and privacy policy.</a></p>
        </div>
        <button class="google-button" data-action="google">
          <span class="g-icon">G</span>
          <span>Continue with Gmail</span>
        </button>
      </section>
    `;
  }

  function configScreen() {
    return `
      <section class="auth card">
        <div class="auth-mark">₹</div>
        <h2>Setup needed</h2>
        <p>This deployment needs <strong>config.js</strong> with the Supabase URL and publishable key before family data can be used.</p>
        <a class="button-link" href="?preview=1">Open design preview</a>
      </section>
    `;
  }

  function setupScreen() {
    const defaultName = state.user?.user_metadata?.full_name || state.user?.email?.split("@")[0] || "";
    const createDraft = readFormDraft("create-family");
    const joinDraft = readFormDraft("join-family");
    return `
      <section class="entry-panel">
        <div class="choice-hero">
          <span class="secure-pill">First step</span>
          <h2>Join your family, or start one</h2>
          <p>If someone sent you a family code and password, enter them below and you are straight in. If you are the first one here, create the family and share those two things with everyone else.</p>
        </div>
        <div class="setup-grid">
          <form class="card panel setup-card join-choice" data-form="join-family">
            <span class="choice-number">1</span>
            <h2>I have a family code</h2>
            <p class="section-subtitle">Enter both and you are in. Nobody needs to approve you.</p>
            <label class="field">Family code<input class="input code-input" name="code" value="${escapeHtml(joinDraft.code || "")}" placeholder="BUDGET-XXXXXXXXXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
            ${passwordField("Family password", joinDraft.privacy, { hint: "The same password everyone in your family uses. Ask whoever sent you the code." })}
            <label class="field">Your name<input class="input" name="person" value="${escapeHtml(joinDraft.person || defaultName)}" required><small>How your spending shows up to the family.</small></label>
            <button class="primary wide" type="submit">Join family</button>
          </form>
          <form class="card panel setup-card create-choice" data-form="create-family">
            <span class="choice-number">2</span>
            <h2>Start a new family</h2>
            <p class="section-subtitle">Use this if you are the first person setting things up.</p>
            <label class="field">Family name<input class="input" name="family" value="${escapeHtml(createDraft.family || "")}" placeholder="Padmanabham Family" required></label>
            <label class="field">Your name<input class="input" name="person" value="${escapeHtml(createDraft.person || defaultName)}" required></label>
            ${passwordField("Create a family password", createDraft.privacy, { isNew: true, hint: "At least 8 characters. This is what scrambles your family's money data before it leaves this device, so nobody else can read it. Share it with your family along with the code. If everyone forgets it, the data cannot be recovered." })}
            <button class="secondary wide" type="submit">Create family</button>
          </form>
        </div>
        <p class="entry-footnote">You can set a monthly budget and a savings goal later, once you have added a few expenses and know what looks normal.</p>
      </section>
    `;
  }

  function appScreen() {
    if (!state.preview && state.family?.encryption_salt && state.privacyLocked && state.tab !== "family") return privacyUnlockScreen();
    if (!state.preview && !state.family?.encryption_salt && state.tab !== "family") return privacySetupScreen();
    return `
      ${state.tab === "dashboard" ? dashboardScreen() : ""}
      ${state.tab === "expenses" ? expensesScreen() : ""}
      ${state.tab === "insights" ? insightsScreen() : ""}
      ${state.tab === "income" ? incomeScreen() : ""}
      ${state.tab === "categories" ? categoriesScreen() : ""}
      ${state.tab === "family" ? familyScreen() : ""}
      ${state.tab === "goals" ? goalsScreen() : ""}
    `;
  }

  function sidebar() {
    return `
      <aside class="sidebar" data-tour="sidebar">
        <div class="side-title">
          <strong>Budget Padmanabham</strong>
          <span>Family Steward</span>
        </div>
        ${navButton("dashboard", "Dashboard")}
        ${navButton("expenses", "Expenses")}
        ${navButton("insights", "Insights")}
        ${navButton("income", "Income")}
        ${navButton("categories", "Categories")}
        ${navButton("family", "Family")}
        <button class="side-add" data-modal="expense">+ Add Transaction</button>
      </aside>
    `;
  }

  function navButton(id, label) {
    return `<button class="side-link ${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
  }

  function bottomNav() {
    return `
      <nav class="bottom-nav" data-tour="nav">
        ${mobileNavButton("dashboard", "⌂", "Home")}
        ${mobileNavButton("insights", "▤", "Insights")}
        ${mobileNavButton("income", "▣", "Income")}
        ${mobileNavButton("categories", "◇", "Categories")}
        ${mobileNavButton("family", "☷", "Family")}
      </nav>
      <button class="floating-add" data-modal="expense" data-tour="fab" aria-label="Add expense">+</button>
    `;
  }

  function mobileNavButton(tab, icon, label) {
    return `
      <button class="${state.tab === tab ? "active" : ""}" data-tab="${tab}">
        <span>${icon}</span>
        <small>${label}</small>
      </button>
    `;
  }

  function privacyUnlockScreen() {
    const draft = readFormDraft("privacy-unlock");
    return `
      <section class="auth card">
        <div class="auth-mark">₹</div>
        <h2>Unlock family ledger</h2>
        <p>Enter the family privacy password to decrypt this family's plan, categories, people, expenses, income, and insights on this device.</p>
        <form data-form="privacy-unlock">
          ${passwordField("Family privacy password", draft.privacy)}
          <button class="primary wide" type="submit">Unlock family ledger</button>
        </form>
      </section>
    `;
  }

  function privacySetupScreen() {
    const isOwner = state.membership?.role === "OWNER";
    const draft = readFormDraft("privacy-setup");
    return `
      <section class="auth card">
        <div class="auth-mark">₹</div>
        <h2>Set family privacy</h2>
        <p>${isOwner ? "Create a family privacy password before entering family data. It encrypts the monthly plan, categories, people, expenses, income, and insights in the browser before saving." : "The person who created this family needs to set the family password before anything can be entered."}</p>
        ${isOwner ? `
          <form data-form="privacy-setup">
            ${passwordField("Family privacy password", draft.privacy, { isNew: true })}
            <button class="primary wide" type="submit">Turn on encryption</button>
          </form>
        ` : `<button class="secondary wide" data-tab="family">Open family page</button>`}
      </section>
    `;
  }

  function dashboardScreen() {
    const analytics = analyticsForMonth(currentMonth());
    const spend = analytics.totals.spend;
    const income = analytics.totals.income;
    const savings = analytics.totals.savings;
    const homeIncome = state.preview ? 142500 : income;
    const homeSavings = state.preview ? 58180 : Math.max(savings, 0);
    const budget = analytics.totals.monthly_budget;
    const used = budget ? Math.min(100, Math.round(analytics.totals.budget_used_percent || 0)) : 0;
    const expenseUsed = used;
    const recent = monthExpenses().slice(0, 3);
    const memberTotals = totalsBy(monthExpenses(), (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const archives = previousMonthSummaries(4);
    const savingsGoal = analytics.totals.savings_goal_amount;
    const savingsSubtitle = state.preview
      ? `House Fund: <b>${money(42000)}</b>`
      : savingsGoal
      ? `${analytics.labels.savings_progress} of ${money(savingsGoal)}`
      : "Set a savings goal";

    return `
      <section class="period-row">
        <span>Current period</span>
        <b>${monthLabel(currentMonth())}</b>
        <em>INR (₹)</em>
      </section>
      <section class="home-balance-card" data-tour="balance">
        <div>
          <span>Total Monthly Income</span>
          <strong>${money(homeIncome)}</strong>
          <small>${state.preview ? "+8.2% vs last month" : analytics.labels.income_change}</small>
        </div>
      </section>
      <section class="home-card-stack" data-tour="summary">
        <article class="finance-summary-card card expense-summary${budget ? "" : " no-budget"}">
          <div>
            <span>Expenses</span>
            <strong>${money(spend)}</strong>
            <!-- No budget is the default for a new family, so say something useful
                 instead of "0% of monthly budget used", which implies one exists. -->
            <small>${budget ? `${expenseUsed || 0}% of monthly budget used` : "Set a monthly budget in Family to track this"}</small>
          </div>
          <b>₹</b>
          ${budget ? `<i class="${expenseUsed >= 100 ? "over" : expenseUsed >= 80 ? "near" : ""}" style="width:${Math.min(100, Math.max(5, expenseUsed))}%"></i>` : ""}
        </article>
        <article class="finance-summary-card card savings-summary">
          <div>
            <span>Savings goal</span>
            <strong>${money(homeSavings)}</strong>
            <small>${state.preview ? savingsSubtitle : escapeHtml(savingsSubtitle)}</small>
          </div>
          <b>✓</b>
        </article>
      </section>
      <section class="budget-status-block">
        <h2>Budget Status</h2>
        <div class="status-grid">
          ${state.preview ? `
            <article class="status-card ${spend > budget && budget ? "warn" : "ok"}">
              <span>Dining</span>
              <strong>${spend > budget && budget ? `Over ${money(spend - budget)}` : "Within limit"}</strong>
            </article>
            <article class="status-card ok">
              <span>Utilities</span>
              <strong>Within limit</strong>
            </article>
          ` : budgetStatusCards(analytics)}
        </div>
      </section>
      <section class="dashboard-grid">
        <div class="activity-block recent-panel" data-tour="recent">
          <div class="activity-head">
            <h2>Recent Activity</h2>
            <button class="activity-link" data-tab="expenses">SEE ALL</button>
          </div>
          <div class="card activity-list-card">
            <div class="activity-list">
              ${state.preview ? previewDashboardActivityRows() : recent.length ? recent.map(recentActivityRow).join("") : emptyState("No expenses yet", "Tap Add expense and record the first one.")}
            </div>
          </div>
        </div>
        <aside class="card panel">
          <h2>Monthly picture</h2>
          <div class="summary-line"><span>Income</span><strong>${money(income)}</strong></div>
          <div class="summary-line"><span>Expenses</span><strong>${money(spend)}</strong></div>
          <div class="summary-line"><span>Budget used</span><strong>${budget ? `${used}%` : "Not set"}</strong></div>
          <p class="month-reset-note">This view starts fresh automatically on the 1st. Older expenses stay in Previous months.</p>
          ${budgetRows()}
          <button class="secondary wide" data-tab="categories">Manage categories</button>
          <div class="archive-card">
            <strong>Previous months</strong>
            ${archives.length ? archives.map((row) => `
              <button data-month-jump="${row.key}">
                <span>${monthLabel(row.key)} · ${row.count} entries</span>
                <strong>${money(row.total)}</strong>
              </button>
            `).join("") : `<p>No previous months yet.</p>`}
          </div>
          <div class="family-card">
            <strong>Family Contributions</strong>
            ${memberTotals.length ? miniBars(memberTotals) : "<p>No entries this month.</p>"}
          </div>
        </aside>
      </section>
    `;
  }

  function budgetStatusCards(analytics) {
    const rows = categoryBudgetRows(analytics, 2);
    if (rows.length) {
      return rows.map((row) => {
        const over = row.budget_status === "OVER";
        const status = row.monthly_limit
          ? over ? `Over by ${money(row.total - row.monthly_limit)}` : `${Math.min(100, Math.round(row.limit_used_percent || 0))}% used`
          : money(row.total);
        return `
          <article class="status-card ${over ? "warn" : "ok"}">
            <span>${escapeHtml(row.name)}</span>
            <strong>${escapeHtml(status)}</strong>
          </article>
        `;
      }).join("");
    }
    const overMonthly = analytics.totals.monthly_budget && analytics.totals.spend > analytics.totals.monthly_budget;
    return `
      <article class="status-card ${overMonthly ? "warn" : "ok"}">
        <span>Monthly budget</span>
        <strong>${escapeHtml(analytics.labels.budget_status)}</strong>
      </article>
      <article class="status-card ok">
        <span>Savings</span>
        <strong>${money(Math.max(analytics.totals.savings, 0))}</strong>
      </article>
    `;
  }

  function metric(label, value, sub) {
    return `<article class="metric card"><span>${label}</span><strong>${value}</strong><small>${sub}</small></article>`;
  }

  function recentActivityRow(expense) {
    const category = categoryName(expense.category_id);
    const color = categoryColor(expense.category_id);
    const person = personName(expense.person_id);
    return `
      <article class="activity-row">
        <span class="activity-spender" title="${escapeHtml(person)}" aria-label="${escapeHtml(person)}" style="background:${softColor(color)};color:${color}">${personInitial(person)}</span>
        <div class="activity-main">
          <strong title="${escapeHtml(expense.title)}">${escapeHtml(expense.title)}</strong>
          <span>${escapeHtml(person)} · ${escapeHtml(category)} · ${activityWhen(expense)}</span>
        </div>
        <div class="activity-side">
          <strong>-${money(expense.amount)}</strong>
        </div>
      </article>
    `;
  }

  function previewDashboardActivityRows() {
    return [
      stitchActivityRow("R", "Spencer's Retail", "Groceries", "Today, 2:14 PM", "-₹4,280", "#e3e7ea", "#0b3d2c"),
      stitchActivityRow("L", "Urban Company", "Services", "Yesterday", "-₹1,200", "#eaded9", "#0b3d2c"),
      stitchActivityRow("A", "Monthly Salary", "Income", "Oct 01", "+₹1,25,000", "#dce7e0", "#0b3d2c", true)
    ].join("");
  }

  function activityWhen(expense) {
    if (expense.spent_on === todayKey()) {
      return "Today";
    }
    if (expense.spent_on === relativeDateKey(-1)) return "Yesterday";
    return shortDate(expense.spent_on);
  }

  function relativeDateKey(offsetDays) {
    const date = new Date(`${todayKey()}T00:00:00`);
    date.setDate(date.getDate() + offsetDays);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function budgetRows() {
    const rows = totalsBy(monthExpenses(), (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id));
    if (!rows.length) return emptyState("No category spend", "Category caps appear after expenses are added.");
    return rows.slice(0, 4).map((row) => `
      <div class="budget-row">
        <div><strong>${escapeHtml(row.name)}</strong><span>${money(row.total)}</span></div>
        <div class="bar"><i style="width:${Math.min(100, row.total / Math.max(monthlySpend(), 1) * 100)}%;background:${row.color}"></i></div>
      </div>
    `).join("");
  }

  function expensesScreen() {
    const month = selectedMonth();
    const start = rangeStart();
    const end = rangeEnd();
    const list = sortedExpenses(start, end);
    const total = list.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const rangeIncome = incomeForRange(start, end);
    const rangeSavings = rangeIncome - total;
    const members = totalsBy(list, (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const categories = totalsBy(list, (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id));
    const topCategory = categories[0]?.name || "None";
    // Exactly one of these three is selected, derived from a single expression.
    // Previously "This month"/"Previous" were derived from the DATES while
    // "Custom" was derived from state.rangeMode. Clicking Custom sets the mode
    // but leaves the dates at full-month bounds, so the date-derived tab stayed
    // lit too and two tabs appeared selected at once.
    const hasCustomRange = start !== monthStart(month) || end !== monthEnd(month);
    const activeRange = state.rangeMode === "custom" || hasCustomRange
      ? "custom"
      : month === currentMonth()
      ? "month"
      : "previous";
    const showCustomDates = activeRange === "custom";
    return `
      <section class="all-expenses-screen">
        <header class="all-expenses-header">
          <button class="icon-only soft-icon" type="button" data-tab="dashboard" aria-label="Back to home">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>
          </button>
          <div>
            <h2>All expenses</h2>
            <p>${escapeHtml(rangeLabel(start, end))}</p>
          </div>
          <button class="icon-only soft-icon" type="button" aria-label="More options">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8h.01"></path><path d="M12 12h.01"></path><path d="M12 16h.01"></path></svg>
          </button>
        </header>

        <div class="expense-period-tabs" role="group" aria-label="Expense date range">
          <button class="${activeRange === "month" ? "active" : ""}" type="button" aria-pressed="${activeRange === "month"}" data-month-current>This month</button>
          <button class="${activeRange === "previous" ? "active" : ""}" type="button" aria-pressed="${activeRange === "previous"}" data-month-shift="-1">Previous</button>
          <button class="${activeRange === "custom" ? "active" : ""}" type="button" aria-pressed="${activeRange === "custom"}" data-expense-custom>Custom</button>
        </div>

        ${showCustomDates ? `
          <div class="compact-date-range">
            <label>From<input type="date" data-date-from value="${escapeHtml(start)}"></label>
            <label>To<input type="date" data-date-to value="${escapeHtml(end)}"></label>
          </div>
        ` : ""}

        <!-- Income and savings for the SELECTED range, not just the month.
             Savings keeps its sign: a family that overspends needs to see that,
             and every other screen clamps it to zero with Math.max(0, ...). -->
        <section class="expense-stat-strip" aria-label="Range summary">
          ${expenseStatCard("Income", money(rangeIncome))}
          ${expenseStatCard("Spent", money(total))}
          ${expenseStatCard(rangeSavings < 0 ? "Overspent" : "Saved", money(Math.abs(rangeSavings)), rangeSavings < 0 ? "negative" : rangeSavings > 0 ? "positive" : "")}
        </section>
        <section class="expense-stat-substrip" aria-label="Expense detail">
          <span><b>${list.length}</b> ${list.length === 1 ? "entry" : "entries"}</span>
          <span>Highest: <b>${escapeHtml(topCategory)}</b></span>
        </section>

        <div class="expense-filter-row">
          <label class="sort-pill">
            <span>Sort</span>
            <select data-sort>
              <option value="date" ${state.sort === "date" ? "selected" : ""}>Date</option>
              <option value="category" ${state.sort === "category" ? "selected" : ""}>Category</option>
              <option value="person" ${state.sort === "person" ? "selected" : ""}>Person</option>
              <option value="amount" ${state.sort === "amount" ? "selected" : ""}>Amount</option>
            </select>
          </label>
          <label class="expense-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path></svg>
            <input type="search" data-expense-search value="${escapeHtml(state.expenseSearch || "")}" placeholder="Find">
          </label>
        </div>

        <section class="expense-analysis-list stitch-analysis-list">
          ${analysisSection("Who spent how much", members.slice(0, 5))}
          ${analysisSection("By category", categories.slice(0, 5))}
        </section>

        <div class="transaction-section-title">
          <span>Recent transactions</span>
          <b>${list.length}</b>
        </div>
        <div class="expense-scroll-list stitch-expense-list">
          ${list.length ? list.map((expense) => expenseRow(expense, { variant: "ledger" })).join("") : emptyState("No expenses in this range", "Change the dates or add a new expense.")}
        </div>
      </section>
    `;
  }

  function expenseStatCard(label, value, tone = "") {
    return `
      <article class="expense-stat-card ${tone}">
        <span>${escapeHtml(label)}</span>
        <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      </article>
    `;
  }

  function rangeLabel(start, end) {
    const year = String(start || "").slice(0, 4);
    const endYear = String(end || "").slice(0, 4);
    if (start === monthStart(selectedMonth()) && end === monthEnd(selectedMonth())) return monthLabel(selectedMonth());
    return year && year === endYear ? `${shortDate(start)} - ${shortDate(end)}` : `${niceDate(start)} - ${niceDate(end)}`;
  }

  function analysisSection(title, rows) {
    return `
      <section class="analysis-section">
        <h3>${escapeHtml(title)}</h3>
        ${rows.length ? analysisRows(rows) : `<p>No spending in this range.</p>`}
      </section>
    `;
  }

  function analysisRows(rows) {
    const max = Math.max(...rows.map((row) => row.total), 1);
    return rows.map((row) => `
      <article class="analysis-row">
        <div>
          <span>${escapeHtml(row.name)}</span>
          <strong>${money(row.total)}</strong>
        </div>
        <div class="analysis-line"><i style="width:${Math.max(4, (row.total / max) * 100)}%;background:${row.color}"></i></div>
      </article>
    `).join("");
  }

  function sortedExpenses(start = rangeStart(), end = rangeEnd()) {
    const search = String(state.expenseSearch || "").trim().toLocaleLowerCase();
    const list = expensesForRange(start, end).filter((expense) => {
      if (!search) return true;
      return [
        expense.title,
        expense.note,
        categoryName(expense.category_id),
        personName(expense.person_id),
        niceDate(expense.spent_on)
      ].some((value) => String(value || "").toLocaleLowerCase().includes(search));
    });
    if (state.sort === "person") return list.sort((a, b) => personName(a.person_id).localeCompare(personName(b.person_id)));
    if (state.sort === "category") return list.sort((a, b) => categoryName(a.category_id).localeCompare(categoryName(b.category_id)));
    if (state.sort === "amount") return list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    return list.sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)));
  }

  function expenseRow(expense, options = {}) {
    const isCompact = Boolean(options.compact);
    const isLedger = options.variant === "ledger";
    const category = categoryName(expense.category_id);
    const color = categoryColor(expense.category_id);
    const person = personName(expense.person_id);
    if (isCompact) {
      return `
        <article class="item compact-expense-item">
          <span class="avatar" title="${escapeHtml(person)}" aria-label="${escapeHtml(person)}" style="background:${softColor(color)};color:${color}">${personInitial(person)}</span>
          <div class="item-main">
            <strong class="expense-title-tag" title="${escapeHtml(expense.title)}">${escapeHtml(expense.title)}</strong>
            <span class="compact-meta"><b>${money(expense.amount)}</b><i>${escapeHtml(category)}</i></span>
          </div>
        </article>
      `;
    }

    if (isLedger) {
      return `
        <article class="item expense-item stitch-expense-item">
          <span class="avatar" title="${escapeHtml(person)}" aria-label="${escapeHtml(person)}" style="background:${softColor(color)};color:${color}">${personInitial(person)}</span>
          <div class="item-main">
            <div class="expense-ledger-top">
              <strong class="expense-title-tag" title="${escapeHtml(expense.title)}">${escapeHtml(expense.title)}</strong>
            </div>
            <span class="expense-meta"><i>${escapeHtml(category)}</i><i>${escapeHtml(person)}</i><i>${activityWhen(expense)}</i></span>
            ${recurrenceChip(expense)}
            ${expense.note ? `<small>${escapeHtml(expense.note)}</small>` : ""}
          </div>
          <div class="item-side">
            <strong class="ledger-amount">${money(expense.amount)}</strong>
            ${expenseActions(expense)}
          </div>
        </article>
      `;
    }

    return `
      <article class="item expense-item">
        <span class="avatar" title="${escapeHtml(person)}" aria-label="${escapeHtml(person)}" style="background:${softColor(color)};color:${color}">${personInitial(person)}</span>
        <div class="item-main">
          <strong class="expense-title-tag" title="${escapeHtml(expense.title)}">${escapeHtml(expense.title)}</strong>
          <span class="expense-meta"><i>${escapeHtml(category)}</i><i>${niceDate(expense.spent_on)}</i></span>
          ${recurrenceChip(expense)}
          ${expense.note ? `<small>${escapeHtml(expense.note)}</small>` : ""}
        </div>
        <div class="item-side">
          <strong>${money(expense.amount)}</strong>
          ${expenseActions(expense)}
        </div>
      </article>
    `;
  }

  function expenseActions(expense) {
    const title = expense.title || "expense";
    return `
      <div class="item-actions">
        ${iconAction("edit", expense.id, `Edit ${title}`)}
        ${iconAction("delete", expense.id, `Delete ${title}`)}
        ${isRecurringExpense(expense) ? lifecycleActions(expense, "expense") : ""}
      </div>
    `;
  }

  function recurrenceChip(expense) {
    if (!isRecurringExpense(expense)) return "";
    const paused = lifecycleOf(expense) !== "ACTIVE";
    return `<span class="status-chip ${paused ? (lifecycleOf(expense) === "PAUSED" ? "is-paused" : "is-stopped") : "is-repeat"}">↻ ${escapeHtml(cadenceShort(expense))}${paused ? ` · ${lifecycleOf(expense) === "PAUSED" ? "Paused" : "Stopped"}` : ""}</span>`;
  }

  function iconAction(action, id, label) {
    const isDelete = action === "delete";
    const attribute = isDelete ? `data-delete-expense="${escapeHtml(id)}"` : `data-edit-expense="${escapeHtml(id)}"`;
    const svg = isDelete
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
    return `<button class="icon-action ${isDelete ? "danger-icon" : ""}" type="button" ${attribute} aria-label="${escapeHtml(label)}" title="${isDelete ? "Delete" : "Edit"}">${svg}</button>`;
  }

  function insightsScreen() {
    if (!isDesktopMode()) return mobileInsightsScreen();
    const spend = monthlySpend();
    const income = monthlyIncome();
    const categories = totalsBy(monthExpenses(), (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id));
    const members = totalsBy(monthExpenses(), (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const months = monthlyHistory();
    const largest = [...monthExpenses()].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 8);
    const byDate = totalsBy(monthExpenses(), (e) => e.spent_on, (e) => shortDate(e.spent_on), () => COLORS[3]).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const average = monthExpenses().length ? spend / monthExpenses().length : 0;
    const tabs = [
      ["overview", "Overview"],
      ["categories", "Categories"],
      ["members", "Members"],
      ["months", "Months"],
      ["records", "Records"]
    ];
    return `
      <section class="insight-header card">
        <div>
          <span class="secure-pill">Desktop insights</span>
          <h2>Family finance insights</h2>
          <p>Charts are calculated in this browser after encrypted expenses are unlocked.</p>
        </div>
        <div class="insight-tabs">
          ${tabs.map(([id, label]) => `<button class="${state.insightTab === id ? "active" : ""}" data-insight-tab="${id}">${label}</button>`).join("")}
        </div>
      </section>
      <section class="metric-grid">
        ${metric("Total balance", money(income - spend), "+ this month")}
        ${metric("Monthly spend", money(spend), `${monthExpenses().length} expenses`)}
        ${metric("Income", money(income), "Active recurring")}
        ${metric("Average expense", money(average), "Per entry")}
      </section>
      ${state.insightTab === "overview" ? `
        <section class="dashboard-grid">
          <div class="card panel">
            <h2>Default chart</h2>
            ${donut(donutRows(categories))}
            ${miniBars(categories)}
          </div>
          <div class="card panel">
            <h2>Daily spend this month</h2>
            ${byDate.length ? verticalBars(byDate) : emptyState("No daily chart", "Add expenses to see spending by day.")}
          </div>
        </section>
      ` : ""}
      ${state.insightTab === "categories" ? `
        <section class="card panel">
          <h2>Categories sorted by spend</h2>
          ${categories.length ? insightTable(categories, ["Category", "Entries", "Spend"]) : emptyState("No category spend", "Add expenses with categories.")}
        </section>
      ` : ""}
      ${state.insightTab === "members" ? `
        <section class="card panel">
          <h2>Family member spending</h2>
          ${members.length ? insightTable(members, ["Member", "Entries", "Spend"]) : emptyState("No member spend", "Add expenses to compare members.")}
        </section>
      ` : ""}
      ${state.insightTab === "months" ? `
        <section class="card panel">
          <h2>Monthly history</h2>
          ${months.length ? verticalBars(months.map((row) => ({ name: monthLabel(row.month), total: row.total, color: COLORS[5] }))) : emptyState("No history", "Past months appear here.")}
          ${months.length ? months.map((row) => `<div class="history-row"><span>${monthLabel(row.month)}</span><strong>${money(row.total)}</strong></div>`).join("") : ""}
        </section>
      ` : ""}
      ${state.insightTab === "records" ? `
        <section class="card panel">
          <h2>Largest expenses this month</h2>
          ${largest.length ? largest.map(expenseRow).join("") : emptyState("No records", "Largest expenses appear after entries are added.")}
        </section>
      ` : ""}
    `;
  }

  function mobileInsightsScreen() {
    if (state.preview) return previewMobileInsightsScreen();
    const analytics = analyticsForMonth(currentMonth());
    const savings = Math.max(analytics.totals.savings, 0);
    const categories = analytics.categories;
    const members = analytics.members;
    const savingsGoal = analytics.totals.savings_goal_amount;
    const savingsProgress = Math.min(100, Math.max(0, Math.round(analytics.totals.savings_progress_percent || 0)));
    const breakdown = donutRows(categories);
    return `
      <section class="mobile-insight-metrics">
        <article class="card insight-mini">
          <span>Total balance</span>
          <strong>${money(savings)}</strong>
          <small>${escapeHtml(analytics.labels.spend_change)}</small>
        </article>
        <article class="card insight-mini">
          <span>Savings goal</span>
          <strong>${savingsGoal ? money(savingsGoal) : "Not set"}</strong>
          <i><b style="width:${savingsGoal ? savingsProgress : 0}%"></b></i>
          <small>${escapeHtml(analytics.labels.savings_progress)}</small>
        </article>
      </section>
      <section class="card panel mobile-chart-card">
        <div class="chart-head"><h2>Monthly Trend</h2><span>6 months</span></div>
        ${trendChart(analytics.trend_months)}
        <div class="trend-months">
          ${analytics.trend_months.map((row, index) => index === analytics.trend_months.length - 1 ? `<strong>${escapeHtml(row.name)}</strong>` : `<span>${escapeHtml(row.name)}</span>`).join("")}
        </div>
      </section>
      <section class="card panel mobile-breakdown-card">
        <h2>Category Breakdown</h2>
        <div class="breakdown-layout">
          ${donut(breakdown)}
          ${donutLegend(breakdown)}
        </div>
      </section>
      <section class="card panel mobile-member-card">
        <h2>Spend by Family Member</h2>
        ${members.slice(0, 3).map((row) => `
          <article class="member-spend-row">
            <span class="avatar" style="background:${softColor(row.color)};color:${row.color}">${personInitial(row.name)}</span>
            <div><strong>${escapeHtml(row.name)}</strong><i><b style="width:${Math.max(8, (row.total / Math.max(members[0]?.total || 1, 1)) * 100)}%"></b></i></div>
            <em>${money(row.total)}</em>
          </article>
        `).join("")}
      </section>
    `;
  }

  function previewMobileInsightsScreen() {
    const spend = monthlySpend();
    const income = monthlyIncome();
    const savings = Math.max(income - spend, 0);
    // The charts are data-driven now, so preview needs the same analytics the
    // real screen uses rather than the hardcoded figures it carried before.
    const analytics = analyticsForMonth(currentMonth());
    const categories = totalsBy(monthExpenses(), (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id));
    const members = totalsBy(monthExpenses(), (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    return `
      <section class="mobile-insight-metrics">
        <article class="card insight-mini">
          <span>Total balance</span>
          <strong>${money(income + savings)}</strong>
          <small>↗ +4.2%</small>
        </article>
        <article class="card insight-mini">
          <span>Savings goal</span>
          <strong>${money(Math.max(savings, 1200000))}</strong>
          <i><b style="width:70%"></b></i>
          <small>70% achieved</small>
        </article>
      </section>
      <section class="card panel mobile-chart-card">
        <div class="chart-head"><h2>Monthly Trend</h2><span>Yearly⌄</span></div>
        ${trendChart(analytics.trend_months)}
        <div class="trend-months">
          ${analytics.trend_months.map((row, index) => index === analytics.trend_months.length - 1 ? `<strong>${escapeHtml(row.name)}</strong>` : `<span>${escapeHtml(row.name)}</span>`).join("")}
        </div>
      </section>
      <section class="card panel mobile-breakdown-card">
        <h2>Category Breakdown</h2>
        <div class="breakdown-layout">
          ${donut(donutRows(categories))}
          ${donutLegend(donutRows(categories))}
        </div>
      </section>
      <section class="card panel mobile-member-card">
        <h2>Spend by Family Member</h2>
        ${members.slice(0, 3).map((row) => `
          <article class="member-spend-row">
            <span class="avatar" style="background:${softColor(row.color)};color:${row.color}">${personInitial(row.name)}</span>
            <div><strong>${escapeHtml(row.name)}</strong><i><b style="width:${Math.max(8, (row.total / Math.max(members[0]?.total || 1, 1)) * 100)}%"></b></i></div>
            <em>${money(row.total)}</em>
          </article>
        `).join("")}
      </section>
    `;
  }

  /* --------------------------------------------------------------------------
     Category breakdown chart.

     The pie and its legend MUST be built from the same array, in the same order.
     Previously the mobile pie was a hardcoded CSS gradient (a 60/30/10 design
     mock) sitting beside a legend built from real data, so the slices and the
     labels described different things entirely.
     -------------------------------------------------------------------------- */

  /* --------------------------------------------------------------------------
     Trend chart: income and spending over six months.

     Replaces .trend-placeholder, which was a literal empty 220px box showing a
     single number. trend_months already carried per-month income and spend.

     Hand-rolled SVG rather than a chart library: the app has no build step and
     loads only Supabase from a CDN, and the CSP blocks every other origin.
     -------------------------------------------------------------------------- */

  // A "nice" axis maximum: 1, 2 or 5 x a power of ten, just above the data. Keeps
  // the gridline labels readable instead of showing values like 137,428.
  function niceAxisMax(value) {
    if (!(value > 0)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalised = value / magnitude;
    // Finer than the usual 1/2/5 ladder: with only three steps a peak of 2.7L
    // rounds to 5L and the chart wastes half its height. Halves keep the lines
    // filling the plot while the labels stay round.
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((candidate) => normalised <= candidate) || 10;
    return step * magnitude;
  }

  // Compact axis labels: 1.25L, 45K. Indian grouping, matching the currency.
  // Trailing zeros are trimmed rather than fixed to 1dp, so the midpoint of a
  // 2.5L axis reads 1.25L instead of being rounded to a wrong-looking 1.3L.
  function compactMoney(value) {
    const n = Number(value || 0);
    const trim = (x) => String(Number(x.toFixed(2)));
    if (n >= 10000000) return `₹${trim(n / 10000000)}Cr`;
    if (n >= 100000) return `₹${trim(n / 100000)}L`;
    if (n >= 1000) return `₹${trim(n / 1000)}K`;
    return `₹${Math.round(n)}`;
  }

  function trendChart(months) {
    const rows = months || [];
    if (rows.length < 2) return `<div class="trend-empty">Not enough history yet. This fills in as the months pass.</div>`;

    // Scale to the larger of the two series, so neither is clipped and their
    // relationship stays readable. The old max looked at spend only.
    const peak = Math.max(...rows.map((row) => Math.max(Number(row.income || 0), Number(row.spend || 0))), 0);
    const axisMax = niceAxisMax(peak);
    const width = 320;
    const height = 150;
    const padLeft = 4;
    const padRight = 4;
    const padTop = 8;
    const padBottom = 4;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const x = (index) => padLeft + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW);
    const y = (value) => padTop + plotH - (Math.min(Number(value || 0), axisMax) / axisMax) * plotH;

    const line = (key) => rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(row[key]).toFixed(1)}`).join(" ");
    const dots = (key, cls) => rows.map((row, index) =>
      `<circle class="${cls}" cx="${x(index).toFixed(1)}" cy="${y(row[key]).toFixed(1)}" r="2.5"></circle>`
    ).join("");

    // Area under spending, so the gap between the two lines reads at a glance.
    const spendArea = `M${x(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} ` +
      rows.map((row, index) => `L${x(index).toFixed(1)} ${y(row.spend).toFixed(1)}`).join(" ") +
      ` L${x(rows.length - 1).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

    const gridlines = [0, 0.5, 1].map((fraction) => {
      const gy = padTop + plotH - fraction * plotH;
      return `<line class="trend-grid" x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${gy.toFixed(1)}"></line>`;
    }).join("");

    return `
      <div class="trend-chart">
        <div class="trend-axis" aria-hidden="true">
          <span>${compactMoney(axisMax)}</span>
          <span>${compactMoney(axisMax / 2)}</span>
          <span>₹0</span>
        </div>
        <svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
             aria-label="Income and spending over the last ${rows.length} months. Highest value ${money(peak)}.">
          ${gridlines}
          <path class="trend-area" d="${spendArea}"></path>
          <path class="trend-line trend-spend" d="${line("spend")}"></path>
          <path class="trend-line trend-income" d="${line("income")}"></path>
          ${dots("spend", "trend-dot trend-spend-dot")}
          ${dots("income", "trend-dot trend-income-dot")}
        </svg>
      </div>
      <div class="trend-legend">
        <span class="trend-key trend-key-income">Income</span>
        <span class="trend-key trend-key-spend">Spent</span>
      </div>
    `;
  }

  const DONUT_SLICES = 5;
  const DONUT_OTHER_COLOR = "#9aa39b";

  // Top N by spend, with everything else rolled into one "Other" slice, so the
  // slices always add up to the total the centre label claims.
  function donutRows(categories, limit = DONUT_SLICES) {
    const rows = (categories || []).filter((row) => Number(row.total) > 0);
    if (rows.length <= limit) return rows;
    const head = rows.slice(0, limit - 1);
    const tail = rows.slice(limit - 1);
    return [...head, {
      key: "other",
      name: `Other (${tail.length})`,
      color: DONUT_OTHER_COLOR,
      total: tail.reduce((sum, row) => sum + Number(row.total || 0), 0),
      count: tail.reduce((sum, row) => sum + Number(row.count || 0), 0)
    }];
  }

  function donut(rows, centreLabel = "Total") {
    const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    // Zero total would make every stop NaN, which invalidates the whole
    // conic-gradient declaration and renders a blank white circle.
    if (!rows.length || total <= 0) {
      return `<div class="donut donut-empty"><span>${escapeHtml(centreLabel)}<br>${money(0)}</span></div>`;
    }
    let cursor = 0;
    const stops = rows.map((row, index) => {
      const start = cursor;
      // Snap the last stop to 100 so floating point cannot leave a hairline gap.
      cursor = index === rows.length - 1 ? 100 : cursor + (Number(row.total) / total) * 100;
      return `${row.color || COLORS[0]} ${start}% ${cursor}%`;
    });
    return `<div class="donut" style="background:conic-gradient(${stops.join(",")})"><span>${escapeHtml(centreLabel)}<br>${money(total)}</span></div>`;
  }

  // Legend for the donut above. Percentages are of the charted total, so they
  // always sum to 100 and match the slice each one sits next to.
  function donutLegend(rows) {
    const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    if (!rows.length || total <= 0) {
      return `<div class="legend-list"><div><span>No category spend yet</span><strong>0%</strong></div></div>`;
    }
    return `
      <div class="legend-list">
        ${rows.map((row) => `
          <div>
            <i style="background:${escapeHtml(row.color || COLORS[0])}"></i>
            <span title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
            <strong>${Math.round((Number(row.total) / total) * 100)}%</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function monthlyHistory() {
    const map = new Map();
    state.expenses.forEach((expense) => {
      const key = monthKey(expense.spent_on);
      map.set(key, (map.get(key) || 0) + Number(expense.amount || 0));
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, total]) => ({ month, total }));
  }

  function verticalBars(rows) {
    const max = Math.max(...rows.map((row) => row.total), 1);
    return `
      <div class="vertical-chart">
        ${rows.slice(-12).map((row) => `
          <div class="vertical-bar">
            <i style="height:${Math.max(8, (row.total / max) * 100)}%;background:${row.color || COLORS[0]}"></i>
            <span>${escapeHtml(row.name || row.month || row.key)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function insightTable(rows, headings) {
    return `
      <div class="insight-table">
        <div class="insight-row head">${headings.map((heading) => `<strong>${heading}</strong>`).join("")}</div>
        ${rows.map((row) => `
          <div class="insight-row">
            <span>${escapeHtml(row.name)}</span>
            <span>${row.count}</span>
            <strong>${money(row.total)}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function incomeScreen() {
    if (!isDesktopMode()) return mobileIncomeScreen();
    const rows = state.incomes;
    return `
      <section class="card panel">
        <div class="income-hero">
          <span>Total Recurring Monthly Income</span>
          <strong>${money(monthlyIncome())}</strong>
        </div>
        <div class="section-head">
          <h2>Recurring Income</h2>
          <button class="primary compact" data-modal="income">Add income</button>
        </div>
        ${rows.length ? rows.map(incomeRow).join("") : emptyState("No income yet", "Add salary, rent, pension, or other recurring income.")}
      </section>
    `;
  }

  function mobileIncomeScreen() {
    if (state.preview) return previewMobileIncomeScreen();
    const rows = state.incomes;
    const analytics = analyticsForMonth(currentMonth());
    const activeRows = rows.filter((income) => isIncomeActive(income) && !income.locked);
    const activePercent = rows.length ? Math.round((activeRows.length / rows.length) * 100) : 0;
    return `
      <section class="mobile-income-hero">
        <span>Total Recurring Monthly Income</span>
        <strong>${money(monthlyIncome())}</strong>
        <div class="income-hero-stats">
          <div><span>Still arriving</span><b>${String(activeRows.length).padStart(2, "0")}</b></div>
          <div><span>Next deposit</span><b>${escapeHtml(nextDepositLabel(activeRows))}</b></div>
        </div>
      </section>
      <section class="income-kpi-grid">
        <article class="card"><b>↗</b><strong>${escapeHtml(shortTrendValue(analytics.previous.income_change_percent))}</strong><span>v/s Last Month</span></article>
        <article class="card"><b>◎</b><strong>${activePercent}%</strong><span>Still arriving</span></article>
        <article class="card"><b>□</b><strong>Monthly</strong><span>Cycle</span></article>
      </section>
      <section class="mobile-list-title"><h2>Recurring Income</h2><button class="primary compact" data-modal="income">Add income</button></section>
      <section class="income-card-list">
        ${rows.map(mobileIncomeRow).join("")}
      </section>
    `;
  }

  function previewMobileIncomeScreen() {
    const rows = state.incomes;
    return `
      <section class="mobile-income-hero">
        <span>Total Recurring Monthly Income</span>
        <strong>${money(monthlyIncome())}</strong>
        <div class="income-hero-stats">
          <div><span>Still arriving</span><b>${String(rows.filter(isIncomeActive).length).padStart(2, "0")}</b></div>
          <div><span>Next deposit</span><b>Oct 01</b></div>
        </div>
      </section>
      <section class="income-kpi-grid">
        <article class="card"><b>↗</b><strong>+8%</strong><span>v/s Last Month</span></article>
        <article class="card"><b>◎</b><strong>100%</strong><span>Verified</span></article>
        <article class="card"><b>□</b><strong>Monthly</strong><span>Cycle</span></article>
      </section>
      <section class="mobile-list-title"><h2>Recurring Income</h2><button class="primary compact" data-modal="income">Add income</button></section>
      <section class="income-card-list">
        ${rows.map(mobileIncomeRow).join("")}
      </section>
    `;
  }

  function shortTrendValue(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "No data";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
  }

  function nextDepositLabel(rows) {
    if (!rows.length) return "None";
    const today = new Date();
    const currentDay = today.getDate();
    const next = rows
      .map((income) => Number(income.day_of_month || 1))
      .sort((a, b) => {
        const aDelta = a >= currentDay ? a - currentDay : a + 31 - currentDay;
        const bDelta = b >= currentDay ? b - currentDay : b + 31 - currentDay;
        return aDelta - bDelta;
      })[0];
    const date = new Date(today);
    if (next < currentDay) date.setMonth(date.getMonth() + 1);
    date.setDate(Math.min(next, 28));
    return new Intl.DateTimeFormat("en-IN", { month: "short", day: "2-digit" }).format(date);
  }

  function mobileIncomeRow(income) {
    const category = categoryName(income.category_id);
    return `
      <article class="card mobile-income-card">
        <span class="avatar">${String(income.title).slice(0, 1).toUpperCase()}</span>
        <div class="item-main">
          <strong>${escapeHtml(income.title)}</strong>
          <!-- Compact row: only label the exceptional state. "Receiving now" on
               every active row wrapped to two lines and said nothing useful. -->
          <span>${escapeHtml(category)} · ${escapeHtml(cadenceShort(income))}</span>
          ${lifecycleChip(income)}
        </div>
        <strong class="mobile-income-amount">${money(income.amount)}</strong>
        ${incomeActions(income)}
      </article>
    `;
  }

  function incomeRow(income) {
    const category = categoryName(income.category_id);
    return `
      <article class="item income-item">
        <span class="avatar">${String(income.title).slice(0, 1).toUpperCase()}</span>
        <div class="item-main">
          <strong>${escapeHtml(income.title)}</strong>
          <span>${escapeHtml(category)} · ${escapeHtml(cadenceLabel(income))} · Arrives day ${escapeHtml(String(income.day_of_month ?? 1))}</span>
          ${lifecycleChip(income)}
        </div>
        <div class="item-side">
          <strong>${money(income.amount)}</strong>
          ${incomeActions(income)}
        </div>
      </article>
    `;
  }

  function incomeActions(income) {
    return `
      <div class="item-actions income-actions">
        <button class="icon-action" data-edit-income="${income.id}" aria-label="Edit ${escapeHtml(income.title)}" title="Edit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        </button>
        <button class="icon-action" data-delete-income="${income.id}" aria-label="Delete ${escapeHtml(income.title)}" title="Delete">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path></svg>
        </button>
        ${lifecycleActions(income, "income")}
      </div>
    `;
  }

  function categoriesScreen() {
    const rows = state.categories.filter((category) => category.scope === state.scope);
    return `
      <section class="card panel">
        <div class="section-head">
          <h2>Categories</h2>
          <button class="primary compact" data-modal="category">Add category</button>
        </div>
        <div class="segmented">
          <button class="${state.scope === "EXPENSE" ? "active" : ""}" data-scope="EXPENSE">Expenses</button>
          <button class="${state.scope === "INCOME" ? "active" : ""}" data-scope="INCOME">Income</button>
        </div>
        ${rows.length ? rows.map(categoryRow).join("") : emptyState("No categories", "Add simple categories your family understands.")}
      </section>
    `;
  }

  function categoryRow(category) {
    const used = state.expenses.filter((expense) => expense.category_id === category.id).length + state.incomes.filter((income) => income.category_id === category.id).length;
    const limitText = category.scope === "EXPENSE" && Number(category.monthly_limit || 0) > 0 ? ` · Limit ${money(category.monthly_limit)}` : "";
    return `
      <article class="item">
        <span class="swatch" style="background:${category.color}"></span>
        <div class="item-main">
          <strong>${escapeHtml(category.name)}</strong>
          <span>${category.scope === "EXPENSE" ? "Expense" : "Income"} · ${used} items${escapeHtml(limitText)}</span>
        </div>
        <div class="item-actions">
          <button data-edit-category="${category.id}">Rename</button>
          <button data-delete-category="${category.id}">Delete</button>
        </div>
      </article>
    `;
  }

  function familyScreen() {
    if (!isDesktopMode()) return mobileFamilyScreen();
    const isOwner = state.membership?.role === "OWNER";
    const inviteCode = state.family?.invite_code || "Code is being prepared";
    const locked = Boolean(state.family?.invite_locked);
    return `
      <section class="dashboard-grid">
        <div class="card panel">
          <div class="section-head">
            <h2>Family Members</h2>
            <span class="secure-pill">Code + password</span>
          </div>
          ${state.people.map((person) => `
            <article class="item">
              <span class="avatar">${personInitial(person.display_name)}</span>
              <div class="item-main"><strong>${escapeHtml(person.display_name)}</strong><span>${person.linked_user_id ? (person.linked_user_id === state.family.owner_id ? "Family admin" : "Signed in member") : "Past expense person"}</span></div>
              ${isOwner && person.linked_user_id && person.linked_user_id !== state.family.owner_id ? `<div class="item-actions"><button class="danger" data-remove-member="${person.linked_user_id}" data-member-name="${escapeHtml(person.display_name)}">Remove</button></div>` : ""}
            </article>
          `).join("")}
        </div>
        <aside class="card panel">
          <div class="section-head">
            <div>
              <h2>Family invite</h2>
              <p class="section-subtitle">One code for this family</p>
            </div>
            <span class="lock-badge ${locked ? "locked" : ""}">${locked ? "Locked" : "Open"}</span>
          </div>
          <div class="invite-code single-code">
            <span>Share this code</span>
            <strong>${escapeHtml(inviteCode)}</strong>
          </div>
          <div class="invite-actions">
            <button class="secondary wide" data-copy-invite="${escapeHtml(inviteCode)}">Copy code</button>
            ${isOwner ? `
              <button class="secondary wide" data-action="rotate-invite">Rotate invite code</button>
              <button class="${locked ? "primary" : "danger"} wide" data-action="toggle-family-lock">${locked ? "Unlock joining" : "Lock joining"}</button>
            ` : ""}
          </div>
          <p class="muted invite-help">${isOwner ? "Rotate if the old code was shared too widely. Old code stops working." : "You can share the code. Only the family admin can rotate, lock, or unlock joining."}</p>
          ${goalsSummaryCard()}
          <hr>
          <button class="secondary wide" data-action="replay-tour">Show me around again</button>
          ${state.preview ? "" : `
          <button class="danger wide" data-action="leave-family">Leave family</button>
          <button class="secondary wide" data-action="signout">Sign out</button>`}
        </aside>
      </section>
    `;
  }

  function mobileFamilyScreen() {
    const isOwner = state.membership?.role === "OWNER";
    const inviteCode = state.family?.invite_code || "Code is being prepared";
    const locked = Boolean(state.family?.invite_locked);
    return `
      <section class="mobile-family-page">
        ${goalsSummaryCard()}
        <h2>Family Members</h2>
        <div class="member-card-list">
          ${state.people.slice(0, 3).map((person) => `
            <article class="card member-card">
              <span class="avatar">${personInitial(person.display_name)}</span>
              <div><strong>${escapeHtml(person.display_name)}</strong><span>${person.linked_user_id === state.family.owner_id ? "Primary Owner" : person.linked_user_id ? "Contributor" : "Viewer"}</span></div>
              <b>${person.linked_user_id === state.family.owner_id ? "♢" : "⋮"}</b>
            </article>
          `).join("")}
        </div>
        <article class="invite-dark-card">
          <h3>Invite a Family Member</h3>
          <p>Share this code with family members to grant them access to the household ledger.</p>
          <div class="invite-copy-row"><strong>${escapeHtml(inviteCode)}</strong><button data-copy-invite="${escapeHtml(inviteCode)}">COPY</button></div>
          <button class="share-invite-button" data-copy-invite="${escapeHtml(inviteCode)}">Copy Invite Code</button>
        </article>
        <h2>Owner Controls</h2>
        <div class="card owner-control-list">
          <article><span>▣</span><div><strong>Family Currency</strong><small>INR (₹) - Indian Rupee</small></div><b>›</b></article>
          <article><span>◌</span><div><strong>Privacy Mode</strong><small>Hide balances by default</small></div><button class="switch-action" type="button" aria-label="Privacy mode"></button></article>
          <article><span>▤</span><div><strong>Shared Data Encryption</strong><small>End-to-end active</small></div><b class="check-dot">✓</b></article>
        </div>
        <h2 class="danger-title">Danger Zone</h2>
        <div class="danger-zone-card">
          <button data-action="rotate-invite"><strong>Rotate Invite Code</strong><span>Old code stops working</span></button>
          <button data-action="toggle-family-lock"><strong>${locked ? "Unlock Joining" : "Lock Joining"}</strong><span>${locked ? "Let people join with the code again" : "Nobody new can join, even with the code"}</span></button>
          <button data-action="replay-tour"><strong>Show Me Around Again</strong><span>Replay the quick tour</span></button>
          ${state.preview ? "" : `<button data-action="leave-family"><strong>Leave Family</strong><span>Exit this family group</span></button>`}
        </div>
        <p class="version-line">Version 2.4.0 · Secured by Padmanabham Infrastructure</p>
      </section>
    `;
  }

  /* --------------------------------------------------------------------------
     Goals screen

     Consolidates the savings goal, the monthly budget and every category limit.
     These used to live in two panels at the bottom of the invite aside, and
     going over a limit produced almost no feedback anywhere in the app.
     -------------------------------------------------------------------------- */

  const GOAL_PILL_TEXT = { ok: "On track", near: "Close to limit", over: "Over" };

  function goalsScreen() {
    const isOwner = state.membership?.role === "OWNER";
    const data = goalsData();

    if (!data.hasAnything) {
      return `
        <section class="goals-screen">
          ${goalsHeader()}
          <article class="card goal-empty">
            <h2>No goals set yet</h2>
            <p>Set a monthly budget, a savings goal, or a limit on the categories you want to watch. You will see progress here, and a warning before you go over.</p>
            ${isOwner
              ? `<button class="primary" data-modal="family-plan">Set your first goal</button>`
              : `<p class="muted">Ask the family admin to set these up.</p>`}
          </article>
        </section>
      `;
    }

    return `
      <section class="goals-screen">
        ${goalsHeader()}
        ${data.savingsGoal ? savingsGoalHero(data) : ""}
        ${data.monthlyBudget ? monthlyBudgetCard(data, isOwner) : goalsUnsetCard("monthly budget", isOwner)}
        ${categoryLimitsCard(data, isOwner)}
        ${!data.savingsGoal ? goalsUnsetCard("savings goal", isOwner) : ""}
      </section>
    `;
  }

  function goalsHeader() {
    return `
      <div class="goals-head">
        <button class="icon-only soft-icon" type="button" data-tab="family" aria-label="Back to family">‹</button>
        <div>
          <h2>Goals</h2>
          <p>${escapeHtml(monthLabel(currentMonth()))}</p>
        </div>
      </div>
    `;
  }

  function savingsGoalHero(data) {
    const percent = Math.round(data.savingsPercent);
    const remaining = Math.max(0, data.savingsGoal - data.savings);
    const days = daysLeftInMonth();
    return `
      <section class="goal-hero">
        <div class="goal-ring" style="--goal-percent:${percent}"><b>${percent}%</b></div>
        <div class="goal-hero-main">
          <span>Savings goal</span>
          <strong>${money(data.savings)} of ${money(data.savingsGoal)}</strong>
          <small>${remaining > 0
            ? `${money(remaining)} to go, with ${days} ${days === 1 ? "day" : "days"} left this month.`
            : "Goal reached this month."}</small>
        </div>
      </section>
    `;
  }

  function monthlyBudgetCard(data, isOwner) {
    const percent = Math.round(data.budgetPercent);
    const state_ = data.budgetState;
    const remaining = data.monthlyBudget - data.spend;
    const pace = Math.round(monthProgressPercent());
    const aheadOfPace = state_ !== "over" && percent > pace + 5;
    return `
      <article class="card goal-card">
        <div class="goal-card-head">
          <div>
            <h2>Monthly budget</h2>
            <p>Everything the family spends this month.</p>
          </div>
          <span class="goal-pill ${state_}">${GOAL_PILL_TEXT[state_] || "On track"}</span>
        </div>
        <div class="goal-amounts">
          <strong>${money(data.spend)}</strong>
          <span>of ${money(data.monthlyBudget)}</span>
        </div>
        <div class="goal-track ${state_}">
          <i style="width:${Math.min(100, Math.max(2, percent))}%"></i>
          ${state_ === "over" ? "" : `<span class="goal-pace" style="left:${pace}%"></span>`}
        </div>
        <div class="goal-foot">
          <span>${percent}% used${aheadOfPace ? ", ahead of pace" : ""}</span>
          ${remaining >= 0
            ? `<span><b>${money(remaining)}</b> left</span>`
            : `<span class="over-text">${money(Math.abs(remaining))} over</span>`}
        </div>
        ${isOwner ? `<div class="goal-card-actions"><button class="secondary compact" data-modal="family-plan">Edit budget and goal</button></div>` : ""}
      </article>
    `;
  }

  function categoryLimitsCard(data, isOwner) {
    return `
      <article class="card goal-card">
        <div class="goal-card-head">
          <div>
            <h2>Category limits</h2>
            <p>${data.tracked.length ? "Sorted by how much attention they need." : "Set a limit on the categories you want to watch."}</p>
          </div>
          ${data.tracked.length || data.untracked.length
            ? `<button class="secondary compact" data-modal="category-limits">${isOwner ? "Edit" : "View"}</button>`
            : ""}
        </div>
        ${data.tracked.length ? `
          <div class="goal-limit-list">
            ${data.tracked.map(goalLimitRow).join("")}
          </div>
        ` : ""}
        ${data.untracked.length ? `
          <div class="goal-untracked${data.tracked.length ? "" : " goal-untracked-only"}">
            <!-- With nothing tracked, the card subtitle already says to set a
                 limit, so repeating "no limit set yet" here just says it twice. -->
            <p>${data.tracked.length
              ? "No limit set yet — these are not being tracked:"
              : `${isOwner ? "Tap Edit to set a limit on any of these:" : "Nothing is being tracked yet:"}`}</p>
            <div class="goal-untracked-chips">
              ${data.untracked.map((row) => `<span class="goal-untracked-chip">${escapeHtml(row.name)}${row.spent ? ` · ${money(row.spent)}` : ""}</span>`).join("")}
            </div>
          </div>
        ` : ""}
      </article>
    `;
  }

  function goalLimitRow(row) {
    const percent = Math.round(row.used);
    const over = row.spent - row.limit;
    return `
      <div class="goal-limit-row">
        <div class="goal-limit-name">
          <i class="goal-dot" style="background:${escapeHtml(row.color || COLORS[0])}"></i>
          <strong title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong>
        </div>
        <div class="goal-limit-figure">
          <b>${money(row.spent)}</b>
          ${row.state === "over"
            ? `<span class="over-text">${money(over)} over ${money(row.limit)}</span>`
            : `<span>of ${money(row.limit)} · ${percent}%</span>`}
        </div>
        <div class="goal-track ${row.state}">
          <i style="width:${Math.min(100, Math.max(2, percent))}%"></i>
        </div>
      </div>
    `;
  }

  function goalsUnsetCard(what, isOwner) {
    return `
      <article class="card goal-card goal-card-unset">
        <div class="goal-card-head">
          <div>
            <h2>No ${what} yet</h2>
            <p>${what === "monthly budget"
              ? "Set one and this screen will track how much of it you have used."
              : "Set one and this screen will track how close you are."}</p>
          </div>
          ${isOwner ? `<button class="secondary compact" data-modal="family-plan">Set</button>` : ""}
        </div>
      </article>
    `;
  }

  /* Warns while an expense is being entered -- the only moment where knowing you
     are near a limit can still change the decision. It informs and never blocks:
     saving always works. Nothing read a limit on this path before, so you only
     discovered an overspend by navigating elsewhere afterwards. */
  function updateLimitWarning(form) {
    const slot = form?.querySelector("[data-limit-warning]");
    if (!slot) return;
    const categoryId = form.querySelector("[name='category_id']")?.value;
    const amount = Number(form.querySelector("[name='amount']")?.value || 0);
    const editingId = form.dataset.id || null;
    const category = state.categories.find((item) => item.id === categoryId);
    const limit = Number(category?.monthly_limit || 0);

    if (!category || limit <= 0 || !Number.isFinite(amount) || amount <= 0) {
      slot.hidden = true;
      slot.innerHTML = "";
      return;
    }

    // Exclude the row being edited, or editing it would count twice.
    const alreadySpent = monthExpenses()
      .filter((item) => item.category_id === categoryId && item.id !== editingId)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const projected = alreadySpent + amount;
    const status = limitStatus(projected, limit);

    if (status === "ok") {
      slot.hidden = true;
      slot.innerHTML = "";
      return;
    }

    const name = escapeHtml(category.name);
    slot.hidden = false;
    slot.className = `goal-warning ${status}`;
    slot.innerHTML = status === "over"
      ? `<span aria-hidden="true">⚠</span><div>This puts ${name} <b>${money(projected - limit)} over</b> its ${money(limit)} limit.</div>`
      : `<span aria-hidden="true">⚠</span><div>${name} would be at <b>${Math.round(limitPercent(projected, limit))}%</b> of its ${money(limit)} limit, leaving ${money(limit - projected)}.</div>`;
  }

  // Compact entry point for the Family tab. Replaces the two panels that used to
  // sit at the bottom of the invite aside.
  function goalsSummaryCard() {
    const data = goalsData();
    const state_ = data.overCount ? "over" : data.nearCount ? "near" : data.budgetState === "none" ? "ok" : data.budgetState;
    const detail = !data.hasAnything
      ? "Nothing set up yet"
      : data.overCount
      ? `${data.overCount} ${data.overCount === 1 ? "category is" : "categories are"} over limit`
      : data.nearCount
      ? `${data.nearCount} close to limit`
      : data.monthlyBudget
      ? `${Math.round(data.budgetPercent)}% of the monthly budget used`
      : "Savings goal on track";
    return `
      <button class="card goal-summary-card" type="button" data-tab="goals">
        <div>
          <span>Goals</span>
          <strong>${escapeHtml(detail)}</strong>
        </div>
        <span class="goal-pill ${state_}">${data.hasAnything ? (GOAL_PILL_TEXT[state_] || "On track") : "Set up"}</span>
      </button>
    `;
  }

  /* --------------------------------------------------------------------------
     Limit status: ONE definition, used everywhere.

     Previously the thresholds disagreed between call sites. The dashboard bar
     turned red at >= 100 while every status label used a strict >, so spending
     exactly your budget showed a red bar and a green "Within monthly budget"
     card at the same time. And the 80% "approaching" tier existed in exactly one
     place, so everywhere else you went from fine to over with no warning.
     -------------------------------------------------------------------------- */
  const LIMIT_NEAR_PERCENT = 80;

  function limitStatus(spent, limit) {
    if (!limit || limit <= 0) return "none";
    const percent = (Number(spent) / Number(limit)) * 100;
    if (percent >= 100) return "over";
    if (percent >= LIMIT_NEAR_PERCENT) return "near";
    return "ok";
  }

  function limitPercent(spent, limit) {
    if (!limit || limit <= 0) return 0;
    return (Number(spent) / Number(limit)) * 100;
  }

  // How far through the month we are, for the pace marker. This is what turns
  // "56% used" into "56% used, and it is only the 12th".
  function monthProgressPercent() {
    const today = todayKey();
    const day = Number(today.slice(8, 10));
    const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    return Math.min(100, (day / daysInMonth) * 100);
  }

  function daysLeftInMonth() {
    const today = todayKey();
    const day = Number(today.slice(8, 10));
    const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    return Math.max(0, daysInMonth - day);
  }

  function spentByCategory() {
    return new Map(
      totalsBy(monthExpenses(), (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id))
        .map((row) => [row.key, row])
    );
  }

  function categoryLimitRows(all = false) {
    const spendRows = spentByCategory();
    const rows = activeExpenseCategories().map((category) => {
      const spent = Number(spendRows.get(category.id)?.total || 0);
      const limit = Number(category.monthly_limit || 0);
      return {
        id: category.id,
        name: category.name,
        color: category.color,
        limit,
        spent,
        used: limitPercent(spent, limit),
        state: limitStatus(spent, limit),
        // Retained for existing call sites that test for the string "OVER".
        status: limitStatus(spent, limit) === "over" ? "OVER" : "OK"
      };
    }).sort((a, b) => {
      const rank = { over: 0, near: 1, ok: 2, none: 3 };
      return rank[a.state] - rank[b.state] || b.used - a.used || b.spent - a.spent || a.name.localeCompare(b.name);
    });
    return all ? rows : rows.slice(0, 3);
  }

  // Everything the Goals screen needs, computed once.
  function goalsData() {
    const analytics = analyticsForMonth(currentMonth());
    const monthlyBudget = Number(state.family?.monthly_budget || 0);
    const savingsGoal = Number(state.family?.savings_goal_amount || 0);
    const spend = analytics.totals.spend;
    const savings = Math.max(0, analytics.totals.savings);
    const rows = categoryLimitRows(true);
    const tracked = rows.filter((row) => row.limit > 0);
    return {
      analytics,
      monthlyBudget,
      savingsGoal,
      spend,
      savings,
      savingsPercent: savingsGoal ? Math.min(100, (savings / savingsGoal) * 100) : 0,
      budgetPercent: limitPercent(spend, monthlyBudget),
      budgetState: limitStatus(spend, monthlyBudget),
      tracked,
      untracked: rows.filter((row) => row.limit <= 0),
      overCount: tracked.filter((row) => row.state === "over").length,
      nearCount: tracked.filter((row) => row.state === "near").length,
      hasAnything: Boolean(monthlyBudget || savingsGoal || tracked.length)
    };
  }

  function miniBars(rows) {
    if (!rows.length) return emptyState("No data", "Nothing to show yet.");
    const max = Math.max(...rows.map((row) => row.total), 1);
    return rows.map((row) => `
      <div class="mini-bar">
        <span>${escapeHtml(row.name)}</span>
        <div class="bar"><i style="width:${Math.max(5, (row.total / max) * 100)}%;background:${row.color}"></i></div>
        <strong>${money(row.total)}</strong>
      </div>
    `).join("");
  }

  function emptyState(title, text) {
    return `<div class="empty"><strong>${title}</strong><span>${text}</span></div>`;
  }

  function modal() {
    const { type, id } = state.modal;
    const title = {
      expense: id ? "Edit expense" : "Add expense",
      income: id ? "Edit income" : "Add income",
      category: id ? "Rename category" : "Add category",
      person: id ? "Edit person" : "Add person",
      "family-plan": "Edit monthly plan",
      "category-limits": "Category limits"
    }[type];
    return `
      <div class="modal-backdrop">
        <section class="modal card">
          <span class="sheet-handle" aria-hidden="true"></span>
          <div class="section-head">
            <h2>${title}</h2>
            <button class="icon-button" data-close-modal>×</button>
          </div>
          ${type === "expense" ? expenseForm(id) : ""}
          ${type === "income" ? incomeForm(id) : ""}
          ${type === "category" ? categoryForm(id) : ""}
          ${type === "person" ? personForm(id) : ""}
          ${type === "family-plan" ? familyPlanForm() : ""}
          ${type === "category-limits" ? categoryLimitsForm() : ""}
        </section>
      </div>
    `;
  }

  function expenseForm(id) {
    const expense = state.expenses.find((item) => item.id === id);
    // Defaults to the month being viewed, not today. Adding an expense while
    // looking at a past month used to default to today's date, so the row landed
    // outside the range on screen and appeared to vanish.
    const dateValue = expense?.spent_on || defaultEntryDate();
    const selectedPersonId = defaultExpensePersonId(expense);
    return `
      <form data-form="expense" data-id="${id || ""}">
        <!-- Filled in by updateLimitWarning() on input. Updated in place rather
             than through render(), which rebuilds the DOM and would drop focus
             out of the field being typed into. -->
        <div class="goal-warning" data-limit-warning hidden></div>
        <label class="field title-field">Expense name<input class="input" name="title" value="${escapeHtml(expense?.title || "")}" placeholder="Milk, vegetables, medicine" required></label>
        <label class="field amount-field">Amount (₹)<input class="input amount-input" name="amount" type="number" inputmode="decimal" min="1" step="1" value="${escapeHtml(expense?.amount || "")}" placeholder="0.00" required></label>
        <div class="form-two-col">
          <label class="field date-field">Date<input class="input" name="spent_on" type="date" value="${escapeHtml(dateValue)}" required></label>
          <label class="field category-field">Category<select class="input" name="category_id">${activeExpenseCategories().map((c) => `<option value="${c.id}" ${expense?.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
        </div>
        <fieldset class="paid-by-options">
          <legend>Paid by</legend>
          <div>
            ${state.people.slice(0, 3).map((p) => `
              <label class="${selectedPersonId === p.id ? "selected" : ""}">
                <input type="radio" name="person_id" value="${p.id}" ${selectedPersonId === p.id ? "checked" : ""} required>
                <span>${escapeHtml(firstName(p.display_name))}</span>
              </label>
            `).join("")}
          </div>
        </fieldset>
        <label class="field">Repeats<select class="input" name="recurrence">
          <option value="NONE" ${!isRecurringExpense(expense) ? "selected" : ""}>Doesn't repeat</option>
          ${CADENCES.map((c) => `<option value="${c.value}" ${isRecurringExpense(expense) && cadenceOf(expense) === c.value ? "selected" : ""}>${c.label}</option>`).join("")}
        </select><small>Rent, fees, subscriptions. Repeating records what you are committed to; it does not create expenses for you.</small></label>
        ${isRecurringExpense(expense) ? lifecycleField(expense, {
          active: "Counting toward your monthly commitments.",
          paused: "On hold — stops counting, switch it back on any time.",
          stopped: "Ended — stops counting and stays for the record."
        }) : ""}
        <div class="modal-actions">
          ${id ? `<button class="danger" type="button" data-delete-expense="${id}">Delete</button>` : ""}
          <button class="primary" type="submit">Save expense</button>
        </div>
      </form>
    `;
  }

  function firstName(value) {
    return String(value || "").trim().split(/\s+/)[0] || "Person";
  }

  // A segmented radio rather than a dropdown: three options, and the choice
  // carries consequences worth reading, so all of them stay visible. The hint
  // under it swaps as you choose, because "Paused" and "Stopped" look
  // interchangeable until someone tells you the difference.
  function lifecycleField(item, hints = {}) {
    const current = item ? lifecycleOf(item) : "ACTIVE";
    return `
      <fieldset class="field lifecycle-field"
        data-hint-active="${escapeHtml(hints.active || "")}"
        data-hint-paused="${escapeHtml(hints.paused || "")}"
        data-hint-stopped="${escapeHtml(hints.stopped || "")}">
        <legend>Status</legend>
        <div class="lifecycle-options">
          ${LIFECYCLES.map((l) => `
            <label class="lifecycle-option">
              <input type="radio" name="lifecycle" value="${l.value}" ${current === l.value ? "checked" : ""}>
              <span>${l.label}</span>
            </label>
          `).join("")}
        </div>
        <small data-lifecycle-hint>${escapeHtml(hints[current.toLowerCase()] || "")}</small>
      </fieldset>
    `;
  }

  function lifecycleChip(item) {
    const state_ = lifecycleOf(item);
    if (state_ === "ACTIVE") return "";
    return `<span class="status-chip ${state_ === "PAUSED" ? "is-paused" : "is-stopped"}">${state_ === "PAUSED" ? "Paused" : "Stopped"}</span>`;
  }

  // Which controls to offer depends on where the item already is. Showing
  // Pause on something already stopped is noise.
  function lifecycleActions(item, kind) {
    const state_ = lifecycleOf(item);
    const attr = kind === "income" ? "data-income-lifecycle" : "data-expense-lifecycle";
    const name = escapeHtml(item.title || "this item");
    const button = (next, label) =>
      `<button class="pill-action" ${attr}="${item.id}" data-lifecycle-to="${next}" aria-label="${label} ${name}">${label}</button>`;
    if (state_ === "ACTIVE") return button("PAUSED", "Pause") + button("STOPPED", "Stop");
    if (state_ === "PAUSED") return button("ACTIVE", "Resume") + button("STOPPED", "Stop");
    return button("ACTIVE", "Resume");
  }

  function incomeForm(id) {
    const income = state.incomes.find((item) => item.id === id);
    return `
      <form data-form="income" data-id="${id || ""}">
        <label class="field">Income title<input class="input" name="title" value="${escapeHtml(income?.title || "")}" placeholder="Salary" required></label>
        <label class="field">Amount<input class="input" name="amount" type="number" min="1" step="1" value="${escapeHtml(income?.amount || "")}" required></label>
        <label class="field">Category<select class="input" name="category_id">${activeIncomeCategories().map((c) => `<option value="${c.id}" ${income?.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
        <label class="field">How often<select class="input" name="cadence">
          ${CADENCES.map((c) => `<option value="${c.value}" ${cadenceOf(income) === c.value ? "selected" : ""}>${c.label}</option>`).join("")}
        </select></label>
        <label class="field">First arrival<input class="input" name="anchor_on" type="date" value="${escapeHtml(anchorDateOf(income, currentMonth()))}"><small>Weekly income repeats on this weekday. Anything longer repeats from this month.</small></label>
        ${lifecycleField(income, {
          active: "Arriving — counts toward your monthly total.",
          paused: "On hold — stops counting, keep it to switch back on later.",
          stopped: "Ended — stops counting and stays for the record."
        })}
        <button class="primary wide" type="submit">Save income</button>
      </form>
    `;
  }

  function categoryForm(id) {
    const category = state.categories.find((item) => item.id === id);
    return `
      <form data-form="category" data-id="${id || ""}">
        <label class="field">Name<input class="input" name="name" value="${escapeHtml(category?.name || "")}" placeholder="Groceries" required></label>
        <label class="field">Type<select class="input" name="scope">
          <option value="EXPENSE" ${(category?.scope || state.scope) === "EXPENSE" ? "selected" : ""}>Expense</option>
          <option value="INCOME" ${(category?.scope || state.scope) === "INCOME" ? "selected" : ""}>Income</option>
        </select></label>
        <label class="field">Monthly limit<input class="input" name="monthly_limit" type="number" min="0" step="1" value="${escapeHtml(category?.monthly_limit || "")}" placeholder="0"><small>Optional for expense categories.</small></label>
        <label class="field">Color<input class="input" name="color" type="color" value="${escapeHtml(category?.color || COLORS[0])}"></label>
        <button class="primary wide" type="submit">Save category</button>
      </form>
    `;
  }

  function personForm(id) {
    const person = state.people.find((item) => item.id === id);
    return `
      <form data-form="person" data-id="${id || ""}">
        <label class="field">Display name<input class="input" name="display_name" value="${escapeHtml(person?.display_name || "")}" placeholder="Amma" required></label>
        <button class="primary wide" type="submit">Save person</button>
      </form>
    `;
  }

  function familyPlanForm() {
    return `
      <form class="family-plan-sheet" data-form="family-planning">
        <label class="field">Monthly Budget (₹)<input class="input" name="monthly_budget" type="number" min="0" step="1" value="${escapeHtml(state.family?.monthly_budget || 0)}"><small>Set your family's spending limit for this month.</small></label>
        <label class="field">Savings Goal (₹)<input class="input" name="savings_goal_amount" type="number" min="0" step="1" value="${escapeHtml(state.family?.savings_goal_amount || 0)}"><small>Target amount for long-term family growth.</small></label>
        <div class="privacy-confirm-line"><span>▤</span><strong>End-to-end encrypted changes</strong></div>
        <div class="modal-actions">
          <button class="secondary" type="button" data-close-modal>Cancel</button>
          <button class="primary" type="submit">Save Plan</button>
        </div>
      </form>
    `;
  }

  function categoryLimitsForm() {
    const isOwner = state.membership?.role === "OWNER";
    const rows = categoryLimitRows(true);
    return `
      <form class="category-limits-sheet" data-form="category-limits">
        <div class="category-limit-scroll">
          ${rows.length ? rows.map((row) => `
            <article class="limit-edit-row">
              <span class="swatch" style="background:${row.color}"></span>
              <div>
                <strong>${escapeHtml(row.name)}</strong>
                <small>${row.spent ? `${money(row.spent)} spent this month` : "No spend this month"}</small>
              </div>
              <label>
                <span>Limit</span>
                <input class="input" data-limit-category="${row.id}" name="limit_${row.id}" type="number" min="0" step="1" value="${escapeHtml(row.limit || "")}" placeholder="0" ${isOwner ? "" : "disabled"}>
              </label>
            </article>
          `).join("") : `<p class="muted">No expense categories yet.</p>`}
        </div>
        <div class="sticky-sheet-actions">
          <button class="secondary" type="button" data-close-modal>Cancel</button>
          ${isOwner ? `<button class="primary" type="submit">Save All Limits</button>` : `<button class="primary" type="button" data-close-modal>Done</button>`}
        </div>
      </form>
    `;
  }

  function bind() {
    document.querySelectorAll("[data-action='google']").forEach((button) => button.addEventListener("click", run(signInWithGoogle)));
    document.querySelectorAll("[data-action='signout']").forEach((button) => button.addEventListener("click", run(signOut)));
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      render();
    }));
    document.querySelectorAll("[data-modal]").forEach((button) => button.addEventListener("click", () => {
      state.modal = { type: button.dataset.modal };
      render();
    }));
    document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => {
      state.modal = null;
      render();
    }));
    document.querySelector("[data-sort]")?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    document.querySelector("[data-expense-search]")?.addEventListener("change", (event) => {
      state.expenseSearch = event.target.value;
      render();
    });
    document.querySelector("[data-month-select]")?.addEventListener("change", (event) => {
      state.selectedMonth = event.target.value;
      state.dateFrom = monthStart(state.selectedMonth);
      state.dateTo = monthEnd(state.selectedMonth);
      state.rangeMode = "month";
      render();
    });
    document.querySelector("[data-month-current]")?.addEventListener("click", () => {
      state.selectedMonth = currentMonth();
      state.dateFrom = monthStart(state.selectedMonth);
      state.dateTo = monthEnd(state.selectedMonth);
      state.rangeMode = "month";
      render();
    });
    document.querySelectorAll("[data-month-shift]").forEach((button) => button.addEventListener("click", () => {
      state.selectedMonth = shiftMonth(selectedMonth(), Number(button.dataset.monthShift || 0));
      state.dateFrom = monthStart(state.selectedMonth);
      state.dateTo = monthEnd(state.selectedMonth);
      state.rangeMode = "month";
      render();
    }));
    document.querySelector("[data-expense-custom]")?.addEventListener("click", () => {
      state.rangeMode = "custom";
      state.dateFrom = state.dateFrom || monthStart(state.selectedMonth);
      state.dateTo = state.dateTo || monthEnd(state.selectedMonth);
      render();
    });
    document.querySelector("[data-date-from]")?.addEventListener("change", (event) => {
      state.dateFrom = safeDate(event.target.value);
      if (state.dateTo && state.dateFrom > state.dateTo) state.dateTo = state.dateFrom;
      state.selectedMonth = monthKey(state.dateFrom);
      state.rangeMode = "custom";
      render();
    });
    document.querySelector("[data-date-to]")?.addEventListener("change", (event) => {
      state.dateTo = safeDate(event.target.value);
      if (state.dateFrom && state.dateTo < state.dateFrom) state.dateFrom = state.dateTo;
      state.rangeMode = "custom";
      render();
    });
    document.querySelectorAll("[data-month-jump]").forEach((button) => button.addEventListener("click", () => {
      state.selectedMonth = button.dataset.monthJump;
      state.dateFrom = monthStart(state.selectedMonth);
      state.dateTo = monthEnd(state.selectedMonth);
      state.rangeMode = "month";
      state.tab = "expenses";
      render();
    }));
    document.querySelectorAll("[data-scope]").forEach((button) => button.addEventListener("click", () => {
      state.scope = button.dataset.scope;
      render();
    }));

    bindForm("create-family", createFamily);
    bindForm("join-family", joinFamily);
    bindForm("expense", saveExpense);
    bindForm("income", saveIncome);
    bindForm("category", saveCategory);
    bindForm("person", savePerson);
    bindForm("family-planning", saveFamilyPlanning);
    bindForm("category-limits", saveCategoryLimits);
    bindForm("privacy-unlock", unlockPrivacy);
    bindForm("privacy-setup", setupPrivacy);
    bindFormDrafts();

    document.querySelectorAll("[data-edit-expense]").forEach((button) => button.addEventListener("click", () => openModal("expense", button.dataset.editExpense)));
    document.querySelectorAll("[data-delete-expense]").forEach((button) => button.addEventListener("click", run(() => deleteExpense(button.dataset.deleteExpense))));
    document.querySelectorAll("[data-edit-income]").forEach((button) => button.addEventListener("click", () => openModal("income", button.dataset.editIncome)));
    document.querySelectorAll("[data-delete-income]").forEach((button) => button.addEventListener("click", run(() => deleteIncome(button.dataset.deleteIncome))));
    document.querySelectorAll("[data-income-lifecycle]").forEach((button) => button.addEventListener("click", run(() => setIncomeLifecycle(button.dataset.incomeLifecycle, button.dataset.lifecycleTo))));
    document.querySelectorAll("[data-expense-lifecycle]").forEach((button) => button.addEventListener("click", run(() => setExpenseLifecycle(button.dataset.expenseLifecycle, button.dataset.lifecycleTo))));
    // The hint under the status picker explains what the choice does, so it has
    // to track the choice rather than whatever was selected when it rendered.
    document.querySelectorAll(".lifecycle-field").forEach((field) => {
      field.addEventListener("change", (event) => {
        if (event.target.name !== "lifecycle") return;
        const hint = field.querySelector("[data-lifecycle-hint]");
        if (hint) hint.textContent = field.dataset[`hint${event.target.value.charAt(0)}${event.target.value.slice(1).toLowerCase()}`] || "";
      });
    });
    document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => openModal("category", button.dataset.editCategory)));
    document.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", run(() => deleteCategory(button.dataset.deleteCategory))));
    document.querySelectorAll("[data-edit-person]").forEach((button) => button.addEventListener("click", () => openModal("person", button.dataset.editPerson)));
    // querySelectorAll, not querySelector: the mobile family screen renders two
    // copy-invite buttons, so the singular form left "Share invite link" dead.
    document.querySelectorAll("[data-action='toggle-family-lock']").forEach((button) => button.addEventListener("click", run(toggleFamilyLock)));
    document.querySelectorAll("[data-action='rotate-invite']").forEach((button) => button.addEventListener("click", run(rotateInviteCode)));
    document.querySelectorAll("[data-action='leave-family']").forEach((button) => button.addEventListener("click", run(leaveFamily)));
    document.querySelectorAll("[data-copy-invite]").forEach((button) => button.addEventListener("click", run(copyInviteCode)));
    document.querySelectorAll("[data-action='replay-tour']").forEach((button) => button.addEventListener("click", () => startTour()));

    // Password reveal. Mutates the DOM directly rather than going through
    // render(), which rebuilds everything and would drop the caret mid-typing.
    document.querySelectorAll("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
      const input = button.parentElement?.querySelector("input");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      button.title = show ? "Hide password" : "Show password";
      button.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
      // Keep the caret where it was so tapping the eye mid-entry is not
      // disruptive; setSelectionRange throws on some input types, hence the try.
      const caret = input.value.length;
      input.focus();
      try { input.setSelectionRange(caret, caret); } catch (_) { /* not supported */ }
    }));

    // Live budget warning on the expense form. Bound to input/change and updated
    // in place -- calling render() here would rebuild the DOM mid-keystroke.
    const expenseFormEl = document.querySelector("[data-form='expense']");
    if (expenseFormEl) {
      updateLimitWarning(expenseFormEl);
      expenseFormEl.querySelector("[name='amount']")?.addEventListener("input", () => updateLimitWarning(expenseFormEl));
      expenseFormEl.querySelector("[name='category_id']")?.addEventListener("change", () => updateLimitWarning(expenseFormEl));
    }
    document.querySelectorAll("[data-remove-member]").forEach((button) => button.addEventListener("click", run(() => removeFamilyMember(button.dataset.removeMember, button.dataset.memberName))));
    document.querySelectorAll("[data-insight-tab]").forEach((button) => button.addEventListener("click", () => {
      state.insightTab = button.dataset.insightTab;
      render();
    }));
    document.querySelectorAll("[data-category-shortcut]").forEach((button) => button.addEventListener("click", () => {
      const form = button.closest("form");
      const categorySelect = form?.querySelector("select[name='category_id']");
      const amountInput = form?.querySelector("input[name='amount']");
      if (categorySelect) categorySelect.value = button.dataset.categoryShortcut || "";
      form?.querySelectorAll("[data-category-shortcut]").forEach((item) => item.classList.toggle("selected", item === button));
      amountInput?.focus();
    }));
  }

  function bindForm(name, handler) {
    document.querySelector(`[data-form="${name}"]`)?.addEventListener("submit", runForm(handler));
  }

  function formDraftKey(name) {
    return `${FORM_DRAFT_PREFIX}:${state.user?.id || "anon"}:${name}`;
  }

  function readFormDraft(name) {
    try {
      return JSON.parse(sessionStorage.getItem(formDraftKey(name)) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveFormDraft(form) {
    const name = form.dataset.form;
    if (!["create-family", "join-family", "privacy-unlock", "privacy-setup"].includes(name)) return;
    const draft = {};
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((field) => {
      if (field.type === "checkbox") draft[field.name] = field.checked ? "1" : "";
      else draft[field.name] = field.value;
    });
    sessionStorage.setItem(formDraftKey(name), JSON.stringify(draft));
  }

  function clearFormDraft(name) {
    sessionStorage.removeItem(formDraftKey(name));
  }

  function bindFormDrafts() {
    document.querySelectorAll("[data-form]").forEach((form) => {
      form.addEventListener("input", () => saveFormDraft(form));
      form.addEventListener("change", () => saveFormDraft(form));
    });
  }

  function openModal(type, id) {
    state.modal = { type, id };
    render();
  }

  function cleanText(value, fallback = "") {
    return String(value ?? fallback).normalize("NFC").trim().replace(/\s+/gu, " ");
  }

  function comparableText(value) {
    return cleanText(value).toLocaleLowerCase("en-IN");
  }

  function findCategoryByName(scope, name, excludeId = "") {
    const comparableName = comparableText(name);
    return state.categories.find((category) =>
      category.scope === scope &&
      category.id !== excludeId &&
      comparableText(category.name) === comparableName
    );
  }

  function isCategoryNameConflict(error) {
    return error?.code === "23505" && String(error.message || error.details || "").includes("budget_categories_family_scope_name_uq");
  }

  function requireText(value, label, maxLength) {
    const text = cleanText(value);
    if (!text) throw new Error(`Please enter ${label}.`);
    if (text.length > maxLength) throw new Error(`${label} is too long.`);
    return text;
  }

  function optionalText(value, maxLength) {
    const text = cleanText(value);
    if (!text) return null;
    if (text.length > maxLength) throw new Error("Notes are too long.");
    return text;
  }

  function positiveMoney(value, label) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Please enter a valid ${label}.`);
    if (amount > 999999999) throw new Error(`${label} is too large.`);
    return Math.round(amount * 100) / 100;
  }

  function nonnegativeMoney(value, label) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Please enter a valid ${label}.`);
    if (amount > 999999999) throw new Error(`${label} is too large.`);
    return Math.round(amount * 100) / 100;
  }

  function boundedNumber(value, label, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new Error(`${label} must be between ${min} and ${max}.`);
    }
    return Math.round(number);
  }

  function safeDate(value) {
    const date = value || todayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Please enter a valid date.");
    return date;
  }

  function createInviteCode() {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const number = [...bytes].reduce((sum, byte) => (sum << 8) + byte, 0) >>> 0;
    return `BUDGET-${number.toString(36).toUpperCase().padStart(7, "0").slice(0, 7)}`;
  }

  function isDesktopMode() {
    // 901, not 900. Every CSS override is `max-width: 900px`, so at exactly 900px
    // both matched: JS emitted desktop markup while CSS applied mobile rules.
    return window.matchMedia("(min-width: 901px)").matches;
  }

  function randomBase64(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function keyStorageKey(familyId = state.family?.id) {
    return `${STORAGE_KEY}:family-key:${state.user?.id || "anon"}:${familyId}`;
  }

  async function deriveFamilyKey(passphrase, saltBase64) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: base64ToBytes(saltBase64), iterations: 250000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function importFamilyKey(rawBase64) {
    return crypto.subtle.importKey("raw", base64ToBytes(rawBase64), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  }

  async function rememberFamilyKey(familyId, key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    localStorage.setItem(keyStorageKey(familyId), bytesToBase64(new Uint8Array(raw)));
  }

  async function encryptJson(key, payload) {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
    return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
  }

  async function decryptJson(key, value) {
    const [version, ivBase64, dataBase64] = String(value || "").split(".");
    if (version !== "v1" || !ivBase64 || !dataBase64) throw new Error("Encrypted expense format is not supported.");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivBase64) }, key, base64ToBytes(dataBase64));
    return JSON.parse(decoder.decode(plaintext));
  }

  // Proof that the holder knows the family privacy password, safe to hand to the
  // server. Domain separated so it is not simply the hash of the encryption key.
  // The server compares this against budget_families.key_fingerprint, which is why
  // joining can be gated on the password without the server ever seeing it.
  async function familyKeyFingerprint(key) {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const material = encoder.encode(KEY_FINGERPRINT_CONTEXT);
    const input = new Uint8Array(material.length + raw.length);
    input.set(material, 0);
    input.set(raw, material.length);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return bytesToBase64(new Uint8Array(digest));
  }

  async function createPrivacySetup(passphrase) {
    const salt = randomBase64(16);
    const key = await deriveFamilyKey(passphrase, salt);
    return {
      salt,
      key,
      check: await encryptJson(key, { check: KEY_CHECK_TEXT }),
      fingerprint: await familyKeyFingerprint(key)
    };
  }

  async function verifyPrivacyKey(passphrase, salt, check) {
    const key = await deriveFamilyKey(passphrase, salt);
    const result = await decryptJson(key, check);
    if (result.check !== KEY_CHECK_TEXT) throw new Error("Family privacy password is not correct.");
    return key;
  }

  async function loadFamilyKey() {
    state.familyKey = null;
    state.privacyLocked = false;
    if (!state.family?.encryption_salt) return;
    const stored = localStorage.getItem(keyStorageKey(state.family.id));
    if (!stored) {
      state.privacyLocked = true;
      return;
    }
    try {
      state.familyKey = await importFamilyKey(stored);
    } catch (_) {
      localStorage.removeItem(keyStorageKey(state.family.id));
      state.privacyLocked = true;
    }
  }

  async function hydrateFamily(row) {
    if (!row?.encrypted_payload) return row ? { ...row, needsEncryptionMigration: Boolean(state.familyKey) } : row;
    if (!state.familyKey) {
      state.privacyLocked = true;
      return { ...row, name: "Locked family", monthly_budget: 0, savings_goal_amount: 0, locked: true };
    }
    try {
      const decrypted = await decryptJson(state.familyKey, row.encrypted_payload);
      return { ...row, ...decrypted, encrypted: true };
    } catch (_) {
      state.privacyLocked = true;
      return { ...row, name: "Locked family", monthly_budget: 0, savings_goal_amount: 0, locked: true };
    }
  }

  async function hydratePeople(rows) {
    const hydrated = [];
    for (const row of rows) {
      if (!row.encrypted_payload) {
        hydrated.push({ ...row, needsEncryptionMigration: Boolean(state.familyKey) });
        continue;
      }
      if (!state.familyKey) {
        hydrated.push({ ...row, display_name: "Locked member", locked: true });
        state.privacyLocked = true;
        continue;
      }
      try {
        hydrated.push({ ...row, ...(await decryptJson(state.familyKey, row.encrypted_payload)), encrypted: true });
      } catch (_) {
        hydrated.push({ ...row, display_name: "Locked member", locked: true });
        state.privacyLocked = true;
      }
    }
    return hydrated;
  }

  async function hydrateCategories(rows) {
    const hydrated = [];
    for (const row of rows) {
      if (!row.encrypted_payload) {
        hydrated.push({ ...row, needsEncryptionMigration: Boolean(state.familyKey) });
        continue;
      }
      if (!state.familyKey) {
        hydrated.push({ ...row, name: "Locked category", color: COLORS[0], monthly_limit: 0, locked: true });
        state.privacyLocked = true;
        continue;
      }
      try {
        hydrated.push({ ...row, ...(await decryptJson(state.familyKey, row.encrypted_payload)), encrypted: true });
      } catch (_) {
        hydrated.push({ ...row, name: "Locked category", color: COLORS[0], monthly_limit: 0, locked: true });
        state.privacyLocked = true;
      }
    }
    return hydrated;
  }

  async function hydrateExpenses(rows) {
    const hydrated = [];
    for (const row of rows) {
      if (!row.encrypted_payload) {
        hydrated.push({ ...row, needsEncryptionMigration: Boolean(state.familyKey) });
        continue;
      }
      if (!state.familyKey) {
        hydrated.push({ ...row, title: "Locked expense", amount: 0, note: "", category_id: null, locked: true });
        state.privacyLocked = true;
        continue;
      }
      try {
        const decrypted = await decryptJson(state.familyKey, row.encrypted_payload);
        hydrated.push({ ...row, ...decrypted, encrypted: true });
      } catch (_) {
        hydrated.push({ ...row, title: "Locked expense", amount: 0, note: "", category_id: null, locked: true });
        state.privacyLocked = true;
      }
    }
    return hydrated;
  }

  async function hydrateIncomes(rows) {
    const hydrated = [];
    for (const row of rows) {
      if (!row.encrypted_payload) {
        hydrated.push({ ...row, needsEncryptionMigration: Boolean(state.familyKey) });
        continue;
      }
      if (!state.familyKey) {
        hydrated.push({ ...row, title: "Locked income", amount: 0, category_id: null, day_of_month: 1, locked: true });
        state.privacyLocked = true;
        continue;
      }
      try {
        const decrypted = await decryptJson(state.familyKey, row.encrypted_payload);
        hydrated.push({ ...row, ...decrypted, encrypted: true });
      } catch (_) {
        hydrated.push({ ...row, title: "Locked income", amount: 0, category_id: null, day_of_month: 1, locked: true });
        state.privacyLocked = true;
      }
    }
    return hydrated;
  }

  async function hydrateAnalyticsSnapshots(rows) {
    const hydrated = [];
    for (const row of rows) {
      if (!state.familyKey) {
        hydrated.push(row);
        continue;
      }
      try {
        hydrated.push({ ...row, payload: await decryptJson(state.familyKey, row.encrypted_payload) });
      } catch (_) {
        hydrated.push(row);
      }
    }
    return hydrated;
  }

  async function encryptedExpensePayload(plain) {
    if (!state.family?.encryption_salt) throw new Error("Please set the family privacy password before entering expenses.");
    if (!state.familyKey) throw new Error("Please unlock family expenses first.");
    return encryptJson(state.familyKey, plain);
  }

  async function encryptedIncomePayload(plain) {
    if (!state.family?.encryption_salt) throw new Error("Please set the family privacy password before entering income.");
    if (!state.familyKey) throw new Error("Please unlock family income first.");
    return encryptJson(state.familyKey, plain);
  }

  async function encryptedFamilyPayload(plain) {
    if (!state.familyKey) throw new Error("Please unlock family privacy first.");
    return encryptJson(state.familyKey, plain);
  }

  async function encryptedCategoryPayload(plain) {
    if (!state.familyKey) throw new Error("Please unlock family privacy first.");
    return encryptJson(state.familyKey, plain);
  }

  async function encryptedPersonPayload(plain) {
    if (!state.familyKey) throw new Error("Please unlock family privacy first.");
    return encryptJson(state.familyKey, plain);
  }

  function familySettingsPayload(source = state.family) {
    return {
      name: source?.name || "Family",
      currency_code: source?.currency_code || "INR",
      monthly_budget: Number(source?.monthly_budget || 0),
      savings_goal_amount: Number(source?.savings_goal_amount || 0)
    };
  }

  function categoryPayload(source) {
    return {
      name: source.name,
      scope: source.scope || "EXPENSE",
      color: source.color || COLORS[0],
      monthly_limit: Number(source.monthly_limit || 0)
    };
  }

  function personPayload(source) {
    return {
      display_name: source.display_name || "Family member"
    };
  }

  async function createFamily(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const familyName = requireText(data.family || "My Family", "family name", 80);
    const personName = requireText(data.person || "Me", "your display name", 80);
    // Budget and savings goal are no longer asked for up front -- you cannot
    // sensibly pick them before entering a single expense. Both start unset and
    // are edited later from the Family tab (familyPlanForm).
    const budget = 0;
    const savingsGoal = 0;
    const privacy = requireText(data.privacy, "a family password", 120);
    if (privacy.length < 8) throw new Error("Family password must be at least 8 characters.");
    const privacySetup = await createPrivacySetup(privacy);

    if (state.demo) {
      const familyId = crypto.randomUUID();
      state.family = { id: familyId, name: familyName, currency_code: "INR", monthly_budget: budget, savings_goal_amount: savingsGoal, owner_id: state.user.id, invite_code: createInviteCode(), invite_locked: false, encryption_salt: privacySetup.salt, encryption_check: privacySetup.check };
      state.familyKey = privacySetup.key;
      state.privacyLocked = false;
      state.membership = { family_id: familyId, role: "OWNER" };
      state.people = [{ id: crypto.randomUUID(), family_id: familyId, display_name: personName, linked_user_id: state.user.id }];
      state.categories = [
        ...EXPENSE_DEFAULTS.map((name, index) => ({ id: crypto.randomUUID(), family_id: familyId, name, scope: "EXPENSE", color: COLORS[index % COLORS.length], monthly_limit: 0 })),
        ...INCOME_DEFAULTS.map((name, index) => ({ id: crypto.randomUUID(), family_id: familyId, name, scope: "INCOME", color: COLORS[(index + 3) % COLORS.length], monthly_limit: 0 }))
      ];
      writeDemo();
      clearFormDraft("create-family");
      render();
      return;
    }

    const { data: family, error: familyError } = await client
      .from("budget_families")
      .insert({
        name: "Encrypted family",
        owner_id: state.user.id,
        currency_code: "INR",
        monthly_budget: 0,
        savings_goal_amount: 0,
        invite_code: createInviteCode(),
        invite_locked: false,
        encryption_salt: privacySetup.salt,
        encryption_check: privacySetup.check,
        // Lets the server verify a joiner's password without ever seeing it.
        key_fingerprint: privacySetup.fingerprint,
        encrypted_payload: await encryptJson(privacySetup.key, {
          name: familyName,
          currency_code: "INR",
          monthly_budget: budget,
          savings_goal_amount: savingsGoal
        }),
        encryption_version: 1
      })
      .select()
      .single();
    if (familyError) throw familyError;
    await rememberFamilyKey(family.id, privacySetup.key);
    state.familyKey = privacySetup.key;

    const { error: memberError } = await client
      .from("budget_family_users")
      .insert({ family_id: family.id, user_id: state.user.id, role: "OWNER" });
    if (memberError) throw memberError;

    const { error: personError } = await client
      .from("budget_people")
      .insert({
        family_id: family.id,
        display_name: "Encrypted member",
        linked_user_id: state.user.id,
        created_by: state.user.id,
        encrypted_payload: await encryptJson(privacySetup.key, { display_name: personName }),
        encryption_version: 1
      });
    if (personError) throw personError;

    await seedDefaultCategories(family.id);
    clearFormDraft("create-family");
    await load();
  }

  async function seedDefaultCategories(familyId) {
    const defaults = [
      ...EXPENSE_DEFAULTS.map((name, index) => ({ name, scope: "EXPENSE", color: COLORS[index % COLORS.length], monthly_limit: 0 })),
      ...INCOME_DEFAULTS.map((name, index) => ({ name, scope: "INCOME", color: COLORS[(index + 3) % COLORS.length], monthly_limit: 0 }))
    ];
    const rows = await Promise.all(defaults.map(async (category) => ({
      family_id: familyId,
      name: `Encrypted category ${crypto.randomUUID().slice(0, 8)}`,
      scope: "EXPENSE",
      color: COLORS[0],
      monthly_limit: 0,
      created_by: state.user.id,
      encrypted_payload: await encryptedCategoryPayload(category),
      encryption_version: 1
    })));
    const { error } = await client.from("budget_categories").insert(rows);
    if (error) throw error;
  }

  // Invite code + family password is the whole flow. No approval step: the password
  // is the real gate, and it is now verified server side (see join_budget_family in
  // schema.sql), so waiting on a moderator was friction without protection.
  async function joinFamily(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (state.demo) throw new Error("Invite joining needs Supabase. Preview mode can create a family locally.");
    // The mobile invite card used to display the code with a PADMA- prefix while
    // the stored code was BUDGET-, so anyone who typed what they saw was rejected.
    // The card now shows the real code; this keeps older screenshots working.
    const code = requireText(data.code, "invite code", 32).toUpperCase().replace(/^PADMA-/, "BUDGET-");
    const person = requireText(data.person || "Family member", "your display name", 80);
    const privacy = requireText(data.privacy, "the family privacy password", 120);

    const { data: securityRows, error: securityError } = await client.rpc("get_budget_invite_security", {
      invite_code_input: code
    });
    if (securityError) throw securityError;
    const security = securityRows?.[0];
    if (!security) throw new Error("That invite code is not valid, or this family has stopped accepting new members.");
    if (!security.encryption_salt) {
      throw new Error("This family is not ready for new members yet. Ask the person who created the family to open the app once, then try again.");
    }

    // Derive locally and send only the fingerprint -- the password never leaves
    // the browser. A wrong password is rejected by the server, not by us.
    const familyKeyForJoin = await deriveFamilyKey(privacy, security.encryption_salt);
    const fingerprint = await familyKeyFingerprint(familyKeyForJoin);

    const { data: joinedFamilyId, error } = await client.rpc("join_budget_family", {
      invite_code_input: code,
      display_name_input: person,
      key_fingerprint_input: fingerprint
    });
    if (error) throw error;

    // Only persist the key once the server has accepted it, so a failed attempt
    // cannot leave a bad key cached for this family.
    await rememberFamilyKey(joinedFamilyId || security.family_id, familyKeyForJoin);
    state.familyKey = familyKeyForJoin;
    state.privacyLocked = false;

    // Replace the placeholder name the RPC inserted with an encrypted one. This
    // browser holds the key; under the old approval flow the moderator's browser
    // had to do it afterwards, leaving the name in plaintext until then.
    if (joinedFamilyId) {
      const { error: personEncryptError } = await client
        .from("budget_people")
        .update({
          display_name: "Encrypted member",
          encrypted_payload: await encryptJson(familyKeyForJoin, { display_name: person }),
          encryption_version: 1
        })
        .eq("family_id", joinedFamilyId)
        .eq("linked_user_id", state.user.id);
      if (personEncryptError) throw personEncryptError;
    }

    clearFormDraft("join-family");
    await load();
  }

  async function unlockPrivacy(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const privacy = requireText(data.privacy, "the family privacy password", 120);
    const key = await verifyPrivacyKey(privacy, state.family.encryption_salt, state.family.encryption_check);
    await rememberFamilyKey(state.family.id, key);
    state.familyKey = key;
    state.privacyLocked = false;
    await backfillKeyFingerprint(key);
    clearFormDraft("privacy-unlock");
    await load();
  }

  // Families created before server side password verification have no fingerprint,
  // so join_budget_family refuses them. Anyone who unlocks proves they know the
  // password, so they can safely write it -- the family self heals on first use.
  async function backfillKeyFingerprint(key) {
    if (!client || state.demo) return;
    if (!state.family?.id || state.family.key_fingerprint) return;
    try {
      const fingerprint = await familyKeyFingerprint(key);
      await client
        .from("budget_families")
        .update({ key_fingerprint: fingerprint })
        .eq("id", state.family.id)
        .is("key_fingerprint", null);
    } catch (_) {
      // Non-fatal: only the owner can write this row, and unlocking must still
      // succeed for everyone else.
    }
  }

  async function setupPrivacy(form) {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family admin can turn on encryption.");
    const data = Object.fromEntries(new FormData(form).entries());
    const privacy = requireText(data.privacy, "a family privacy password", 120);
    if (privacy.length < 8) throw new Error("Family privacy password must be at least 8 characters.");
    const privacySetup = await createPrivacySetup(privacy);
    if (state.demo) {
      state.family = { ...state.family, encryption_salt: privacySetup.salt, encryption_check: privacySetup.check };
      state.familyKey = privacySetup.key;
      state.privacyLocked = false;
      writeDemo();
      clearFormDraft("privacy-setup");
      render();
      return;
    }
    const { error } = await client
      .from("budget_families")
      .update({ encryption_salt: privacySetup.salt, encryption_check: privacySetup.check })
      .eq("id", state.family.id);
    if (error) throw error;
    await rememberFamilyKey(state.family.id, privacySetup.key);
    clearFormDraft("privacy-setup");
    await load();
  }

  async function leaveFamily() {
    if (!window.confirm("Leave this family? If you are the family admin, the next admin will be chosen alphabetically.")) return;
    if (state.demo) {
      state.family = null;
      state.membership = null;
      state.people = [];
      state.expenses = [];
      state.incomes = [];
      writeDemo();
      render();
      return;
    }
    const familyId = state.family.id;
    const { error } = await client.rpc("leave_budget_family", { target_family: familyId });
    if (error) throw error;
    localStorage.removeItem(keyStorageKey(familyId));
    await load();
  }

  async function rotateInviteCode() {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family admin can rotate the invite code.");
    if (!window.confirm("Rotate the invite code? The old code will stop working immediately.")) return;
    if (state.demo) {
      const nextCode = createInviteCode();
      state.family = { ...state.family, invite_code: nextCode };
      writeDemo();
      render();
      window.alert(`New invite code: ${nextCode}`);
      return;
    }
    const { data, error } = await client.rpc("rotate_budget_family_invite", {
      target_family: state.family.id
    });
    if (error) throw error;
    await load();
    window.alert(`New invite code: ${data}`);
  }

  async function removeFamilyMember(userId, memberName) {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family admin can remove members.");
    if (!userId) throw new Error("This person is not a signed-in member.");
    if (!window.confirm(`Remove ${memberName || "this member"} from the family? They will lose access immediately.`)) return;
    if (state.demo) {
      state.people = state.people.map((person) => person.linked_user_id === userId ? { ...person, linked_user_id: null } : person);
      writeDemo();
      render();
      return;
    }
    const { error } = await client.rpc("remove_budget_family_member", {
      target_family: state.family.id,
      target_user: userId
    });
    if (error) throw error;
    await load();
  }

  async function saveExpense(form) {
    const id = form.dataset.id;
    const data = Object.fromEntries(new FormData(form).entries());
    const existingExpense = id ? state.expenses.find((expense) => expense.id === id) : null;
    const payload = {
      family_id: state.family.id,
      title: requireText(data.title, "what it was for", 120),
      amount: positiveMoney(data.amount, "amount"),
      spent_on: safeDate(data.spent_on),
      person_id: data.person_id,
      category_id: data.category_id || null,
      note: Object.hasOwn(data, "note") ? optionalText(data.note, 500) : existingExpense?.note || null,
      recurrence: data.recurrence === "NONE" || !data.recurrence ? "NONE" : cadenceOf({ recurrence: data.recurrence }),
      // The status control only renders once an expense already repeats, so on
      // the first save there is no field to read and it starts out active.
      lifecycle: data.recurrence && data.recurrence !== "NONE"
        ? lifecycleOf({ lifecycle: data.lifecycle || existingExpense?.lifecycle })
        : "ACTIVE",
      anchor_on: safeDate(data.spent_on),
      entered_by: state.user.id
    };
    if (!state.people.some((person) => person.id === payload.person_id)) throw new Error("Please choose a family member.");

    if (state.demo) {
      if (id) state.expenses = state.expenses.map((expense) => expense.id === id ? { ...expense, ...payload } : expense);
      else state.expenses.unshift({ id: crypto.randomUUID(), ...payload, created_at: new Date().toISOString() });
      state.modal = null;
      // Same follow-the-expense behaviour as the real path, so preview is an
      // honest rehearsal of what a family will actually see.
      focusMonthOf(payload.spent_on);
      if (monthKey(payload.spent_on) !== currentMonth()) {
        showNotice(`Saved to ${monthLabel(monthKey(payload.spent_on))}. Showing that month now.`);
      }
      writeDemo();
      render();
      return;
    }

    const encryptedPayload = await encryptedExpensePayload(payload);
    const databasePayload = {
      family_id: state.family.id,
      title: "Encrypted expense",
      amount: 1,
      spent_on: todayKey(),
      person_id: currentUserPerson()?.id || payload.person_id,
      category_id: null,
      note: null,
      entered_by: state.user.id,
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    };
    const query = id
      ? client.from("budget_expenses").update(databasePayload).eq("id", id)
      : client.from("budget_expenses").insert(databasePayload);
    const { error } = await query;
    if (error) throw error;
    queueAnalyticsSnapshot(monthKey(payload.spent_on));
    state.modal = null;
    // Follow the expense. Saving one dated outside the visible range used to
    // succeed silently and show nothing, which read as "it did not save".
    focusMonthOf(payload.spent_on);
    if (monthKey(payload.spent_on) !== currentMonth()) {
      showNotice(`Saved to ${monthLabel(monthKey(payload.spent_on))}. Showing that month now.`);
    }
    await load();
  }

  function expensePayloadFrom(expense, overrides = {}) {
    return {
      family_id: state.family.id,
      title: expense.title,
      amount: Number(expense.amount || 0),
      spent_on: safeDate(expense.spent_on),
      person_id: expense.person_id,
      category_id: expense.category_id || null,
      note: expense.note || null,
      recurrence: isRecurringExpense(expense) ? cadenceOf(expense) : "NONE",
      lifecycle: lifecycleOf(expense),
      anchor_on: anchorDateOf(expense, currentMonth()),
      entered_by: expense.entered_by || state.user.id,
      ...overrides
    };
  }

  async function setExpenseLifecycle(id, next) {
    const expense = state.expenses.find((item) => item.id === id);
    if (!expense) return;
    const lifecycle = lifecycleOf({ lifecycle: next });
    if (state.demo) {
      state.expenses = state.expenses.map((item) => item.id === id ? { ...item, lifecycle } : item);
      writeDemo();
      render();
      return;
    }
    const encryptedPayload = await encryptedExpensePayload(expensePayloadFrom(expense, { lifecycle }));
    const { error } = await client.from("budget_expenses").update({
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    }).eq("id", id);
    if (error) throw error;
    queueAnalyticsSnapshot(monthKey(expense.spent_on));
    await load();
  }

  async function deleteExpense(id) {
    const expense = state.expenses.find((item) => item.id === id);
    const label = expense ? `${expense.title} - ${money(expense.amount)}` : "this expense";
    if (!window.confirm(`Delete ${label}?\n\nPlease confirm. This cannot be undone.`)) return;
    if (state.demo) {
      state.expenses = state.expenses.filter((expense) => expense.id !== id);
      state.modal = null;
      writeDemo();
      render();
      return;
    }
    const { error } = await client.from("budget_expenses").delete().eq("id", id);
    if (error) throw error;
    if (expense?.spent_on) queueAnalyticsSnapshot(monthKey(expense.spent_on));
    state.modal = null;
    await load();
  }

  async function saveIncome(form) {
    const id = form.dataset.id;
    const data = Object.fromEntries(new FormData(form).entries());
    const cadence = cadenceOf({ cadence: data.cadence });
    const lifecycle = lifecycleOf({ lifecycle: data.lifecycle });
    const anchorOn = isDateKey(data.anchor_on) ? data.anchor_on : todayKey();
    const payload = {
      family_id: state.family.id,
      title: requireText(data.title, "income title", 120),
      amount: positiveMoney(data.amount, "income amount"),
      cadence,
      anchor_on: anchorOn,
      lifecycle,
      // Kept in sync with the anchor so anything still reading day_of_month --
      // older clients, the analytics snapshots -- keeps getting a sane value.
      // Clamped rather than validated: the 29th onward does not exist in every
      // month, and refusing the date would be a strange way to say so.
      day_of_month: Math.min(Math.max(Number(anchorOn.slice(8, 10)) || 1, 1), 28),
      category_id: data.category_id || null,
      is_active: lifecycle === "ACTIVE",
      created_by: state.user.id
    };

    if (state.demo) {
      if (id) state.incomes = state.incomes.map((income) => income.id === id ? { ...income, ...payload } : income);
      else state.incomes.unshift({ id: crypto.randomUUID(), ...payload });
      state.modal = null;
      writeDemo();
      render();
      return;
    }

    const encryptedPayload = await encryptedIncomePayload(payload);
    const databasePayload = {
      family_id: state.family.id,
      title: "Encrypted income",
      amount: 1,
      day_of_month: 1,
      category_id: null,
      is_active: true,
      created_by: state.user.id,
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    };
    const query = id
      ? client.from("budget_incomes").update(databasePayload).eq("id", id)
      : client.from("budget_incomes").insert(databasePayload);
    const { error } = await query;
    if (error) throw error;
    queueAnalyticsSnapshot(currentMonth());
    state.modal = null;
    await load();
  }

  // Rebuilds the whole payload from the hydrated row, so fields this function
  // does not care about survive the write. The previous version listed the
  // columns it knew by hand, which silently dropped anything added later --
  // pausing an income would have erased its cadence.
  function incomePayloadFrom(income, overrides = {}) {
    const merged = {
      family_id: state.family.id,
      title: income.title,
      amount: Number(income.amount || 0),
      cadence: cadenceOf(income),
      anchor_on: anchorDateOf(income, currentMonth()),
      lifecycle: lifecycleOf(income),
      day_of_month: Number(income.day_of_month || 1),
      category_id: income.category_id || null,
      created_by: income.created_by || state.user.id,
      ...overrides
    };
    merged.is_active = merged.lifecycle === "ACTIVE";
    return merged;
  }

  async function setIncomeLifecycle(id, next) {
    const income = state.incomes.find((item) => item.id === id);
    if (!income) return;
    const lifecycle = lifecycleOf({ lifecycle: next });
    if (state.demo) {
      state.incomes = state.incomes.map((item) => item.id === id
        ? { ...item, lifecycle, is_active: lifecycle === "ACTIVE" }
        : item);
      writeDemo();
      render();
      return;
    }
    const payload = incomePayloadFrom(income, { lifecycle });
    const encryptedPayload = await encryptedIncomePayload(payload);
    const { error } = await client.from("budget_incomes").update({
      title: "Encrypted income",
      amount: 1,
      day_of_month: 1,
      category_id: null,
      is_active: true,
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    }).eq("id", id);
    if (error) throw error;
    queueAnalyticsSnapshot(currentMonth());
    await load();
  }

  async function deleteIncome(id) {
    const income = state.incomes.find((item) => item.id === id);
    if (!income) return;
    if (!confirm(`Delete ${income.title}?`)) return;
    if (state.demo) {
      state.incomes = state.incomes.filter((item) => item.id !== id);
      writeDemo();
      render();
      return;
    }
    const { error } = await client.from("budget_incomes").delete().eq("id", id);
    if (error) throw error;
    queueAnalyticsSnapshot(currentMonth());
    await load();
  }

  async function saveCategory(form) {
    const id = form.dataset.id;
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      family_id: state.family.id,
      name: requireText(data.name, "category name", 80),
      scope: data.scope || state.scope,
      color: data.color || COLORS[0],
      monthly_limit: nonnegativeMoney(data.monthly_limit || 0, "monthly category limit"),
      created_by: state.user.id
    };
    if (!/^#[0-9a-f]{6}$/i.test(payload.color)) throw new Error("Please choose a valid category color.");
    const existing = findCategoryByName(payload.scope, payload.name, id);
    if (existing) {
      if (id) throw new Error(`"${payload.name}" already exists in ${payload.scope === "EXPENSE" ? "expense" : "income"} categories.`);
      state.scope = existing.scope;
      state.modal = null;
      render();
      return;
    }

    if (state.demo) {
      if (id) state.categories = state.categories.map((category) => category.id === id ? { ...category, ...payload } : category);
      else state.categories.push({ id: crypto.randomUUID(), ...payload });
      state.modal = null;
      writeDemo();
      render();
      return;
    }

    const encryptedPayload = await encryptedCategoryPayload(categoryPayload(payload));
    const databasePayload = {
      family_id: state.family.id,
      name: id ? (state.categories.find((category) => category.id === id)?.name?.startsWith("Encrypted category") ? state.categories.find((category) => category.id === id).name : `Encrypted category ${String(id).slice(0, 8)}`) : `Encrypted category ${crypto.randomUUID().slice(0, 8)}`,
      scope: "EXPENSE",
      color: COLORS[0],
      monthly_limit: 0,
      created_by: state.user.id,
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    };
    const query = id
      ? client.from("budget_categories").update(databasePayload).eq("id", id)
      : client.from("budget_categories").insert(databasePayload);
    const { error } = await query;
    if (error) {
      if (isCategoryNameConflict(error)) {
        if (id) throw new Error(`"${payload.name}" already exists in ${payload.scope === "EXPENSE" ? "expense" : "income"} categories.`);
        state.modal = null;
        await load();
        return;
      }
      throw error;
    }
    if (payload.scope === "EXPENSE") queueAnalyticsSnapshot(selectedMonth());
    state.modal = null;
    await load();
  }

  async function deleteCategory(id) {
    if (!window.confirm("Delete this category? Existing entries keep their amount but lose this category.")) return;
    if (state.demo) {
      state.categories = state.categories.filter((category) => category.id !== id);
      state.expenses = state.expenses.map((expense) => expense.category_id === id ? { ...expense, category_id: null } : expense);
      state.incomes = state.incomes.map((income) => income.category_id === id ? { ...income, category_id: null } : income);
      writeDemo();
      render();
      return;
    }
    const { error } = await client.from("budget_categories").delete().eq("id", id);
    if (error) throw error;
    queueAnalyticsSnapshot(selectedMonth());
    await load();
  }

  async function saveFamilyPlanning(form) {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family admin can change the monthly plan.");
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      monthly_budget: nonnegativeMoney(data.monthly_budget || 0, "monthly budget"),
      savings_goal_amount: nonnegativeMoney(data.savings_goal_amount || 0, "savings goal")
    };
    if (state.demo) {
      state.family = { ...state.family, ...payload };
      writeDemo();
      render();
      return;
    }
    const encryptedPayload = await encryptedFamilyPayload(familySettingsPayload({ ...state.family, ...payload }));
    const { error } = await client.from("budget_families").update({
      name: "Encrypted family",
      monthly_budget: 0,
      savings_goal_amount: 0,
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    }).eq("id", state.family.id);
    if (error) throw error;
    queueAnalyticsSnapshot(selectedMonth());
    await load();
  }

  async function saveCategoryLimits(form) {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family admin can change category limits.");
    const fields = [...form.querySelectorAll("[data-limit-category]")];
    const updates = activeExpenseCategories().map((category) => {
      const field = fields.find((input) => input.dataset.limitCategory === category.id);
      return {
        id: category.id,
        monthly_limit: nonnegativeMoney(field?.value || 0, `${category.name} monthly limit`)
      };
    });
    if (state.demo) {
      state.categories = state.categories.map((category) => {
        const update = updates.find((item) => item.id === category.id);
        return update ? { ...category, monthly_limit: update.monthly_limit } : category;
      });
      state.modal = null;
      writeDemo();
      render();
      return;
    }
    for (const update of updates) {
      const category = state.categories.find((item) => item.id === update.id);
      if (!category) continue;
      const { error } = await client
        .from("budget_categories")
        .update({
          name: `Encrypted category ${String(update.id).slice(0, 8)}`,
          scope: "EXPENSE",
          color: COLORS[0],
          monthly_limit: 0,
          encrypted_payload: await encryptedCategoryPayload(categoryPayload({ ...category, monthly_limit: update.monthly_limit })),
          encryption_version: 1
        })
        .eq("id", update.id)
        .eq("family_id", state.family.id);
      if (error) throw error;
    }
    queueAnalyticsSnapshot(selectedMonth());
    state.modal = null;
    await load();
  }

  async function migratePlaintextPrivacyRows() {
    if (state.demo || privacyMigrationRunning || !state.familyKey || state.privacyLocked || !state.family?.id) return;
    const hasWork =
      state.family.needsEncryptionMigration ||
      state.people.some((person) => person.needsEncryptionMigration) ||
      state.categories.some((category) => category.needsEncryptionMigration) ||
      state.expenses.some((expense) => expense.needsEncryptionMigration) ||
      state.incomes.some((income) => income.needsEncryptionMigration);
    if (!hasWork) return;

    privacyMigrationRunning = true;
    try {
      if (state.family.needsEncryptionMigration) {
        const { error } = await client.from("budget_families").update({
          name: "Encrypted family",
          monthly_budget: 0,
          savings_goal_amount: 0,
          encrypted_payload: await encryptedFamilyPayload(familySettingsPayload(state.family)),
          encryption_version: 1
        }).eq("id", state.family.id);
        if (error) throw error;
      }

      for (const person of state.people.filter((item) => item.needsEncryptionMigration)) {
        const { error } = await client.from("budget_people").update({
          display_name: "Encrypted member",
          encrypted_payload: await encryptedPersonPayload(personPayload(person)),
          encryption_version: 1
        }).eq("id", person.id);
        if (error) throw error;
      }

      for (const category of state.categories.filter((item) => item.needsEncryptionMigration)) {
        const { error } = await client.from("budget_categories").update({
          name: `Encrypted category ${String(category.id).slice(0, 8)}`,
          scope: "EXPENSE",
          color: COLORS[0],
          monthly_limit: 0,
          encrypted_payload: await encryptedCategoryPayload(categoryPayload(category)),
          encryption_version: 1
        }).eq("id", category.id);
        if (error) throw error;
      }

      for (const expense of state.expenses.filter((item) => item.needsEncryptionMigration)) {
        const payload = {
          family_id: state.family.id,
          title: expense.title,
          amount: Number(expense.amount || 0),
          spent_on: expense.spent_on || todayKey(),
          person_id: expense.person_id,
          category_id: expense.category_id || null,
          note: expense.note || null,
          entered_by: expense.entered_by || state.user.id
        };
        const shellPerson = currentUserPerson()?.id || expense.person_id;
        const { error } = await client.from("budget_expenses").update({
          title: "Encrypted expense",
          amount: 1,
          spent_on: todayKey(),
          person_id: shellPerson,
          category_id: null,
          note: null,
          encrypted_payload: await encryptedExpensePayload(payload),
          encryption_version: 1
        }).eq("id", expense.id);
        if (error) throw error;
      }

      for (const income of state.incomes.filter((item) => item.needsEncryptionMigration)) {
        const payload = {
          family_id: state.family.id,
          title: income.title,
          amount: Number(income.amount || 0),
          day_of_month: Number(income.day_of_month || 1),
          category_id: income.category_id || null,
          is_active: isIncomeActive(income),
          created_by: income.created_by || state.user.id
        };
        const { error } = await client.from("budget_incomes").update({
          title: "Encrypted income",
          amount: 1,
          day_of_month: 1,
          category_id: null,
          is_active: true,
          encrypted_payload: await encryptedIncomePayload(payload),
          encryption_version: 1
        }).eq("id", income.id);
        if (error) throw error;
      }

      queueRefresh(100);
    } catch (error) {
      showError(error);
    } finally {
      privacyMigrationRunning = false;
    }
  }

  async function savePerson(form) {
    const id = form.dataset.id;
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      family_id: state.family.id,
      display_name: requireText(data.display_name, "a name", 80),
      created_by: state.user.id
    };

    if (state.demo) {
      if (id) state.people = state.people.map((person) => person.id === id ? { ...person, ...payload } : person);
      else state.people.push({ id: crypto.randomUUID(), ...payload });
      state.modal = null;
      writeDemo();
      render();
      return;
    }

    const databasePayload = {
      family_id: state.family.id,
      display_name: "Encrypted member",
      created_by: state.user.id,
      encrypted_payload: await encryptedPersonPayload(personPayload(payload)),
      encryption_version: 1
    };
    const query = id
      ? client.from("budget_people").update(databasePayload).eq("id", id)
      : client.from("budget_people").insert(databasePayload);
    const { error } = await query;
    if (error) throw error;
    state.modal = null;
    await load();
  }

  async function toggleFamilyLock() {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family creator can lock or unlock joining.");
    const nextLocked = !state.family.invite_locked;
    if (state.demo) {
      state.family = { ...state.family, invite_locked: nextLocked };
      writeDemo();
      render();
      return;
    }
    const { error } = await client
      .from("budget_families")
      .update({ invite_locked: nextLocked })
      .eq("id", state.family.id);
    if (error) throw error;
    await load();
  }

  async function copyInviteCode(event) {
    const code = event.currentTarget.dataset.copyInvite || state.family?.invite_code || "";
    if (!code || code === "Code is being prepared") throw new Error("Invite code is not ready yet.");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      window.alert("Invite code copied.");
      return;
    }
    window.prompt("Copy this invite code", code);
  }

  function runForm(action) {
    return run((event) => {
      event.preventDefault();
      return action(event.currentTarget);
    });
  }

  function run(action) {
    return async (event) => {
      try {
        state.busy = true;
        state.error = "";
        await action(event);
      } catch (error) {
        showError(error);
      } finally {
        state.busy = false;
      }
    };
  }

  // Transient confirmation. .notice was styled but nothing ever set one, so a
  // save that landed outside the visible range gave no feedback at all.
  function showNotice(message) {
    state.notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      state.notice = "";
      render();
    }, 6000);
  }

  function showError(error) {
    if (isCategoryNameConflict(error)) {
      state.error = "This category already exists. Please choose it from the list or use a different name.";
    } else {
      state.error = error.message || "Something went wrong.";
    }
    render();
  }

  function softColor(hex) {
    return `${hex || COLORS[0]}22`;
  }

  /* ==========================================================================
     First-run guided tour

     Anchors a spotlight to real elements in the live app. The overlay is appended
     to document.body -- a SIBLING of #app -- because render() only assigns
     app.innerHTML, so anything outside #app survives every re-render for free.

     Tour state is deliberately module-level rather than on `state`: load() mutates
     `state` constantly and writeDemo() serialises it.
     ========================================================================== */

  const TOUR_VERSION = 1;

  const TOUR_STEPS = [
    {
      id: "balance",
      target: '[data-tour="balance"]',
      title: "Your month at a glance",
      body: "This is everything coming in this month. It updates on its own as your family adds expenses.",
      placement: "bottom",
      requires: { tab: "dashboard" }
    },
    {
      id: "summary",
      target: '[data-tour="summary"]',
      title: "Spending and savings",
      body: "What has gone out this month, and how your savings goal is doing. You can set a monthly budget later from the Family tab.",
      placement: "bottom",
      requires: { tab: "dashboard" }
    },
    {
      id: "recent",
      target: '[data-tour="recent"]',
      title: "The latest entries",
      body: "The most recent expenses anyone in the family added. Tap SEE ALL for the full list.",
      placement: "top",
      requires: { tab: "dashboard" },
      optional: true
    },
    {
      id: "fab",
      target: '[data-tour="fab"]',
      title: "Add an expense",
      body: "This is the button you will use most. Tap it any time to record something you spent.",
      // Hardcoded, not auto: near the home indicator, auto-flip picks wrong.
      placement: "top",
      requires: { desktop: false },
      optional: true
    },
    {
      id: "nav",
      target: '[data-tour="nav"]',
      title: "Everything else lives here",
      body: "Insights shows charts, Income tracks money arriving each month, and Family is where you share your code and manage members.",
      placement: "top",
      requires: { desktop: false },
      optional: true
    },
    {
      id: "sidebar",
      target: '[data-tour="sidebar"]',
      title: "Everything else lives here",
      body: "Insights shows charts, Income tracks money arriving each month, and Family is where you share your code and manage members.",
      placement: "right",
      requires: { desktop: true },
      optional: true
    }
  ];

  function tourStorageKey() {
    return `${STORAGE_KEY}:tour:v${TOUR_VERSION}:${state.user?.id || "anon"}`;
  }

  function tourAlreadySeen() {
    try {
      return Boolean(JSON.parse(localStorage.getItem(tourStorageKey()) || "null")?.completed);
    } catch (_) {
      return false;
    }
  }

  function markTourSeen() {
    try {
      localStorage.setItem(tourStorageKey(), JSON.stringify({ completed: true, at: new Date().toISOString() }));
    } catch (_) {
      // Private browsing. Worst case the tour offers itself again.
    }
  }

  function tourActive() {
    return Boolean(tourState);
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Steps whose requirements the current view cannot satisfy are dropped up front,
  // so "step 2 of 4" counts only steps that will actually be shown.
  function eligibleTourSteps() {
    const isDesktop = isDesktopMode();
    return TOUR_STEPS.filter((step) => {
      if (step.requires?.desktop === true && !isDesktop) return false;
      if (step.requires?.desktop === false && isDesktop) return false;
      return true;
    });
  }

  function maybeStartTour() {
    // Must never run in preview/visual mode: the overlay would corrupt every
    // screenshot the visual baseline depends on.
    if (previewMode || visualMode) return;
    if (!state.user || !state.family || state.privacyLocked) return;
    if (tourActive() || tourAlreadySeen()) return;
    startTour();
  }

  function startTour() {
    if (tourActive()) return;
    const steps = eligibleTourSteps();
    if (!steps.length) return;

    tourState = { steps, index: 0, returnFocus: document.activeElement };

    const root = document.createElement("div");
    root.className = "tour-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "tour-title");
    root.setAttribute("aria-describedby", "tour-body");
    root.innerHTML = `
      <div class="tour-scrim"></div>
      <div class="tour-hole" aria-hidden="true"></div>
      <div class="tour-tip">
        <span class="tour-arrow" aria-hidden="true"></span>
        <p class="tour-step-count"></p>
        <h2 class="tour-title" id="tour-title" tabindex="-1"></h2>
        <p class="tour-body" id="tour-body"></p>
        <div class="tour-actions">
          <button type="button" class="tour-skip">Skip</button>
          <div class="tour-nav-buttons">
            <button type="button" class="tour-back">Back</button>
            <button type="button" class="tour-next primary"></button>
          </div>
        </div>
      </div>
      <p class="tour-status" aria-live="polite"></p>
    `;
    document.body.appendChild(root);
    tourState.root = root;

    root.querySelector(".tour-skip").addEventListener("click", () => endTour(false));
    root.querySelector(".tour-back").addEventListener("click", () => goToTourStep(tourState.index - 1));
    root.querySelector(".tour-next").addEventListener("click", () => goToTourStep(tourState.index + 1));
    // Clicking the dimmed area advances, which is what people try first.
    root.querySelector(".tour-scrim").addEventListener("click", () => goToTourStep(tourState.index + 1));

    tourState.onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); endTour(false); }
      else if (event.key === "ArrowRight") goToTourStep(tourState.index + 1);
      else if (event.key === "ArrowLeft") goToTourStep(tourState.index - 1);
      else if (event.key === "Tab") trapTourFocus(event);
    };
    tourState.onReposition = () => syncTour();
    document.addEventListener("keydown", tourState.onKeyDown, true);
    window.addEventListener("resize", tourState.onReposition);
    window.addEventListener("orientationchange", tourState.onReposition);
    window.addEventListener("scroll", tourState.onReposition, true);

    // inert rather than aria-hidden: it blocks focus as well as AT, and it is a
    // single attribute on #app itself so it survives innerHTML replacement.
    app.setAttribute("inert", "");

    goToTourStep(0);
  }

  function trapTourFocus(event) {
    const focusables = tourState.root.querySelectorAll("button");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function goToTourStep(index) {
    if (!tourActive()) return;
    if (index >= tourState.steps.length) return endTour(true);
    if (index < 0) return;
    tourState.index = index;

    const step = tourState.steps[index];
    // A step may need a different tab than the one showing.
    if (step.requires?.tab && state.tab !== step.requires.tab) {
      state.tab = step.requires.tab;
      render(); // render() calls syncTour(), which paints this step
      return;
    }
    syncTour();
    tourState.root.querySelector(".tour-title").focus({ preventScroll: true });
  }

  function resolveTourTarget(step) {
    return document.querySelector(step.target);
  }

  function syncTour() {
    if (!tourActive()) return;
    const { root, steps, index } = tourState;
    const step = steps[index];
    const element = resolveTourTarget(step);

    if (!element) {
      // Optional steps (an empty activity list, a control for the other
      // breakpoint) are skipped. A required one falls back to a centred card
      // rather than leaving a spotlight hole over nothing.
      if (step.optional && index + 1 < steps.length) return goToTourStep(index + 1);
      if (step.optional) return endTour(true);
      root.classList.add("tour-root--paused");
      paintTourText(step, index, steps.length);
      return;
    }

    root.classList.remove("tour-root--paused");
    paintTourText(step, index, steps.length);
    scrollTourTargetIntoView(element, () => positionTour(element, step));
  }

  function paintTourText(step, index, total) {
    const { root } = tourState;
    root.querySelector(".tour-step-count").textContent = `Step ${index + 1} of ${total}`;
    root.querySelector(".tour-title").textContent = step.title;
    root.querySelector(".tour-body").textContent = step.body;
    root.querySelector(".tour-next").textContent = index + 1 === total ? "Done" : "Next";
    root.querySelector(".tour-back").hidden = index === 0;
    root.querySelector(".tour-status").textContent = `Step ${index + 1} of ${total}. ${step.title}.`;
  }

  function scrollTourTargetIntoView(element, done) {
    const rect = element.getBoundingClientRect();
    const fullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (fullyVisible) return done();
    element.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    // scrollend is not reliable across browsers here, so settle by measuring:
    // wait until the rect stops moving for two consecutive frames.
    let last = null;
    let stable = 0;
    let frames = 0;
    const tick = () => {
      if (!tourActive()) return;
      const now = element.getBoundingClientRect().top;
      stable = last !== null && Math.abs(now - last) < 0.5 ? stable + 1 : 0;
      last = now;
      frames += 1;
      if (stable >= 2 || frames > 30) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function positionTour(element, step) {
    const { root } = tourState;
    const rect = element.getBoundingClientRect();
    const pad = 6;
    const x = Math.max(0, rect.left - pad);
    const y = Math.max(0, rect.top - pad);
    const w = rect.width + pad * 2;
    const h = rect.height + pad * 2;

    // One style write; the spotlight and tooltip both key off these.
    root.style.setProperty("--t-x", `${x}px`);
    root.style.setProperty("--t-y", `${y}px`);
    root.style.setProperty("--t-w", `${w}px`);
    root.style.setProperty("--t-h", `${h}px`);

    const tip = root.querySelector(".tour-tip");
    const arrow = root.querySelector(".tour-arrow");
    const tipRect = tip.getBoundingClientRect();
    const edge = 12;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsAbove = y - tipRect.height - gap >= edge;
    const fitsBelow = y + h + tipRect.height + gap <= vh - edge;

    let placement = step.placement || "bottom";
    if (placement === "top" && !fitsAbove) placement = fitsBelow ? "bottom" : "float";
    else if (placement === "bottom" && !fitsBelow) placement = fitsAbove ? "top" : "float";
    else if (placement === "right" && x + w + gap + tipRect.width > vw - edge) {
      placement = fitsBelow ? "bottom" : fitsAbove ? "top" : "float";
    }

    let top;
    let left;
    if (placement === "right") {
      left = x + w + gap;
      top = clamp(y + h / 2 - tipRect.height / 2, edge, vh - tipRect.height - edge);
    } else {
      left = clamp(x + w / 2 - tipRect.width / 2, edge, vw - tipRect.width - edge);
      // "float": the target is taller than the space around it (common for the
      // sidebar, or a long list on desktop). Neither side fits, so detach from
      // the target and clamp into view rather than positioning off-screen --
      // previously `top` was never clamped, which pushed the buttons out of
      // reach entirely.
      top = placement === "top" ? y - tipRect.height - gap
          : placement === "bottom" ? y + h + gap
          : clamp(y + h / 2 - tipRect.height / 2, edge, vh - tipRect.height - edge);
    }
    top = clamp(top, edge, Math.max(edge, vh - tipRect.height - edge));

    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tip.dataset.placement = placement;

    // Clamp the arrow inside the bubble's rounded corners, or it slides off on
    // edge-anchored targets like the FAB. Floating tips get no arrow, since it
    // would point at nothing.
    if (placement === "right") {
      arrow.style.left = "";
      arrow.style.top = `${clamp(y + h / 2 - top, 16, Math.max(16, tipRect.height - 16))}px`;
    } else {
      arrow.style.top = "";
      arrow.style.left = `${clamp(x + w / 2 - left, 20, Math.max(20, tipRect.width - 20))}px`;
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function endTour(completed) {
    if (!tourActive()) return;
    const { root, onKeyDown, onReposition, returnFocus } = tourState;
    try {
      if (completed) markTourSeen();
      else markTourSeen(); // dismissing counts as seen; a replay button exists
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("orientationchange", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      root.remove();
    } finally {
      // These two MUST run even if something above threw. Leaving #app inert
      // makes the app unusable, and skipping the refresh flush latches
      // refreshAfterModal true so data silently stops updating.
      tourState = null;
      app.removeAttribute("inert");
      if (returnFocus?.isConnected) returnFocus.focus?.();
      queueRefresh(0);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  init().catch(showError);
})();
