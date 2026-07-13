(function () {
  const DEFAULT_URL = "https://svgyjfqpgleywjjnqpda.supabase.co";
  const DEFAULT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2Z3lqZnFwZ2xleXdqam5xcGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1ODMyMDYsImV4cCI6MjA4ODE1OTIwNn0.7mqtrOZ-X1_P7_9-2TY-PfGGhcA_A7kAvvha-DfQ8ec";
  const STORAGE_KEY = "budget-padmanabham-web";
  const CONFIG_KEY = "budget-padmanabham-config";
  const COLORS = ["#0b8a5f", "#f2b544", "#e65d4f", "#3877ad", "#8b5fbf", "#d57929", "#2e9d9a", "#9c4f65"];

  const state = {
    config: loadConfig(),
    session: loadSession(),
    mode: "signin",
    tab: "home",
    insightTab: "overview",
    family: null,
    currentUserId: null,
    members: [],
    categories: [],
    expenses: [],
    incomes: [],
    editingExpense: null,
    categoryInputScope: "EXPENSE",
    pendingCategoryName: "",
    sort: "date",
    loading: false,
    error: ""
  };

  const app = document.getElementById("app");

  function loadConfig() {
    const saved = readJson(CONFIG_KEY);
    const injected = window.BUDGET_PADMANABHAM_CONFIG || {};
    return {
      SUPABASE_URL: saved?.SUPABASE_URL || injected.SUPABASE_URL || DEFAULT_URL,
      SUPABASE_ANON_KEY: saved?.SUPABASE_ANON_KEY || injected.SUPABASE_ANON_KEY || DEFAULT_ANON_KEY
    };
  }

  function loadSession() {
    return readJson(STORAGE_KEY) || null;
  }

  function saveSession(session) {
    state.session = session;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveConfig(config) {
    state.config = config;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function cleanUrl(url) {
    return (url || "").trim().replace(/\/+$/, "");
  }

  function isConfigured() {
    return cleanUrl(state.config.SUPABASE_URL) && state.config.SUPABASE_ANON_KEY.trim();
  }

  function money(value) {
    const currency = state.family?.currency_code || "INR";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function dateLabel(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  }

  function monthKey(value) {
    const date = value ? new Date(value) : new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function currentMonthKey() {
    return monthKey(new Date().toISOString());
  }

  function thisMonthExpenses() {
    const key = currentMonthKey();
    return state.expenses.filter((expense) => monthKey(expense.spent_at) === key);
  }

  function thisMonthIncome() {
    return state.incomes.filter((income) => income.is_active !== false).reduce((sum, income) => sum + Number(income.amount || 0), 0);
  }

  function thisMonthExpenseTotal() {
    return thisMonthExpenses().reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  }

  function yearlyExpenseTotal() {
    const year = new Date().getFullYear();
    return state.expenses
      .filter((expense) => new Date(expense.spent_at).getFullYear() === year)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  }

  function categoryName(id, fallback) {
    return state.categories.find((category) => category.id === id)?.name || fallback || "Unassigned";
  }

  function memberName(userId, fallback) {
    const member = state.members.find((item) => item.user_id === userId);
    return member?.display_name || fallback || "Family member";
  }

  function colorFor(text) {
    let hash = 0;
    for (let i = 0; i < String(text || "").length; i += 1) {
      hash = (hash * 31 + String(text).charCodeAt(i)) >>> 0;
    }
    return COLORS[hash % COLORS.length];
  }

  async function authFetch(path, options = {}) {
    if (!isConfigured()) throw new Error("Add your Supabase URL and publishable anon key in Settings.");
    const url = `${cleanUrl(state.config.SUPABASE_URL)}${path}`;
    const headers = {
      apikey: state.config.SUPABASE_ANON_KEY.trim(),
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const response = await fetch(url, { ...options, headers });
    return parseResponse(response);
  }

  async function restFetch(path, options = {}, retry = true) {
    if (!state.session?.access_token) throw new Error("Please sign in again.");
    const url = `${cleanUrl(state.config.SUPABASE_URL)}/rest/v1${path}`;
    const headers = {
      apikey: state.config.SUPABASE_ANON_KEY.trim(),
      Authorization: `Bearer ${state.session.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const response = await fetch(url, { ...options, headers });
    if ((response.status === 401 || response.status === 403) && retry && state.session.refresh_token) {
      const refreshed = await refreshSession();
      if (refreshed) return restFetch(path, options, false);
    }
    return parseResponse(response);
  }

  async function parseResponse(response) {
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = text;
      }
    }
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || text || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  async function refreshSession() {
    try {
      const data = await authFetch("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: state.session.refresh_token })
      });
      saveSession({ ...state.session, ...data });
      return true;
    } catch (_) {
      saveSession(null);
      return false;
    }
  }

  async function signIn(email, password) {
    const data = await authFetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveSession(data);
    await upsertProfile(data.user?.id, data.user?.email, "");
    await loadDashboard();
  }

  async function signUp(fullName, email, password) {
    const data = await authFetch("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, data: { full_name: fullName } })
    });
    if (!data.access_token) {
      throw new Error("Signup needs email confirmation. Disable confirmation in Supabase Auth for testing, or confirm the email before signing in.");
    }
    saveSession(data);
    await upsertProfile(data.user?.id, email, fullName);
    await loadDashboard();
  }

  async function upsertProfile(id, email, fullName) {
    if (!id) return;
    await restFetch("/profiles?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id, email, full_name: fullName || null })
    });
  }

  async function loadDashboard() {
    state.error = "";
    state.currentUserId = state.session?.user?.id || state.session?.user_id || null;
    if (!state.currentUserId) throw new Error("Supabase did not return a user id. Please sign in again.");
    const memberships = await restFetch(`/family_members?select=*&user_id=eq.${state.currentUserId}`);
    if (!memberships.length) {
      state.family = null;
      state.members = [];
      state.categories = [];
      state.expenses = [];
      state.incomes = [];
      render();
      return;
    }
    const familyId = memberships[0].family_id;
    const families = await restFetch(`/families?select=*&id=eq.${familyId}&limit=1`);
    state.family = families[0] || null;
    if (!state.family) throw new Error("Family not found. Re-run the Supabase schema and check RLS policies.");
    const [members, categories, expenses, incomes] = await Promise.all([
      restFetch(`/family_members?select=*&family_id=eq.${familyId}`),
      restFetch(`/categories?select=*&family_id=eq.${familyId}&order=created_at.desc`),
      restFetch(`/expense_view?select=*&family_id=eq.${familyId}&order=spent_at.desc`),
      loadIncomes(familyId)
    ]);
    state.members = members;
    state.categories = categories;
    state.expenses = await Promise.all(expenses.map(async (expense) => ({
      ...expense,
      name: await decryptIfEncrypted(state.family.expense_secret, expense.name),
      notes: await decryptIfEncrypted(state.family.expense_secret, expense.notes)
    })));
    state.incomes = incomes;
    render();
  }

  async function loadIncomes(familyId) {
    try {
      return await restFetch(`/income_view?select=*&family_id=eq.${familyId}&order=created_at.desc`);
    } catch (error) {
      if (!String(error.message).toLowerCase().includes("income_view")) throw error;
      return restFetch(`/incomes?select=*&family_id=eq.${familyId}&order=created_at.desc`);
    }
  }

  async function createFamily(name, currency, displayName) {
    const rows = await restFetch("/families", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name, owner_id: state.currentUserId, currency_code: (currency || "INR").toUpperCase() })
    });
    const family = rows[0];
    await restFetch("/family_members", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ family_id: family.id, user_id: state.currentUserId, role: "OWNER", display_name: displayName || null })
    });
    await loadDashboard();
  }

  async function joinFamily(code, displayName) {
    const normalized = code.trim().toUpperCase();
    const invites = await restFetch(`/family_invites?select=*&invite_code=eq.${normalized}&status=eq.PENDING&limit=1`);
    const invite = invites[0];
    if (!invite) throw new Error("Invite code is invalid or expired.");
    await restFetch("/family_members", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ family_id: invite.family_id, user_id: state.currentUserId, role: "MEMBER", display_name: displayName || null })
    });
    await restFetch(`/family_invites?id=eq.${invite.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ACCEPTED" })
    });
    await loadDashboard();
  }

  async function createCategory(name, scope) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = state.categories.find((item) => item.scope === scope && item.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const rows = await restFetch("/categories", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ family_id: state.family.id, name: trimmed, scope, created_by: state.currentUserId })
    });
    await loadDashboard();
    return rows[0];
  }

  async function saveExpense(form) {
    let categoryId = form.category_id || null;
    const typedCategory = form.category_name?.trim();
    if (!categoryId && typedCategory) {
      const confirmed = window.confirm(`Create "${typedCategory}" as a new expense category?`);
      if (!confirmed) throw new Error("Choose an existing category or create the new category.");
      const category = await createCategory(typedCategory, "EXPENSE");
      categoryId = category?.id || null;
    }
    const encryptedName = await encryptText(state.family.expense_secret, form.name.trim());
    const encryptedNotes = form.notes?.trim() ? await encryptText(state.family.expense_secret, form.notes.trim()) : null;
    const payload = {
      name: encryptedName,
      category_id: categoryId,
      amount: Number(form.amount),
      notes: encryptedNotes
    };
    if (state.editingExpense) {
      await restFetch(`/expenses?id=eq.${state.editingExpense.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload)
      });
    } else {
      await restFetch("/expenses", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...payload, family_id: state.family.id, spent_by: state.currentUserId })
      });
    }
    state.editingExpense = null;
    await loadDashboard();
  }

  async function deleteExpense(id) {
    if (!window.confirm("Delete this expense? This keeps family members and other records untouched.")) return;
    await restFetch(`/expenses?id=eq.${id}`, { method: "DELETE" });
    await loadDashboard();
  }

  async function saveIncome(form) {
    const category = form.category_name?.trim() ? await createCategory(form.category_name, "INCOME") : null;
    const payload = {
      family_id: state.family.id,
      title: form.title.trim(),
      category_id: form.category_id || category?.id || null,
      amount: Number(form.amount),
      day_of_month: Number(form.day_of_month || 1)
    };
    await restFetch("/incomes", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    await loadDashboard();
  }

  async function createInvite(email) {
    const code = generateCode();
    const rows = await restFetch("/family_invites", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        family_id: state.family.id,
        invited_email: email.trim(),
        invite_code: code,
        inviter_id: state.currentUserId,
        currency_code: state.family.currency_code
      })
    });
    await loadDashboard();
    return rows[0];
  }

  async function removeMember(memberId) {
    const member = state.members.find((item) => item.id === memberId);
    if (!member || member.role === "OWNER") return;
    if (!window.confirm(`Remove ${member.display_name || "this member"} from the family? Their expense history will remain.`)) return;
    await restFetch(`/family_members?id=eq.${memberId}&family_id=eq.${state.family.id}`, { method: "DELETE" });
    await loadDashboard();
  }

  function generateCode() {
    const source = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 8 }, () => source[Math.floor(Math.random() * source.length)]).join("");
  }

  async function deriveKey(secret) {
    const encoded = new TextEncoder().encode(secret || "");
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }

  function base64ToBytes(base64) {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }

  async function encryptText(secret, plainText) {
    if (!secret || !plainText) return plainText;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
    return `enc:v2:${bytesToBase64(iv)}:${bytesToBase64(encrypted)}`;
  }

  async function decryptIfEncrypted(secret, value) {
    if (!value || !secret || !String(value).startsWith("enc:v2:")) return value;
    try {
      const [, , ivPart, dataPart] = String(value).split(":");
      const key = await deriveKey(secret);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivPart) }, key, base64ToBytes(dataPart));
      return new TextDecoder().decode(decrypted);
    } catch (_) {
      return value;
    }
  }

  function render() {
    const hasSession = Boolean(state.session?.access_token);
    app.innerHTML = `
      <div class="app-shell">
        ${topbar()}
        ${!hasSession ? authScreen() : state.family ? dashboardScreen() : setupScreen()}
      </div>
      ${expenseModal()}
      ${categoryModal()}
      ${incomeModal()}
      ${settingsModal()}
    `;
    bindEvents();
  }

  function topbar() {
    return `
      <header class="topbar">
        <div></div>
        <div class="brand">
          <div class="brand-mark">₹</div>
          <div class="brand-title"><strong>బడ్జెట్ పద్మనాభం</strong><span>Budget Padmanabham</span></div>
        </div>
        <button class="settings-link" data-open-settings>Settings</button>
      </header>
    `;
  }

  function authScreen() {
    return `
      <main class="screen active">
        <div class="auth-layout">
          <section class="welcome">
            <div>
              <div class="coin-big">₹</div>
              <h1 class="telugu-title">బడ్జెట్ పద్మనాభం</h1>
            </div>
            <p class="welcome-copy">A family-first expense pad for shared spending, recurring income, monthly summaries, and quick daily entry.</p>
          </section>
          <section class="panel auth-card">
            <div class="segmented">
              <button class="${state.mode === "signin" ? "active" : ""}" data-auth-mode="signin">Sign in</button>
              <button class="${state.mode === "signup" ? "active" : ""}" data-auth-mode="signup">Sign up</button>
            </div>
            <form data-auth-form>
              ${state.mode === "signup" ? field("Full name", "fullName", "text", "Your name") : ""}
              ${field("Email", "email", "email", "you@example.com")}
              ${field("Password", "password", "password", "••••••••")}
              <button class="btn primary wide" type="submit">${state.loading ? "Working..." : state.mode === "signin" ? "Sign in" : "Create account"}</button>
              <p class="hint">For testing, Supabase email confirmation should be disabled or the email must be confirmed before first login.</p>
              ${errorBox()}
            </form>
          </section>
        </div>
      </main>
    `;
  }

  function setupScreen() {
    return `
      <main class="setup">
        <section class="panel section">
          <h2>Create family</h2>
          <form data-create-family>
            ${field("Family name", "name", "text", "Padmanabham Family")}
            <div class="two-col">
              ${field("Your display name", "displayName", "text", "Paddu")}
              ${field("Currency", "currency", "text", "INR", "INR")}
            </div>
            <button class="btn primary" type="submit">Create family</button>
          </form>
        </section>
        <section class="panel section">
          <h2>Join family</h2>
          <form data-join-family>
            <div class="two-col">
              ${field("Invite code", "code", "text", "ABCD2345")}
              ${field("Your display name", "displayName", "text", "Your name")}
            </div>
            <button class="btn ghost" type="submit">Join family</button>
          </form>
          ${errorBox()}
        </section>
      </main>
    `;
  }

  function dashboardScreen() {
    return `
      <main class="dashboard">
        <aside class="sidebar panel">
          ${navButton("home", "⌂", "Home")}
          ${navButton("insights", "◌", "Insights")}
          ${navButton("income", "+", "Income")}
          ${navButton("account", "☻", "Account")}
        </aside>
        <section class="main-area">
          ${summaryCard()}
          ${state.tab === "home" ? homeTab() : ""}
          ${state.tab === "insights" ? insightsTab() : ""}
          ${state.tab === "income" ? incomeTab() : ""}
          ${state.tab === "account" ? accountTab() : ""}
        </section>
        <button class="fab" data-open-expense title="Add expense">+</button>
      </main>
    `;
  }

  function navButton(id, icon, label) {
    return `<button class="nav-button ${state.tab === id ? "active" : ""}" data-tab="${id}"><span>${icon}</span><span>${label}</span></button>`;
  }

  function summaryCard() {
    return `
      <section class="summary">
        <div>
          <h1 class="family-name">${escapeHtml(state.family.name)}</h1>
          <p class="hint">Monthly numbers refresh naturally from this month's expense dates. Yearly stats stay available in Insights.</p>
        </div>
        <div class="summary-stats">
          <div class="stat-row"><span>Income</span><strong>${money(thisMonthIncome())}</strong></div>
          <div class="stat-row"><span>Expenses</span><strong>${money(thisMonthExpenseTotal())}</strong></div>
          <div class="stat-row"><span>Savings</span><strong>${money(thisMonthIncome() - thisMonthExpenseTotal())}</strong></div>
        </div>
      </section>
    `;
  }

  function homeTab() {
    return `
      <div class="content-grid">
        <section class="panel section">
          <div class="section-head">
            <h2>Expenses</h2>
            <div class="toolbar">
              <select class="select" data-sort>
                <option value="date" ${state.sort === "date" ? "selected" : ""}>Sort by date</option>
                <option value="category" ${state.sort === "category" ? "selected" : ""}>Sort by category</option>
                <option value="person" ${state.sort === "person" ? "selected" : ""}>Sort by person</option>
              </select>
              <button class="btn ghost" data-open-categories>Categories</button>
            </div>
          </div>
          <div class="expense-list">${expenseList(sortedExpenses())}</div>
        </section>
        <aside class="panel section">
          <h2>Quick read</h2>
          ${miniBars(categoryTotals(thisMonthExpenses()), "category")}
        </aside>
      </div>
    `;
  }

  function sortedExpenses() {
    const list = [...state.expenses];
    if (state.sort === "category") return list.sort((a, b) => categoryName(a.category_id, a.category_name).localeCompare(categoryName(b.category_id, b.category_name)));
    if (state.sort === "person") return list.sort((a, b) => memberName(a.spent_by, a.spent_by_name).localeCompare(memberName(b.spent_by, b.spent_by_name)));
    return list.sort((a, b) => new Date(b.spent_at) - new Date(a.spent_at));
  }

  function expenseList(expenses) {
    if (!expenses.length) return `<div class="empty">No expenses yet. Tap the big plus and put the first one down.</div>`;
    return expenses.map((expense) => `
      <article class="item">
        <div class="color-stripe" style="background:${colorFor(expense.category_id || expense.name)}"></div>
        <div>
          <div class="item-title">${escapeHtml(expense.name)}</div>
          <div class="item-meta">${escapeHtml(categoryName(expense.category_id, expense.category_name))} · ${escapeHtml(memberName(expense.spent_by, expense.spent_by_name))} · ${dateLabel(expense.spent_at)}</div>
          ${expense.notes ? `<div class="item-meta">${escapeHtml(expense.notes)}</div>` : ""}
        </div>
        <div>
          <div class="item-amount">${money(expense.amount)}</div>
          <div class="item-actions">
            <button class="icon-btn" title="Edit" data-edit-expense="${expense.id}">✎</button>
            <button class="icon-btn" title="Delete" data-delete-expense="${expense.id}">×</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  function insightsTab() {
    const monthExpenses = thisMonthExpenses();
    return `
      <section class="panel section">
        <div class="tabs">
          ${insightButton("overview", "Overview")}
          ${insightButton("charts", "Charts")}
          ${insightButton("history", "Past months")}
        </div>
        ${state.insightTab === "overview" ? overview(monthExpenses) : ""}
        ${state.insightTab === "charts" ? charts(monthExpenses) : ""}
        ${state.insightTab === "history" ? historyView() : ""}
      </section>
    `;
  }

  function insightButton(id, label) {
    return `<button class="${state.insightTab === id ? "active" : ""}" data-insight="${id}">${label}</button>`;
  }

  function overview(expenses) {
    return `
      <div class="metric-grid">
        <div class="metric"><span>Monthly income</span><strong>${money(thisMonthIncome())}</strong></div>
        <div class="metric"><span>Monthly spend</span><strong>${money(thisMonthExpenseTotal())}</strong></div>
        <div class="metric"><span>Yearly spend</span><strong>${money(yearlyExpenseTotal())}</strong></div>
      </div>
      <div class="two-col">
        <div>${miniBars(memberTotals(expenses), "member")}</div>
        <div>${miniBars(incomeCategoryTotals(), "income")}</div>
      </div>
    `;
  }

  function charts(expenses) {
    const totals = categoryTotals(expenses);
    return `
      <div class="two-col">
        <div class="chart-wrap"><div class="pie" style="background:${pieGradient(totals)}"></div></div>
        <div>${miniBars(totals, "category")}</div>
      </div>
    `;
  }

  function historyView() {
    const months = [...new Set(state.expenses.map((expense) => monthKey(expense.spent_at)))].sort().reverse();
    if (!months.length) return `<div class="empty">Past months will appear after expenses are added.</div>`;
    return months.map((key) => {
      const expenses = state.expenses.filter((expense) => monthKey(expense.spent_at) === key);
      const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      return `
        <details class="panel section" style="box-shadow:none; margin-bottom:12px;">
          <summary><strong>${key}</strong> · ${money(total)} · ${expenses.length} expenses</summary>
          <div style="margin-top:12px;">${expenseList(expenses)}</div>
        </details>
      `;
    }).join("");
  }

  function incomeTab() {
    return `
      <div class="content-grid">
        <section class="panel section">
          <div class="section-head">
            <h2>Recurring income</h2>
            <button class="btn primary" data-open-income>Add income</button>
          </div>
          ${state.incomes.length ? state.incomes.map((income) => `
            <article class="item">
              <div class="color-stripe" style="background:${colorFor(income.category_id || income.title)}"></div>
              <div>
                <div class="item-title">${escapeHtml(income.title)}</div>
                <div class="item-meta">${escapeHtml(categoryName(income.category_id, income.category_name))} · Day ${income.day_of_month}</div>
              </div>
              <div class="item-amount">${money(income.amount)}</div>
            </article>
          `).join("") : `<div class="empty">No recurring income yet.</div>`}
        </section>
        <aside class="panel section">${miniBars(incomeCategoryTotals(), "income")}</aside>
      </div>
    `;
  }

  function accountTab() {
    const isOwner = state.family.owner_id === state.currentUserId;
    return `
      <div class="content-grid">
        <section class="panel section">
          <h2>Family members</h2>
          ${state.members.map((member) => `
            <article class="item">
              <div class="color-stripe" style="background:${member.role === "OWNER" ? "var(--marigold)" : "var(--leaf)"}"></div>
              <div>
                <div class="item-title">${escapeHtml(member.display_name || "Family member")}</div>
                <div class="item-meta">${member.role}</div>
              </div>
              <div>${isOwner && member.role !== "OWNER" ? `<button class="btn danger" data-remove-member="${member.id}">Remove</button>` : ""}</div>
            </article>
          `).join("")}
        </section>
        <aside class="panel section">
          <h2>Invite</h2>
          ${isOwner ? `
            <form data-invite>
              ${field("Email", "email", "email", "member@example.com")}
              <button class="btn primary wide" type="submit">Create invite code</button>
            </form>
          ` : `<p class="hint">Only the family owner can invite members.</p>`}
          <hr>
          <button class="btn ghost wide" data-signout>Sign out</button>
        </aside>
      </div>
    `;
  }

  function categoryTotals(expenses) {
    const map = new Map();
    expenses.forEach((expense) => {
      const name = categoryName(expense.category_id, expense.category_name);
      map.set(name, (map.get(name) || 0) + Number(expense.amount || 0));
    });
    return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }

  function memberTotals(expenses) {
    const map = new Map();
    expenses.forEach((expense) => {
      const name = memberName(expense.spent_by, expense.spent_by_name);
      map.set(name, (map.get(name) || 0) + Number(expense.amount || 0));
    });
    return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }

  function incomeCategoryTotals() {
    const map = new Map();
    state.incomes.forEach((income) => {
      const name = categoryName(income.category_id, income.category_name);
      map.set(name, (map.get(name) || 0) + Number(income.amount || 0));
    });
    return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }

  function miniBars(rows, emptyLabel) {
    if (!rows.length) return `<div class="empty">No ${emptyLabel} data yet.</div>`;
    const max = Math.max(...rows.map((row) => row.total), 1);
    return rows.map((row) => `
      <div class="bar-row">
        <strong>${escapeHtml(row.name)}</strong>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (row.total / max) * 100)}%; background:${colorFor(row.name)}"></div></div>
        <span>${money(row.total)}</span>
      </div>
    `).join("");
  }

  function pieGradient(rows) {
    if (!rows.length) return "conic-gradient(#ded8ce 0 100%)";
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    let cursor = 0;
    const stops = rows.map((row) => {
      const start = cursor;
      cursor += (row.total / total) * 100;
      return `${colorFor(row.name)} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(",")})`;
  }

  function expenseModal() {
    const expense = state.editingExpense;
    return `
      <div class="modal-backdrop" id="expense-modal">
        <div class="modal">
          <div class="modal-head">
            <h2>${expense ? "Edit expense" : "Add expense"}</h2>
            <button class="icon-btn" data-close-modal>×</button>
          </div>
          <form data-expense-form>
            ${field("Expense name", "name", "text", "Groceries", expense?.name || "")}
            ${categorySuggestField("EXPENSE", expense?.category_id || "", categoryName(expense?.category_id, expense?.category_name) === "Unassigned" ? "" : categoryName(expense?.category_id, expense?.category_name))}
            ${field("Amount", "amount", "number", "1200", expense?.amount || "")}
            <div class="field"><label>Notes</label><textarea class="textarea" name="notes">${escapeHtml(expense?.notes || "")}</textarea></div>
            <button class="btn primary wide" type="submit">${expense ? "Save changes" : "Add expense"}</button>
          </form>
        </div>
      </div>
    `;
  }

  function categoryModal() {
    const expenseCategories = state.categories.filter((category) => category.scope === "EXPENSE");
    return `
      <div class="modal-backdrop" id="category-modal">
        <div class="modal">
          <div class="modal-head">
            <h2>Expense categories</h2>
            <button class="icon-btn" data-close-modal>×</button>
          </div>
          <form data-category-form>
            ${field("New category", "name", "text", "School fees")}
            <button class="btn primary" type="submit">Add category</button>
          </form>
          <div class="expense-list" style="max-height:360px; margin-top:16px;">
            ${expenseCategories.length ? expenseCategories.map((category) => `<article class="item"><div class="color-stripe" style="background:${colorFor(category.name)}"></div><div class="item-title">${escapeHtml(category.name)}</div><div></div></article>`).join("") : `<div class="empty">No categories yet.</div>`}
          </div>
        </div>
      </div>
    `;
  }

  function incomeModal() {
    return `
      <div class="modal-backdrop" id="income-modal">
        <div class="modal">
          <div class="modal-head">
            <h2>Add recurring income</h2>
            <button class="icon-btn" data-close-modal>×</button>
          </div>
          <form data-income-form>
            ${field("Income title", "title", "text", "Salary")}
            ${categorySuggestField("INCOME", "", "")}
            ${field("Amount", "amount", "number", "50000")}
            ${field("Day of month", "day_of_month", "number", "1", "1")}
            <button class="btn primary wide" type="submit">Add income</button>
          </form>
        </div>
      </div>
    `;
  }

  function settingsModal() {
    return `
      <div class="modal-backdrop" id="settings-modal">
        <div class="modal">
          <div class="modal-head">
            <h2>Supabase settings</h2>
            <button class="icon-btn" data-close-modal>×</button>
          </div>
          <form data-settings-form>
            ${field("Project URL", "url", "url", DEFAULT_URL, state.config.SUPABASE_URL)}
            ${field("Publishable anon key", "key", "password", "eyJ...", state.config.SUPABASE_ANON_KEY)}
            <button class="btn primary wide" type="submit">Save settings</button>
            <p class="hint">The anon key is publishable, but RLS policies must be correct because browser and mobile clients both use it.</p>
          </form>
        </div>
      </div>
    `;
  }

  function categorySuggestField(scope, selectedId, selectedName) {
    const categories = orderedCategories(scope);
    return `
      <div class="field suggest-wrap" data-suggest-scope="${scope}">
        <label>${scope === "INCOME" ? "Income category" : "Category"}</label>
        <input type="hidden" name="category_id" value="${escapeHtml(selectedId || "")}">
        <input class="input" name="category_name" autocomplete="off" value="${escapeHtml(selectedName || "")}" placeholder="Start typing or choose from the list">
        <div class="suggestions">
          ${categories.map((category) => `<button type="button" data-category-pick="${category.id}" data-category-name="${escapeHtml(category.name)}">${escapeHtml(category.name)}</button>`).join("")}
        </div>
      </div>
    `;
  }

  function orderedCategories(scope) {
    const usage = new Map();
    state.expenses.forEach((expense) => usage.set(expense.category_id, (usage.get(expense.category_id) || 0) + 1));
    return state.categories
      .filter((category) => category.scope === scope)
      .sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || a.name.localeCompare(b.name));
  }

  function field(label, name, type, placeholder, value = "") {
    return `<div class="field"><label>${label}</label><input class="input" name="${name}" type="${type}" placeholder="${placeholder}" value="${escapeHtml(value)}" ${type === "number" ? "step=\"0.01\" min=\"0\"" : ""}></div>`;
  }

  function errorBox() {
    return `<div class="error ${state.error ? "show" : ""}">${escapeHtml(state.error)}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function bindEvents() {
    document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
      state.mode = button.dataset.authMode;
      state.error = "";
      render();
    }));
    document.querySelector("[data-auth-form]")?.addEventListener("submit", runForm(async (form) => {
      const data = formData(form);
      if (state.mode === "signin") await signIn(data.email, data.password);
      else await signUp(data.fullName, data.email, data.password);
    }));
    document.querySelector("[data-create-family]")?.addEventListener("submit", runForm(async (form) => {
      const data = formData(form);
      await createFamily(data.name || "Our Family", data.currency || "INR", data.displayName);
    }));
    document.querySelector("[data-join-family]")?.addEventListener("submit", runForm(async (form) => {
      const data = formData(form);
      await joinFamily(data.code, data.displayName);
    }));
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      render();
    }));
    document.querySelectorAll("[data-insight]").forEach((button) => button.addEventListener("click", () => {
      state.insightTab = button.dataset.insight;
      render();
    }));
    document.querySelector("[data-sort]")?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });
    document.querySelectorAll("[data-open-expense]").forEach((button) => button.addEventListener("click", () => openModal("expense-modal")));
    document.querySelectorAll("[data-open-categories]").forEach((button) => button.addEventListener("click", () => openModal("category-modal")));
    document.querySelectorAll("[data-open-income]").forEach((button) => button.addEventListener("click", () => openModal("income-modal")));
    document.querySelectorAll("[data-open-settings]").forEach((button) => button.addEventListener("click", () => openModal("settings-modal")));
    document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
    document.querySelector("[data-expense-form]")?.addEventListener("submit", runForm(async (form) => saveExpense(formData(form)), closeModals));
    document.querySelector("[data-category-form]")?.addEventListener("submit", runForm(async (form) => createCategory(formData(form).name, "EXPENSE"), closeModals));
    document.querySelector("[data-income-form]")?.addEventListener("submit", runForm(async (form) => saveIncome(formData(form)), closeModals));
    document.querySelector("[data-settings-form]")?.addEventListener("submit", runForm(async (form) => {
      const data = formData(form);
      saveConfig({ SUPABASE_URL: data.url, SUPABASE_ANON_KEY: data.key });
    }, closeModals));
    document.querySelectorAll("[data-edit-expense]").forEach((button) => button.addEventListener("click", () => {
      state.editingExpense = state.expenses.find((expense) => expense.id === button.dataset.editExpense);
      render();
      openModal("expense-modal");
    }));
    document.querySelectorAll("[data-delete-expense]").forEach((button) => button.addEventListener("click", runAction(() => deleteExpense(button.dataset.deleteExpense))));
    document.querySelectorAll("[data-remove-member]").forEach((button) => button.addEventListener("click", runAction(() => removeMember(button.dataset.removeMember))));
    document.querySelector("[data-invite]")?.addEventListener("submit", runForm(async (form) => {
      const invite = await createInvite(formData(form).email);
      window.alert(`Invite code: ${invite.invite_code}`);
    }));
    document.querySelector("[data-signout]")?.addEventListener("click", () => {
      saveSession(null);
      state.family = null;
      render();
    });
    bindSuggesters();
  }

  function bindSuggesters() {
    document.querySelectorAll("[data-suggest-scope]").forEach((wrap) => {
      const input = wrap.querySelector("input[name='category_name']");
      const hidden = wrap.querySelector("input[name='category_id']");
      const menu = wrap.querySelector(".suggestions");
      input.addEventListener("focus", () => menu.classList.add("show"));
      input.addEventListener("input", () => {
        hidden.value = "";
        const query = input.value.trim().toLowerCase();
        menu.querySelectorAll("button").forEach((button) => {
          button.style.display = button.dataset.categoryName.toLowerCase().includes(query) ? "block" : "none";
        });
        menu.classList.add("show");
      });
      menu.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        hidden.value = button.dataset.categoryPick;
        input.value = button.dataset.categoryName;
        menu.classList.remove("show");
      }));
    });
  }

  function openModal(id) {
    document.getElementById(id)?.classList.add("show");
  }

  function closeModals() {
    document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.classList.remove("show"));
    state.editingExpense = null;
  }

  function runForm(action, after) {
    return async (event) => {
      event.preventDefault();
      await runAction(async () => {
        await action(event.currentTarget);
        if (after) after();
      })();
    };
  }

  function runAction(action) {
    return async () => {
      state.loading = true;
      state.error = "";
      try {
        await action();
      } catch (error) {
        state.error = error.message || "Something went wrong.";
        window.alert(state.error);
      } finally {
        state.loading = false;
        render();
      }
    };
  }

  render();
  if (state.session?.access_token && isConfigured()) {
    loadDashboard().catch((error) => {
      state.error = error.message;
      render();
    });
  }
})();
