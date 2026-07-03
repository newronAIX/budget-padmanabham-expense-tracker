(function () {
  const STORAGE_KEY = "budget-stitch-demo-v2";
  const FORM_DRAFT_PREFIX = `${STORAGE_KEY}:draft`;
  const COLORS = ["#1B4332", "#F5B700", "#EE6055", "#3A7CA5", "#7D5BA6", "#2A9D8F", "#9B5D3A", "#6C757D"];
  const EXPENSE_DEFAULTS = ["Groceries", "Milk", "Medicine", "Education", "Fuel", "Temple", "Dining"];
  const INCOME_DEFAULTS = ["Salary", "Rent", "Pension", "Business"];
  const INCOME_RECURRING = "RECURRING";
  const INCOME_ONE_TIME = "ONE_TIME";
  const TERMS_VERSION = "2026-06-21";
  const KEY_CHECK_TEXT = "budget-padmanabham-family-key-v1";

  const config = window.BUDGET_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const previewMode = params.get("preview") === "1";
  const visualMode = previewMode && params.get("visual") === "activity";
  const initialTab = ["dashboard", "expenses", "insights", "income", "categories", "family"].includes(params.get("tab"))
    ? params.get("tab")
    : "dashboard";
  const initialModal = ["expense", "income", "category", "person"].includes(params.get("modal"))
    ? { type: params.get("modal") }
    : null;
  const initialMonth = /^\d{4}-\d{2}$/.test(params.get("month") || "") ? params.get("month") : null;
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
    joinRequests: [],
    pendingRequest: null,
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

  const todayKey = () => {
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
        invites: state.invites,
        joinRequests: state.joinRequests
      })
    );
  }

  function seedDemo() {
    const saved = readDemo();
    state.user = { id: "demo-user", email: "ramesh@example.com", user_metadata: { full_name: "Ramesh Padmanabham" } };
    if (!saved && state.preview) {
      const seeded = seededPreviewData();
      state.family = seeded.family;
      state.membership = seeded.membership;
      state.people = seeded.people;
      state.categories = seeded.categories;
      state.expenses = seeded.expenses;
      state.incomes = seeded.incomes;
      state.invites = seeded.invites;
      state.joinRequests = seeded.joinRequests;
      return;
    }
    state.family = saved?.family || null;
    state.membership = saved?.membership || (state.family ? { role: "OWNER" } : null);
    state.people = saved?.people || [];
    state.categories = saved?.categories || [];
    state.expenses = saved?.expenses || [];
    state.incomes = (saved?.incomes || []).map(normalizeIncome);
    state.analyticsSnapshots = saved?.analyticsSnapshots || [];
    state.invites = saved?.invites || [];
    state.joinRequests = saved?.joinRequests || [];
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
        monthly_limit: index === 0 ? 55000 : index === 6 ? 16000 : 0
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
      ["Utilities", 9800, "p-ramesh", "c-exp-4", daysAgo(4), ""],
      ["Medicine", 7600, "p-lakshmi", "c-exp-2", daysAgo(6), ""],
      ["Education", 10590, "p-arjun", "c-exp-3", daysAgo(8), ""],
      ["Household items", 20000, "p-lakshmi", "c-exp-0", daysAgo(14), ""],
      ["Tuition fee", 12000, "p-arjun", "c-exp-3", lastMonthDay(12), ""]
    ].map(([title, amount, person_id, category_id, spent_on, note], index) => ({
      id: `e-${index}`,
      family_id: family.id,
      title,
      amount,
      person_id,
      category_id,
      spent_on,
      note,
      entered_by: "demo-user",
      created_at: new Date(Date.now() - index * 3600000).toISOString()
    }));
    const incomes = [
      { id: "i-0", family_id: family.id, title: "Primary Salary", amount: 120000, day_of_month: 1, category_id: "c-inc-0", income_type: INCOME_RECURRING, received_on: null, is_active: true, created_by: "demo-user" },
      { id: "i-1", family_id: family.id, title: "Rental Income", amount: 45000, day_of_month: 1, category_id: "c-inc-1", income_type: INCOME_RECURRING, received_on: null, is_active: true, created_by: "demo-user" },
      { id: "i-2", family_id: family.id, title: "Freelance Projects", amount: 15000, day_of_month: 1, category_id: "c-inc-3", income_type: INCOME_ONE_TIME, received_on: `${currentMonth()}-12`, is_active: true, created_by: "demo-user" },
      { id: "i-3", family_id: family.id, title: "FD Dividends", amount: 4500, day_of_month: 1, category_id: "c-inc-2", income_type: INCOME_RECURRING, received_on: null, is_active: true, created_by: "demo-user" }
    ].map(normalizeIncome);
    return {
      family,
      membership: { family_id: family.id, role: "OWNER" },
      people,
      categories,
      expenses,
      incomes,
      invites: [],
      joinRequests: [
        { id: "jr-1", family_id: family.id, display_name: "Suresh", status: "PENDING", requested_at: new Date().toISOString() }
      ]
    };
  }

  function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function lastMonthDay(day) {
    const date = new Date();
    date.setMonth(date.getMonth() - 1, day);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
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

    if (!memberships?.length) {
      const { data: pendingRows, error: pendingError } = await client
        .from("budget_join_requests")
        .select("*")
        .eq("user_id", state.user.id)
        .in("status", ["PENDING", "REJECTED"])
        .order("requested_at", { ascending: false })
        .limit(1);
      if (pendingError) throw pendingError;
      state.family = null;
      state.membership = null;
      state.people = [];
      state.categories = [];
      state.expenses = [];
      state.incomes = [];
      state.analyticsSnapshots = [];
      state.invites = [];
      state.joinRequests = [];
      state.pendingRequest = pendingRows?.[0] || null;
      state.privacyLocked = false;
      if (state.pendingRequest) {
        ensurePendingRealtime(state.user.id);
      } else {
        stopRealtime();
      }
      render();
      return;
    }

    state.membership = memberships[0];
    state.pendingRequest = null;
    const familyId = memberships[0].family_id;
    const [familyRes, peopleRes, categoriesRes, expensesRes, incomesRes, requestsRes, snapshotsRes] = await Promise.all([
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
        .from("budget_join_requests")
        .select("*")
        .eq("family_id", familyId)
        .eq("status", "PENDING")
        .order("requested_at", { ascending: true }),
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
    if (requestsRes.error) throw requestsRes.error;
    if (snapshotsRes.error) throw snapshotsRes.error;

    state.family = familyRes.data;
    await loadFamilyKey();
    state.family = await hydrateFamily(familyRes.data);
    state.people = await hydratePeople(peopleRes.data || []);
    state.categories = await hydrateCategories(categoriesRes.data || []);
    state.expenses = await hydrateExpenses(expensesRes.data || []);
    state.incomes = await hydrateIncomes(incomesRes.data || []);
    state.analyticsSnapshots = await hydrateAnalyticsSnapshots(snapshotsRes.data || []);
    state.invites = [];
    state.joinRequests = await hydrateJoinRequests(requestsRes.data || []);
    ensureRealtime(familyId);
    if (state.familyKey && !state.analyticsSnapshots.some((snapshot) => snapshot.month_key === currentMonth())) {
      queueAnalyticsSnapshot(currentMonth());
    }
    render();
    flushAnalyticsSnapshotQueue();
    migratePlaintextPrivacyRows();
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
  }

  function queueRefresh(delay = 400) {
    if (state.demo || !state.user || state.checkingSession) return;
    if (state.modal) {
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
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_join_requests", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_people", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_categories", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_expenses", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_incomes", filter: `family_id=eq.${familyId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_analytics_snapshots", filter: `family_id=eq.${familyId}` }, reload)
      .subscribe();
  }

  function ensurePendingRealtime(userId) {
    const key = `pending:${userId}`;
    if (!client || state.demo || !userId || realtimeFamilyId === key) return;
    stopRealtime();
    const reload = () => queueRefresh(250);
    realtimeFamilyId = key;
    realtimeChannel = client
      .channel(`budget-pending-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_join_requests", filter: `user_id=eq.${userId}` }, reload)
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

  function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function normalizeIncome(income) {
    const incomeType = income?.income_type === INCOME_ONE_TIME ? INCOME_ONE_TIME : INCOME_RECURRING;
    const createdDate = String(income?.created_at || "").slice(0, 10);
    const receivedOn = isDateKey(income?.received_on)
      ? income.received_on
      : isDateKey(createdDate) ? createdDate : todayKey();
    const day = Number(income?.day_of_month || 1);
    return {
      ...income,
      income_type: incomeType,
      received_on: incomeType === INCOME_ONE_TIME ? receivedOn : null,
      day_of_month: Math.min(28, Math.max(1, Math.round(Number.isFinite(day) ? day : 1))),
      is_active: income?.is_active !== false
    };
  }

  function isOneTimeIncome(income) {
    return normalizeIncome(income).income_type === INCOME_ONE_TIME;
  }

  function incomeReceivedOn(income) {
    return normalizeIncome(income).received_on || todayKey();
  }

  function incomeAppliesToMonth(income, key = currentMonth()) {
    const normalized = normalizeIncome(income);
    if (normalized.is_active === false || normalized.locked) return false;
    if (normalized.income_type === INCOME_ONE_TIME) return monthKey(normalized.received_on) === key;
    return true;
  }

  function incomeCadenceLabel(income) {
    const normalized = normalizeIncome(income);
    if (normalized.income_type === INCOME_ONE_TIME) return `One time on ${shortDate(normalized.received_on)}`;
    return `Every month on day ${normalized.day_of_month}`;
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
    state.incomes.forEach((income) => {
      const normalized = normalizeIncome(income);
      if (normalized.income_type === INCOME_ONE_TIME) months.add(monthKey(normalized.received_on));
    });
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

  function incomeForMonth(key = currentMonth()) {
    return state.incomes.filter((income) => incomeAppliesToMonth(income, key)).reduce((sum, income) => sum + Number(income.amount || 0), 0);
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
          ${needsConfig ? configScreen() : state.checkingSession ? loadingScreen() : needsAuth ? authScreen() : needsSetup ? setupScreen() : appScreen()}
        </main>
      </div>
      ${state.user && state.family ? bottomNav() : ""}
      ${state.modal ? modal() : ""}
    `;
    bind();
    if (!state.modal && refreshAfterModal) {
      refreshAfterModal = false;
      queueRefresh(0);
    }
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
            <button class="icon-button" data-action="signout" title="Sign out">↪</button>
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
    if (state.pendingRequest?.status === "PENDING") {
      return `
        <section class="auth card">
          <div class="auth-mark">₹</div>
          <h2>Waiting for moderator</h2>
          <p>Your request to join this family was sent. The family moderator needs to approve you before you can enter expenses.</p>
          <button class="secondary wide" data-action="signout">Sign out</button>
        </section>
      `;
    }
    return `
      <section class="entry-panel">
        <div class="choice-hero">
          <span class="secure-pill">First step</span>
          <h2>Choose how you want to enter</h2>
          <p>Create a new family if you are starting the group. Join an existing family if someone already sent you a Budget code.</p>
          ${state.pendingRequest?.status === "REJECTED" ? `<p>Your last join request was not approved. You can check with the moderator and send a new request.</p>` : ""}
        </div>
        <div class="setup-grid">
          <form class="card panel setup-card create-choice" data-form="create-family">
            <span class="choice-number">1</span>
            <h2>Create a family</h2>
            <p class="section-subtitle">Use this when you are the first person setting up the family.</p>
            <label class="field">Family name<input class="input" name="family" value="${escapeHtml(createDraft.family || "Padmanabham Family")}" required></label>
            <label class="field">Your display name<input class="input" name="person" value="${escapeHtml(createDraft.person || defaultName)}" required></label>
            <label class="field">Monthly budget<input class="input" name="budget" type="number" value="${escapeHtml(createDraft.budget || "150000")}" min="0"></label>
            <label class="field">Savings goal<input class="input" name="savings_goal" type="number" value="${escapeHtml(createDraft.savings_goal || "0")}" min="0"><small>Optional monthly savings target.</small></label>
            <label class="field">Family privacy password<input class="input" name="privacy" type="password" minlength="8" autocomplete="new-password" value="${escapeHtml(createDraft.privacy || "")}" required><small>Share this only with approved family members. It is not stored in Supabase.</small></label>
            <button class="primary wide" type="submit">Create family</button>
          </form>
          <form class="card panel setup-card join-choice" data-form="join-family">
            <span class="choice-number">2</span>
            <h2>Join existing family</h2>
            <p class="section-subtitle">Use the one invite code shared by your family.</p>
            <label class="field">Invite code<input class="input code-input" name="code" value="${escapeHtml(joinDraft.code || "")}" placeholder="BUDGET-1234" required></label>
            <label class="field">Your display name<input class="input" name="person" value="${escapeHtml(joinDraft.person || defaultName)}" required></label>
            <label class="field">Family privacy password<input class="input" name="privacy" type="password" autocomplete="current-password" value="${escapeHtml(joinDraft.privacy || "")}" required><small>Ask the family moderator for this separately from the invite code.</small></label>
            <button class="secondary wide" type="submit">Join with code</button>
          </form>
        </div>
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
    `;
  }

  function sidebar() {
    return `
      <aside class="sidebar">
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
      <nav class="bottom-nav">
        ${mobileNavButton("dashboard", "⌂", "Home")}
        ${mobileNavButton("insights", "▤", "Insights")}
        ${mobileNavButton("income", "▣", "Income")}
        ${mobileNavButton("family", "☷", "Family")}
      </nav>
      <button class="floating-add" data-modal="expense" aria-label="Add expense">+</button>
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
          <label class="field">Family privacy password<input class="input" name="privacy" type="password" autocomplete="current-password" value="${escapeHtml(draft.privacy || "")}" required></label>
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
        <p>${isOwner ? "Create a family privacy password before entering family data. It encrypts the monthly plan, categories, people, expenses, income, and insights in the browser before saving." : "The family moderator needs to create the privacy password before family data can be entered."}</p>
        ${isOwner ? `
          <form data-form="privacy-setup">
            <label class="field">Family privacy password<input class="input" name="privacy" type="password" minlength="8" autocomplete="new-password" value="${escapeHtml(draft.privacy || "")}" required></label>
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
      <section class="home-balance-card">
        <div>
          <span>Total Monthly Income</span>
          <strong>${money(homeIncome)}</strong>
          <small>${state.preview ? "+8.2% vs last month" : analytics.labels.income_change}</small>
        </div>
      </section>
      <section class="home-card-stack">
        <article class="finance-summary-card card expense-summary">
          <div>
            <span>Expenses</span>
            <strong>${money(spend)}</strong>
            <small>${expenseUsed || 0}% of monthly budget used</small>
          </div>
          <b>₹</b>
          <i style="width:${Math.max(5, expenseUsed)}%"></i>
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
            <article class="status-card warn">
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
        <div class="activity-block recent-panel">
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
    const members = totalsBy(list, (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const categories = totalsBy(list, (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id));
    const topCategory = categories[0]?.name || "None";
    const hasCustomRange = start !== monthStart(month) || end !== monthEnd(month);
    const showCustomDates = state.rangeMode === "custom" || hasCustomRange;
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
          <button class="${!hasCustomRange && month === currentMonth() ? "active" : ""}" type="button" data-month-current>This month</button>
          <button class="${!hasCustomRange && month !== currentMonth() ? "active" : ""}" type="button" data-month-shift="-1">Previous</button>
          <button class="${showCustomDates ? "active" : ""}" type="button" data-expense-custom>Custom</button>
        </div>

        ${showCustomDates ? `
          <div class="compact-date-range">
            <label>From<input type="date" data-date-from value="${escapeHtml(start)}"></label>
            <label>To<input type="date" data-date-to value="${escapeHtml(end)}"></label>
          </div>
        ` : ""}

        <section class="expense-stat-strip" aria-label="Expense summary">
          ${expenseStatCard("Total spent", money(total))}
          ${expenseStatCard("Entries", String(list.length))}
          ${expenseStatCard("Highest cat.", topCategory)}
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

  function expenseStatCard(label, value) {
    return `
      <article class="expense-stat-card">
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
      </div>
    `;
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
        ${metric("Income", money(income), "Active this month")}
        ${metric("Average expense", money(average), "Per entry")}
      </section>
      ${state.insightTab === "overview" ? `
        <section class="dashboard-grid">
          <div class="card panel">
            <h2>Default chart</h2>
            ${donut(categories)}
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
    const trendMax = Math.max(...analytics.trend_months.map((row) => row.spend), 0);
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
        <div class="trend-placeholder"><b>${trendMax ? money(trendMax) : "No history"}</b></div>
        <div class="trend-months">
          ${analytics.trend_months.map((row, index) => index === analytics.trend_months.length - 1 ? `<strong>${escapeHtml(row.name)}</strong>` : `<span>${escapeHtml(row.name)}</span>`).join("")}
        </div>
      </section>
      <section class="card panel mobile-breakdown-card">
        <h2>Category Breakdown</h2>
        <div class="breakdown-layout">
          <div class="donut stitch-donut"><span>Total<br>${money(analytics.totals.spend)}</span></div>
          <div class="legend-list">
            ${categories.slice(0, 3).map((row) => `<div><i style="background:${row.color}"></i><span>${escapeHtml(row.name)}</span><strong>${Math.round(row.percent || 0)}%</strong></div>`).join("") || `<div><span>No category spend</span><strong>0%</strong></div>`}
          </div>
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
        <div class="trend-placeholder"><b>₹1.2L</b></div>
        <div class="trend-months"><span>MAR</span><span>APR</span><span>MAY</span><span>JUN</span><span>JUL</span><strong>AUG</strong></div>
      </section>
      <section class="card panel mobile-breakdown-card">
        <h2>Category Breakdown</h2>
        <div class="breakdown-layout">
          <div class="donut stitch-donut"><span>Total<br>100%</span></div>
          <div class="legend-list">
            ${categories.slice(0, 3).map((row, index) => `<div><i style="background:${row.color}"></i><span>${escapeHtml(row.name)}</span><strong>${index === 0 ? "60%" : index === 1 ? "30%" : "10%"}</strong></div>`).join("")}
          </div>
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

  function donut(rows) {
    if (!rows.length) return emptyState("No chart yet", "Charts appear after expenses are added.");
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    let cursor = 0;
    const stops = rows.map((row) => {
      const start = cursor;
      cursor += (row.total / total) * 100;
      return `${row.color} ${start}% ${cursor}%`;
    });
    return `<div class="donut" style="background:conic-gradient(${stops.join(",")})"><span>Total<br>${money(total)}</span></div>`;
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
          <span>This Month Income</span>
          <strong>${money(monthlyIncome())}</strong>
        </div>
        <div class="section-head">
          <h2>Income</h2>
          <button class="primary compact" data-modal="income">Add income</button>
        </div>
        ${rows.length ? rows.map(incomeRow).join("") : emptyState("No income yet", "Add salary, rent, pension, bonus, or other income.")}
      </section>
    `;
  }

  function mobileIncomeScreen() {
    if (state.preview) return previewMobileIncomeScreen();
    const rows = state.incomes;
    const analytics = analyticsForMonth(currentMonth());
    const activeRows = rows.filter((income) => income.is_active !== false && !income.locked);
    const activeRecurringRows = activeRows.filter((income) => !isOneTimeIncome(income));
    const cycleLabel = activeRows.some(isOneTimeIncome) && activeRecurringRows.length ? "Mixed" : activeRows.some(isOneTimeIncome) ? "One time" : "Monthly";
    const activePercent = rows.length ? Math.round((activeRows.length / rows.length) * 100) : 0;
    return `
      <section class="mobile-income-hero">
        <span>This Month Income</span>
        <strong>${money(monthlyIncome())}</strong>
        <div class="income-hero-stats">
          <div><span>Active streams</span><b>${String(activeRows.length).padStart(2, "0")}</b></div>
          <div><span>Next deposit</span><b>${escapeHtml(nextDepositLabel(activeRecurringRows))}</b></div>
        </div>
      </section>
      <section class="income-kpi-grid">
        <article class="card"><b>↗</b><strong>${escapeHtml(shortTrendValue(analytics.previous.income_change_percent))}</strong><span>v/s Last Month</span></article>
        <article class="card"><b>◎</b><strong>${activePercent}%</strong><span>Active</span></article>
        <article class="card"><b>□</b><strong>${escapeHtml(cycleLabel)}</strong><span>Cycle</span></article>
      </section>
      <section class="mobile-list-title"><h2>Income</h2><button class="primary compact" data-modal="income">Add income</button></section>
      <section class="income-card-list">
        ${rows.map(mobileIncomeRow).join("")}
      </section>
    `;
  }

  function previewMobileIncomeScreen() {
    const rows = state.incomes;
    return `
      <section class="mobile-income-hero">
        <span>This Month Income</span>
        <strong>${money(monthlyIncome())}</strong>
        <div class="income-hero-stats">
          <div><span>Active streams</span><b>${String(rows.filter((income) => income.is_active).length).padStart(2, "0")}</b></div>
          <div><span>Next deposit</span><b>Oct 01</b></div>
        </div>
      </section>
      <section class="income-kpi-grid">
        <article class="card"><b>↗</b><strong>+8%</strong><span>v/s Last Month</span></article>
        <article class="card"><b>◎</b><strong>100%</strong><span>Verified</span></article>
        <article class="card"><b>□</b><strong>Monthly</strong><span>Cycle</span></article>
      </section>
      <section class="mobile-list-title"><h2>Income</h2><button class="primary compact" data-modal="income">Add income</button></section>
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
          <span>${escapeHtml(category)} · ${escapeHtml(incomeCadenceLabel(income))}</span>
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
          <span>${escapeHtml(category)} · ${escapeHtml(incomeCadenceLabel(income))} · ${income.is_active ? "Active" : "Paused"}</span>
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
        <button class="switch-action ${income.is_active ? "on" : ""}" data-toggle-income="${income.id}" aria-label="${income.is_active ? "Pause" : "Resume"} ${escapeHtml(income.title)}"></button>
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
    const pending = state.joinRequests.filter((request) => request.status === "PENDING");
    return `
      <section class="dashboard-grid">
        <div class="card panel">
          <div class="section-head">
            <h2>Family Members</h2>
            <span class="secure-pill">Invite approval only</span>
          </div>
          ${state.people.map((person) => `
            <article class="item">
              <span class="avatar">${personInitial(person.display_name)}</span>
              <div class="item-main"><strong>${escapeHtml(person.display_name)}</strong><span>${person.linked_user_id ? (person.linked_user_id === state.family.owner_id ? "Moderator" : "Signed in member") : "Past expense person"}</span></div>
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
          <p class="muted invite-help">${isOwner ? "Rotate if the old code was shared too widely. Old code stops working." : "You can share the code. Only the moderator can rotate, lock, or unlock joining."}</p>
          ${!state.preview ? budgetGoalsPanel() : ""}
          ${!state.preview ? categoryLimitsPanel() : ""}
          ${isOwner ? `
            <hr>
            <h2>Join requests</h2>
            ${pending.length ? pending.map((request) => `
              <article class="join-request">
                <strong>${escapeHtml(request.display_name)}</strong>
                <span>${niceDate(String(request.requested_at || todayKey()).slice(0, 10))}</span>
                <div class="item-actions">
                  <button class="primary" data-review-request="${request.id}" data-decision="APPROVED">Accept</button>
                  <button class="danger" data-review-request="${request.id}" data-decision="REJECTED">Reject</button>
                </div>
              </article>
            `).join("") : `<p class="muted">No pending requests.</p>`}
          ` : ""}
          <hr>
          <button class="danger wide" data-action="leave-family">Leave family</button>
          <button class="secondary wide" data-action="signout">Sign out</button>
        </aside>
      </section>
    `;
  }

  function mobileFamilyScreen() {
    const isOwner = state.membership?.role === "OWNER";
    const inviteCode = state.family?.invite_code || "Code is being prepared";
    const locked = Boolean(state.family?.invite_locked);
    const pending = state.joinRequests.filter((request) => request.status === "PENDING");
    return `
      <section class="mobile-family-page">
        ${!state.preview ? budgetGoalsPanel("mobile") : ""}
        ${!state.preview ? categoryLimitsPanel("mobile") : ""}
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
          <div class="invite-copy-row"><strong>${escapeHtml(inviteCode.replace("BUDGET-", "PADMA-"))}</strong><button data-copy-invite="${escapeHtml(inviteCode)}">COPY</button></div>
          <button class="share-invite-button" data-copy-invite="${escapeHtml(inviteCode)}">Share Invite Link</button>
        </article>
        <h2>Owner Controls</h2>
        <div class="card owner-control-list">
          <article><span>▣</span><div><strong>Family Currency</strong><small>INR (₹) - Indian Rupee</small></div><b>›</b></article>
          <article><span>◌</span><div><strong>Privacy Mode</strong><small>Hide balances by default</small></div><button class="switch-action" type="button" aria-label="Privacy mode"></button></article>
          <article><span>▤</span><div><strong>Shared Data Encryption</strong><small>End-to-end active</small></div><b class="check-dot">✓</b></article>
        </div>
        ${isOwner && pending.length ? `
          <h2>Join requests</h2>
          <div class="card owner-control-list join-list">
            ${pending.map((request) => `
              <article>
                <span>${personInitial(request.display_name)}</span>
                <div><strong>${escapeHtml(request.display_name)}</strong><small>${niceDate(String(request.requested_at || todayKey()).slice(0, 10))}</small></div>
                <div class="inline-actions">
                  <button data-review-request="${request.id}" data-decision="APPROVED">Accept</button>
                  <button data-review-request="${request.id}" data-decision="REJECTED">Reject</button>
                </div>
              </article>
            `).join("")}
          </div>
        ` : ""}
        <h2 class="danger-title">Danger Zone</h2>
        <div class="danger-zone-card">
          <button data-action="rotate-invite"><strong>Rotate Invite Code</strong><span>Old code stops working</span></button>
          <button data-action="toggle-family-lock"><strong>${locked ? "Unlock Joining" : "Lock Joining"}</strong><span>${locked ? "Allow approved requests again" : "Stop new join requests"}</span></button>
          <button data-action="leave-family"><strong>Leave Family</strong><span>Exit this family group</span></button>
        </div>
        <p class="version-line">Version 2.4.0 · Secured by Padmanabham Infrastructure</p>
      </section>
    `;
  }

  function budgetGoalsPanel(mode = "desktop") {
    const isOwner = state.membership?.role === "OWNER";
    const analytics = analyticsForMonth(currentMonth());
    const monthlyBudget = Number(state.family?.monthly_budget || 0);
    const savingsGoal = Number(state.family?.savings_goal_amount || 0);
    const budgetPercent = Math.min(100, Math.max(0, Math.round(analytics.totals.budget_used_percent || 0)));
    const savingsPercent = Math.min(100, Math.max(0, Math.round(analytics.totals.savings_progress_percent || 0)));
    const overCount = categoryLimitRows(true).filter((row) => row.status === "OVER").length;
    return `
      <section class="card budget-goals-card ${mode === "mobile" ? "mobile-budget-goals-card" : ""}">
        <div class="budget-card-head">
          <div>
            <span>Monthly plan</span>
            <h2>Budget & Goals</h2>
          </div>
          ${isOwner ? `<button class="secondary compact" data-modal="family-plan">Edit</button>` : ""}
        </div>
        <div class="plan-value-grid">
          <article>
            <span>Budget</span>
            <strong>${money(monthlyBudget)}</strong>
          </article>
          <article>
            <span>Goal</span>
            <strong>${savingsGoal ? money(savingsGoal) : "Not set"}</strong>
          </article>
        </div>
        <div class="budget-status-list">
          ${statusMeter("Total budget used", monthlyBudget ? `${budgetPercent}%` : "Not set", budgetPercent, budgetPercent > 100 ? "warn" : "")}
          ${statusMeter("Savings progress", savingsGoal ? `${savingsPercent}%` : "Not set", savingsGoal ? savingsPercent : 0, "gold")}
          ${statusMeter("Categories over limit", `${overCount}`, overCount ? 100 : 0, overCount ? "warn" : "")}
        </div>
      </section>
    `;
  }

  function categoryLimitsPanel(mode = "desktop") {
    const isOwner = state.membership?.role === "OWNER";
    const rows = categoryLimitRows(true);
    const limitCount = rows.filter((row) => row.limit > 0).length;
    const overCount = rows.filter((row) => row.status === "OVER").length;
    const spentAgainstLimited = rows.filter((row) => row.limit > 0).reduce((sum, row) => sum + row.spent, 0);
    return `
      <section class="card category-limit-panel ${mode === "mobile" ? "mobile-category-limit-panel" : ""}">
        <div class="limit-summary-row">
          <div>
            <span>Category limits</span>
            <strong>${limitCount ? `${limitCount} set` : "None set"}</strong>
            <small>${overCount ? `${overCount} over limit` : `${money(spentAgainstLimited)} tracked`}</small>
          </div>
          ${rows.length ? `<button class="${isOwner ? "primary" : "secondary"} compact" data-modal="category-limits">${isOwner ? "Edit limits" : "View limits"}</button>` : ""}
        </div>
      </section>
    `;
  }

  function statusMeter(label, value, percent, tone = "") {
    const width = Number(percent || 0) <= 0 ? 0 : Math.min(100, Math.max(4, Number(percent || 0)));
    return `
      <article class="budget-meter ${tone}">
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
        <i><b style="width:${width}%"></b></i>
      </article>
    `;
  }

  function categoryLimitRows(all = false) {
    const spendRows = new Map(totalsBy(monthExpenses(), (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id)).map((row) => [row.key, row]));
    const rows = activeExpenseCategories().map((category) => {
      const spent = Number(spendRows.get(category.id)?.total || 0);
      const limit = Number(category.monthly_limit || 0);
      const used = limit ? (spent / limit) * 100 : 0;
      return {
        id: category.id,
        name: category.name,
        color: category.color,
        limit,
        spent,
        used,
        status: limit && spent > limit ? "OVER" : "OK"
      };
    }).sort((a, b) => {
      const overDiff = (b.status === "OVER" ? 1 : 0) - (a.status === "OVER" ? 1 : 0);
      return overDiff || b.used - a.used || b.spent - a.spent || a.name.localeCompare(b.name);
    });
    return all ? rows : rows.slice(0, 3);
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
    const dateValue = expense?.spent_on || todayKey();
    const selectedPersonId = defaultExpensePersonId(expense);
    return `
      <form data-form="expense" data-id="${id || ""}">
        <label class="field title-field">Expense name<input class="input" name="title" value="${escapeHtml(expense?.title || "")}" placeholder="Milk, vegetables, medicine" required></label>
        <label class="field amount-field">Amount (₹)<input class="input amount-input" name="amount" type="number" inputmode="decimal" min="1" step="1" value="${escapeHtml(expense?.amount || "")}" placeholder="0.00" required></label>
        <div class="form-two-col">
          <label class="field date-field">Date<input class="input" name="spent_on" type="date" value="${dateValue}" required></label>
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
        <label class="recurring-row">Mark as recurring?<input type="checkbox" name="recurring_preview"><span></span></label>
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

  function incomeForm(id) {
    const income = state.incomes.find((item) => item.id === id);
    const normalized = normalizeIncome(income);
    const incomeType = normalized.income_type;
    const incomeCategories = activeIncomeCategories();
    const selectedCategoryId = normalized.category_id && incomeCategories.some((category) => category.id === normalized.category_id)
      ? normalized.category_id
      : id ? "" : incomeCategories[0]?.id || "";
    const recurringHidden = incomeType === INCOME_ONE_TIME ? "hidden" : "";
    const recurringDisabled = incomeType === INCOME_ONE_TIME ? "disabled" : "";
    const oneTimeHidden = incomeType === INCOME_ONE_TIME ? "" : "hidden";
    const oneTimeDisabled = incomeType === INCOME_ONE_TIME ? "" : "disabled";
    return `
      <form data-form="income" data-id="${id || ""}">
        <label class="field">Income title<input class="input" name="title" value="${escapeHtml(income?.title || "")}" placeholder="Salary" required></label>
        <fieldset class="choice-field income-type-field">
          <legend>Income type</legend>
          <div class="choice-grid">
            <label class="${incomeType === INCOME_RECURRING ? "selected" : ""}">
              <input type="radio" name="income_type" value="${INCOME_RECURRING}" ${incomeType === INCOME_RECURRING ? "checked" : ""}>
              <span>Recurring</span>
            </label>
            <label class="${incomeType === INCOME_ONE_TIME ? "selected" : ""}">
              <input type="radio" name="income_type" value="${INCOME_ONE_TIME}" ${incomeType === INCOME_ONE_TIME ? "checked" : ""}>
              <span>One time</span>
            </label>
          </div>
        </fieldset>
        <label class="field">Amount<input class="input" name="amount" type="number" inputmode="decimal" min="1" step="1" value="${escapeHtml(income?.amount || "")}" required></label>
        <label class="field">Income category<select class="input" name="category_id">
          <option value="">Choose income category</option>
          ${incomeCategories.map((c) => `<option value="${c.id}" ${selectedCategoryId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select></label>
        <label class="field">New income category<input class="input" name="category_name" value="" placeholder="Bonus, freelance, interest"><small>Type a new income category here, or choose an existing one above.</small></label>
        <label class="field" data-income-recurring ${recurringHidden}>Day of month<input class="input" name="day_of_month" type="number" min="1" max="28" value="${escapeHtml(normalized.day_of_month || 1)}" ${recurringDisabled}></label>
        <label class="field" data-income-one-time ${oneTimeHidden}>Received on<input class="input" name="received_on" type="date" value="${escapeHtml(normalized.received_on || todayKey())}" ${oneTimeDisabled}></label>
        <label class="check"><input type="checkbox" name="is_active" ${income?.is_active === false ? "" : "checked"}> Active income</label>
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
    bindIncomeTypeFields();

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
    document.querySelectorAll("[data-toggle-income]").forEach((button) => button.addEventListener("click", run(() => toggleIncome(button.dataset.toggleIncome))));
    document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => openModal("category", button.dataset.editCategory)));
    document.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", run(() => deleteCategory(button.dataset.deleteCategory))));
    document.querySelectorAll("[data-edit-person]").forEach((button) => button.addEventListener("click", () => openModal("person", button.dataset.editPerson)));
    document.querySelector("[data-action='toggle-family-lock']")?.addEventListener("click", run(toggleFamilyLock));
    document.querySelector("[data-action='rotate-invite']")?.addEventListener("click", run(rotateInviteCode));
    document.querySelector("[data-action='leave-family']")?.addEventListener("click", run(leaveFamily));
    document.querySelector("[data-copy-invite]")?.addEventListener("click", run(copyInviteCode));
    document.querySelectorAll("[data-review-request]").forEach((button) => button.addEventListener("click", run(() => reviewJoinRequest(button.dataset.reviewRequest, button.dataset.decision))));
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

  function bindIncomeTypeFields() {
    const form = document.querySelector(`[data-form="income"]`);
    if (!form) return;
    const sync = () => syncIncomeTypeFields(form);
    form.querySelectorAll(`input[name="income_type"]`).forEach((input) => input.addEventListener("change", sync));
    sync();
  }

  function syncIncomeTypeFields(form) {
    const isOneTime = form.querySelector(`input[name="income_type"][value="${INCOME_ONE_TIME}"]`)?.checked;
    form.querySelectorAll(".choice-grid label").forEach((label) => {
      const input = label.querySelector("input");
      if (input?.name === "income_type") label.classList.toggle("selected", input.checked);
    });
    form.querySelectorAll("[data-income-recurring]").forEach((field) => {
      field.hidden = Boolean(isOneTime);
      field.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = Boolean(isOneTime); });
    });
    form.querySelectorAll("[data-income-one-time]").forEach((field) => {
      field.hidden = !isOneTime;
      field.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !isOneTime; });
    });
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
    return window.matchMedia("(min-width: 900px)").matches;
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

  async function createPrivacySetup(passphrase) {
    const salt = randomBase64(16);
    const key = await deriveFamilyKey(passphrase, salt);
    return { salt, key, check: await encryptJson(key, { check: KEY_CHECK_TEXT }) };
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

  async function hydrateJoinRequests(rows) {
    const hydrated = [];
    for (const row of rows) {
      if (!row.encrypted_payload) {
        hydrated.push({ ...row, needsEncryptionMigration: Boolean(state.familyKey) });
        continue;
      }
      if (!state.familyKey) {
        hydrated.push({ ...row, display_name: "Locked request", locked: true });
        state.privacyLocked = true;
        continue;
      }
      try {
        hydrated.push({ ...row, ...(await decryptJson(state.familyKey, row.encrypted_payload)), encrypted: true });
      } catch (_) {
        hydrated.push({ ...row, display_name: "Locked request", locked: true });
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
        hydrated.push(normalizeIncome({ ...row, needsEncryptionMigration: Boolean(state.familyKey) }));
        continue;
      }
      if (!state.familyKey) {
        hydrated.push(normalizeIncome({ ...row, title: "Locked income", amount: 0, category_id: null, day_of_month: 1, locked: true }));
        state.privacyLocked = true;
        continue;
      }
      try {
        const decrypted = await decryptJson(state.familyKey, row.encrypted_payload);
        hydrated.push(normalizeIncome({ ...row, ...decrypted, encrypted: true }));
      } catch (_) {
        hydrated.push(normalizeIncome({ ...row, title: "Locked income", amount: 0, category_id: null, day_of_month: 1, locked: true }));
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

  async function encryptedJoinRequestPayload(plain, key = state.familyKey) {
    if (!key) throw new Error("Please unlock family privacy first.");
    return encryptJson(key, plain);
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
    const budget = data.budget ? boundedNumber(data.budget, "Monthly budget", 0, 999999999) : 0;
    const savingsGoal = nonnegativeMoney(data.savings_goal || 0, "savings goal");
    const privacy = requireText(data.privacy, "a family privacy password", 120);
    if (privacy.length < 8) throw new Error("Family privacy password must be at least 8 characters.");
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

  async function joinFamily(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (state.demo) throw new Error("Invite joining needs Supabase. Preview mode can create a family locally.");
    const code = requireText(data.code, "invite code", 32).toUpperCase();
    const person = requireText(data.person || "Family member", "your display name", 80);
    const privacy = requireText(data.privacy, "the family privacy password", 120);
    let familyKeyForJoin = null;
    const { data: securityRows, error: securityError } = await client.rpc("get_budget_invite_security", {
      invite_code_input: code
    });
    if (securityError) throw securityError;
    const security = securityRows?.[0];
    if (!security) throw new Error("Invite code is invalid or locked.");
    if (security.encryption_salt && security.encryption_check) {
      familyKeyForJoin = await verifyPrivacyKey(privacy, security.encryption_salt, security.encryption_check);
      await rememberFamilyKey(security.family_id, familyKeyForJoin);
    }
    const { data: joinedFamilyId, error } = await client.rpc("join_budget_invite", {
      invite_code_input: code,
      display_name_input: person
    });
    if (error) throw error;
    if (familyKeyForJoin && joinedFamilyId) {
      const { error: requestEncryptError } = await client
        .from("budget_join_requests")
        .update({
          display_name: "Encrypted request",
          encrypted_payload: await encryptedJoinRequestPayload({ display_name: person }, familyKeyForJoin),
          encryption_version: 1
        })
        .eq("family_id", joinedFamilyId)
        .eq("user_id", state.user.id);
      if (requestEncryptError) throw requestEncryptError;
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
    clearFormDraft("privacy-unlock");
    await load();
  }

  async function setupPrivacy(form) {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family moderator can turn on encryption.");
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

  async function reviewJoinRequest(id, decision) {
    if (state.membership?.role !== "OWNER") throw new Error("Only the family moderator can review join requests.");
    const request = state.joinRequests.find((item) => item.id === id);
    if (state.demo) {
      state.joinRequests = state.joinRequests.map((request) => request.id === id ? { ...request, status: decision } : request);
      writeDemo();
      render();
      return;
    }
    const { error } = await client.rpc("review_budget_join_request", {
      request_id_input: id,
      decision_input: decision
    });
    if (error) throw error;
    if (decision === "APPROVED" && request?.user_id && request?.display_name && state.familyKey) {
      const { data: peopleRows, error: peopleError } = await client
        .from("budget_people")
        .select("id")
        .eq("family_id", state.family.id)
        .eq("linked_user_id", request.user_id)
        .limit(1);
      if (peopleError) throw peopleError;
      const personId = peopleRows?.[0]?.id;
      if (personId) {
        const { error: personEncryptError } = await client
          .from("budget_people")
          .update({
            display_name: "Encrypted member",
            encrypted_payload: await encryptedPersonPayload({ display_name: request.display_name }),
            encryption_version: 1
          })
          .eq("id", personId);
        if (personEncryptError) throw personEncryptError;
      }
    }
    await load();
  }

  async function leaveFamily() {
    if (!window.confirm("Leave this family? If you are the moderator, the next moderator will be chosen alphabetically.")) return;
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
    if (state.membership?.role !== "OWNER") throw new Error("Only the family moderator can rotate the invite code.");
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
    if (state.membership?.role !== "OWNER") throw new Error("Only the family moderator can remove members.");
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
      entered_by: state.user.id
    };
    if (!state.people.some((person) => person.id === payload.person_id)) throw new Error("Please choose a family member.");

    if (state.demo) {
      if (id) state.expenses = state.expenses.map((expense) => expense.id === id ? { ...expense, ...payload } : expense);
      else state.expenses.unshift({ id: crypto.randomUUID(), ...payload, created_at: new Date().toISOString() });
      state.modal = null;
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

  async function createIncomeCategory(name) {
    const categoryName = requireText(name, "income category", 80);
    const existing = findCategoryByName("INCOME", categoryName);
    if (existing) return existing;
    const payload = {
      family_id: state.family.id,
      name: categoryName,
      scope: "INCOME",
      color: COLORS[(activeIncomeCategories().length + 3) % COLORS.length],
      monthly_limit: 0,
      created_by: state.user.id
    };

    if (state.demo) {
      const category = { id: crypto.randomUUID(), ...payload };
      state.categories.push(category);
      return category;
    }

    const encryptedPayload = await encryptedCategoryPayload(categoryPayload(payload));
    const databasePayload = {
      family_id: state.family.id,
      name: `Encrypted category ${crypto.randomUUID().slice(0, 8)}`,
      scope: "EXPENSE",
      color: COLORS[0],
      monthly_limit: 0,
      created_by: state.user.id,
      encrypted_payload: encryptedPayload,
      encryption_version: 1
    };
    const { data, error } = await client.from("budget_categories").insert(databasePayload).select().single();
    if (error) throw error;
    const category = (await hydrateCategories([data]))[0];
    state.categories.push(category);
    return category;
  }

  async function incomeCategoryIdFromForm(data) {
    const typedCategory = cleanText(data.category_name);
    if (typedCategory) return (await createIncomeCategory(typedCategory)).id;
    const selectedCategoryId = data.category_id || "";
    if (selectedCategoryId && activeIncomeCategories().some((category) => category.id === selectedCategoryId)) return selectedCategoryId;
    throw new Error("Choose or create an income category.");
  }

  async function saveIncome(form) {
    const id = form.dataset.id;
    const data = Object.fromEntries(new FormData(form).entries());
    const existingIncome = id ? state.incomes.find((income) => income.id === id) : null;
    const incomeType = data.income_type === INCOME_ONE_TIME ? INCOME_ONE_TIME : INCOME_RECURRING;
    const title = requireText(data.title, "income title", 120);
    const amount = positiveMoney(data.amount, "income amount");
    const dayOfMonth = incomeType === INCOME_ONE_TIME ? 1 : boundedNumber(data.day_of_month || existingIncome?.day_of_month || 1, "Day of month", 1, 28);
    const receivedOn = incomeType === INCOME_ONE_TIME ? safeDate(data.received_on || existingIncome?.received_on || todayKey()) : null;
    const categoryId = await incomeCategoryIdFromForm(data);
    const payload = {
      family_id: state.family.id,
      title,
      amount,
      day_of_month: dayOfMonth,
      income_type: incomeType,
      received_on: receivedOn,
      category_id: categoryId,
      is_active: Boolean(data.is_active),
      created_by: existingIncome?.created_by || state.user.id
    };

    if (state.demo) {
      if (id) state.incomes = state.incomes.map((income) => income.id === id ? normalizeIncome({ ...income, ...payload }) : income);
      else state.incomes.unshift(normalizeIncome({ id: crypto.randomUUID(), ...payload }));
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
    queueAnalyticsSnapshot(payload.income_type === INCOME_ONE_TIME ? monthKey(payload.received_on) : currentMonth());
    if (existingIncome && isOneTimeIncome(existingIncome)) queueAnalyticsSnapshot(monthKey(incomeReceivedOn(existingIncome)));
    state.modal = null;
    await load();
  }

  async function toggleIncome(id) {
    const income = state.incomes.find((item) => item.id === id);
    if (!income) return;
    const normalized = normalizeIncome(income);
    if (state.demo) {
      state.incomes = state.incomes.map((item) => item.id === id ? normalizeIncome({ ...item, is_active: !item.is_active }) : item);
      writeDemo();
      render();
      return;
    }
    const payload = {
      family_id: state.family.id,
      title: normalized.title,
      amount: Number(normalized.amount || 0),
      day_of_month: Number(normalized.day_of_month || 1),
      income_type: normalized.income_type,
      received_on: normalized.received_on,
      category_id: normalized.category_id || null,
      is_active: !normalized.is_active,
      created_by: normalized.created_by || state.user.id
    };
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
    queueAnalyticsSnapshot(payload.income_type === INCOME_ONE_TIME ? monthKey(payload.received_on) : currentMonth());
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
    queueAnalyticsSnapshot(isOneTimeIncome(income) ? monthKey(incomeReceivedOn(income)) : currentMonth());
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
    if (state.membership?.role !== "OWNER") throw new Error("Only the family moderator can change the monthly plan.");
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
    if (state.membership?.role !== "OWNER") throw new Error("Only the family moderator can change category limits.");
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
      state.joinRequests.some((request) => request.needsEncryptionMigration) ||
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

      for (const request of state.joinRequests.filter((item) => item.needsEncryptionMigration)) {
        const { error } = await client.from("budget_join_requests").update({
          display_name: "Encrypted request",
          encrypted_payload: await encryptedJoinRequestPayload({ display_name: request.display_name }),
          encryption_version: 1
        }).eq("id", request.id);
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
        const normalized = normalizeIncome(income);
        const payload = {
          family_id: state.family.id,
          title: normalized.title,
          amount: Number(normalized.amount || 0),
          day_of_month: Number(normalized.day_of_month || 1),
          income_type: normalized.income_type,
          received_on: normalized.received_on,
          category_id: normalized.category_id || null,
          is_active: normalized.is_active !== false,
          created_by: normalized.created_by || state.user.id
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
