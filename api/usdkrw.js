function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      send(res, 405, { error: "Method not allowed" });
      return;
    }

    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `USD/KRW fetch failed: ${response.status}`);
    }

    const payload = JSON.parse(text);
    const rate = Number(payload?.rates?.KRW);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("USD/KRW rate is unavailable");
    }

    send(res, 200, {
      base: payload.base_code || "USD",
      quote: "KRW",
      rate,
      updatedAt: payload.time_last_update_utc || payload.time_last_update_unix || null,
    });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
};
