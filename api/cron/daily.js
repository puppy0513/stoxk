const { refreshDashboardSnapshot } = require("../_dashboard");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const authHeader = req.headers.authorization || "";
  return authHeader === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      send(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!isAuthorizedCron(req)) {
      send(res, 401, { error: "Unauthorized" });
      return;
    }

    const snapshot = await refreshDashboardSnapshot();
    send(res, 200, {
      ok: true,
      exportedAt: snapshot.exportedAt,
      warningCount: Array.isArray(snapshot.warnings) ? snapshot.warnings.length : 0,
    });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
};
