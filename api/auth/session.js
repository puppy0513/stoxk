const { isAuthenticated } = require("../_session");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isAuthenticated(req)) {
    send(res, 401, { authenticated: false });
    return;
  }

  send(res, 200, { authenticated: true });
};
