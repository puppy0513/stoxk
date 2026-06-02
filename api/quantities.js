const TABLE = "portfolio_quantities";
const { isAuthenticated } = require("./_session");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

async function supabaseFetch(path, options = {}) {
  const url = `${getEnv("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
  const headers = {
    apikey: getEnv("SUPABASE_ANON_KEY"),
    Authorization: `Bearer ${getEnv("SUPABASE_ANON_KEY")}`,
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

function normalizeQuantity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid quantity: ${value}`);
  }
  return Math.floor(parsed);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase request failed: ${response.status}`);
  }
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function handler(req, res) {
  try {
    if (!isAuthenticated(req)) {
      send(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET") {
      const response = await supabaseFetch(`${TABLE}?select=ticker,quantity,updated_at&order=ticker`, {
        method: "GET",
      });
      const rows = await readJsonResponse(response);
      const quantities = {};
      for (const row of rows) {
        quantities[row.ticker] = normalizeQuantity(row.quantity);
      }

      send(res, 200, { quantities, updatedAt: rows[0]?.updated_at || null });
      return;
    }

    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      const payload = JSON.parse(raw);
      const quantities = Array.isArray(payload.quantities) ? payload.quantities : [];

      const rows = quantities.map((item) => ({
        ticker: String(item.ticker || "").trim().toUpperCase(),
        quantity: normalizeQuantity(item.quantity),
        updated_at: new Date().toISOString(),
      })).filter((item) => item.ticker);

      if (rows.length === 0) {
        throw new Error("No quantities provided");
      }

      let updated = 0;
      let inserted = 0;

      for (const row of rows) {
        const existing = await supabaseFetch(
          `${TABLE}?select=ticker&ticker=eq.${encodeURIComponent(row.ticker)}&limit=1`,
          { method: "GET" }
        );
        const existingRows = await readJsonResponse(existing);

        if (Array.isArray(existingRows) && existingRows.length > 0) {
          const updateResponse = await supabaseFetch(`${TABLE}?ticker=eq.${encodeURIComponent(row.ticker)}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              quantity: row.quantity,
              updated_at: row.updated_at,
            }),
          });
          await readJsonResponse(updateResponse);
          updated += 1;
          continue;
        }

        const insertResponse = await supabaseFetch(`${TABLE}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify([row]),
        });
        await readJsonResponse(insertResponse);
        inserted += 1;
      }

      send(res, 200, { ok: true, count: rows.length, updated, inserted });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
}

module.exports = handler;
