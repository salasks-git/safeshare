// src/index.ts
// Worker entry point: routing, security headers, cookie auth, and API dispatch.
//
// SECURITY NOTES:
// - Room existence is never disclosed: all failures return 404.
// - Codes and tokens are never logged.
// - Auth cookie: roomCode.role.token (HttpOnly, Secure, SameSite=Strict).

import { RoomDO } from './room';
import { LimiterDO } from './limiter';

import { handleCron } from './cron';

export { RoomDO, LimiterDO };

// ─── Env binding types ────────────────────────────────────────────────────────

interface Env {
  ROOM_DO: DurableObjectNamespace;
  LIMITER_DO: DurableObjectNamespace;
  FILES_KV: KVNamespace;
  ASSETS: Fetcher;
  MAX_FILE_SIZE_BYTES: string;
  MAX_FILES_PER_ROOM: string;
  MAX_TOTAL_BYTES_PER_ROOM: string;
  ROOM_IDLE_TIMEOUT_MS: string;
  ROOM_MAX_LIFETIME_MS: string;
  ROOM_CODE_WAIT_TIMEOUT_MS: string;
}

// ─── Security headers applied to all HTML/API responses ─────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://cdn.tailwindcss.com https://fonts.googleapis.com 'unsafe-inline'",
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' blob: data:",
    "connect-src 'self' wss:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; '),
};

function addSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res; // Do not recreate WebSocket responses

  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

/** Parse the auth cookie. Returns { code, role, token } or null. */
function parseCookie(req: Request): { code: string; role: string; token: string } | null {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'sd_auth') {
      const val = rest.join('=');
      const [code, role, token] = val.split('.');
      if (code && role && token) return { code, role, token };
    }
  }
  return null;
}

function setCookieHeader(code: string, role: string, token: string): string {
  return `sd_auth=${code}.${role}.${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`;
}

function clearCookieHeader(): string {
  return `sd_auth=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// ─── IP helpers ──────────────────────────────────────────────────────────────

function getClientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

/** SHA-256 of the IP — used as the LimiterDO key. Never log raw IPs. */
async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getLimiterDO(env: Env, hashedIp: string): DurableObjectStub {
  return env.LIMITER_DO.get(env.LIMITER_DO.idFromName(hashedIp));
}

function getRoomDO(env: Env, code: string): DurableObjectStub {
  return env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
}

// ─── 6-digit code validation ──────────────────────────────────────────────────

function isValidCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

// ─── Auth middleware: verify cookie against RoomDO ───────────────────────────

/**
 * Forwards an internal request to a RoomDO, injecting the role from the cookie.
 * Returns null if cookie is missing/invalid (caller should return 404).
 */
async function authedRoomFetch(
  req: Request,
  env: Env,
  doPath: string,
  extraHeaders?: Record<string, string>
): Promise<{ res: Response; code: string; role: string } | null> {
  const cookie = parseCookie(req);
  if (!cookie) return null;
  if (!isValidCode(cookie.code)) return null;

  const do_ = getRoomDO(env, cookie.code);
  const headers = new Headers(req.headers);
  headers.set('X-Role', cookie.role);
  headers.set('X-Token', cookie.token);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }

  const doReq = new Request(`http://do${doPath}`, {
    method: req.method,
    headers,
    body: req.body,
  });

  // Note: RoomDO verifies the token hash internally per-action when needed.
  const res = await do_.fetch(doReq);
  return { res, code: cookie.code, role: cookie.role };
}

// ─── Main Worker ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Health check ──────────────────────────────────────────────────────────
    if (path === '/health') {
      return addSecurityHeaders(new Response('ok', { status: 200 }));
    }

    // ── API routes ────────────────────────────────────────────────────────────
    if (path.startsWith('/api/')) {
      const res = await handleApi(request, env, url);
      return addSecurityHeaders(res);
    }

    // ── Static assets (React SPA) ─────────────────────────────────────────────
    // Try to serve the exact file first. If the assets server returns 404
    // for a non-file path (e.g. /room, /wait, /privacy), serve index.html so
    // React Router can pick up the route on reload. API paths never reach here.
    let res = await env.ASSETS.fetch(request);
    if (res.status === 404) {
      // Re-request the SPA shell. Use GET regardless of the original method.
      const indexReq = new Request(new URL('/index.html', request.url).toString(), {
        method: 'GET',
        headers: request.headers,
      });
      res = await env.ASSETS.fetch(indexReq);
    }
    return addSecurityHeaders(res);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },
};

// ─── API handler ─────────────────────────────────────────────────────────────

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // POST /api/rooms — create a room
  if (path === '/api/rooms' && method === 'POST') {
    return handleCreateRoom(request, env);
  }

  // POST /api/rooms/join — join with code
  if (path === '/api/rooms/join' && method === 'POST') {
    return handleJoinRoom(request, env);
  }

  // Routes that require a code in the path: /api/rooms/:code/...
  const roomMatch = path.match(/^\/api\/rooms\/(\d{6})(\/.*)?$/);
  if (roomMatch) {
    const code = roomMatch[1];
    const sub = roomMatch[2] || '/';
    return handleRoomAction(request, env, code, sub, url);
  }

  return new Response('not_found', { status: 404 });
}

// ─── POST /api/rooms ──────────────────────────────────────────────────────────

async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
  const ip = getClientIp(request);
  const hashedIp = await hashIp(ip);
  const limiter = getLimiterDO(env, hashedIp);

  // Rate limit: max 10 creates/hour per IP
  const limitRes = await limiter.fetch(new Request('http://do/create', { method: 'POST' }));
  if (limitRes.status === 429) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }


  // Try random 6-digit codes until one is available (usually first try)
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const do_ = getRoomDO(env, code);
    const res = await do_.fetch(new Request('http://do/create', { method: 'POST' }));
    if (res.status === 409) continue; // code in use, try another

    if (!res.ok) return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    const { token } = await res.json() as { token: string };
    const cookie = setCookieHeader(code, 'host', token);

    return new Response(JSON.stringify({ code }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
      },
    });
  }

  return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}

// ─── POST /api/rooms/join ─────────────────────────────────────────────────────

async function handleJoinRoom(request: Request, env: Env): Promise<Response> {
  const ip = getClientIp(request);
  const hashedIp = await hashIp(ip);
  const limiter = getLimiterDO(env, hashedIp);

  let body: { code?: string } = {};
  try { body = await request.json(); } catch {}

  const code = (body.code ?? '').trim();
  if (!isValidCode(code)) {
    return new Response(JSON.stringify({ error: 'invalid_code' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check current failure count (still tracked for general rate limiting if needed)
  const checkRes = await limiter.fetch(new Request('http://do/check-join'));
  const failCount = parseInt(await checkRes.text(), 10);

  const do_ = getRoomDO(env, code);
  const res = await do_.fetch(new Request('http://do/join', { method: 'POST' }));

  if (res.status === 404) {
    // Record failed join for rate limiting
    await limiter.fetch(new Request('http://do/failed-join', { method: 'POST' }));
    const newCount = failCount + 1;
    return new Response(JSON.stringify({
      error: 'not_found',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const { token, expiresAt } = await res.json() as { token: string; expiresAt: number };
  const cookie = setCookieHeader(code, 'guest', token);

  return new Response(JSON.stringify({ code, expiresAt }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
}

// ─── Room sub-routes (require auth cookie) ────────────────────────────────────

async function handleRoomAction(
  request: Request,
  env: Env,
  code: string,
  sub: string,
  url: URL
): Promise<Response> {
  const method = request.method;
  const cookie = parseCookie(request);
  if (!cookie || cookie.code !== code) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const do_ = getRoomDO(env, code);
  const role = cookie.role;

  // GET /api/rooms/:code/state
  if (sub === '/state' && method === 'GET') {
    const res = await do_.fetch(new Request('http://do/state', {
      headers: { 'X-Role': role, 'X-Token': cookie.token },
    }));
    return res;
  }

  // GET /api/rooms/:code/ws — WebSocket upgrade
  if (sub === '/ws' && method === 'GET') {
    // MUST pass original request directly to preserve WebSocket upgrade context
    return await do_.fetch(request);
  }

  // POST /api/rooms/:code/files — upload
  if (sub === '/files' && method === 'POST') {
    const rawName = request.headers.get('X-Filename') || 'file';
    const res = await do_.fetch(new Request('http://do/upload', {
      method: 'POST',
      headers: {
        'X-Role': role,
        'X-Token': cookie.token,
        'X-Filename': rawName,
        'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream',
      },
      body: request.body,
    }));
    return res;
  }

  // POST /api/rooms/:code/texts — send text
  if (sub === '/texts' && method === 'POST') {
    const res = await do_.fetch(new Request('http://do/text', {
      method: 'POST',
      headers: {
        'X-Role': role,
        'X-Token': cookie.token,
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
      },
      body: request.body,
    }));
    return res;
  }

  // GET /api/rooms/:code/files/:fileId — view
  const fileMatch = sub.match(/^\/files\/([a-f0-9-]{36})$/);
  if (fileMatch && method === 'GET') {
    const fileId = fileMatch[1];
    const res = await do_.fetch(new Request(`http://do/file?id=${fileId}`, {
      headers: { 'X-Role': role, 'X-Token': cookie.token },
    }));
    return res;
  }

  // DELETE /api/rooms/:code/files/:fileId
  if (fileMatch && method === 'DELETE') {
    const fileId = fileMatch[1];
    const res = await do_.fetch(new Request(`http://do/delete-file?id=${fileId}`, {
      method: 'DELETE',
      headers: { 'X-Role': role, 'X-Token': cookie.token },
    }));
    return res;
  }

  // POST /api/rooms/:code/end
  if (sub === '/end' && method === 'POST') {
    const res = await do_.fetch(new Request('http://do/end', {
      method: 'POST',
      headers: { 'X-Role': role, 'X-Token': cookie.token },
    }));
    // Clear the auth cookie on successful end
    const headers = new Headers(res.headers);
    headers.set('Set-Cookie', clearCookieHeader());
    return new Response(res.body, { status: res.status, headers });
  }

  return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
}
