import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the self-contained component previews under design-system/.
 *
 * DEV-TIME ONLY. The app never loads this, so its no-build-step property is
 * untouched. styles.css stays the single source of truth: this inlines it into
 * each preview, so a preview can never drift from what the app actually renders.
 *
 * Direction is strictly one way, styles.css -> previews. Never hand-edit a
 * generated file; re-run this instead.
 *
 *   node scripts/build_ds_previews.mjs
 *   node scripts/build_ds_previews.mjs --check   # fail if output is stale
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "design-system");
const CHECK = process.argv.includes("--check");

const rawCss = readFileSync(join(ROOT, "styles.css"), "utf8");

// The stylesheet loads Inter from a relative path. A published preview is served
// from somewhere else entirely, so that URL would 404 and the previews would
// silently fall back to the system font -- misrepresenting the type. Inline the
// font so each preview really is self-contained.
const fontBase64 = readFileSync(join(ROOT, "fonts/InterVariable-subset.woff2")).toString("base64");
const css = rawCss.replace(
  'url("./fonts/InterVariable-subset.woff2") format("woff2-variations")',
  `url("data:font/woff2;base64,${fontBase64}") format("woff2-variations")`
);
if (css === rawCss) {
  throw new Error("Could not inline the font: the @font-face src in styles.css changed shape.");
}

// Pulled from styles.css so the swatch list cannot drift from the tokens.
const tokenBlock = css.slice(
  css.indexOf("/* #region ds:tokens */"),
  css.indexOf("/* #endregion ds:tokens */")
);
const semanticColors = [...tokenBlock.matchAll(/^\s{2}(--(?:bg|text|border|accent|positive|warning|critical|info)[\w-]*): (.+);$/gm)]
  .map((m) => m[1])
  .filter((name) => !name.startsWith("--text-") || !/^--text-(2xs|xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl)$/.test(name));
const spaceTokens = [...tokenBlock.matchAll(/^\s{2}(--space-[\w]+): (.+);$/gm)].map((m) => m[1]);
const radiusTokens = [...tokenBlock.matchAll(/^\s{2}(--radius-[\w]+): (.+);$/gm)].map((m) => m[1]);
const textTokens = [...tokenBlock.matchAll(/^\s{2}(--text-(?:2xs|xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl)): (.+);$/gm)].map((m) => m[1]);

const FRAME_CSS = `
  .ds-page { padding: 24px; max-width: 1180px; margin: 0 auto; }
  .ds-head { margin: 0 0 4px; font-size: 24px; font-weight: 700; }
  .ds-sub { margin: 0 0 28px; color: var(--text-secondary); font-size: 14px; max-width: 60ch; line-height: 1.5; }
  .ds-section { margin: 0 0 36px; }
  .ds-label { margin: 0 0 10px; font-size: 11px; font-weight: 600; letter-spacing: .08em;
              text-transform: uppercase; color: var(--text-secondary); }
  .ds-note { margin: 8px 0 0; font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
  .ds-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .ds-stack > * + * { margin-top: 12px; }
  .ds-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
  .ds-swatch { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
  .ds-swatch i { display: block; height: 52px; }
  .ds-swatch span { display: block; padding: 8px 10px; font-size: 11px; font-family: ui-monospace, monospace; }
  .ds-bar { background: var(--accent); height: 14px; border-radius: 3px; }
  .ds-box { background: var(--bg-surface); border: 1px solid var(--border-subtle); padding: 16px; }
`;

function page({ group, title, subtitle, body }) {
  // First line MUST be the @dsCard marker -- the Design System pane indexes on it.
  return `<!-- @dsCard group="${group}" -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!-- ds:css:start (generated from styles.css - do not edit) -->
<style>
${css}
${FRAME_CSS}
</style>
<!-- ds:css:end -->
</head>
<body>
<div class="ds-page">
  <h1 class="ds-head">${title}</h1>
  <p class="ds-sub">${subtitle}</p>
${body}
</div>
</body>
</html>
`;
}

const section = (label, html, note) =>
  `  <section class="ds-section">
    <p class="ds-label">${label}</p>
${html}
${note ? `    <p class="ds-note">${note}</p>` : ""}
  </section>`;

const FILES = {
  "foundations/colors.html": page({
    group: "Foundations",
    title: "Colour",
    subtitle:
      "Two tiers. --ref-* primitives are raw values and appear only inside :root. Everything else in the stylesheet uses the semantic tokens below. Keeping that split is what makes dark mode a small diff rather than a rewrite of every rule.",
    body: section(
      "Semantic tokens",
      `    <div class="ds-grid">
${semanticColors.map((t) => `      <div class="ds-swatch"><i style="background: var(${t})"></i><span>${t}</span></div>`).join("\n")}
    </div>`,
      "Never reference a --ref-* token outside :root."
    ) + "\n" + section(
      "Category swatches",
      `    <div class="ds-grid">
${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `      <div class="ds-swatch"><i style="background: var(--ref-cat-${n})"></i><span>--ref-cat-${n}</span></div>`).join("\n")}
    </div>`,
      "Mirrored by COLORS in app.js, which writes these into inline style attributes. Change one, change both."
    ),
  }),

  "foundations/typography.html": page({
    group: "Foundations",
    title: "Typography",
    subtitle:
      "Inter, self-hosted and subset to ~68KB. Weights collapsed from nine ad-hoc values (including the nonstandard 750/850/950) to four tokens, so weight carries hierarchy instead of everything being maximum bold.",
    body: section(
      "Size scale",
      `    <div class="ds-stack">
${textTokens.map((t) => `      <p style="font-size: var(${t}); margin: 0;">${t} — Family expenses</p>`).join("\n")}
    </div>`
    ) + "\n" + section(
      "Weights",
      `    <div class="ds-stack">
      <p style="font-weight: var(--weight-regular); margin:0; font-size:18px;">--weight-regular 400 — body copy</p>
      <p style="font-weight: var(--weight-medium); margin:0; font-size:18px;">--weight-medium 500 — secondary labels</p>
      <p style="font-weight: var(--weight-semibold); margin:0; font-size:18px;">--weight-semibold 600 — controls, captions</p>
      <p style="font-weight: var(--weight-bold); margin:0; font-size:18px;">--weight-bold 700 — headings, amounts</p>
    </div>`
    ) + "\n" + section(
      "Tabular numerals",
      `    <div class="ds-row">
      <div class="ds-box"><div style="font-variant-numeric: tabular-nums;">₹1,42,500<br>₹84,320<br>₹1,11,111</div><p class="ds-note">tabular (used for money)</p></div>
      <div class="ds-box"><div>₹1,42,500<br>₹84,320<br>₹1,11,111</div><p class="ds-note">proportional — digits jitter</p></div>
    </div>`,
      "Amounts always use tabular-nums so ledger columns stay aligned as values change."
    ),
  }),

  "foundations/space-radius-elevation.html": page({
    group: "Foundations",
    title: "Space, radius, elevation",
    subtitle:
      "A 4px spacing base replaces 18 eyeballed gap values. Radius scales with element size rather than 8px everywhere. Elevation is a three-step ramp tinted toward the brand green.",
    body: section(
      "Spacing",
      `    <div class="ds-stack">
${spaceTokens.map((t) => `      <div><div class="ds-bar" style="width: var(${t}); min-width: 2px;"></div><p class="ds-note">${t}</p></div>`).join("\n")}
    </div>`
    ) + "\n" + section(
      "Radius",
      `    <div class="ds-row">
${radiusTokens.map((t) => `      <div style="width:76px;height:76px;background:var(--bg-accent-tint);border-radius:var(${t});display:grid;place-items:center;font-size:10px;text-align:center;padding:4px;">${t.replace("--radius-", "")}</div>`).join("\n")}
    </div>`
    ) + "\n" + section(
      "Elevation",
      `    <div class="ds-row">
      <div class="ds-box" style="box-shadow: var(--elev-0); border-radius: var(--radius-lg);">--elev-0</div>
      <div class="ds-box" style="box-shadow: var(--elev-1); border-radius: var(--radius-lg);">--elev-1 (cards)</div>
      <div class="ds-box" style="box-shadow: var(--elev-2); border-radius: var(--radius-lg);">--elev-2 (hero)</div>
      <div class="ds-box" style="box-shadow: var(--elev-3); border-radius: var(--radius-lg);">--elev-3 (overlays)</div>
    </div>`,
      "Cards previously declared --elev-2 and then cancelled it in nine places; they now use --elev-1, which sits under the border instead of fighting it."
    ),
  }),

  "components/actions.html": page({
    group: "Actions",
    title: "Buttons",
    subtitle:
      "Hover is gated behind (hover: hover) so it does not stick after a tap on touch. Focus uses :focus-visible, so a mouse click leaves no ring but keyboard focus is always visible — there was previously no focus style on any button.",
    body: section(
      "Variants",
      `    <div class="ds-row">
      <button class="primary">Add expense</button>
      <button class="secondary">Join family</button>
      <button class="danger">Remove</button>
      <button class="text-button">Skip</button>
      <button class="icon-button">₹</button>
      <button class="compact">Filter</button>
    </div>`
    ) + "\n" + section(
      "Full width",
      `    <div class="ds-stack" style="max-width:360px">
      <button class="primary wide">Join family</button>
      <button class="secondary wide">Show me around again</button>
      <button class="danger wide">Leave family</button>
    </div>`
    ) + "\n" + section(
      "Focus ring (simulated)",
      `    <div class="ds-row">
      <button class="primary" style="outline:2px solid var(--border-focus);outline-offset:2px;border-radius:var(--radius-sm)">Focused</button>
      <button class="secondary" style="outline:2px solid var(--border-focus);outline-offset:2px;border-radius:var(--radius-sm)">Focused</button>
    </div>`,
      "On the dark sidebar and the FAB the ring switches to white, where a green ring would be invisible."
    ),
  }),

  "components/forms.html": page({
    group: "Forms",
    title: "Form fields",
    subtitle: "Fields are a label/input stack with a 52px minimum input height for large touch targets. Help text sits under the control and explains consequences, not mechanics.",
    body: section(
      "Text and password",
      `    <div class="ds-stack" style="max-width:420px">
      <label class="field">Family code<input class="input code-input" value="BUDGET-4F2A91C7B3D0"></label>
      <label class="field">Family password<input class="input" type="password" value="hunter2hunter2"><small>The same password everyone in your family uses. Ask whoever sent you the code.</small></label>
      <label class="field">Your name<input class="input" value="Ramesh Padmanabham"><small>How your spending shows up to the family.</small></label>
    </div>`
    ) + "\n" + section(
      "Checkbox with help text",
      `    <div class="ds-box" style="max-width:420px;border-radius:var(--radius-lg)">
      <label class="check"><input type="checkbox" checked> I am still receiving this<small>Untick if this income has stopped, for example a job you left. It stops counting toward your monthly total, and past records stay.</small></label>
    </div>`,
      "This replaced a bare “Active income” checkbox, which never said what switching it off would do."
    ),
  }),

  "components/surfaces.html": page({
    group: "Surfaces",
    title: "Cards and panels",
    subtitle: "One base surface with a hairline border and a tight shadow, plus the dark hero treatment used for the single most important number on a screen.",
    body: section(
      "Card",
      `    <div class="card panel" style="max-width:420px">
      <div class="section-head"><h2>Family invite</h2></div>
      <p class="section-subtitle">One code for this family</p>
    </div>`
    ) + "\n" + section(
      "Hero",
      `    <section class="home-balance-card" style="max-width:420px">
      <div><span>Total Monthly Income</span><strong>₹1,42,500</strong><small>+8.2% vs last month</small></div>
    </section>`
    ) + "\n" + section(
      "Summary cards",
      `    <div class="ds-stack" style="max-width:420px">
      <article class="finance-summary-card card expense-summary">
        <div><span>Expenses</span><strong>₹84,320</strong><small>65% of monthly budget used</small></div>
        <b>₹</b><i style="width:65%"></i>
      </article>
      <article class="finance-summary-card card expense-summary">
        <div><span>Expenses</span><strong>₹1,64,320</strong><small>128% of monthly budget used</small></div>
        <b>₹</b><i class="over" style="width:100%"></i>
      </article>
      <article class="finance-summary-card card expense-summary no-budget">
        <div><span>Expenses</span><strong>₹84,320</strong><small>Set a monthly budget in Family to track this</small></div>
        <b>₹</b>
      </article>
    </div>`,
      "The bar reflects usage: accent, warning at 80%, critical at 100%. With no budget set there is no bar and the caption prompts instead of reporting 0%."
    ),
  }),

  "components/lists.html": page({
    group: "Data display",
    title: "Rows and meters",
    subtitle: "The repeating units of the ledger, plus the meters used for budgets and limits.",
    body: section(
      "Activity row",
      `    <div class="card activity-list-card" style="max-width:420px">
      <div class="activity-list">
        <article class="activity-row">
          <span class="activity-spender" style="background:#dceee522;color:#1B4332">R</span>
          <div class="activity-main"><strong>Spencer's Retail</strong><span>Ramesh · Groceries · Today</span></div>
          <div class="activity-side"><strong>-₹4,280</strong></div>
        </article>
        <article class="activity-row">
          <span class="activity-spender" style="background:#EE605522;color:#EE6055">L</span>
          <div class="activity-main"><strong>Urban Company</strong><span>Lakshmi · Services · Yesterday</span></div>
          <div class="activity-side"><strong>-₹1,200</strong></div>
        </article>
      </div>
    </div>`
    ) + "\n" + section(
      "Budget meter",
      `    <div class="ds-stack" style="max-width:420px">
      <div class="budget-meter"><div><span>Groceries</span><strong>62%</strong></div><i><b style="width:62%"></b></i></div>
      <div class="budget-meter gold"><div><span>Dining</span><strong>88%</strong></div><i><b style="width:88%"></b></i></div>
      <div class="budget-meter warn"><div><span>Fuel</span><strong>120%</strong></div><i><b style="width:100%"></b></i></div>
    </div>`,
      "The over-budget bar used var(--danger), which is defined nowhere — the declaration was invalid, so the one state this meter exists to show rendered fully transparent."
    ) + "\n" + section(
      "Status cards",
      `    <div class="ds-row">
      <article class="status-card ok"><span>Utilities</span><strong>Within limit</strong></article>
      <article class="status-card warn"><span>Dining</span><strong>Over ₹2,400</strong></article>
    </div>`
    ),
  }),

  "components/onboarding.html": page({
    group: "Onboarding",
    title: "Onboarding",
    subtitle:
      "Joining is one step: a family code plus the family password. Joining is listed first because receiving a code is the common case. Budget and savings goal are deliberately absent — nobody can pick them before entering a single expense.",
    body: section(
      "Entry",
      `    <section class="entry-panel">
      <div class="choice-hero">
        <span class="secure-pill">First step</span>
        <h2>Join your family, or start one</h2>
        <p>If someone sent you a family code and password, enter them below and you are straight in.</p>
      </div>
      <div class="setup-grid">
        <form class="card panel setup-card join-choice">
          <span class="choice-number">1</span>
          <h2>I have a family code</h2>
          <p class="section-subtitle">Enter both and you are in. Nobody needs to approve you.</p>
          <label class="field">Family code<input class="input code-input" placeholder="BUDGET-XXXXXXXXXXXX"></label>
          <label class="field">Family password<input class="input" type="password"></label>
          <button class="primary wide" type="button">Join family</button>
        </form>
        <form class="card panel setup-card create-choice">
          <span class="choice-number">2</span>
          <h2>Start a new family</h2>
          <p class="section-subtitle">Use this if you are the first person setting things up.</p>
          <label class="field">Family name<input class="input" placeholder="Padmanabham Family"></label>
          <button class="secondary wide" type="button">Create family</button>
        </form>
      </div>
    </section>`
    ),
  }),

  "components/goals.html": page({
    group: "Goals",
    title: "Goals",
    subtitle:
      "One screen for the savings goal, the monthly budget and every category limit. Previously these were split across two panels buried at the bottom of the invite aside, and exceeding a limit produced almost no visible feedback: the budget meter's warn state was unreachable dead code, nothing warned at the moment of entry, and the Expenses screen showed no limit state at all.",
    body: section(
      "Savings goal",
      `    <section class="goal-hero">
      <div class="goal-ring" style="--goal-percent: 70"><b>70%</b></div>
      <div class="goal-hero-main">
        <span>Savings goal</span>
        <strong>₹42,000 of ₹60,000</strong>
        <small>₹18,000 to go, with 12 days left this month.</small>
      </div>
    </section>`,
      "Progress is capped at 100% and negative savings floor to zero, so the ring can never show a nonsense value in a month that ran a deficit."
    ) + "\n" + section(
      "Monthly budget — the three states",
      `    <div class="ds-stack" style="max-width:560px">
      <article class="card goal-card">
        <div class="goal-card-head">
          <div><h2>Monthly budget</h2><p>Everything the family spends this month.</p></div>
          <span class="goal-pill ok">On track</span>
        </div>
        <div class="goal-amounts"><strong>₹84,320</strong><span>of ₹1,50,000</span></div>
        <div class="goal-track"><i style="width:56%"></i><span class="goal-pace" style="left:61%"></span></div>
        <div class="goal-foot"><span>56% used</span><span><b>₹65,680</b> left</span></div>
      </article>

      <article class="card goal-card">
        <div class="goal-card-head">
          <div><h2>Monthly budget</h2><p>Everything the family spends this month.</p></div>
          <span class="goal-pill near">Close to limit</span>
        </div>
        <div class="goal-amounts"><strong>₹1,32,400</strong><span>of ₹1,50,000</span></div>
        <div class="goal-track near"><i style="width:88%"></i><span class="goal-pace" style="left:61%"></span></div>
        <div class="goal-foot"><span>88% used, ahead of pace</span><span><b>₹17,600</b> left</span></div>
      </article>

      <article class="card goal-card">
        <div class="goal-card-head">
          <div><h2>Monthly budget</h2><p>Everything the family spends this month.</p></div>
          <span class="goal-pill over">Over</span>
        </div>
        <div class="goal-amounts"><strong>₹1,73,900</strong><span>of ₹1,50,000</span></div>
        <div class="goal-track over"><i style="width:100%"></i></div>
        <div class="goal-foot"><span>116% used</span><span class="over-text">₹23,900 over</span></div>
      </article>
    </div>`,
      "The thin vertical marker is <em>pace</em>: where spending should be given how much of the month has passed. It is what turns “56% used” into “56% used, and it is only the 18th”. It is hidden once over, where it no longer helps."
    ) + "\n" + section(
      "Category limits",
      `    <article class="card goal-card" style="max-width:560px">
      <div class="goal-card-head">
        <div><h2>Category limits</h2><p>Sorted by how much attention they need.</p></div>
        <button class="secondary compact" type="button">Edit</button>
      </div>
      <div class="goal-limit-list">
        <div class="goal-limit-row">
          <div class="goal-limit-name"><i class="goal-dot" style="background:var(--ref-cat-3)"></i><strong>Dining</strong></div>
          <div class="goal-limit-figure"><b>₹9,400</b><span class="over-text">₹2,400 over ₹7,000</span></div>
          <div class="goal-track over"><i style="width:100%"></i></div>
        </div>
        <div class="goal-limit-row">
          <div class="goal-limit-name"><i class="goal-dot" style="background:var(--ref-cat-2)"></i><strong>Fuel</strong></div>
          <div class="goal-limit-figure"><b>₹4,600</b><span>of ₹5,000 · 92%</span></div>
          <div class="goal-track near"><i style="width:92%"></i></div>
        </div>
        <div class="goal-limit-row">
          <div class="goal-limit-name"><i class="goal-dot" style="background:var(--ref-cat-1)"></i><strong>Groceries</strong></div>
          <div class="goal-limit-figure"><b>₹18,200</b><span>of ₹30,000 · 61%</span></div>
          <div class="goal-track"><i style="width:61%"></i></div>
        </div>
      </div>
      <div class="goal-untracked">
        <p>No limit set yet — these are not being tracked:</p>
        <div class="goal-untracked-chips">
          <span class="goal-untracked-chip">Medicine · ₹3,100</span>
          <span class="goal-untracked-chip">Education · ₹12,000</span>
          <span class="goal-untracked-chip">Temple · ₹900</span>
        </div>
      </div>
    </article>`,
      "Untracked categories are separated out rather than shown as green “within limit” cards, which is what happens today — a category with no limit currently renders identically to one comfortably under budget."
    ) + "\n" + section(
      "Warning at the moment of entry",
      `    <div class="ds-stack" style="max-width:420px">
      <div class="ds-box" style="border-radius:var(--radius-lg)">
        <div class="goal-warning near"><span>⚠</span><div>Dining is at <b>92%</b> of its ₹7,000 limit. This expense would leave ₹560.</div></div>
        <label class="field">Amount<input class="input" value="4,600"></label>
      </div>
      <div class="ds-box" style="border-radius:var(--radius-lg)">
        <div class="goal-warning over"><span>⚠</span><div>This puts Dining <b>₹2,400 over</b> its ₹7,000 limit.</div></div>
        <label class="field">Amount<input class="input" value="9,400"></label>
      </div>
    </div>`,
      "The single highest-value placement: the only moment where knowing you are near a limit can still change the outcome. Today the add-expense form never reads a limit at all, so you only discover an overspend by navigating elsewhere afterwards."
    ) + "\n" + section(
      "Nothing set yet",
      `    <article class="card goal-empty" style="max-width:560px">
      <h2>No goals set yet</h2>
      <p>Set a monthly budget, a savings goal, or a limit on the categories you want to watch. You will see progress here, and a warning before you go over.</p>
      <button class="primary" type="button">Set your first goal</button>
    </article>`,
      "New families now start with no budget and no goal by design, so this is the state most people see first."
    ),
  }),

  "components/tour.html": page({
    group: "Onboarding",
    title: "Guided tour",
    subtitle:
      "Shown once on first run, replayable from the Family tab. The overlay lives on document.body, outside #app, so it survives the full-DOM re-render the app performs on every state change.",
    body: section(
      "Tooltip",
      `    <div style="position:relative;background:var(--bg-subtle);border-radius:var(--radius-lg);padding:40px;">
      <div class="tour-tip" style="position:relative;top:auto;left:auto;margin:0 auto;" data-placement="bottom">
        <span class="tour-arrow" style="left:40px"></span>
        <p class="tour-step-count">Step 4 of 5</p>
        <h2 class="tour-title">Add an expense</h2>
        <p class="tour-body">This is the button you will use most. Tap it any time to record something you spent.</p>
        <div class="tour-actions">
          <button type="button" class="tour-skip">Skip</button>
          <div class="tour-nav-buttons">
            <button type="button" class="tour-back">Back</button>
            <button type="button" class="tour-next primary">Next</button>
          </div>
        </div>
      </div>
    </div>`,
      "The spotlight is a single element with a 9999px spread shadow, positioned from four custom properties written in one go."
    ),
  }),
};

if (CHECK) {
  let stale = 0;
  for (const [path, html] of Object.entries(FILES)) {
    let current = "";
    try {
      current = readFileSync(join(OUT, path), "utf8");
    } catch {
      /* missing counts as stale */
    }
    if (current !== html) {
      console.error(`stale: design-system/${path}`);
      stale += 1;
    }
  }
  if (stale) {
    console.error(`\n${stale} file(s) out of date. Run: node scripts/build_ds_previews.mjs`);
    process.exit(1);
  }
  console.log("design-system previews are up to date");
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [path, html] of Object.entries(FILES)) {
    const full = join(OUT, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, html);
  }
  console.log(`wrote ${Object.keys(FILES).length} previews to design-system/`);
}
