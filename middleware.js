import { next } from "@vercel/functions";

const COOKIE_NAME = "stoxk_session";

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

function base64UrlToBytes(input) {
  const normalized = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const base64 = normalized + "=".repeat(padLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacBase64Url(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET || process.env.SITE_PASSWORD || process.env.PASSWORD || "";
  if (!secret || !token) {
    return false;
  }

  const parts = String(token).split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [expiresAtRaw, nonce, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const expected = await hmacBase64Url(`${expiresAtRaw}.${nonce}`, secret);
  const expectedBytes = base64UrlToBytes(expected);
  const actualBytes = base64UrlToBytes(signature);
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    mismatch |= expectedBytes[index] ^ actualBytes[index];
  }
  return mismatch === 0;
}

async function isAuthenticated(request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function isPublicPath(pathname) {
  return pathname === "/login.html" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/");
}

function wantsApi(pathname) {
  return pathname.startsWith("/api/");
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (isPublicPath(pathname)) {
    if (pathname === "/login.html" && (await isAuthenticated(request))) {
      return Response.redirect(new URL("/", request.url), 302);
    }
    return next();
  }

  if (!(await isAuthenticated(request))) {
    if (wantsApi(pathname)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const nextUrl = encodeURIComponent(`${url.pathname}${url.search}`);
    return Response.redirect(new URL(`/login.html?next=${nextUrl}`, request.url), 302);
  }

  return next();
}

export const config = {
  runtime: "nodejs",
  matcher: "/:path*",
};
