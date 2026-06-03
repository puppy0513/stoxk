const CONFIG = {
  sheetName: "Raw_data",
  tickerColumn: 2, // column B
  dividendColumn: 5, // column E
  frequencyColumnCandidates: ["Dividend Frequency", "배당주기"],
  settingsSheetName: "설정",
};

function syncRawDataFromSupabase() {
  const settings = readSettings_();
  const supabaseUrl = settings.SUPABASE_URL.replace(/\/$/, "");
  const supabaseAnonKey = settings.SUPABASE_ANON_KEY;
  const spreadsheetId = settings.SPREADSHEET_ID;
  const sheetName = settings.SHEET_NAME || CONFIG.sheetName;

  const rows = fetchDividendSnapshots_(supabaseUrl, supabaseAnonKey);
  const rowByTicker = new Map(rows.map((row) => [normalizeTicker_(row.ticker), row]));

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);

  const values = sheet.getDataRange().getValues();
  const frequencyColumn = findHeaderColumn_(values, CONFIG.frequencyColumnCandidates);
  const updates = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const ticker = normalizeTicker_(values[rowIndex][CONFIG.tickerColumn - 1]);
    if (!ticker || !rowByTicker.has(ticker)) continue;

    const row = rowByTicker.get(ticker);
    const dividend = row.dividend;
    if (dividend === null || dividend === undefined || dividend === "") continue;

    const currentValue = values[rowIndex][CONFIG.dividendColumn - 1];
    const frequencyValue = row.dividend_frequency || "";
    const currentFrequencyValue =
      frequencyColumn > 0 ? values[rowIndex][frequencyColumn - 1] : null;

    if (String(currentValue) === String(dividend) && String(currentFrequencyValue) === String(frequencyValue)) {
      continue;
    }

    updates.push({
      row: rowIndex + 1,
      value: dividend,
      ticker: ticker,
      frequency: frequencyValue,
    });
  }

  updates.forEach((update) => {
    sheet.getRange(update.row, CONFIG.dividendColumn).setValue(update.value);
    if (frequencyColumn > 0) {
      sheet.getRange(update.row, frequencyColumn).setValue(update.frequency);
    }
  });

  return {
    updatedCount: updates.length,
    updatedRows: updates,
  };
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "syncRawDataFromSupabase")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("syncRawDataFromSupabase")
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(5)
    .create();
}

function fetchDividendSnapshots_(supabaseUrl, supabaseAnonKey) {
  const url =
    supabaseUrl +
    "/rest/v1/dividend_snapshots?select=stock_name,ticker,dividend,payment_day,ex_date,market,currency,source,source_symbol,dividend_frequency,updated_at&order=ticker";
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: "Bearer " + supabaseAnonKey,
      Accept: "application/json",
    },
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`Supabase request failed (${code}): ${body}`);
  }

  const payload = JSON.parse(body);
  if (!Array.isArray(payload)) throw new Error("Unexpected Supabase response.");
  return payload;
}

function normalizeTicker_(value) {
  return String(value || "").trim().toUpperCase();
}

function findHeaderColumn_(values, candidates) {
  const limitRows = Math.min(values.length, 10);
  for (let rowIndex = 0; rowIndex < limitRows; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const limitCols = Math.min(row.length, 20);
    for (let colIndex = 0; colIndex < limitCols; colIndex += 1) {
      const cell = String(row[colIndex] || "").trim();
      if (candidates.includes(cell)) {
        return colIndex + 1;
      }
    }
  }
  return 0;
}

function readSettings_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Active spreadsheet is not available.");
  }

  const sheet = spreadsheet.getSheetByName(CONFIG.settingsSheetName);
  if (!sheet) {
    throw new Error(`Settings sheet not found: ${CONFIG.settingsSheetName}`);
  }

  const values = sheet.getDataRange().getValues();
  const settings = {};
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const key = String(values[rowIndex][0] || "").trim();
    const value = String(values[rowIndex][1] || "").trim();
    if (!key) continue;
    settings[key] = value;
  }

  const requiredKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SPREADSHEET_ID"];
  const missing = requiredKeys.filter((key) => !settings[key]);
  if (missing.length > 0) {
    throw new Error(`Missing setting(s): ${missing.join(", ")}`);
  }

  return settings;
}
