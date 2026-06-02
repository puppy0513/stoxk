const crypto = require("node:crypto");

const COOKIE_NAME = "stoxk_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getPassword() {
  return process.env.SITE_PASSWORD || process.env.PASSWORD || getEnv("SITE_PASSWORD");
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || getPassword();
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(payload) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function createSessionToken() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const nonce = base64UrlEncode(crypto.randomBytes(16));
  const payload = `${expiresAt}.${nonce}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [expiresAtRaw, nonce, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const payload = `${expiresAtRaw}.${nonce}`;
  return timingSafeEqual(sign(payload), signature);
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const index = item.indexOf("=");
      if (index === -1) {
        return cookies;
      }
      const name = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || "";
}

function isAuthenticated(req) {
  return verifySessionToken(getSessionTokenFromRequest(req));
}

function serializeCookie(value, options = {}) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  parts.push("HttpOnly");
  parts.push(`Max-Age=${options.maxAge || SESSION_MAX_AGE_SECONDS}`);
  parts.push("SameSite=Strict");
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function buildAuthCookie(value) {
  return serializeCookie(value, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: Boolean(process.env.VERCEL || process.env.NODE_ENV === "production"),
  });
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict${Boolean(process.env.VERCEL || process.env.NODE_ENV === "production") ? "; Secure" : ""}`;
}

module.exports = {
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  buildAuthCookie,
  buildClearCookie,
  createSessionToken,
  getPassword,
  isAuthenticated,
  parseCookies,
  verifySessionToken,
};
