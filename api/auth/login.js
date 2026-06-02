const { buildAuthCookie, createSessionToken, getPassword } = require("../_session");

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      send(res, 405, { error: "Method not allowed" });
      return;
    }

    const payload = await readJson(req);
    const password = String(payload.password || "");

    if (!password || password !== getPassword()) {
      send(res, 401, { error: "비밀번호가 올바르지 않습니다." });
      return;
    }

    const token = createSessionToken();
    send(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": buildAuthCookie(token),
      }
    );
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "Unknown error" });
  }
};
