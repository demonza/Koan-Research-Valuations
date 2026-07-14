"use strict";
/* Gama Research — DCF Workstation server
 * Express static host + state persistence (Supabase) + live quote proxy.
 * Runs fine with zero env vars (in-memory state, no auth) so you can
 * test locally before wiring Supabase and Railway.
 */
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- optional single-user auth ---------------- */
const KEY = "";
function auth(req, res, next) {
  if (!KEY) return next(); // no key configured → open (fine for local dev)
  if (req.get("x-workstation-key") === KEY) return next();
  return res.status(401).json({ error: "missing or wrong x-workstation-key" });
}

/* ---------------- Supabase (falls back to in-memory) ---------------- */
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = require("@supabase/supabase-js");
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
let memState = null; // fallback store when Supabase is not configured

app.get("/api/state", auth, async (req, res) => {
  try {
    if (!supabase) return res.json(memState || {});
    const { data, error } = await supabase
      .from("workstation_state")
      .select("data")
      .eq("key", "default")
      .maybeSingle();
    if (error) throw error;
    res.json(data ? data.data : {});
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/state", auth, async (req, res) => {
  try {
    const payload = {
      store: req.body && req.body.store ? req.body.store : {},
      scen: req.body && req.body.scen ? req.body.scen : null,
    };
    if (!supabase) {
      memState = payload;
      return res.json({ ok: true, mode: "memory" });
    }
    const { error } = await supabase.from("workstation_state").upsert(
      { key: "default", data: payload, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* ---------------- live quotes: Yahoo chart endpoint, 10-min cache ----------------
 * Unofficial but stable-for-years public endpoint; no API key required.
 * Exchange-qualified symbols cover the EU listings.
 * If it ever breaks, the frontend degrades gracefully to manual prices.
 */
const SYMBOLS = {
  GE: "GE",            // NYSE, USD
  V: "V",              // NYSE, USD
  SPGI: "SPGI",        // NYSE, USD (post-MBGL RemainCo)
  WM: "WM",            // NYSE, USD
  BSX: "BSX",          // NYSE, USD
  NESN: "NESN.SW",     // SIX, CHF
  DG: "DG.PA",         // Euronext Paris, EUR (Vinci)
  AENA: "AENA.MC",     // BME Madrid, EUR
  NVO: "NOVO-B.CO",    // Copenhagen, DKK (Novo Nordisk B)
  SAAB: "SAAB-B.ST",   // Stockholm, SEK
};

let quoteCache = { ts: 0, data: null };
const QUOTE_TTL_MS = 10 * 60 * 1000;

async function yahooQuote(sym) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(sym) +
    "?interval=1d&range=1d";
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (GamaResearch DCF workstation)" },
  });
  if (!r.ok) throw new Error(sym + " HTTP " + r.status);
  const j = await r.json();
  const meta = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!meta || !isFinite(meta.regularMarketPrice)) throw new Error(sym + ": no price in response");
  return {
    price: meta.regularMarketPrice,
    currency: meta.currency,
    asOf: new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
  };
}

app.get("/api/quotes", auth, async (req, res) => {
  if (quoteCache.data && Date.now() - quoteCache.ts < QUOTE_TTL_MS) {
    return res.json(quoteCache.data);
  }
  const entries = Object.entries(SYMBOLS);
  const results = await Promise.allSettled(entries.map(([, s]) => yahooQuote(s)));
  const out = {};
  results.forEach((r, i) => {
    const t = entries[i][0];
    if (r.status === "fulfilled") out[t] = r.value;
    else out[t] = { error: String((r.reason && r.reason.message) || r.reason) };
  });
  if (Object.values(out).some((v) => isFinite(v.price))) {
    quoteCache = { ts: Date.now(), data: out };
  }
  res.json(out);
});

app.get("/health", (req, res) =>
  res.json({ ok: true, db: !!supabase, auth: !!KEY })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    "Gama Research · DCF workstation on :" +
      PORT +
      (supabase ? " · Supabase connected" : " · in-memory mode (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)") +
      (KEY ? " · auth enabled" : " · auth OFF (set WORKSTATION_KEY)")
  );
});
