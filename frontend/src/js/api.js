// src/js/api.js
// Thin wrappers around the Safe-Drop REST API.
// NEVER log codes, tokens, or file names.

const base = '';

async function _json(res) {
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) return res.json();
  return { _raw: await res.text() };
}

/** POST /api/rooms — create a room. Returns { code }. */
export async function createRoom() {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    credentials: 'same-origin',
  });
  return { ok: res.ok, status: res.status, data: await _json(res) };
}

/** POST /api/rooms/join — join with code. Returns { code, expiresAt }. */
export async function joinRoom(code) {
  const res = await fetch(`${base}/api/rooms/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    credentials: 'same-origin',
  });
  return { ok: res.ok, status: res.status, data: await _json(res) };
}

/** GET /api/rooms/:code/state */
export async function getState(code) {
  const res = await fetch(`${base}/api/rooms/${code}/state`, {
    credentials: 'same-origin',
  });
  return { ok: res.ok, status: res.status, data: await _json(res) };
}

/** POST /api/rooms/:code/files — upload a file. Returns { id, name, size, mime }. */
export async function uploadFile(code, file) {
  const res = await fetch(`${base}/api/rooms/${code}/files`, {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(file.name) },
    body: file,
    credentials: 'same-origin',
  });
  return { ok: res.ok, status: res.status, data: await _json(res) };
}

/** Returns the URL to view a file (used in <img src> or pdf.js). */
export function fileViewUrl(code, fileId) {
  return `${base}/api/rooms/${code}/files/${fileId}`;
}

/** DELETE /api/rooms/:code/files/:fileId */
export async function deleteFile(code, fileId) {
  const res = await fetch(`${base}/api/rooms/${code}/files/${fileId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  return { ok: res.ok, status: res.status };
}

/** POST /api/rooms/:code/end */
export async function endSession(code) {
  const res = await fetch(`${base}/api/rooms/${code}/end`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  return { ok: res.ok, status: res.status };
}
