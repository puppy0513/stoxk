const { getDashboardSnapshot } = require("./_dashboard");
const { isAuthenticated } = require("./_session");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    if (!isAuthenticated(req)) {
      send(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      send(res, 405, { error: "Method not allowed" });
      return;
    }

    const snapshot = await getDashboardSnapshot();
    send(res, 200, snapshot);
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
};
