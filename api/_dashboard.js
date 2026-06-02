const WATCHLIST = [
  { ticker: "QQQI", name: "NEOS Nasdaq-100 High Income ETF", market: "US", paymentFrequency: "monthly", currency: "USD", sourceSymbol: "QQQI" },
  { ticker: "O", name: "Realty Income", market: "US", paymentFrequency: "monthly", currency: "USD", sourceSymbol: "O" },
  { ticker: "441640", name: "KODEX 미국배당커버드콜액티브", market: "KR", paymentFrequency: "monthly", currency: "KRW", sourceSymbol: "441640.KS" },
  { ticker: "0144L0", name: "KODEX 미국성장커버드콜액티브", market: "KR", paymentFrequency: "monthly", currency: "KRW", sourceSymbol: "0144L0.KS" },
  { ticker: "489030", name: "PLUS 고배당주위클리커버드콜", market: "KR", paymentFrequency: "monthly", currency: "KRW", sourceSymbol: "489030.KS" },
  { ticker: "486290", name: "TIGER 미국나스닥100타겟데일리커버드콜", market: "KR", paymentFrequency: "monthly", currency: "KRW", sourceSymbol: "486290.KS" },
  { ticker: "498400", name: "KODEX 200타겟위클리커버드콜", market: "KR", paymentFrequency: "monthly", currency: "KRW", sourceSymbol: "498400.KS" },
  { ticker: "YMAX", name: "YieldMax Universe Fund of Option Income ETFs", market: "US", paymentFrequency: "weekly", currency: "USD", sourceSymbol: "YMAX" },
  { ticker: "YMAG", name: "YieldMax Magnificent 7 Fund of Option Income ETFs", market: "US", paymentFrequency: "weekly", currency: "USD", sourceSymbol: "YMAG" },
  { ticker: "QDTE", name: "Roundhill N-100 0DTE Covered Call Strategy ETF", market: "US", paymentFrequency: "weekly", currency: "USD", sourceSymbol: "QDTE" },
];

const SNAPSHOT_TABLE = "dashboard_snapshots";
const SNAPSHOT_ID = "latest";
const LOOKBACK_DAYS = 370;
const TTM_WINDOW_DAYS = 365;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function normalizeAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function fetchYahooChart(symbol, lookbackDays, includeDividends) {
  const now = new Date();
  const period2 = Math.floor(now.getTime() / 1000);
  const period1 = Math.floor((now.getTime() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    `${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false` +
    (includeDividends ? "&events=div" : "");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "stoxk-dividend-tracker/0.1",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${symbol}: HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  const payload = JSON.parse(text);
  const chart = payload?.chart;
  if (!chart || chart.error) {
    throw new Error(`${symbol}: ${chart?.error?.description || "chart error"}`);
  }

  const result = chart.result?.[0];
  if (!result) {
    throw new Error(`${symbol}: empty chart result`);
  }

  return result;
}

async function fetchDividendEvents(asset) {
  const result = await fetchYahooChart(asset.sourceSymbol, LOOKBACK_DAYS, true);
  const dividends = result?.events?.dividends || {};
  const rows = [];
  for (const item of Object.values(dividends)) {
    const timestamp = item?.date;
    const amount = normalizeAmount(item?.amount);
    if (!timestamp || !Number.isFinite(amount)) {
      continue;
    }
    rows.push({
      exDate: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
      amount,
    });
  }
  rows.sort((left, right) => left.exDate.localeCompare(right.exDate));
  return rows;
}

async function fetchPreviousClose(asset) {
  const result = await fetchYahooChart(asset.sourceSymbol, 14, false);
  const timestamps = result.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];

  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const close = closes[index];
    if (close === null || close === undefined) {
      continue;
    }
    return {
      price: Number(close),
      priceDate: new Date(Number(timestamps[index]) * 1000).toISOString().slice(0, 10),
    };
  }

  throw new Error(`${asset.sourceSymbol}: no close price available`);
}

async function buildRows() {
  const warnings = [];
  const rows = [];
  for (const asset of WATCHLIST) {
    let price = null;
    let priceDate = null;
    let events = [];

    const [dividendsResult, quoteResult] = await Promise.allSettled([
      fetchDividendEvents(asset),
      fetchPreviousClose(asset),
    ]);

    if (dividendsResult.status === "fulfilled") {
      events = dividendsResult.value;
    } else {
      warnings.push(dividendsResult.reason instanceof Error ? dividendsResult.reason.message : String(dividendsResult.reason));
    }

    if (quoteResult.status === "fulfilled") {
      price = quoteResult.value.price;
      priceDate = quoteResult.value.priceDate;
    } else {
      warnings.push(quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason));
    }

    const recent = events.at(-1) || null;
    const ttmDividend = events.reduce((sum, event) => sum + event.amount, 0);

    rows.push({
      ticker: asset.ticker,
      name: asset.name,
      market: asset.market,
      paymentFrequency: asset.paymentFrequency,
      currency: asset.currency,
      price: price === null ? null : String(price),
      priceDate,
      recentDividend: recent ? String(recent.amount) : null,
      recentDividendDate: recent ? recent.exDate : null,
      ttmDividend: String(ttmDividend),
      defaultQuantity: 1,
    });
  }

  return { rows, warnings };
}

function buildSnapshotPayload(rows, warnings) {
  const asOf = todayIso();
  return {
    exportedAt: asOf,
    asOf,
    rows,
    source: "stoxk-cron",
    warnings,
  };
}

function getSupabaseHeaders() {
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
  };
}

async function supabaseFetch(path, options = {}) {
  const url = `${getEnv("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getSupabaseHeaders(),
      ...options.headers,
    },
  });
  return response;
}

async function readJson(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

async function readSnapshot() {
  const response = await supabaseFetch(
    `${SNAPSHOT_TABLE}?select=payload,updated_at&id=eq.${encodeURIComponent(SNAPSHOT_ID)}&limit=1`,
    { method: "GET" }
  );
  const rows = await readJson(response);
  const payload = rows?.[0]?.payload || null;
  return payload;
}

async function writeSnapshot(payload) {
  const response = await supabaseFetch(`${SNAPSHOT_TABLE}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        id: SNAPSHOT_ID,
        payload,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
  await readJson(response);
}

async function refreshDashboardSnapshot() {
  const { rows, warnings } = await buildRows();
  const payload = buildSnapshotPayload(rows, warnings);
  await writeSnapshot(payload);
  return payload;
}

async function getDashboardSnapshot() {
  const existing = await readSnapshot();
  if (existing) {
    return existing;
  }
  return refreshDashboardSnapshot();
}

module.exports = {
  SNAPSHOT_ID,
  SNAPSHOT_TABLE,
  buildSnapshotPayload,
  buildRows,
  getDashboardSnapshot,
  refreshDashboardSnapshot,
  todayIso,
  WATCHLIST,
};
