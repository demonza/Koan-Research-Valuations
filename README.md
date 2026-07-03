# Gama Research — DCF Workstation

Three-stage DCF · reverse DCF · Monte Carlo · scenario weighting · **live quotes** · **Supabase-persisted state**.

Same engine and interface as the static v2, now served by a small Express app that does the two things a static file can't:

1. **Live prices** — the server fetches quotes for all 10 tickers (US + SIX + Euronext + BME + Copenhagen + Stockholm) server-side, so there's no browser CORS problem. 10-minute cache. One `↻ Live prices` click updates every ticker's price and freshness date.
2. **Persistent state** — every assumption you change (per-ticker inputs, scenarios, price dates) is debounced and saved to Supabase. Open the app on your phone and your model is there.

The server boots with **zero configuration** (in-memory state, no auth) so you can test locally first, then add Supabase and the auth key when deploying.

---

## 1 · Run locally (2 minutes)

```bash
npm install
npm start
# → http://localhost:3000
```

That's it. State lives in memory (lost on restart), quotes work immediately.

## 2 · Supabase (5 minutes)

1. [supabase.com](https://supabase.com) → New project (free tier is plenty — this stores one JSON row).
2. SQL Editor → paste the contents of `schema.sql` → Run.
3. Project Settings → API → copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (secret) → `SUPABASE_SERVICE_ROLE_KEY`

The service-role key stays on the server only. RLS is enabled with no policies, so the public anon key can't touch the table.

## 3 · Railway (5 minutes)

**Via GitHub (recommended — auto-deploys on push):**
1. Push this folder to a GitHub repo.
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → pick it. Railway auto-detects Node and runs `npm start`.
3. Service → **Variables** → add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKSTATION_KEY` — any string you invent (this is your login)
4. Service → Settings → Networking → **Generate Domain**.

**Via CLI instead:** `npm i -g @railway/cli && railway login && railway init && railway up`, then set the same variables with `railway variables set`.

## 4 · First open

Visit once with the key in the URL so the browser learns it:

```
https://your-app.up.railway.app/?key=YOUR_WORKSTATION_KEY
```

It's remembered locally after that. The sync status in the freshness bar tells you what's happening (`✓ saved`, `state loaded`, `⚠ wrong key`, `⚠ offline`).

---

## API surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/state` | GET | key | Load workstation state |
| `/api/state` | PUT | key | Save workstation state (debounced from the UI) |
| `/api/quotes` | GET | key | Live quotes for all 10 tickers, 10-min server cache |
| `/health` | GET | — | `{ok, db, auth}` — check Supabase/auth wiring |

## Honest limitations

- **Quotes** come from Yahoo Finance's public chart endpoint — unofficial, keyless, stable for years, but not contractual. If it breaks someday, the workstation degrades gracefully to manual prices (the pill system still tracks staleness) and `server.js` has one small function (`yahooQuote`) to swap for another provider.
- **Fundamentals don't auto-update by design.** Base FCF, shares and net cash change when *you* read the filing, not when a feed says so — that's the discipline, not a missing feature. Quarterly routine: earnings → refresh anchors → done.
- **Single-user by construction.** One state row, one key. That's correct for its job; don't put the service-role key anywhere client-side.

## Ticker → exchange mapping

GE, V, SPGI, WM, BSX (NYSE) · NESN.SW (SIX) · DG.PA (Vinci, Euronext) · AENA.MC (BME) · NOVO-B.CO (Copenhagen) · SAAB-B.ST (Stockholm). Edit `SYMBOLS` in `server.js` when the portfolio changes.
