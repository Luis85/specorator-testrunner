# Design System Review — Specorator Testrunner

**Scope:** the cross-cutting visual look-and-feel every surface shares — `styles.css` (1585 lines), the shared presentation primitives, and how views apply classes.
**Mandate:** a **bold redesign** with a *native + light identity* — stay theme-compatible via Obsidian CSS variables, but introduce a subtle, consistent Specorator identity (a real design system) that aids hierarchy and recognition.
**Constraint:** zero raw HTML (`createEl`/`createDiv` only); eslint forbids `as` casts and `!`; colours flow from Obsidian CSS vars; desktop-only.

---

## 1. Current state — the existing visual system

The plugin already has a **disciplined, theme-native CSS layer**. It is not chaotic — it is *under-systematised*: lots of good local decisions, no shared vocabulary tying them together.

### 1.1 Structure of `styles.css`
One flat file, sectioned by feature/wave with `── header ──` comment banners, roughly in build order:

| Lines | Section |
|---|---|
| 8–53 | KPI tiles (incl. colour-blind `[data-status]` border accents) |
| 55–106 | Tables (runs / suites / use-cases share one rule group) |
| 119–162 | Link-as-button + documentation action buttons |
| 164–243 | Test Console (banner, output, stderr, cmd) |
| 245–291 | Init wizard progress / error boxes |
| 293–398 | Settings (env blocks, validation errors, checklist rows) |
| 400–489 | Console toolbar + per-row run buttons |
| 491–661 | Dashboard hub (init CTA, topbar, env badge, quick actions, onboarding) |
| 663–833 | Use Case detail (status pills, feature cards, wip/quarantine badges, tag preview) |
| 835–886 | Evidence explorer + Guided Tour |
| 888–990 | Feature Editor |
| 992–1083 | PRD explorer + roadmap |
| 1084–1269 | Story Maps explorer cards |
| 1271–1585 | Story Map **board** (SVG) |

### 1.2 De-facto component vocabulary (what already exists)
- **Buttons:** Obsidian `mod-cta` (primary) + plugin one-offs (`*-doc-button`, `*-quick-button`, `*-run-button`, `*-onboarding-button`, `*-settings-inline-button`, `*-console-action`). Each re-declares the *same* `:focus-visible` ring.
- **Link-buttons:** `e2e-test-hub-link-button` (styles.css:121) — chrome-stripped `<button>` that looks like an accent link. The canonical "open this artifact" affordance.
- **KPI tiles:** `e2e-test-hub-kpi-tile` (17, 589) — bordered card, `[data-status]` left-border accent, doubles as a `<button>`.
- **Tables:** runs/suite/uc share one rule (57–106); `[data-status]` colours status cells.
- **Banners:** console banner (166) + feature-editor banner (896) — *different* implementations of the same idea.
- **Error/result boxes:** `*-error` (268), `*-settings-errors` (334), `*-settings-result` checklist rows (357) — the recurring "red-on-red fix" pattern (subtle bg + error border + error text).
- **Status pills:** `*-uc-detail-status` (689), `*-prd-status` (1024), `*-story-map-status` (1228) — **three near-identical pill implementations**.
- **Badges/chips:** `*-wip-badge`/`*-quarantine-badge` (797), `*-story-map-chip` (1179), `*-env-badge` (524).
- **Bordered panels:** init-cta (499), onboarding (620), env-block (297), prd-roadmap (1056), story-map-card (1104) — same `border + radius-m + background-secondary` recipe, five times.
- **Empty/loading/error states:** `renderLoadError` helper (modal-helpers.ts:46) is the one good consolidation; empty states are otherwise ad-hoc muted `<p>` / `*-uc-detail-empty` (721).
- **Checklist rows:** a genuinely shared system — `ChecklistRow` view-model (settings-rows.ts) + `✓/✗/!/–/…` icon vocabulary (settings-rows.ts:27) + `[data-status]` colours, reused by wizard, settings, and UC detail.

### 1.3 Conventions worth preserving
- **`[data-status]` reinforcement pattern** — colour is *never* the only signal; text/icon/border-position always carry it too (styles.css:42–46, 85–88, 356). This is genuinely good colour-blind-safe work; the redesign must keep it.
- **`:focus-visible` rings everywhere** — 2px `--interactive-accent` outline, offset 2px (137–141 and ~12 copies). Universal keyboard affordance.
- **Token fallbacks** — every Obsidian var has a literal fallback: `var(--size-4-3, 12px)`, `var(--radius-m, 8px)`. Resilient if a theme omits a var.
- **Pure view-models** — `dashboard-rows.ts`, `settings-rows.ts`, `use-case-detail-rows.ts` shape projections (incl. `aria-label`s) out of the views, so the DOM layer is thin.

---

## 2. Pain points & inconsistencies (evidence-backed)

### Severity: HIGH

**H1 — No identity at all; the system is "Obsidian default, slightly arranged."**
There is no accent treatment, no signature colour, no consistent elevation/spacing rhythm that says "Specorator." Everything is `--background-secondary` + `--background-modifier-border`. The product is indistinguishable from any other plugin. *(Whole file — the absence is the finding.)*

**H2 — Three duplicated "status pill" implementations.**
`*-uc-detail-status` (689–709), `*-prd-status` (1024–1042), `*-story-map-status` (1228–1246) are the same component with cosmetic drift: PRD/story-map pills are `text-transform:uppercase` + `letter-spacing` + bordered; the UC pill is lowercase + filled, no border. Same semantic ("a status"), three looks.

**H3 — Five copies of the "bordered panel" recipe.**
`border:1px + radius-m + background-secondary + padding` at lines 499, 620, 297, 1056, 1104. No `--card` token, so a future radius/elevation change is a five-place edit.

**H4 — Button focus-ring + cursor declared ~12 times.**
Identical `:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; border-radius: var(--radius-s) }` block copied at 137, 158, 394, 444, 485, 544, 580, 650, 1147, 1218 (and `cursor:pointer` at 154, 416, 480, 578, 648…). One drift already exists: the board uses `--text-accent` not `--interactive-accent` (1525).

### Severity: MEDIUM

**M1 — Class-prefix scheme is inconsistent (three prefixes + bare classes).**
Dominant `e2e-test-hub-*`, but the Story Map board uses `sm-board-*` (1271+) and the explorer uses `e2e-test-hub-story-map-*` — two prefixes for one feature. Worse, several modals emit **unprefixed classes that do not exist in `styles.css`**: `error-text`, `button-container`, `scope-items`, `scope-item`, `prd-summary` (prd-builder-modal.ts:139,289,350,357), `story-map-items`/`story-map-summary` (story-map-builder-modal.ts), `setting-item-description` (reusing an Obsidian internal class). These render unstyled or lean on undocumented Obsidian internals.

**M2 — The plugin id/prefix is legacy.** manifest id is `e2e-test-hub` and every class is `e2e-test-hub-*`, but the **product is "Specorator Testrunner"** (manifest name, CONTEXT.md). The naming no longer matches the brand — a rename opportunity the redesign should seize.

**M3 — Magic numbers not from tokens, concentrated in the SVG board.**
Hardcoded `font-size: 9px/10px/11px/12px` (1337,1355,1363,1382,1463,1473,1484,1584), `width/height: 28px` (1199), `0.12s`/`0.1s` transition durations (~10 places), `drop-shadow(0 2px 5px rgba(0,0,0,0.28))` (1535), `opacity: 0.5/0.55/0.6/0.7/0.85` scattered. None reference a token, so "the board" has its own un-systematised type/motion scale.

**M4 — Hardcoded card-ink + pastel hexes.**
`--sm-card-ink, #1a1a22` (1330), `rgba(26,26,34,0.62)` (1336), and the five pastel card hexes in `story-map-card.ts:17–21` + a second 6-colour `CARD_PALETTE` hex array in `story-map-board-view.ts:210`. These are deliberate (pastels must stay light in both themes for dark-ink contrast — comment at 1327), but they are the **one place the plugin hard-codes brand colour**, and there are *two* uncoordinated palettes.

**M5 — Two banner implementations.**
Console banner (166, with `[data-status]` states) vs feature-editor banner (896, a plain warning box). Same UI idiom, no shared class.

**M6 — Spacing rhythm leans on two scales.** `--size-4-*` (107 uses) is the workhorse, but `--size-2-*` (24 uses) is mixed in for "tight" contexts (feature editor, story-map chips) with no documented rule for *when* to use which — so gaps drift (e.g. `--size-2-3` vs `--size-4-2` both used as "8px").

### Severity: LOW

**L1 — No `prefers-reduced-motion` guard.** Zero `@media` queries in the file, yet there are transitions/`filter` drop-shadow animations on cards and board (1113, 1208, 1496, 1531). The hover drop-shadow + drag opacity animate unconditionally.

**L2 — No `prefers-contrast` / forced-colors handling.** The colour-blind work is solid, but high-contrast/forced-colors mode isn't addressed.

**L3 — `--text-warning` fallback chain is verbose and repeated.** `var(--text-warning, var(--text-muted))` appears ~6 times; `--text-error, var(--text-warning, var(--text-muted))` once (811). A local token would read better.

**L4 — Heading hierarchy is inline, not tokenised.** `h2/h3/h4` come straight from the theme; section spacing (`margin: 0 0 var(--size-2-2)`) is set per-place (630, 1063) rather than via a heading rhythm.

---

## 3. Proposed design system — *native + light identity*

**Principle:** layer a thin Specorator token sheet *on top of* Obsidian vars. Never replace a theme var — derive from it. Identity comes from **one accent, consistent elevation, one spacing rhythm, and a small set of canonical components** — not from new colours that fight the theme.

### 3.1 Design tokens (a `:root` block at the top of `styles.css`)

```css
/* Specorator design tokens — layered ON TOP of Obsidian vars.
 * Every token derives from a theme var so light/dark/custom themes still drive it.
 * The literal fallback keeps the plugin styled if a theme omits the base var. */
.theme-light, .theme-dark, :root {
  /* — Identity accent — the single Specorator signature.
   * DECIDED (§0/T2): defaults to a Specorator brand teal (a contrast-tuned literal),
   * NOT the theme accent. It is its own token, so falling back to the theme accent
   * is a one-line override, not a refactor. (Example values shown here are illustrative;
   * the shipped values live in styles.css / A1.) */
  --spec-accent:            #0f766e;  /* Specorator brand teal (T2 default, NOT the theme accent) */
  --spec-accent-hover:      #115e54;  /* per-theme contrast overrides live in A1 / styles.css */
  --spec-on-accent:         #ffffff;

  /* — Spacing rhythm (one scale, named by intent, mapped to Obsidian sizes) — */
  --spec-space-1: var(--size-4-1, 4px);   /* hairline gaps, chip padding */
  --spec-space-2: var(--size-4-2, 8px);   /* default control gap */
  --spec-space-3: var(--size-4-3, 12px);  /* panel padding */
  --spec-space-4: var(--size-4-4, 16px);  /* section rhythm */

  /* — Radius — */
  --spec-radius-chip: var(--radius-s, 4px);
  --spec-radius-card: var(--radius-m, 8px);

  /* — Elevation (the ONE place shadows live) — */
  --spec-elev-0: none;
  --spec-elev-1: 0 1px 2px rgba(0,0,0,0.10);
  --spec-elev-2: 0 2px 5px rgba(0,0,0,0.28);   /* current board hover shadow */

  /* — Motion — */
  --spec-motion-fast: 120ms;
  --spec-ease: ease;

  /* — Accent treatment: the Specorator "spine".
   * A 3px accent edge is the recurring identity cue — panels, active states,
   * the dashboard rail all share it. */
  --spec-spine-width: 3px;

  /* — Semantic status (alias the reinforcement vars in one spot) — */
  --spec-status-pass:  var(--text-success);
  --spec-status-fail:  var(--text-error);
  --spec-status-warn:  var(--text-warning, var(--text-muted));
  --spec-status-idle:  var(--text-muted);
}

@media (prefers-reduced-motion: reduce) {
  :root { --spec-motion-fast: 0ms; }
}
```

### 3.2 The Specorator accent treatment (the *light identity*)
One recognisable, theme-safe motif applied consistently:

1. **The accent spine.** A `--spec-spine-width` left edge on panels/cards that is **transparent by default and lights to `--spec-accent` on hover/active.** The Story Map explorer card *already does exactly this* (styles.css:1110 `border-left: 2px solid transparent` → 1121 accent on hover). **Promote it to the house style** for every panel (KPI tiles, roadmap, onboarding, env blocks). This is the cheapest, most distinctive move and it is already proven in-codebase.
2. **One accent, used sparingly** — links, primary CTAs, focus rings, active tour step, KPI hover, progress bars all draw `--spec-accent`. No second hue.
3. **Brand tint — DECIDED: default Specorator hue, not opt-in** (supersedes this report's original opt-in-default recommendation; see `00-redesign-plan.md` §0/T2 and the as-shipped A1). Ship `--spec-accent` defaulting to a **Specorator brand teal** (a single adjustable, contrast-tuned token), *not* the theme accent. A settings toggle may still let a user fall *back* to their theme accent, but the shipped default is the brand hue. **Implementers: follow the §0/T2 decision, not the earlier opt-in framing anywhere in this report.**

### 3.3 Canonical component library (consolidate the duplicates)

| Component | Canonical class | Replaces | Spec |
|---|---|---|---|
| **Panel** (card surface) | `.spec-panel` | init-cta, onboarding, env-block, prd-roadmap, story-map-card | `border + --spec-radius-card + bg-secondary + --spec-space-3`; `border-left: --spec-spine-width solid transparent`; `:hover` lights the spine + `--spec-elev-1` |
| **Button (base)** | `.spec-btn` + modifiers `.is-primary`/`.is-link`/`.is-icon`/`.is-danger` | doc/quick/run/onboarding/console-action one-offs | one focus-ring + cursor rule, declared **once** |
| **Link-button** | `.spec-btn.is-link` | `e2e-test-hub-link-button` | keep current look (121–141), now a modifier |
| **KPI tile** | `.spec-tile` | `e2e-test-hub-kpi-tile` | a `.spec-panel` variant with centred value/label |
| **Table** | `.spec-table` | runs/suite/uc tables | already shared (57–106); just rename + tokenise |
| **Banner** | `.spec-banner[data-status]` | console-banner + feature-editor-banner | one impl; `[data-status]` drives the left-border + tint (keep the red-on-red fix at 194–199) |
| **Status pill** | `.spec-pill[data-status]` | uc-detail-status, prd-status, story-map-status | **one** pill; pick the bordered-uppercase look (1024) as canonical |
| **Chip/badge** | `.spec-chip` (`.is-wip`/`.is-quarantine`) | wip/quarantine badge, story-map-chip, env-badge | tiny pill, `--spec-radius-chip`, `--spec-space-1` |
| **Checklist row** | keep `ChecklistRow` + `.spec-check[data-status]` | already shared — just rename | the model + icon vocab (settings-rows.ts:27) is the template for *all* status surfaces |
| **Empty state** | `.spec-empty` + a `renderEmptyState()` helper | scattered muted `<p>`, uc-detail-empty | muted, centred, italic; pair with `renderLoadError` as a sibling primitive |

**Layering example — KPI tile after consolidation:**
```css
.spec-panel {
  padding: var(--spec-space-3);
  border: 1px solid var(--background-modifier-border);
  border-left: var(--spec-spine-width) solid transparent;
  border-radius: var(--spec-radius-card);
  background-color: var(--background-secondary);
  transition: border-color var(--spec-motion-fast) var(--spec-ease),
              box-shadow var(--spec-motion-fast) var(--spec-ease);
}
.spec-panel:hover { border-left-color: var(--spec-accent); box-shadow: var(--spec-elev-1); }

.spec-tile { /* extends .spec-panel */ display: flex; flex-direction: column;
  align-items: center; gap: var(--spec-space-1); text-align: center; cursor: pointer; }
.spec-tile[data-status="passing"] { border-left-color: var(--spec-status-pass); }
.spec-tile[data-status="failing"] { border-left-color: var(--spec-status-fail); }
```
Note this *unifies* the spine motif: the same left edge that carries hover-accent carries the colour-blind status accent — one mechanism, two jobs.

### 3.4 Motion & interaction guidelines
- All transitions use `--spec-motion-fast` + `--spec-ease`; **never** a raw `0.12s` again. Reduced-motion zeroes the duration via the one `@media` block (§3.1) — fixes L1 globally.
- Hover = spine-accent + `--spec-elev-1`. Drag = `--spec-elev-2` + `opacity` (board already does this; route through tokens).
- Focus = the single `.spec-focus` ring rule; board switches from `--text-accent` to `--spec-accent` to kill the drift (1525).

### 3.5 Naming & consolidation strategy
- **New prefix `spec-`** for the design-system primitives (panel/btn/tile/pill/chip/table/banner/check/empty). Short, on-brand, replaces the legacy `e2e-test-hub-` for shared components.
- **Keep `e2e-test-hub-` as the manifest id** (renaming the plugin id is a breaking migration — out of scope), but migrate *class names* feature-by-feature behind the `spec-` primitives.
- **Collapse `sm-board-` vs `e2e-test-hub-story-map-`** to one `spec-storymap-` namespace.
- **Fix the unprefixed/undefined classes** (M1): give `error-text`, `button-container`, `scope-items`, `prd-summary`, etc. real `spec-` classes with real rules, or delete them.
- Migration order: tokens first (purely additive, zero visual change) → primitives (`.spec-panel/.spec-btn/.spec-pill`) → swap classes in views feature-by-feature → delete dead rules.

---

## 4. Prioritized recommendations

| # | Recommendation | Impact | Effort | Risk | Dependencies |
|---|---|---|---|---|---|
| R1 | Add the `:root` token sheet (§3.1) — spacing/radius/elevation/accent/motion, additive | H | L | Low — purely additive, no visual change | none |
| R2 | Add `prefers-reduced-motion` block + route all durations through `--spec-motion-fast` (fixes L1) | M | L | Low | R1 |
| R3 | Introduce `.spec-panel` + adopt the **accent-spine** as the house identity motif (§3.2) | H | M | Low | R1 |
| R4 | Consolidate buttons into `.spec-btn` + modifiers; declare focus-ring/cursor **once** (fixes H4) | H | M | Med — touches every view's `cls:` | R1 |
| R5 | Unify the three status pills into one `.spec-pill[data-status]` (fixes H2) | M | M | Low | R1 |
| R6 | Unify banners + the bordered-panel recipe (fixes H3, M5) into `.spec-panel`/`.spec-banner` | M | M | Low | R3 |
| R7 | Tokenise the SVG board: board type scale, `28px`, durations, elevation, palettes (fixes M3, M4) | M | M | Med — SVG inline attrs + TS hex arrays | R1 |
| R8 | Collapse `sm-board-`/`e2e-test-hub-story-map-` → `spec-storymap-`; fix unprefixed/undefined classes (fixes M1) | M | M | Med — coordinate TS `cls:` + CSS | R3 |
| R9 | Add a `renderEmptyState()` primitive + `.spec-empty`, sibling to `renderLoadError` | L | L | Low | none |
| R10 | **DECIDED: ship `--spec-accent` defaulting to the Specorator brand teal** (not opt-in; §0/T2 — done in A1). An *optional* toggle to fall back to the theme accent is a nice-to-have, not the default. | M | M | Med — theme-compat testing across light/dark | R1, R3 |
| R11 | Add `prefers-contrast`/forced-colors hardening (L2) | L | M | Low | R1 |

**Suggested first slice (low-risk, high-signal):** R1 → R2 → R3. Tokens + reduced-motion + the accent spine give immediate, visible identity with near-zero regression risk before touching the higher-churn button/pill consolidations.

---

## 5. Open questions for the product owner

1. ~~**Brand colour**~~ — **DECIDED (§0/T2): a real Specorator hue (teal) as the *default***, not native-only and not opt-in. Shipped in A1.
2. ~~**Plugin id rename**~~ — **DECIDED (§0/T2): keep the plugin id `e2e-test-hub`** (renaming it is a breaking settings/data-path migration — out of scope). The redesign renames only **classes (`spec-*`) and UI copy/wordmark** to "Specorator"; do **not** touch the manifest id or migrate the data path.
3. **Class-prefix churn:** OK to migrate `e2e-test-hub-*` → `spec-*` for shared primitives now (one big-ish PR series), or stage it so existing snapshot/integration tests that assert class names migrate incrementally?
4. **The accent spine as house style:** is the left-edge accent (proven on Story Map cards) the identity motif you want everywhere, or do you prefer a top-border / corner-mark / icon-lockup signature?
5. **Story Map pastels:** the five card-type hexes are the only true brand colours and must stay light in both themes (dark-ink contrast). Should these become *the* Specorator palette seed, or stay isolated to the board?
6. **Density:** desktop-only — do you want a slightly more generous spacing rhythm (more "product," less "dense plugin"), or keep Obsidian-native density?
