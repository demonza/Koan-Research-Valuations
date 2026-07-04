# Koan Research & Valuations — CTO Technical Audit

**Audited artifact:** `Koan-Research-Valuations-main.zip` (8 files, ~100KB) — v2.1 "DCF Workstation": `server.js` (Express, 150 lines), `public/index.html` (1,145 lines: all CSS, markup, and application JS), `schema.sql` (1 table), `package.json`/lockfile, README.
**Audit date:** 2026-07-04. Every line was read.

**Scope note.** This zip is the 10-ticker personal workstation. It does **not** contain global ticker search or moat scoring — if a larger Koan build with those features exists in another repo, this audit does not cover it. Say the word and I'll audit that one too.

---

## Executive summary

What you've built is a **genuinely good single-user instrument** — and the README knows it, stating plainly "single-user by construction." The valuation engine is correct and thoughtfully designed (three-stage with linear fade, per-share modeling via share-count drift, reverse-DCF by bisection, triangular Monte Carlo). The epistemic design — reverse DCF as the headline lens, validation chips that challenge your own assumptions, "the point estimate is the least important number on this page" — is the most distinctive thing in the repo and, frankly, rarer in this market than the math.

But the brief is *commercial SaaS*, and against that brief the verdict is unambiguous: **this is not an early version of a SaaS — it is a different species of software.** Single-tenancy is baked into every layer: one shared static key is the entire auth model, the database schema is physically incapable of storing a second user (one row, hardcoded key `"default"`), the quote cache and fallback state live in process memory, and the data source is an unofficial scraped endpoint that is legally unusable in a paid product. The path to SaaS is not a refactor of this codebase. It is a greenfield build that **extracts and reuses two assets**: the valuation engine (as a tested, pure module) and the visual/editorial identity.

That is not a criticism of the work. It's the correct diagnosis so you don't spend three months "upgrading" a foundation that can't carry the building.

---

## Scores

Each score is given against the commercial-SaaS brief. Where the personal-tool lens differs materially, it's noted — because several "low" scores reflect deliberate, documented design choices that are *right* for the tool's current job.

| Dimension | Score (SaaS lens) | Personal-tool lens | One-line justification |
|---|---|---|---|
| Overall architecture | **4 / 10** | 8 / 10 | Coherent and elegant for one user; structurally single-tenant at every layer. |
| Commercial readiness | **1 / 10** | n/a | Cannot onboard a second user. No accounts, billing, legal, or licensed data. |
| UI/UX | **7 / 10** | 8.5 / 10 | Distinctive terminal identity and exceptional explanatory microcopy; accessibility and stranger-onboarding gaps. |
| Scalability | **2 / 10** | n/a | Per-process caches, one DB row, hand-synced symbol maps, scraped quotes. Breaks at >1 instance. |
| Security | **3 / 10** | 6 / 10 | Shared static key transported in the URL, fail-open when unset, no rate limiting, no-op escape function. Mitigants: service-role key kept server-side, RLS-locked table, clean dependencies, no committed secrets. |
| Database design | **3 / 10** | 8 / 10 | For one user, a JSONB blob is the correct call (the schema comment even argues it well). For SaaS: no identity, no per-entity rows, no history, no concurrency control, unqueryable. |
| Code quality | **6.5 / 10** | — | Consistent, readable, commented with intent, graceful degradation, smart focus-preserving DOM tricks. Zero tests on a financial engine, no modules/types/lint, one no-op sanitizer landmine. |
| Maintainability | **4 / 10** | — | One 1,145-line file mixing data, prose, CSS, engine, and UI; ticker changes touch two files plus a currency map; refactors are unguarded by any test. |

---

## 1. Every weakness

**Architecture & structure**

1. The entire frontend — engine, charts, state sync, UI wiring, styles, and *content* (per-company analyst notes) — lives in one 1,145-line HTML file. Nothing is independently testable, reusable, or reviewable.
2. Two hand-synchronized sources of truth for the investable universe: `COMPANIES` (client) and `SYMBOLS` (server). A third, the `CUR` currency map, must also be updated in lockstep. The README even instructs manual editing of `SYMBOLS` — process-as-code.
3. Editorial content (the per-ticker `note` fields — genuinely good analyst commentary) is embedded as HTML strings inside a JS array. Updating a thesis means editing application code.
4. In-memory fallback state (`memState`) and the quote cache are per-process: any restart loses unsaved state in memory mode, and any horizontal scaling produces split-brain.
5. Stale branding throughout: package name `gama-research-dcf`, server log strings "Gama Research", export filename `gama-dcf-state-…`, localStorage key `mcos-key`. Three product names coexist in one repo — a symptom of change friction with no rename checklist.
6. No environment scaffolding: no `.gitignore`, no `.env.example`, no lint config, no CI, no tests, no scripts beyond `start`.

**Engine & modeling (minor, but a financial tool must disclose them)**

7. Monte Carlo perturbs only four inputs (base FCF, g₁, g∞, r) and draws them **independently** — in reality r and growth are correlated; independent draws overstate dispersion symmetry.
8. In Gordon mode the MC clamps drawn r up to g∞ + 25bp instead of rejecting the draw — a small right-tail bias in the IV distribution that isn't disclosed in the methodology notes.
9. Share-count drift compounds only through the explicit horizon; the terminal value implicitly assumes buybacks/dilution stop at year N. Defensible, but undisclosed.
10. Scenario rows silently mutate g∞ to r − 25bp when a scenario pushes r ≤ g∞ — the displayed IV then corresponds to inputs *different from those shown in the table*. In a tool whose brand is honesty, this is a self-inconsistency.

**Product**

11. No onboarding, empty states, or help for anyone who isn't the author. The tool assumes its user already holds the philosophy.
12. Error surfaces are a native `alert()` and a small text node (`sync`) that's easy to miss — including for the critical "your edits are not being saved" condition.
13. Charts have no hover tooltips or data readout; values must be inferred from axis labels.
14. Accessibility: 8.5–10px fonts throughout, `--dimmer` (#4a5a70) on #0a0e15 fails WCAG contrast, ticker tiles are click-only `div`s (no keyboard focus, no roles), sliders have no accessible value announcements.

## 2. Every bug risk

Ordered by severity × likelihood.

1. **Multi-device last-write-wins clobber.** The README advertises "open the app on your phone and your model is there," but there is no version/etag on `PUT /api/state` and `restore()` runs only at boot. Phone and desktop open simultaneously → the staler tab's next debounced save silently overwrites the other's work. This is the single most likely way you lose real analysis.
2. **Lost final edit on tab close.** Saves are debounced 800ms with no `beforeunload`/`visibilitychange` flush; close the tab inside the window and the edit is gone, with "✓ saved" from the *previous* save still displayed.
3. **Wrong-key session is fully interactive but never saves.** With a bad key the app loads defaults, every input works, every `PUT` 401s; the only signal is small grey text. Hours of tuning can be silently discarded.
4. **`fmtCur` hard-crashes the entire render loop on any unknown currency.** `CUR[c]` is undefined → property access throws inside `render()`. Adding a GBP or JPY ticker — which the README invites — bricks the app on selection.
5. **Quote currency is never validated against the model currency.** The server returns `currency` per quote; the client ignores it. A provider-side listing change (or a wrong symbol mapping) silently mixes units — the worst failure mode a valuation tool can have, because it produces *plausible* wrong numbers.
6. **Zero/empty price → division by zero.** Clearing the price field coerces to 0; upside becomes Infinity and the badge logic proudly shows "CLEARS MoS." Empty FCF/shares similarly coerce to 0 and NaN-cascade with no guard or message.
7. **Import validation is cosmetic.** Any JSON with a `store` key is accepted; malformed value shapes flow into inputs and the model. Only `JSON.parse` failures hit the alert. The `scen` check is just `length === 3`.
8. **No timeout on upstream Yahoo fetches.** Node's fetch has no default timeout; one hung socket holds `/api/quotes` open indefinitely (allSettled waits for all ten).
9. **Thundering herd on cold cache.** No in-flight request dedup: N concurrent cold hits fire 10 upstream requests *each* — the fastest way to get the server IP rate-limited by Yahoo, which then breaks quotes for the sole legitimate user.
10. **Partial-failure caching.** If ≥1 quote succeeds, the whole result — including per-ticker error objects — is cached for 10 minutes; transient failures become sticky.
11. **`daysSince` timezone off-by-one.** `new Date(iso + "T00:00:00")` parses local midnight and compares against `Date.now()`; staleness pills can flip a day early/late across timezones — cosmetic, but it drives the AGING/STALE warnings.
12. **Bisection NaN bias.** In `impliedG1`, if the model returns NaN mid-search, `NaN < px` is false → the bracket collapses toward `hi` silently rather than reporting an invalid regime.
13. **Orphan state.** Tickers removed from `COMPANIES` leave dead entries in `store` forever (harmless today; unbounded in principle).
14. **Dead code signals drift.** `renderScenarios(p, base)` never uses `base`; the waterfall's connector `if/else` branches are byte-identical. Neither is a bug; both are the sediment refactors-without-tests leave behind.

## 3. Every scalability problem

1. **The database cannot represent a second user.** One row, key hardcoded to `"default"` in `server.js`. This is the hardest constraint in the system.
2. **The credential cannot represent a second user.** One static shared key; no identity, sessions, or authorization concept to scale onto.
3. **Per-process state.** Quote cache and `memState` live in the Node process — a second instance (or a Railway restart) produces inconsistent or lost data. Correctness, not just performance, breaks at >1 replica.
4. **Fixed, duplicated universe.** Ten symbols hardcoded on both client and server; no search, no dynamic instruments, no per-user universes.
5. **Scraped quotes.** Yahoo's unofficial chart endpoint has no SLA, IP-level throttling, and — decisive for SaaS — no license. It cannot survive commercial volume technically or legally.
6. **1MB request cap doubles as the total account-state ceiling** (all tickers' state ships in every save).
7. **Full-rebuild rendering.** Every keystroke rebuilds tables and charts via innerHTML string concatenation and recomputes ~150 model evaluations. Fine at today's size (single-digit milliseconds), but the pattern caps feature complexity; heavier simulation belongs in a worker.
8. **No queueing or backpressure** on outbound fetch bursts; the quotes route is the amplification point.

## 4. Every security issue

1. **Auth is a single static shared secret.** No user identity, no rotation story, no revocation short of redeploying an env var.
2. **The secret travels in the URL** (`?key=…`): it lands in browser history, Railway edge/access logs, any intermediary logs, and any screenshot of the address bar — then persists in `localStorage`, readable by any future XSS.
3. **Fail-open by design.** No `WORKSTATION_KEY` → all read/write endpoints are public. Documented for local dev, but one forgotten env var away from a world-writable production instance.
4. **`/health` advertises the weakness**: it returns `auth: false` on unprotected instances — a scanner's dream field.
5. **No rate limiting anywhere.** Key brute-force is unthrottled; `/api/quotes` lets any holder (or, on a keyless instance, anyone) trigger outbound request bursts.
6. **Non-constant-time key comparison** (`===` on the header). Timing attacks are a stretch at this scale; noted for completeness because the fix is one standard-library call.
7. **`esc()` is a no-op** — `return String(s)` — yet is used as the sanitizer for all SVG text. Every current call site is program-generated, so **there is no exploitable XSS today**, but this is a loaded gun: the moment any user-controlled string (a custom ticker name, a user note — i.e., the first SaaS feature) reaches `svgText` or the many innerHTML sinks, stored XSS is live. A sanitizer that doesn't sanitize is worse than none, because readers trust the name.
8. **`PUT /api/state` persists arbitrary JSON up to 1MB with no schema validation.** Garbage round-trips into the client; in a multi-user future this becomes a stored-payload and storage-abuse vector.
9. **No security headers**: no CSP, no `frame-ancestors`/X-Frame-Options, no nosniff, no HSTS at the app layer (TLS is delegated entirely to Railway's edge).
10. **Single god-credential to the database.** The service-role key bypassing RLS is a sound pattern for this tool, but it means one leaked env var equals full data access, and the pattern cannot extend to multi-tenant.
11. **CSRF footnote (currently fine):** the custom `x-workstation-key` header incidentally provides CSRF protection. If auth ever moves to cookies without tokens, that protection silently disappears.
12. **Legal exposure as a security-adjacent risk:** redistributing scraped Yahoo market data in a paid product violates ToS and exchange licensing norms. For a commercial launch this is a lawyer-letter risk, not a hypothetical.

**Genuinely good security decisions, for the record:** service-role key server-side only; RLS enabled with no policies so the anon key is inert; dependencies current and post-CVE (verified in the lockfile: express 4.22.2, body-parser 1.20.5, cookie 0.7.2, path-to-regexp 0.1.13); no secrets committed; supabase-js parameterization leaves no SQL-injection surface; JSON body size capped.

## 5. Every file that should be refactored

1. **`public/index.html`** — decompose into: a pure valuation-engine module (`growthPath`, `model`, `impliedG1`, MC — zero DOM dependencies); a formatting module; a chart module; a state/sync module; UI wiring; a stylesheet; and the company data + notes as *content*, not code. This one file is 90% of the refactor surface.
2. **`server.js`** — split auth middleware, state routes, and a quote-provider adapter behind an interface; move `SYMBOLS` into shared configuration consumed by both tiers; add timeout, in-flight dedup, and rate limiting.
3. **`package.json`** — rename off "gama", add lint/test scripts and dev tooling.
4. **`schema.sql`** — not refactored but *superseded* for SaaS (see §9); for the personal tool, add an `updated_at`-based concurrency check to `PUT`.
5. **`README.md`** — split operator docs from user docs once there are users who aren't the operator.

## 6. Technical debt, ranked highest → lowest

1. **Zero automated tests on the valuation engine.** Real capital-allocation decisions ride on `model()`; any refactor, and this entire roadmap, is blind without a golden-master suite. Highest-leverage item in the repo.
2. **The identity/authorization model** (shared static key). Blocks every commercial requirement downstream.
3. **The monolithic frontend file.** Blocks testing, reuse of the engine, and any parallel or AI-assisted workstream that touches two features at once.
4. **Triplicated universe definitions** (`COMPANIES` / `SYMBOLS` / `CUR`) with a crash-on-miss currency map.
5. **Unofficial market-data dependency** — reliability *and* legal debt simultaneously.
6. **State concurrency** — last-write-wins with no versioning or history in a tool whose product thesis is decision discipline.
7. **No CI, lint, or types** — every change ships on vibes.
8. **The no-op `esc()` and pervasive innerHTML string-building** — latent XSS pattern plus untestable rendering.
9. **Branding drift** (gama/mcos/Koan) — trivial effort, user-visible (it's in the export filename).
10. **Dead code** (unused params, duplicate branches) — cosmetic, but the smoke that indicates item 1's fire.

## 7. Missing functionality required before charging customers

**Identity & tenancy:** signup/login, email verification, password reset, session management; per-user data isolation enforced in the database, not the application.
**Billing:** checkout, plan entitlements and gating, invoices, cancellation/self-serve portal, webhook handling — plus **EU VAT**. As a Portuguese sole operator, seriously evaluate a merchant-of-record (Paddle / Lemon Squeezy) over raw Stripe: they become the seller and handle VAT OSS across the EU, which is otherwise a real administrative tax on a solo founder.
**Data:** licensed quotes *and* fundamentals with redistribution rights; arbitrary ticker search; currency handling driven by instrument data rather than a hardcoded five-entry map.
**Legal & compliance:** Terms of Service, Privacy Policy, GDPR machinery (DPA with Supabase, data export, account deletion), a properly framed "not investment advice / not a regulated service" disclaimer reviewed once by a lawyer — an analytics tool generally stays outside MiFID scope, but that's a conclusion to buy, not assume.
**Reliability & ops:** error tracking, uptime monitoring, structured logs, verified backups/restore, staging environment, CI/CD.
**Product table stakes:** onboarding and empty states, docs/help, a support channel, state history/undo, working multi-device behavior (the current clobber bug becomes a paying customer's ruined weekend).
**Security:** rate limiting, security headers, real input validation, secrets hygiene per environment.
**Quality:** the engine test suite; cross-browser and accessibility passes.

## 8. Recommended project architecture

**Strategic frame first.** Two decisions dominate everything below:

- **Freeze, don't evolve, the workstation.** It is the live instrument managing your own capital. Keep it running untouched; build the SaaS greenfield and migrate yourself onto it as customer #1 via the existing JSON export.
- **Extract the two real assets:** (a) the valuation engine as a pure, typed, tested package with no DOM dependencies — the same functions then serve the web app, and later an API tier if one ever makes sense; (b) the visual/editorial identity — the terminal aesthetic and the honesty apparatus (reverse-DCF headline, validation chips, methodology prose). Port the hand-rolled SVG charts as components rather than adopting a chart library; the look is a brand differentiator and the functions are small.

**Recommended shape:** Next.js (React, App Router) as the application; Supabase for Auth and Postgres with RLS as the *actual* authorization layer — the browser talks to the database under the user's own JWT, and the service-role key exits the request path entirely. Thin server routes exist only for what must be server-side: the market-data provider proxy, Stripe/MoR webhooks, and scheduled jobs. Market data goes behind a provider-adapter interface (FMP, EODHD, or Finnhub as the first implementation) so the vendor is swappable and symbols are provider-agnostic. This stack is also, pragmatically, the one with the deepest AI-assistance corpus — which matters given how this product actually gets built.

**Product-philosophy note as architecture:** keep "fundamental anchors are updated by *you* reading the filing" as a first-class concept — autofill from the data provider, but with provenance and a manual-override that the UI visibly respects. Competitors sell data firehoses; this tool's differentiator is *discipline*. The snapshot history in §9 is that philosophy turned into schema.

## 9. Recommended database architecture

Described structurally (no DDL, per the brief):

- **`profiles`** — one row per auth user: plan, billing customer reference, timestamps. 1:1 with the managed auth users table.
- **`instruments`** — shared, read-only reference data: canonical symbol, exchange, display name, trading currency, provider symbol mappings. Kills the triplicated maps and the `fmtCur` crash class at the schema level.
- **`valuations`** — one row per user per model: owner, instrument reference, currency, an **inputs JSONB column** (JSONB remains exactly right for assumption sets — flexible, schemaless where the model evolves), the user's own thesis notes (treated as untrusted input and sanitized on render), timestamps, and an integer **version for optimistic concurrency** — a stale write is rejected and surfaced, which converts today's silent multi-device clobber into a visible, resolvable conflict.
- **`valuation_snapshots`** — append-only: inputs plus computed outputs (IV, price at the time) captured at save points. This is the audit trail — "what did I believe in March, at what price" — and it is simultaneously the product's most defensible feature and the thing the current schema structurally cannot do.
- **`quotes_cache`** — one row per symbol: price, currency, as-of, fetched-at. A database-backed shared cache written by a scheduled job, replacing the per-process cache and eliminating the thundering-herd path by construction (user requests never trigger upstream calls).
- **`fundamentals_cache`** — per symbol per fiscal period: normalized columns for FCF, shares, net debt, plus the raw provider payload for audit.
- **Row-Level Security:** owner-only policies on `valuations` and `valuation_snapshots`; authenticated read on `instruments` and the caches. RLS is the tenancy boundary — the application never has to be trusted to filter.
- **Operational:** updated-at triggers, migrations versioned in git, point-in-time recovery on a paid tier, and a periodic logical export — with one actual restore drill before launch, because an unrehearsed backup is a hypothesis.

## 10. Recommended deployment architecture

- **Hosting:** Vercel for the Next.js app (previews per PR, edge TLS/HSTS) + managed Supabase for Postgres/Auth. Railway remains viable if single-platform comfort matters more; Vercel is the lower-friction default for this stack.
- **Environments:** local (Supabase CLI) → staging project → production project, with separate secrets per environment held in platform vaults; the service-role key never appears in any client bundle or request path.
- **CI/CD:** GitHub Actions running typecheck, lint, and the engine test suite on every push; preview deploys per PR; migrations applied through the pipeline, not by hand in a SQL editor.
- **Scheduled jobs:** quote refresh (and periodic fundamentals refresh) via cron into the cache tables.
- **Observability:** Sentry on client and server, an external uptime monitor, structured request logs, and webhook signature verification on the billing integration.
- **Hygiene:** security headers via framework config; a `/health` that reports liveness without advertising its own auth posture.

## 11. Roadmap in implementation sprints

Two-week sprints, sized for one person building AI-assisted alongside a full-time job. **Sprint 0 is a gate, not a formality** — its output decides whether Sprints 2–6 happen at all.

**Sprint 0 — Decision gate + harden the tool you actually use (1 week).**
Commercial research: competitor scan (AlphaSpread, TIKR, Simply Wall St, Fiscal.ai, GuruFocus, Wisesheets — several sell adjacent or overlapping products today), a pricing hypothesis, and — decisively — data-provider quotes with *redistribution* terms, because data licensing cost versus indie price point is the single variable most likely to kill the business model on paper. Output: a one-page go/no-go.
In parallel, five hardening fixes to the personal instance regardless of the verdict: stop passing the key in the URL; rate-limit and timing-safe-compare the auth; remove the auth flag from `/health`; add upstream fetch timeouts and in-flight dedup; add an updated-at guard on state saves and a flush-on-hide so the phone/desktop clobber and the lost-last-edit bugs die now.

**Sprint 1 — Extract the crown jewel.** Pull the engine into a pure, typed module and write a golden-master test suite that locks today's exact numeric outputs across all ten tickers plus edge regimes (r ≤ g∞, negative growth, exit-multiple mode, zero fade). Repo hygiene: rename off "gama", lint, CI. From this point, every future change is verifiable.

**Sprint 2 — Greenfield foundation.** New app scaffold, Supabase Auth, the §9 schema with RLS and migrations, and the visual shell ported for a single instrument under a logged-in user. Definition of done: two different accounts see only their own data, enforced by the database.

**Sprint 3 — The universe opens.** Valuations CRUD, ticker search through the provider adapter, quotes served from the cron-fed cache, currency handling driven by instrument data. Definition of done: value any listed company, not ten.

**Sprint 4 — Anchors with provenance.** Fundamentals autofill with visible source/date and manual override (the philosophy, preserved), snapshot history with a compare view, and an importer for the workstation's JSON export — you migrate yourself as user #1.

**Sprint 5 — Money and law.** Merchant-of-record (or Stripe + Stripe Tax) integration, plan gating, rate limits, ToS/Privacy/GDPR export-and-delete, transactional email. Definition of done: a stranger can pay, use, and leave lawfully.

**Sprint 6 — Beta.** Observability wired, a restore drill passed, onboarding and docs written, accessibility/cross-browser pass, then 10–20 beta users recruited from value-investing communities, with a feedback loop.

**Post-beta (~4 weeks):** iterate on what beta users actually hit, then a launch checklist.

**Timeline honesty:** the sprint math says ~3.5 months; with a day job, a band, a degree conferring, and FMM season, plan for **5–6 calendar months** to a chargeable product — and treat Sprint 0's licensing-cost finding as permission to stop early if the unit economics don't clear.

---

## Closing judgment

The engine is sound, the epistemics are the brand, and the README's self-awareness is a leading indicator of good engineering judgment. The codebase's "failures" against SaaS criteria are mostly deliberate scope decisions, correctly made for a different product. The three findings I'd act on even if the SaaS never happens: the multi-device clobber, the key-in-URL transport, and the absence of any test on a model that prices your own portfolio. The one strategic finding that outranks everything technical: **run Sprint 0 before writing a line of the new build** — in this market, the moat candidate is the discipline-and-history product wrapped in this visual identity, not the DCF arithmetic, and the data-licensing line item is the make-or-break number.
