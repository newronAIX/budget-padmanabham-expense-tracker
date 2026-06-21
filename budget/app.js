(function () {
  const STORAGE_KEY = "budget-stitch-demo-v2";
  const COLORS = ["#1B4332", "#F5B700", "#EE6055", "#3A7CA5", "#7D5BA6", "#2A9D8F", "#9B5D3A", "#6C757D"];
  const EXPENSE_DEFAULTS = ["Groceries", "Milk", "Medicine", "Education", "Fuel", "Temple", "Dining"];
  const INCOME_DEFAULTS = ["Salary", "Rent", "Pension", "Business"];

  const config = window.BUDGET_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const previewMode = params.get("preview") === "1";
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
    invites: [],
    tab: initialTab,
    modal: initialModal,
    sort: "date",
    selectedMonth: initialMonth,
    scope: "EXPENSE",
    busy: false,
    checkingSession: hasSupabase && !previewMode,
    error: "",
    demo: previewMode,
    preview: previewMode
  };

  const app = document.getElementById("app");

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
        invites: state.invites
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
      return;
    }
    state.family = saved?.family || null;
    state.membership = saved?.membership || (state.family ? { role: "OWNER" } : null);
    state.people = saved?.people || [];
    state.categories = saved?.categories || [];
    state.expenses = saved?.expenses || [];
    state.incomes = saved?.incomes || [];
    state.invites = saved?.invites || [];
  }

  function seededPreviewData() {
    const family = {
      id: "preview-family",
      name: "Padmanabham Family",
      currency_code: "INR",
      monthly_budget: 150000,
      owner_id: "demo-user"
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
        color: COLORS[index % COLORS.length]
      })),
      ...INCOME_DEFAULTS.map((name, index) => ({
        id: `c-inc-${index}`,
        family_id: family.id,
        name,
        scope: "INCOME",
        color: COLORS[(index + 3) % COLORS.length]
      }))
    ];
    const expenses = [
      ["Vegetables and fruits", 1260, "p-lakshmi", "c-exp-0", todayKey(), "Weekly market"],
      ["Milk card recharge", 2200, "p-amma", "c-exp-1", todayKey(), ""],
      ["Blood pressure medicine", 940, "p-ramesh", "c-exp-2", daysAgo(1), ""],
      ["School notebooks", 1860, "p-arjun", "c-exp-3", daysAgo(2), ""],
      ["Petrol", 3500, "p-ramesh", "c-exp-4", daysAgo(3), "Office travel"],
      ["Family dinner", 2750, "p-lakshmi", "c-exp-6", daysAgo(6), ""],
      ["Temple donation", 501, "p-amma", "c-exp-5", daysAgo(8), ""],
      ["Groceries monthly", 8650, "p-lakshmi", "c-exp-0", daysAgo(14), "Rice, dal, oil"],
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
      { id: "i-0", family_id: family.id, title: "Ramesh salary", amount: 98000, day_of_month: 1, category_id: "c-inc-0", is_active: true, created_by: "demo-user" },
      { id: "i-1", family_id: family.id, title: "Lakshmi business", amount: 42000, day_of_month: 5, category_id: "c-inc-3", is_active: true, created_by: "demo-user" },
      { id: "i-2", family_id: family.id, title: "House rent", amount: 18000, day_of_month: 10, category_id: "c-inc-1", is_active: true, created_by: "demo-user" },
      { id: "i-3", family_id: family.id, title: "Pension", amount: 12000, day_of_month: 15, category_id: "c-inc-2", is_active: false, created_by: "demo-user" }
    ];
    const invites = [
      {
        id: "invite-preview",
        family_id: family.id,
        invite_code: "BUDGET-2048",
        invited_email: "family@gmail.com",
        inviter_id: "demo-user",
        status: "PENDING"
      }
    ];
    return {
      family,
      membership: { family_id: family.id, role: "OWNER" },
      people,
      categories,
      expenses,
      incomes,
      invites
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
      state.family = null;
      state.membership = null;
      state.people = [];
      state.categories = [];
      state.expenses = [];
      state.incomes = [];
      state.invites = [];
      render();
      return;
    }

    state.membership = memberships[0];
    const familyId = memberships[0].family_id;
    const [familyRes, peopleRes, categoriesRes, expensesRes, incomesRes, invitesRes] = await Promise.all([
      client.from("budget_families").select("*").eq("id", familyId).single(),
      client.from("budget_people").select("*").eq("family_id", familyId).order("created_at"),
      client.from("budget_categories").select("*").eq("family_id", familyId).order("scope").order("name"),
      client
        .from("budget_expenses")
        .select("*, budget_people(display_name), budget_categories(name,color)")
        .eq("family_id", familyId)
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false }),
      client
        .from("budget_incomes")
        .select("*, budget_categories(name,color)")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false }),
      client.from("budget_invites").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(8)
    ]);

    if (familyRes.error) throw familyRes.error;
    if (peopleRes.error) throw peopleRes.error;
    if (categoriesRes.error) throw categoriesRes.error;
    if (expensesRes.error) throw expensesRes.error;
    if (incomesRes.error) throw incomesRes.error;
    if (invitesRes.error) throw invitesRes.error;

    state.family = familyRes.data;
    state.people = peopleRes.data || [];
    state.categories = categoriesRes.data || [];
    state.expenses = expensesRes.data || [];
    state.incomes = incomesRes.data || [];
    state.invites = invitesRes.data || [];
    render();
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

  function monthlyIncome() {
    return state.incomes.filter((income) => income.is_active !== false).reduce((sum, income) => sum + Number(income.amount || 0), 0);
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

  function render() {
    const needsConfig = !hasSupabase && !state.preview;
    const needsAuth = !state.user;
    const needsSetup = state.user && !state.family;
    app.innerHTML = `
      <div class="shell ${state.family ? "has-family" : ""}">
        ${state.family ? sidebar() : ""}
        <main class="app">
          ${topbar()}
          ${state.preview ? `<div class="notice">Preview mode is active for design review. Real users still enter with Gmail.</div>` : ""}
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
          ${needsConfig ? configScreen() : state.checkingSession ? loadingScreen() : needsAuth ? authScreen() : needsSetup ? setupScreen() : appScreen()}
        </main>
      </div>
      ${state.user && state.family ? bottomNav() : ""}
      ${state.modal ? modal() : ""}
    `;
    bind();
  }

  function topbar() {
    const title = state.family ? state.family.name : "Budget Padmanabham";
    return `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">₹</div>
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${state.family ? "Family ledger" : "Family expense tracker"}</p>
          </div>
        </div>
        ${state.user ? `<button class="icon-button" data-action="signout" title="Sign out">↪</button>` : ""}
      </header>
    `;
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
        <p>Shared family expenses, income, categories, and insights.</p>
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
    return `
      <section class="setup-grid">
        <form class="card panel" data-form="create-family">
          <h2>Create family</h2>
          <label class="field">Family name<input class="input" name="family" value="Padmanabham Family" required></label>
          <label class="field">Your display name<input class="input" name="person" value="${escapeHtml(defaultName)}" required></label>
          <label class="field">Monthly budget<input class="input" name="budget" type="number" value="150000" min="0"></label>
          <button class="primary wide" type="submit">Start family tracker</button>
        </form>
        <form class="card panel" data-form="join-family">
          <h2>Join family</h2>
          <label class="field">Invite code<input class="input code-input" name="code" placeholder="BUDGET-1234" required></label>
          <label class="field">Your display name<input class="input" name="person" value="${escapeHtml(defaultName)}" required></label>
          <button class="secondary wide" type="submit">Join with code</button>
        </form>
      </section>
    `;
  }

  function appScreen() {
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
    const items = [
      ["dashboard", "Home"],
      ["expenses", "Expenses"],
      ["add", "+ Add"],
      ["income", "Income"],
      ["family", "Family"]
    ];
    return `
      <nav class="bottom-nav">
        ${items.map(([id, label]) => id === "add"
          ? `<button class="nav-add" data-modal="expense">${label}</button>`
          : `<button class="${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`
        ).join("")}
      </nav>
    `;
  }

  function dashboardScreen() {
    const spend = monthlySpend();
    const income = monthlyIncome();
    const savings = income - spend;
    const budget = Number(state.family.monthly_budget || 0);
    const used = budget ? Math.min(100, Math.round((spend / budget) * 100)) : 0;
    const recent = monthExpenses().slice(0, 5);
    const memberTotals = totalsBy(monthExpenses(), (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const currentPerson = currentUserPerson();
    const archives = previousMonthSummaries(4);

    return `
      <section class="quick-entry card">
        <div>
          <span class="secure-pill">Current month - ${monthLabel(currentMonth())}</span>
          <h2>Add today's expense</h2>
          <p>${currentPerson ? `Default person: ${escapeHtml(currentPerson.display_name)}` : "Amount, item, person, save."}</p>
        </div>
        <button class="primary entry-button" data-modal="expense">+ Add expense</button>
      </section>
      <section class="metric-grid simple-metrics">
        ${metric("Spent this month", money(spend), `${monthExpenses().length} entries`)}
        ${metric("Money left", money(savings), income ? "Income minus expenses" : "Add income to track balance")}
      </section>
      <section class="dashboard-grid">
        <div class="card panel">
          <div class="section-head">
            <h2>Recent expenses</h2>
            <button class="text-button" data-tab="expenses">View all</button>
          </div>
          ${recent.length ? recent.map(expenseRow).join("") : emptyState("No expenses yet", "Tap Add expense and record the first one.")}
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

  function metric(label, value, sub) {
    return `<article class="metric card"><span>${label}</span><strong>${value}</strong><small>${sub}</small></article>`;
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
    const list = sortedExpenses(month);
    const total = spendForMonth(month);
    const isCurrent = month === currentMonth();
    return `
      <section class="card panel">
        <div class="section-head">
          <div>
            <h2>${isCurrent ? "This month's expenses" : "Previous month expenses"}</h2>
            <p class="section-subtitle">${monthLabel(month)} · ${list.length} entries · ${money(total)}</p>
          </div>
          <button class="primary compact" data-modal="expense">Add expense</button>
        </div>
        <div class="month-switcher">
          <button class="secondary" data-month-shift="-1">Previous</button>
          <select class="input" data-month-select>
            ${availableMonthKeys().map((key) => `<option value="${key}" ${month === key ? "selected" : ""}>${key === currentMonth() ? "Current - " : ""}${monthLabel(key)}</option>`).join("")}
          </select>
          <button class="secondary" data-month-current ${isCurrent ? "disabled" : ""}>This month</button>
        </div>
        <div class="month-note">${isCurrent ? "New month starts fresh automatically on the 1st." : "These entries are kept as family history and do not mix with the current month."}</div>
        <div class="toolbar">
          <select class="input" data-sort>
            <option value="date" ${state.sort === "date" ? "selected" : ""}>Sort by date</option>
            <option value="person" ${state.sort === "person" ? "selected" : ""}>Sort by person</option>
            <option value="category" ${state.sort === "category" ? "selected" : ""}>Sort by category</option>
          </select>
        </div>
        ${list.length ? list.map(expenseRow).join("") : emptyState(isCurrent ? "No expenses this month" : "No expenses in this month", isCurrent ? "Use Add expense to start this month's ledger." : "Choose another month to see older entries.")}
      </section>
    `;
  }

  function sortedExpenses(month = selectedMonth()) {
    const list = [...expensesForMonth(month)];
    if (state.sort === "person") return list.sort((a, b) => personName(a.person_id).localeCompare(personName(b.person_id)));
    if (state.sort === "category") return list.sort((a, b) => categoryName(a.category_id).localeCompare(categoryName(b.category_id)));
    return list.sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)));
  }

  function expenseRow(expense) {
    const category = expense.budget_categories?.name || categoryName(expense.category_id);
    const color = expense.budget_categories?.color || categoryColor(expense.category_id);
    const person = expense.budget_people?.display_name || personName(expense.person_id);
    return `
      <article class="item">
        <span class="avatar" style="background:${softColor(color)};color:${color}">${personInitial(person)}</span>
        <div class="item-main">
          <strong>${escapeHtml(expense.title)}</strong>
          <span>${escapeHtml(category)} · ${escapeHtml(person)} · ${niceDate(expense.spent_on)}</span>
          ${expense.note ? `<small>${escapeHtml(expense.note)}</small>` : ""}
        </div>
        <div class="item-side">
          <strong>${money(expense.amount)}</strong>
          <div class="item-actions">
            <button data-edit-expense="${expense.id}">Edit</button>
            <button data-delete-expense="${expense.id}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }

  function insightsScreen() {
    const spend = monthlySpend();
    const income = monthlyIncome();
    const categories = totalsBy(monthExpenses(), (e) => e.category_id || "none", (e) => categoryName(e.category_id), (e) => categoryColor(e.category_id));
    const members = totalsBy(monthExpenses(), (e) => e.person_id, (e) => personName(e.person_id), (e) => personColor(e.person_id));
    const months = monthlyHistory();
    return `
      <section class="metric-grid">
        ${metric("Total balance", money(income - spend), "+ this month")}
        ${metric("Monthly spend", money(spend), `${monthExpenses().length} expenses`)}
        ${metric("Income", money(income), "Active recurring")}
      </section>
      <section class="dashboard-grid">
        <div class="card panel">
          <h2>Category Breakdown</h2>
          ${donut(categories)}
          ${miniBars(categories)}
        </div>
        <div class="card panel">
          <h2>Spend by Family Member</h2>
          ${members.length ? miniBars(members) : emptyState("No member spend", "Add expenses to compare spend.")}
          <h2 class="mt">Monthly History</h2>
          ${months.length ? months.map((row) => `<div class="history-row"><span>${row.month}</span><strong>${money(row.total)}</strong></div>`).join("") : emptyState("No history", "Past months appear here.")}
        </div>
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

  function incomeScreen() {
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

  function incomeRow(income) {
    const category = income.budget_categories?.name || categoryName(income.category_id);
    return `
      <article class="item">
        <span class="avatar">${String(income.title).slice(0, 1).toUpperCase()}</span>
        <div class="item-main">
          <strong>${escapeHtml(income.title)}</strong>
          <span>${escapeHtml(category)} · Day ${income.day_of_month} · ${income.is_active ? "Active" : "Paused"}</span>
        </div>
        <div class="item-side">
          <strong>${money(income.amount)}</strong>
          <div class="item-actions">
            <button data-edit-income="${income.id}">Edit</button>
            <button data-toggle-income="${income.id}">${income.is_active ? "Pause" : "Resume"}</button>
          </div>
        </div>
      </article>
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
    return `
      <article class="item">
        <span class="swatch" style="background:${category.color}"></span>
        <div class="item-main">
          <strong>${escapeHtml(category.name)}</strong>
          <span>${category.scope === "EXPENSE" ? "Expense" : "Income"} · ${used} items</span>
        </div>
        <div class="item-actions">
          <button data-edit-category="${category.id}">Rename</button>
          <button data-delete-category="${category.id}">Delete</button>
        </div>
      </article>
    `;
  }

  function familyScreen() {
    const isOwner = state.membership?.role === "OWNER";
    return `
      <section class="dashboard-grid">
        <div class="card panel">
          <div class="section-head">
            <h2>Family Members</h2>
            <button class="primary compact" data-modal="person">Add person</button>
          </div>
          ${state.people.map((person) => `
            <article class="item">
              <span class="avatar">${personInitial(person.display_name)}</span>
              <div class="item-main"><strong>${escapeHtml(person.display_name)}</strong><span>${person.linked_user_id ? "Signed in member" : "Expense person"}</span></div>
              <div class="item-actions"><button data-edit-person="${person.id}">Edit</button></div>
            </article>
          `).join("")}
        </div>
        <aside class="card panel">
          <h2>Invite</h2>
          ${isOwner ? `
            <form data-form="invite">
              <label class="field">Email (optional)<input class="input" name="email" type="email" placeholder="member@gmail.com"></label>
              <button class="primary wide" type="submit">Create invite code</button>
            </form>
            ${state.invites.length ? state.invites.map((invite) => `<div class="invite-code"><span>${invite.status}</span><strong>${invite.invite_code}</strong></div>`).join("") : ""}
          ` : `<p class="muted">Only the owner can invite members.</p>`}
          <hr>
          <button class="secondary wide" data-action="signout">Sign out</button>
        </aside>
      </section>
    `;
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
      person: id ? "Edit person" : "Add person"
    }[type];
    return `
      <div class="modal-backdrop">
        <section class="modal card">
          <div class="section-head">
            <h2>${title}</h2>
            <button class="icon-button" data-close-modal>×</button>
          </div>
          ${type === "expense" ? expenseForm(id) : ""}
          ${type === "income" ? incomeForm(id) : ""}
          ${type === "category" ? categoryForm(id) : ""}
          ${type === "person" ? personForm(id) : ""}
        </section>
      </div>
    `;
  }

  function expenseForm(id) {
    const expense = state.expenses.find((item) => item.id === id);
    const dateValue = expense?.spent_on || todayKey();
    const selectedPersonId = defaultExpensePersonId(expense);
    const categoryShortcuts = topExpenseCategories(3);
    return `
      <form data-form="expense" data-id="${id || ""}">
        <label class="field amount-field">Amount spent<input class="input amount-input" name="amount" type="number" inputmode="decimal" min="1" step="1" value="${escapeHtml(expense?.amount || "")}" placeholder="250" required></label>
        ${categoryShortcuts.length ? `<div class="shortcut-group"><span>Often used categories</span><div class="quick-picks" aria-label="Frequently used categories">
          ${categoryShortcuts.map((category) => `<button type="button" class="${expense?.category_id === category.id ? "selected" : ""}" data-category-shortcut="${escapeHtml(category.id)}" style="--chip-color:${escapeHtml(category.color || COLORS[0])}">${escapeHtml(category.name)}</button>`).join("")}
        </div></div>` : ""}
        <label class="field title-field">Expense name<input class="input" name="title" value="${escapeHtml(expense?.title || "")}" placeholder="Milk, vegetables, medicine" required></label>
        <label class="field person-field">Person who spent<select class="input" name="person_id" required>${state.people.map((p) => `<option value="${p.id}" ${selectedPersonId === p.id ? "selected" : ""}>${escapeHtml(p.display_name)}</option>`).join("")}</select></label>
        <label class="field category-field">Category<select class="input" name="category_id">${activeExpenseCategories().map((c) => `<option value="${c.id}" ${expense?.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
        <label class="field date-field">Date<input class="input" name="spent_on" type="date" value="${dateValue}" required><small>Today is loaded automatically. Change only if needed.</small></label>
        <div class="modal-actions">
          ${id ? `<button class="danger" type="button" data-delete-expense="${id}">Delete</button>` : ""}
          <button class="primary" type="submit">Save expense</button>
        </div>
      </form>
    `;
  }

  function incomeForm(id) {
    const income = state.incomes.find((item) => item.id === id);
    return `
      <form data-form="income" data-id="${id || ""}">
        <label class="field">Income title<input class="input" name="title" value="${escapeHtml(income?.title || "")}" placeholder="Salary" required></label>
        <label class="field">Amount<input class="input" name="amount" type="number" min="1" step="1" value="${escapeHtml(income?.amount || "")}" required></label>
        <label class="field">Category<select class="input" name="category_id">${activeIncomeCategories().map((c) => `<option value="${c.id}" ${income?.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select></label>
        <label class="field">Day of month<input class="input" name="day_of_month" type="number" min="1" max="28" value="${escapeHtml(income?.day_of_month || 1)}"></label>
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
    document.querySelector("[data-close-modal]")?.addEventListener("click", () => {
      state.modal = null;
      render();
    });
    document.querySelector("[data-sort]")?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    document.querySelector("[data-month-select]")?.addEventListener("change", (event) => {
      state.selectedMonth = event.target.value;
      render();
    });
    document.querySelector("[data-month-current]")?.addEventListener("click", () => {
      state.selectedMonth = currentMonth();
      render();
    });
    document.querySelectorAll("[data-month-shift]").forEach((button) => button.addEventListener("click", () => {
      state.selectedMonth = shiftMonth(selectedMonth(), Number(button.dataset.monthShift || 0));
      render();
    }));
    document.querySelectorAll("[data-month-jump]").forEach((button) => button.addEventListener("click", () => {
      state.selectedMonth = button.dataset.monthJump;
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
    bindForm("invite", createInvite);

    document.querySelectorAll("[data-edit-expense]").forEach((button) => button.addEventListener("click", () => openModal("expense", button.dataset.editExpense)));
    document.querySelectorAll("[data-delete-expense]").forEach((button) => button.addEventListener("click", run(() => deleteExpense(button.dataset.deleteExpense))));
    document.querySelectorAll("[data-edit-income]").forEach((button) => button.addEventListener("click", () => openModal("income", button.dataset.editIncome)));
    document.querySelectorAll("[data-toggle-income]").forEach((button) => button.addEventListener("click", run(() => toggleIncome(button.dataset.toggleIncome))));
    document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => openModal("category", button.dataset.editCategory)));
    document.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", run(() => deleteCategory(button.dataset.deleteCategory))));
    document.querySelectorAll("[data-edit-person]").forEach((button) => button.addEventListener("click", () => openModal("person", button.dataset.editPerson)));
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

  async function createFamily(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const familyName = requireText(data.family || "My Family", "family name", 80);
    const personName = requireText(data.person || "Me", "your display name", 80);
    const budget = data.budget ? boundedNumber(data.budget, "Monthly budget", 0, 999999999) : 0;

    if (state.demo) {
      const familyId = crypto.randomUUID();
      state.family = { id: familyId, name: familyName, currency_code: "INR", monthly_budget: budget, owner_id: state.user.id };
      state.membership = { family_id: familyId, role: "OWNER" };
      state.people = [{ id: crypto.randomUUID(), family_id: familyId, display_name: personName, linked_user_id: state.user.id }];
      state.categories = [
        ...EXPENSE_DEFAULTS.map((name, index) => ({ id: crypto.randomUUID(), family_id: familyId, name, scope: "EXPENSE", color: COLORS[index % COLORS.length] })),
        ...INCOME_DEFAULTS.map((name, index) => ({ id: crypto.randomUUID(), family_id: familyId, name, scope: "INCOME", color: COLORS[(index + 3) % COLORS.length] }))
      ];
      writeDemo();
      render();
      return;
    }

    const { data: family, error: familyError } = await client
      .from("budget_families")
      .insert({ name: familyName, owner_id: state.user.id, currency_code: "INR", monthly_budget: budget })
      .select()
      .single();
    if (familyError) throw familyError;

    const { error: memberError } = await client
      .from("budget_family_users")
      .insert({ family_id: family.id, user_id: state.user.id, role: "OWNER" });
    if (memberError) throw memberError;

    const { error: personError } = await client
      .from("budget_people")
      .insert({ family_id: family.id, display_name: personName, linked_user_id: state.user.id, created_by: state.user.id });
    if (personError) throw personError;

    await seedDefaultCategories(family.id);
    await load();
  }

  async function seedDefaultCategories(familyId) {
    const rows = [
      ...EXPENSE_DEFAULTS.map((name, index) => ({ family_id: familyId, name, scope: "EXPENSE", color: COLORS[index % COLORS.length], created_by: state.user.id })),
      ...INCOME_DEFAULTS.map((name, index) => ({ family_id: familyId, name, scope: "INCOME", color: COLORS[(index + 3) % COLORS.length], created_by: state.user.id }))
    ];
    const { error } = await client.from("budget_categories").insert(rows);
    if (error) throw error;
  }

  async function joinFamily(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (state.demo) throw new Error("Invite joining needs Supabase. Preview mode can create a family locally.");
    const code = requireText(data.code, "invite code", 32).toUpperCase();
    const person = requireText(data.person || "Family member", "your display name", 80);
    const { error } = await client.rpc("join_budget_invite", {
      invite_code_input: code,
      display_name_input: person
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

    const query = id
      ? client.from("budget_expenses").update(payload).eq("id", id)
      : client.from("budget_expenses").insert(payload);
    const { error } = await query;
    if (error) throw error;
    state.modal = null;
    await load();
  }

  async function deleteExpense(id) {
    if (!window.confirm("Delete this expense?")) return;
    if (state.demo) {
      state.expenses = state.expenses.filter((expense) => expense.id !== id);
      state.modal = null;
      writeDemo();
      render();
      return;
    }
    const { error } = await client.from("budget_expenses").delete().eq("id", id);
    if (error) throw error;
    state.modal = null;
    await load();
  }

  async function saveIncome(form) {
    const id = form.dataset.id;
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      family_id: state.family.id,
      title: requireText(data.title, "income title", 120),
      amount: positiveMoney(data.amount, "income amount"),
      day_of_month: boundedNumber(data.day_of_month || 1, "Day of month", 1, 28),
      category_id: data.category_id || null,
      is_active: Boolean(data.is_active),
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

    const query = id
      ? client.from("budget_incomes").update(payload).eq("id", id)
      : client.from("budget_incomes").insert(payload);
    const { error } = await query;
    if (error) throw error;
    state.modal = null;
    await load();
  }

  async function toggleIncome(id) {
    const income = state.incomes.find((item) => item.id === id);
    if (!income) return;
    if (state.demo) {
      state.incomes = state.incomes.map((item) => item.id === id ? { ...item, is_active: !item.is_active } : item);
      writeDemo();
      render();
      return;
    }
    const { error } = await client.from("budget_incomes").update({ is_active: !income.is_active }).eq("id", id);
    if (error) throw error;
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

    const query = id
      ? client.from("budget_categories").update(payload).eq("id", id)
      : client.from("budget_categories").insert(payload);
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
    await load();
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

    const query = id
      ? client.from("budget_people").update(payload).eq("id", id)
      : client.from("budget_people").insert(payload);
    const { error } = await query;
    if (error) throw error;
    state.modal = null;
    await load();
  }

  async function createInvite(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const code = createInviteCode();
    const invitedEmail = cleanText(data.email).toLowerCase();
    const payload = {
      family_id: state.family.id,
      invite_code: code,
      invited_email: invitedEmail || null,
      inviter_id: state.user.id
    };
    if (state.demo) {
      state.invites.unshift({ id: crypto.randomUUID(), ...payload, status: "PENDING" });
      writeDemo();
      render();
      window.alert(`Invite code: ${code}`);
      return;
    }
    const { error } = await client.from("budget_invites").insert(payload);
    if (error) throw error;
    await load();
    window.alert(`Invite code: ${code}`);
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
