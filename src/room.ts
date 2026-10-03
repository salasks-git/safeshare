// src/room.ts
// RoomDO: The core Durable Object. One instance per room (keyed by 6-digit code).
// All state transitions are atomic because they run inside a single DO.
// Uses SQLite storage and the WebSocket Hibernation API.
//
// SECURITY: Raw tokens are never stored — only SHA-256 hashes.
//           Codes and filenames are never logged.

import { MAGIC_PEEK_BYTES, detectMime, sanitizeFilename } from './files';

// ─── Types ────────────────────────────────────────────────────────────────────

type RoomStatus = 'waiting' | 'active' | 'ended';
type Role = 'host' | 'guest';

interface FileRow {
  id: string;
  r2Key: string;
  name: string;
  size: number;
  mime: string;
  senderRole: Role;
  createdAt: number;
}

interface Env {
  FILES_KV: KVNamespace;
  MAX_FILE_SIZE_BYTES: string;
  MAX_FILES_PER_ROOM: string;
  MAX_TOTAL_BYTES_PER_ROOM: string;
  ROOM_IDLE_TIMEOUT_MS: string;
  ROOM_MAX_LIFETIME_MS: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_TAG_HOST = 'host';
const WS_TAG_GUEST = 'guest';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hex of a string. Used to store tokens securely. */
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Generate a random hex token (32 bytes = 64 hex chars). */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a random UUID for R2 keys. */
function randomId(): string {
  return crypto.randomUUID();
}

// ─── RoomDO ───────────────────────────────────────────────────────────────────

export class RoomDO implements DurableObject {
  private sql: SqlStorage;
  private env: Env;

  constructor(private state: DurableObjectState, env: Env) {
    this.sql = state.storage.sql;
    this.env = env;
    // Initialize schema lazily (runs once per DO instance lifetime)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (
        status      TEXT NOT NULL DEFAULT 'waiting',
        roomId      TEXT NOT NULL,         -- random UUID for R2 prefix (never the code)
        hostHash    TEXT NOT NULL,
        guestHash   TEXT,
        createdAt   INTEGER NOT NULL,
        expiresAt   INTEGER NOT NULL,
        lastActivity INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id          TEXT PRIMARY KEY,
        r2Key       TEXT NOT NULL,
        name        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        mime        TEXT NOT NULL,
        senderRole  TEXT NOT NULL,
        createdAt   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS texts (
        id          TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        senderRole  TEXT NOT NULL,
        createdAt   INTEGER NOT NULL
      );
    `);
  }

  // ─── Alarm (auto-delete) ──────────────────────────────────────────────────

  async alarm(): Promise<void> {
    // Triggered by idle timeout or absolute max-lifetime expiry.
    await this._endRoom('alarm');
  }

  // ─── HTTP Dispatch ────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname; // internal paths set by index.ts

    try {
      if (action.endsWith('/ws')) return this.handleWebSocket(request);

      switch (action) {
        case '/create':   return this.handleCreate(request);
        case '/join':     return this.handleJoin(request);
        case '/state':    return this.handleState(request);
        case '/upload':   return this.handleUpload(request);
        case '/text':     return this.handleText(request);
        case '/file':     return this.handleFileGet(request);
        case '/delete-file': return this.handleFileDelete(request);
        case '/end':      return this.handleEnd(request);
        default:          return new Response('not_found', { status: 404 });
      }
    } catch (e) {
      // Never expose internals
      return new Response('error', { status: 500 });
    }
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  private async handleCreate(req: Request): Promise<Response> {
    const rows = this.sql.exec('SELECT status FROM room LIMIT 1').toArray();
    if (rows.length > 0) {
      const status = rows[0].status as RoomStatus;
      if (status !== 'ended') {
        // Code already in use by a live room — caller retries with new code
        return new Response('exists', { status: 409 });
      }
    }

    const token = randomToken();
    const hash = await sha256hex(token);
    const now = Date.now();
    const maxMs = Number(this.env.ROOM_MAX_LIFETIME_MS);
    const expiresAt = now + maxMs;

    // Clear any old state
    this.sql.exec('DELETE FROM room');
    this.sql.exec('DELETE FROM files');
    this.sql.exec('DELETE FROM texts');

    this.sql.exec(
      'INSERT INTO room (status, roomId, hostHash, createdAt, expiresAt, lastActivity) VALUES (?, ?, ?, ?, ?, ?)',
      'waiting', randomId(), hash, now, expiresAt, now
    );

    // Set alarm to expire the waiting room
    await this.state.storage.setAlarm(expiresAt);

    return Response.json({ token });
  }

  // ─── Join ─────────────────────────────────────────────────────────────────

  private async handleJoin(req: Request): Promise<Response> {
    const rows = this.sql.exec('SELECT status FROM room LIMIT 1').toArray();
    if (rows.length === 0) return new Response('not_found', { status: 404 });

    const { status } = rows[0] as { status: RoomStatus };
    if (status !== 'waiting') return new Response('not_found', { status: 404 });

    const token = randomToken();
    const hash = await sha256hex(token);
    const now = Date.now();
    const maxMs = Number(this.env.ROOM_MAX_LIFETIME_MS);

    // Set active with absolute alarm
    const roomRow = this.sql.exec('SELECT createdAt FROM room LIMIT 1').toArray()[0] as { createdAt: number };
    const expiresAt = roomRow.createdAt + maxMs;

    this.sql.exec(
      'UPDATE room SET status=?, guestHash=?, expiresAt=?, lastActivity=? WHERE 1=1',
      'active', hash, expiresAt, now
    );

    // Reset alarm to idle timeout
    await this.state.storage.setAlarm(expiresAt);

    // Notify host via WebSocket
    this._broadcast({ type: 'peer_joined' }, WS_TAG_GUEST /* exclude guest, they just joined */);

    return Response.json({ token, expiresAt });
  }

  // ─── State (polling fallback + initial load) ─────────────────────────────

  private handleState(req: Request): Response {
    const rows = this.sql.exec('SELECT * FROM room LIMIT 1').toArray();
    if (rows.length === 0) return new Response('not_found', { status: 404 });
    const room = rows[0] as Record<string, unknown>;

    const files = this.sql.exec(
      'SELECT id, name, size, mime, senderRole, createdAt FROM files ORDER BY createdAt ASC'
    ).toArray() as unknown as FileRow[];

    const texts = this.sql.exec(
      'SELECT id, content, senderRole, createdAt FROM texts ORDER BY createdAt ASC'
    ).toArray() as unknown as Array<{ id: string, content: string, senderRole: Role, createdAt: number }>;

    return Response.json({
      status: room.status,
      expiresAt: room.expiresAt,
      files,
      texts,
    });
  }

  // ─── WebSocket (Hibernation API) ──────────────────────────────────────────

  private async handleWebSocket(req: Request): Promise<Response> {
    const upgrade = req.headers.get('Upgrade');
    if (upgrade?.toLowerCase() !== 'websocket') { console.log('WS FAIL: upgrade is', upgrade); return new Response('expected websocket', { status: 426 }); }

    let role: Role | null = null;
    const cookieRaw = req.headers.get('Cookie') || '';
    const match = cookieRaw.match(/sd_auth=([^;]+)/);
    if (match) {
      const [code, cRole, cToken] = match[1].split('.');
      const tokenHash = await sha256hex(cToken);
      
      const rows = this.sql.exec('SELECT status, hostHash, guestHash FROM room LIMIT 1').toArray();
      if (rows.length > 0) {
        const r = rows[0] as { status: string, hostHash: string, guestHash: string | null };
        if (r.status !== 'ended') {
          if (cRole === 'host' && safeEqual(tokenHash, r.hostHash)) role = 'host';
          if (cRole === 'guest' && r.guestHash && safeEqual(tokenHash, r.guestHash)) role = 'guest';
        }
      }
    }

    if (!role) return new Response('not_found', { status: 404 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server, [role === 'host' ? WS_TAG_HOST : WS_TAG_GUEST]);

    return new Response(null, { status: 101, webSocket: client });
  }

  // WebSocket Hibernation API handlers
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Client sends pings to reset idle timer
    this._resetIdleAlarm();
    const room = this.sql.exec('SELECT expiresAt FROM room LIMIT 1').toArray()[0] as { expiresAt: number } | undefined;
    if (room) {
      try { ws.send(JSON.stringify({ type: 'expires_at', expiresAt: room.expiresAt })); } catch {}
    }
  }

  webSocketClose(ws: WebSocket): void {
    const tags = this.state.getTags(ws);
    const roleTag = tags.includes(WS_TAG_HOST) ? WS_TAG_HOST : WS_TAG_GUEST;
    const role = roleTag === WS_TAG_HOST ? 'host' : 'guest';
    
    // Give a 3-second grace period for navigation (e.g. from Wait.jsx to Room.jsx)
    // before destroying the room, as React Router unmounts the old WS before mounting the new one.
    this.state.waitUntil(
      new Promise(resolve => setTimeout(resolve, 3000)).then(() => {
        if (this.state.getWebSockets(roleTag).length === 0) {
          // No active socket for this role after 3 seconds; truly disconnected
          void this._endRoom(`peer_disconnected_${role}`);
        }
      })
    );
  }

  webSocketError(ws: WebSocket): void {
    // Same as close
    this.webSocketClose(ws);
  }

  // ─── Upload ───────────────────────────────────────────────────────────────

  private async handleUpload(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

    const role = req.headers.get('X-Role') as Role | null;
    if (!role) return new Response('not_found', { status: 404 });

    let rawName = req.headers.get('X-Filename') || 'file';
    try { rawName = decodeURIComponent(rawName); } catch {}
    const name = sanitizeFilename(rawName);
    const maxFile = Number(this.env.MAX_FILE_SIZE_BYTES);
    const maxFiles = Number(this.env.MAX_FILES_PER_ROOM);
    const maxTotal = Number(this.env.MAX_TOTAL_BYTES_PER_ROOM);

    // Check per-room limits before reading body
    const countRow = this.sql.exec('SELECT COUNT(*) as c, SUM(size) as s FROM files').toArray()[0] as { c: number; s: number | null };
    if (countRow.c >= maxFiles) return new Response('too_many_files', { status: 413 });

    if (!req.body) return new Response('no_body', { status: 400 });

    // Read entire body into memory (max 15MB, fits in DO memory)
    const buffer = await req.arrayBuffer();
    const totalRead = buffer.byteLength;
    if (totalRead === 0) return new Response('empty_file', { status: 400 });
    if (totalRead > maxFile) return new Response('file_too_large', { status: 413 });

    const peek = new Uint8Array(buffer, 0, Math.min(totalRead, MAGIC_PEEK_BYTES));
    const mime = detectMime(peek);
    if (!mime) {
      return new Response('unsupported_type', { status: 415 });
    }

    const totalRoomBytes = (countRow.s ?? 0) + totalRead;
    if (totalRoomBytes > maxTotal) return new Response('room_quota_exceeded', { status: 413 });

    // Get the room's R2 prefix
    const roomRow = this.sql.exec('SELECT roomId FROM room LIMIT 1').toArray()[0] as { roomId: string };
    const fileId = randomId();
    const r2Key = `rooms/${roomRow.roomId}/${fileId}`; // code never in R2 key

    // Store in KV
    await this.env.FILES_KV.put(r2Key, buffer, {
      metadata: { contentType: mime },
      expirationTtl: 3600
    });

    // Record in SQLite
    this.sql.exec(
      'INSERT INTO files (id, r2Key, name, size, mime, senderRole, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      fileId, r2Key, name, totalRead, mime, role, Date.now()
    );

    // Reset idle alarm and notify peer
    this._resetIdleAlarm();
    this._broadcast({
      type: 'file_added',
      file: { id: fileId, name, size: totalRead, mime, senderRole: role, createdAt: Date.now() },
    });

    return Response.json({ id: fileId, name, size: totalRead, mime });
  }

  // ─── Text Get ─────────────────────────────────────────────────────────────

  private async handleText(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

    const role = req.headers.get('X-Role') as Role | null;
    if (!role) return new Response('not_found', { status: 404 });

    const body = await req.json().catch(() => null) as { content?: string } | null;
    if (!body || typeof body.content !== 'string' || body.content.trim() === '') {
      return new Response('bad_request', { status: 400 });
    }

    const content = body.content.substring(0, 5000); // Max 5000 chars

    const textId = randomId();
    const createdAt = Date.now();

    this.sql.exec(
      'INSERT INTO texts (id, content, senderRole, createdAt) VALUES (?, ?, ?, ?)',
      textId, content, role, createdAt
    );

    this._resetIdleAlarm();
    this._broadcast({
      type: 'text_added',
      text: { id: textId, content, senderRole: role, createdAt },
    });

    return Response.json({ id: textId, content, senderRole: role, createdAt });
  }

  // ─── File Get (stream from R2) ────────────────────────────────────────────

  private async handleFileGet(req: Request): Promise<Response> {
    const fileId = new URL(req.url).searchParams.get('id');
    if (!fileId) return new Response('not_found', { status: 404 });

    const rows = this.sql.exec('SELECT r2Key, mime, size FROM files WHERE id=?', fileId).toArray() as Array<{ r2Key: string; mime: string, size: number }>;
    if (rows.length === 0) return new Response('not_found', { status: 404 });

    const { r2Key, mime, size } = rows[0];
    const obj = await this.env.FILES_KV.getWithMetadata(r2Key, 'stream');
    if (!obj.value) return new Response('not_found', { status: 404 });

    this._resetIdleAlarm();

    return new Response(obj.value, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        // Sandbox the content: disables scripts, forms, popups inside served content
        'Content-Security-Policy': 'sandbox',
      },
    });
  }

  // ─── File Delete ──────────────────────────────────────────────────────────

  private async handleFileDelete(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const fileId = url.searchParams.get('id');
    const role = req.headers.get('X-Role') as Role | null;
    if (!fileId || !role) return new Response('not_found', { status: 404 });

    const rows = this.sql.exec(
      'SELECT r2Key, senderRole FROM files WHERE id=?', fileId
    ).toArray() as Array<{ r2Key: string; senderRole: Role }>;
    if (rows.length === 0) return new Response('not_found', { status: 404 });

    // Only the sender can delete their own file
    if (rows[0].senderRole !== role) return new Response('not_found', { status: 404 });

    await this.env.FILES_KV.delete(rows[0].r2Key);
    this.sql.exec('DELETE FROM files WHERE id=?', fileId);

    this._resetIdleAlarm();
    this._broadcast({ type: 'file_removed', fileId });

    return new Response('ok');
  }

  // ─── End Session ─────────────────────────────────────────────────────────

  private async handleEnd(_req: Request): Promise<Response> {
    await this._endRoom('request');
    return new Response('ok');
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /** Broadcast a JSON event to all (or all-except-one-role) connected WebSockets. */
  private _broadcast(event: Record<string, unknown>, excludeTag?: string): void {
    const message = JSON.stringify(event);
    for (const ws of this.state.getWebSockets()) {
      if (excludeTag) {
        const tags = this.state.getTags(ws);
        if (tags.includes(excludeTag)) continue;
      }
      try { ws.send(message); } catch {}
    }
  }

  /** Reset the idle alarm. Called on any activity. */
  private async _resetIdleAlarm(): Promise<void> {
    const rows = this.sql.exec('SELECT createdAt FROM room LIMIT 1').toArray()[0] as { createdAt: number } | undefined;
    if (!rows) return;

    const now = Date.now();
    const maxMs = Number(this.env.ROOM_MAX_LIFETIME_MS);
    const absoluteExpiry = rows.createdAt + maxMs;

    this.sql.exec('UPDATE room SET lastActivity=? WHERE 1=1', now);
    await this.state.storage.setAlarm(absoluteExpiry);
  }

  /** Delete all R2 objects, wipe SQLite, broadcast ended, close sockets. */
  private async _endRoom(reason: string): Promise<void> {
    const files = this.sql.exec('SELECT r2Key FROM files').toArray() as Array<{ r2Key: string }>;
    for (const { r2Key } of files) {
      await this.env.FILES_KV.delete(r2Key).catch(() => {});
    }

    this.sql.exec('UPDATE room SET status=? WHERE 1=1', 'ended');
    this.sql.exec('DELETE FROM files');
    this.sql.exec('DELETE FROM texts');

    this._broadcast({ type: 'ended', reason });

    for (const ws of this.state.getWebSockets()) {
      try { ws.close(1000, 'room_ended'); } catch {}
    }
  }
}
