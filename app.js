const LOCAL_DRAFT_KEY = "stoxk.quantities.draft.v2";
const LOCAL_SAVED_KEY = "stoxk.quantities.saved.v2";
const LOCAL_DIRTY_KEY = "stoxk.quantities.dirty.v2";
const DEFAULT_SOURCE = "/api/dashboard-data";

const rowsEl = document.getElementById("rows");
const summaryEl = document.getElementById("summary");
const statusEl = document.getElementById("status");
const sourceInput = document.getElementById("sourceInput");
const saveButton = document.getElementById("saveButton");
const reloadButton = document.getElementById("reloadButton");
const resetButton = document.getElementById("resetButton");
const logoutButton = document.getElementById("logoutButton");
const portfolioTotalValueEl = document.getElementById("portfolioTotalValue");
const portfolioTotalMetaEl = document.getElementById("portfolioTotalMeta");
const monthlyDividendValueEl = document.getElementById("monthlyDividendValue");
const monthlyDividendMetaEl = document.getElementById("monthlyDividendMeta");

const searchParams = new URLSearchParams(window.location.search);
const initialSource = searchParams.get("source") || DEFAULT_SOURCE;
sourceInput.value = initialSource;

let snapshot = null;
let quantityState = loadQuantities();
let savedQuantityState = cloneQuantities(quantityState);
let hasUnsavedChanges = loadDirtyFlag();
let hydratingFromRemote = false;
let usdKrwRate = Number.NaN;
let usdKrwUpdatedAt = "";

function loadQuantities() {
  try {
    const dirtyRaw = localStorage.getItem(LOCAL_DIRTY_KEY);
    const draftRaw = localStorage.getItem(LOCAL_DRAFT_KEY);
    const savedRaw = localStorage.getItem(LOCAL_SAVED_KEY);
    const dirty = dirtyRaw === "true";
    if (dirty && draftRaw) {
      return JSON.parse(draftRaw);
    }
    if (savedRaw) {
      return JSON.parse(savedRaw);
    }
    if (draftRaw) {
      return JSON.parse(draftRaw);
    }
    return {};
  } catch {
    return {};
  }
}

function loadDirtyFlag() {
  try {
    return localStorage.getItem(LOCAL_DIRTY_KEY) === "true";
  } catch {
    return false;
  }
}

function cloneQuantities(source) {
  if (!source) return {};
  return JSON.parse(JSON.stringify(source || {}));
}

function persistDraftQuantities() {
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(quantityState));
  localStorage.setItem(LOCAL_DIRTY_KEY, hasUnsavedChanges ? "true" : "false");
}

function persistSavedQuantities() {
  localStorage.setItem(LOCAL_SAVED_KEY, JSON.stringify(savedQuantityState));
}

function moneyFormatter(currency, fractionDigits = currency === "KRW" ? 0 : 2) {
  return new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function plainNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatMoney(value, currency, fractionDigits) {
  if (!Number.isFinite(value)) return "-";
  return moneyFormatter(currency, fractionDigits).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${plainNumber(value * 100, 2)}%`;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function currentQuantity(ticker, fallback) {
  const value = quantityState[ticker];
  return Number.isFinite(value) ? value : fallback;
}

function setQuantity(ticker, value) {
  const next = Math.max(0, Math.floor(Number(value) || 0));
  quantityState[ticker] = next;
  hasUnsavedChanges = true;
  persistDraftQuantities();
  setSaveState();
  render();
}

function normalizeFrequency(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quarterly") return "quarterly";
  if (normalized === "half yearly" || normalized === "half-yearly" || normalized === "semiannual") {
    return "half yearly";
  }
  if (normalized === "yearly" || normalized === "annual" || normalized === "annually") {
    return "yearly";
  }
  if (normalized === "monthly" || normalized === "weekly") {
    return normalized;
  }
  return normalized || "monthly";
}

function annualFactor(frequency) {
  switch (normalizeFrequency(frequency)) {
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "half yearly":
      return 2;
    case "yearly":
      return 1;
    default:
      return Number.NaN;
  }
}

function annualDividend(row) {
  const factor = annualFactor(row.paymentFrequency);
  if (Number.isFinite(row.recentDividend) && Number.isFinite(factor)) {
    return row.recentDividend * factor;
  }
  return Number.isFinite(row.ttmDividend) ? row.ttmDividend : Number.NaN;
}

function monthlyDividendPerShare(row) {
  const recent = Number.isFinite(row.recentDividend) ? row.recentDividend : Number.NaN;
  if (!Number.isFinite(recent)) {
    return Number.isFinite(row.ttmDividend) ? row.ttmDividend / 12 : Number.NaN;
  }

  switch (normalizeFrequency(row.paymentFrequency)) {
    case "weekly":
      return recent * 4;
    case "monthly":
      return recent;
    case "quarterly":
      return recent / 3;
    case "half yearly":
      return recent / 6;
    case "yearly":
      return recent / 12;
    default: {
      const annual = annualDividend(row);
      return Number.isFinite(annual) ? annual / 12 : Number.NaN;
    }
  }
}

function loadData(source) {
  return fetch(source, { cache: "no-store" }).then(async (response) => {
    if (response.status === 401) {
      redirectToLogin();
      throw new Error("인증이 만료되었습니다.");
    }
    if (!response.ok) {
      throw new Error(`데이터를 불러오지 못했습니다: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (contentType.includes("application/json") || source.toLowerCase().endsWith(".json") || source.startsWith("/api/")) {
      return JSON.parse(text);
    }
    return parseCsvPayload(text);
  });
}

function redirectToLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login.html?next=${next}`;
}

function parseCsvPayload(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { rows: [] };
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
  return { rows };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function normalizePayload(payload) {
  const rows = payload.rows || payload;
  return rows.map((row) => ({
    ticker: row.ticker,
    name: row.name,
    market: row.market || "",
    paymentFrequency: normalizeFrequency(row.paymentFrequency ?? row.payment_frequency ?? "monthly"),
    currency: row.currency || "USD",
    price: asNumber(row.price),
    priceDate: row.priceDate || row.price_date || "",
    recentDividend: asNumber(row.recentDividend ?? row.recent_dividend),
    recentDividendDate: row.recentDividendDate || row.recent_dividend_date || "",
    ttmDividend: asNumber(row.ttmDividend ?? row.ttm_dividend),
    defaultQuantity: Number.isFinite(Number(row.defaultQuantity ?? row.default_quantity))
      ? Math.max(0, Math.floor(Number(row.defaultQuantity ?? row.default_quantity)))
      : 1,
  }));
}

function currencyRows(rows) {
  return rows.reduce((acc, row) => {
    const bucket = acc[row.currency] || { currentValue: 0, annualDividend: 0, priceCount: 0 };
    const quantity = currentQuantity(row.ticker, row.defaultQuantity);
    if (Number.isFinite(row.price)) {
      bucket.currentValue += row.price * quantity;
      bucket.priceCount += 1;
    }
    const annual = annualDividend(row);
    if (Number.isFinite(annual)) {
      bucket.annualDividend += annual;
    }
    acc[row.currency] = bucket;
    return acc;
  }, {});
}

function toKrw(value, currency) {
  if (!Number.isFinite(value)) return Number.NaN;
  if (currency === "KRW") return value;
  if (currency === "USD" && Number.isFinite(usdKrwRate)) return value * usdKrwRate;
  return Number.NaN;
}

function syncQuantityInputs() {
  rowsEl.querySelectorAll("tr").forEach((tr) => {
    const ticker = tr.dataset.ticker;
    const input = tr.querySelector("input");
    if (input) {
      input.value = String(currentQuantity(ticker, 1));
    }
  });
}

function renderSummary(rows, exportedAt) {
  const totals = currencyRows(rows);
  const fragments = [
    {
      label: "종목 수",
      value: rows.length.toString(),
      note: "추적 중인 자산",
    },
    {
      label: "갱신 시점",
      value: exportedAt || "-",
      note: "데이터 스냅샷",
    },
  ];

  Object.entries(totals).forEach(([currency, stats]) => {
    fragments.push({
      label: `${currency} 현재 가치`,
      value: formatMoney(stats.currentValue, currency, currency === "KRW" ? 0 : 2),
      note: `1년 예상 ${formatMoney(stats.annualDividend, currency, currency === "KRW" ? 0 : 3)}`,
    });
  });

  summaryEl.innerHTML = fragments
    .map(
      (item) => `
        <div class="summary-item">
          <strong>${item.value}</strong>
          <span>${item.label}${item.note ? ` · ${item.note}` : ""}</span>
        </div>
      `
    )
    .join("");
}

function renderOverview(rows) {
  let totalValueKrw = 0;
  let monthlyDividendKrw = 0;
  let hasAnyKrwValue = false;
  let hasAnyMonthlyDividend = false;
  const hasUsdRows = rows.some((row) => row.currency === "USD");
  const hasUsdMonthlyRows = rows.some((row) => row.currency === "USD");

  for (const row of rows) {
    const quantity = currentQuantity(row.ticker, row.defaultQuantity);
    const positionValue = Number.isFinite(row.price) ? row.price * quantity : Number.NaN;
    const positionValueKrw = toKrw(positionValue, row.currency);
    if (Number.isFinite(positionValueKrw)) {
      totalValueKrw += positionValueKrw;
      hasAnyKrwValue = true;
    }

    const monthlyPerShare = monthlyDividendPerShare(row);
    const monthlyValue = Number.isFinite(monthlyPerShare) ? monthlyPerShare * quantity : Number.NaN;
    const monthlyValueKrw = toKrw(monthlyValue, row.currency);
    if (Number.isFinite(monthlyValueKrw)) {
      monthlyDividendKrw += monthlyValueKrw;
      hasAnyMonthlyDividend = true;
    }
  }

  const canShowTotal = hasAnyKrwValue && (!hasUsdRows || Number.isFinite(usdKrwRate));
  const canShowMonthly = hasAnyMonthlyDividend && (!hasUsdMonthlyRows || Number.isFinite(usdKrwRate));

  portfolioTotalValueEl.textContent = canShowTotal ? formatMoney(totalValueKrw, "KRW", 0) : "-";
  monthlyDividendValueEl.textContent = canShowMonthly ? formatMoney(monthlyDividendKrw, "KRW", 0) : "-";

  if (Number.isFinite(usdKrwRate)) {
    const updatedText = usdKrwUpdatedAt ? ` · 업데이트 ${usdKrwUpdatedAt}` : "";
    portfolioTotalMetaEl.textContent = `USD 자산은 1달러 = ${plainNumber(usdKrwRate, 2)}원으로 환산했습니다.${updatedText}`;
  } else {
    portfolioTotalMetaEl.textContent = "USD/KRW 환율을 불러오는 중입니다.";
  }

  monthlyDividendMetaEl.textContent = "이번달 예상 배당금은 배당주기별 월간 추정치를 합산한 값입니다.";
}

function renderRows(rows) {
  rowsEl.innerHTML = rows
    .map((row) => {
      const quantity = currentQuantity(row.ticker, row.defaultQuantity);
      const currentValue = Number.isFinite(row.price) ? row.price * quantity : Number.NaN;
      const projectedDividend = annualDividend(row);
      const yieldRate = Number.isFinite(row.price) && row.price > 0 && Number.isFinite(projectedDividend)
        ? projectedDividend / row.price
        : Number.NaN;

      return `
        <tr data-ticker="${row.ticker}">
          <td>
            <span class="name">${row.name}</span>
            ${row.market ? `<span class="subtle">${row.market}</span>` : ""}
          </td>
          <td class="ticker">${row.ticker}</td>
          <td class="muted">${row.paymentFrequency}</td>
          <td class="money">${formatMoney(row.price, row.currency, row.currency === "KRW" ? 0 : 2)}</td>
          <td>
            <div class="qty-control">
              <input
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                value="${quantity}"
                aria-label="${row.ticker} 수량"
              />
            </div>
          </td>
          <td class="money">
            ${formatMoney(row.recentDividend, row.currency, row.currency === "KRW" ? 0 : 3)}
            ${row.recentDividendDate ? `<span class="subtle">${row.recentDividendDate}</span>` : ""}
          </td>
          <td class="money">${formatMoney(projectedDividend, row.currency, row.currency === "KRW" ? 0 : 3)}</td>
          <td class="yield ${yieldRate >= 0 ? "positive" : ""}">${formatPercent(yieldRate)}</td>
          <td class="money">${formatMoney(currentValue, row.currency, row.currency === "KRW" ? 0 : 2)}</td>
        </tr>
      `;
    })
    .join("");

  rowsEl.querySelectorAll("tr").forEach((tr) => {
    const ticker = tr.dataset.ticker;
    const input = tr.querySelector("input");

    input.addEventListener("input", () => {
      const next = Math.max(0, Math.floor(Number(input.value) || 0));
      quantityState[ticker] = next;
      hasUnsavedChanges = true;
      persistDraftQuantities();
      setSaveState();
    });
    input.addEventListener("change", () => setQuantity(ticker, input.value));
    input.addEventListener("blur", () => setQuantity(ticker, input.value));
  });
}

function render() {
  if (!snapshot) return;
  const rows = snapshot.rows.slice();
  renderOverview(rows);
  renderSummary(rows, snapshot.exportedAt);
  renderRows(rows);
}

async function refresh() {
  const source = sourceInput.value.trim() || DEFAULT_SOURCE;
  sourceInput.value = source;
  statusEl.textContent = "데이터를 불러오는 중입니다.";
  try {
    const payload = await loadData(source);
    snapshot = {
      exportedAt: payload.exportedAt || payload.asOf || "",
      rows: normalizePayload(payload),
    };
    render();
    statusEl.textContent = `데이터 로드 완료: ${source}`;
  } catch (error) {
    if (error instanceof Error && error.message === "인증이 만료되었습니다.") {
      return;
    }
    statusEl.textContent = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
  }
}

async function hydrateExchangeRate() {
  try {
    const response = await fetch("/api/usdkrw", { cache: "no-store" });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    if (!response.ok) {
      throw new Error(`환율 로딩 실패: ${response.status}`);
    }
    const payload = await response.json();
    usdKrwRate = Number(payload.rate);
    usdKrwUpdatedAt = String(payload.updatedAt || "");
    if (snapshot) {
      renderOverview(snapshot.rows.slice());
    }
  } catch {
    usdKrwRate = Number.NaN;
    usdKrwUpdatedAt = "";
  }
}

function setSaveState() {
  saveButton.disabled = !hasUnsavedChanges || hydratingFromRemote;
  saveButton.textContent = hasUnsavedChanges ? "저장" : "저장됨";
}

async function hydrateQuantities() {
  hydratingFromRemote = true;
  setSaveState();
  try {
    const response = await fetch("/api/quantities", { cache: "no-store" });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    if (!response.ok) {
      throw new Error(`Supabase 로딩 실패: ${response.status}`);
    }
    const payload = await response.json();
    const remoteQuantities = payload.quantities || {};
    if (!hasUnsavedChanges) {
      quantityState = remoteQuantities;
      savedQuantityState = cloneQuantities(remoteQuantities);
      persistSavedQuantities();
      persistDraftQuantities();
      render();
      statusEl.textContent = "Supabase에서 개수를 불러왔습니다.";
    } else {
      savedQuantityState = cloneQuantities(remoteQuantities);
      persistSavedQuantities();
      statusEl.textContent = "로컬 수정본을 유지한 채 Supabase 개수도 불러왔습니다.";
    }
  } catch {
    if (Object.keys(savedQuantityState).length > 0 && !hasUnsavedChanges) {
      quantityState = cloneQuantities(savedQuantityState);
      render();
    }
  } finally {
    hydratingFromRemote = false;
    setSaveState();
  }
}

async function saveQuantitiesToSupabase() {
  const payload = {
    quantities: Object.entries(quantityState).map(([ticker, quantity]) => ({
      ticker,
      quantity,
    })),
  };

  saveButton.disabled = true;
  statusEl.textContent = "Supabase에 저장하는 중입니다.";
  try {
    const response = await fetch("/api/quantities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `저장 실패: ${response.status}`);
    }
    savedQuantityState = cloneQuantities(quantityState);
    hasUnsavedChanges = false;
    persistSavedQuantities();
    persistDraftQuantities();
    render();
    statusEl.textContent = "Supabase에 저장했습니다.";
  } catch (error) {
    statusEl.textContent = error instanceof Error ? `Supabase 저장 실패: ${error.message}` : "Supabase 저장 실패";
  } finally {
    setSaveState();
  }
}

async function logout() {
  logoutButton.disabled = true;
  statusEl.textContent = "로그아웃하는 중입니다.";
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login.html";
  }
}

reloadButton.addEventListener("click", refresh);
saveButton.addEventListener("click", saveQuantitiesToSupabase);
logoutButton.addEventListener("click", logout);
resetButton.addEventListener("click", () => {
  quantityState = {};
  savedQuantityState = {};
  hasUnsavedChanges = true;
  persistDraftQuantities();
  persistSavedQuantities();
  setSaveState();
  render();
});

sourceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    refresh();
  }
});

setSaveState();
render();
hydrateQuantities().finally(refresh);
hydrateExchangeRate();
