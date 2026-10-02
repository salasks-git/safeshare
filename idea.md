# Safe-Drop: idea.md

> Read this file fully before writing any code. It is the single source of truth for the project.
> Working name: **Safe-Drop**. Rename freely.
> **IMPORTANT NOTE (Oct 2026):** We are using Cloudflare KV instead of Cloudflare R2 for file storage to avoid the credit card requirement. Any reference to R2 below should be treated as Cloudflare KV (`FILES_KV`).

---

## 1. One-line idea

Connect two devices with a short code, then share files between them in both directions. No login, no install, no download button. Everything deletes itself when the session ends.

## 2. Problem

People constantly need to move a file between two devices that are not theirs or not linked: phone to a shared PC, phone to a friend's phone, phone to a cyber cafe computer. Today they:

- log into personal email or WhatsApp Web on an untrusted PC, or
- send private documents (Aadhaar, PAN, marksheets, resumes) to a stranger's WhatsApp, or
- use cloud drives that keep the file forever.

The result is private files left behind on devices and accounts nobody controls.

## 3. Solution

1. Device A taps **Create a room** and gets a 6-digit code (and a QR code).
2. Device B types the code (or scans the QR) and joins. A room holds **exactly two devices**.
3. Either device can **send files** to the other at any time.
4. Files are **view-only in the browser** by default, but can be downloaded if needed.
5. When either side taps **End session**, or after 15 minutes of inactivity, the room and every file in it are deleted.

No accounts. No database of users. Nothing to back up.

## 4. Honest privacy promise (use this wording in the UI)

> "We don't keep your files. They're deleted when the session ends or after 15 minutes of inactivity."

Do **not** claim "the other person can't copy it". A browser viewer cannot stop screenshots or a determined user. "View-only" is a UI design choice that reduces accidental retention. It is not DRM. Never market it as one.

## 5. Goals and non-goals

**Goals**
- Dead simple: one main action per screen.
- Free to host, forever, on free tiers, with no servers to maintain.
- Works on low-end phones and old PCs (React, CSS).
- Secure by default: short-lived, single-pair, rate-limited, no logs of sensitive data.

**Non-goals (do NOT build)**
- Printing, print options, shop pages, shop names, shop QR posters.
- User accounts, login, passwords, email, phone numbers.
- Permanent storage, file history across sessions.
- Group rooms (more than two devices).
- Server-side file parsing, previews, thumbnails, or antivirus (not possible on the free runtime; see Section 9).
- Analytics or any third-party scripts.

## 6. Tech stack (fixed, do not add services)

| Layer | Choice | Why |
|---|---|---|
| Hosting and compute | **Cloudflare Workers** (TypeScript) | Serverless, free tier, no sleeping |
| Room state and timers | **Durable Objects, SQLite-backed** | Atomic single-use logic, WebSockets, alarms for auto-delete |
| File storage | **Cloudflare R2** | 10 GB free, zero egress fees |
| Frontend hosting | **Workers Static Assets** (same Worker) | One deploy, one URL |
| Frontend | React (Vite) + CSS | React framework with Vite build step |
| PDF viewing | **pdf.js**, pinned version, self-hosted in `/public/vendor` | No CDN dependency, CSP-friendly |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` | Runs Durable Objects locally |
| CI/CD | GitHub Actions running `wrangler deploy` on push to `main` | Zero manual deploys |

**Free-tier note:** Cloudflare's free tier has daily limits (about 100,000 Worker requests per day, Durable Objects free plan only supports SQLite-backed objects, R2 about 10 GB and 1M writes per month). On the free plan, going over a limit makes operations fail; it does not bill you. Verify current limits in Cloudflare's docs when you start, because they can change. R2 may require a payment method on file at signup even for the free allowance. Check this.

**Dependency rule:** keep runtime dependencies near zero. Use the platform's built-in Web APIs. Pin every version. Set a fixed `compatibility_date` in the Wrangler config so runtime changes never silently break the app.

## 7. User flows

### 7.1 Host (creates the room)
1. Opens `/`, taps **Get a code**.
2. Sees a large 6-digit code, a QR code, a countdown, and "Waiting for other device...".
3. When the guest joins, the screen switches to the **Room** view.

### 7.2 Guest (joins the room)
1. Opens `/`, types the 6-digit code (or scans the QR, which opens `/?code=123456`), taps **Connect**.
2. On success, goes straight to the **Room** view.

### 7.3 Inside the room (identical for both devices)
- Top bar: green "Connected" dot, "Room 123456", countdown, **End session** button.
- File list (newest at the bottom): icon, name, size, sender ("You" or "Other device"), time, **View** button.
- Fixed bottom button **Send a file** (and a secondary **Take photo**). Multiple files allowed.
- Sending shows a progress bar, then "Sent".
- **View** opens a full-screen viewer (PDF pages or image) with Previous/Next and **Back to room**. You can also download the file.

### 7.4 End and error states
- Code not found or expired.
- Too many wrong tries (with countdown).
- Other device disconnected (Wait / End session).
- Session ended, all files deleted (button: Start new session).

## 8. Architecture

```
Browser A (host)  ─┐                           ┌─ R2 bucket
                   ├─▶ Worker ─▶ RoomDO ──────▶│  (random UUID keys, no backups)
Browser B (guest) ─┘      │        │            └─
                          │        └─ alarm(): deletes R2 objects + wipes state
                          └─▶ LimiterDO (per-IP rate limits)
```

### 8.1 Durable Objects
- **RoomDO**: one instance per room. Found via `idFromName(code)`. Holds:
  - `status`: `waiting` | `active` | `ended`
  - hashed `hostToken` and `guestToken` (SHA-256; never store raw tokens)
  - file metadata rows: `id, r2Key, name, size, mime, senderRole, createdAt`
  - `lastActivityAt`, `expiresAt`
  - Uses the **WebSocket Hibernation API** to push live events to both devices.
  - Uses **`alarm()`** as the auto-delete timer. Every activity resets the alarm to 15 minutes ahead. Also enforce an absolute maximum room lifetime of 1 hour.
- **LimiterDO**: one instance per hashed client IP. Tracks request counts and failed joins with sliding windows.

### 8.2 Room lifecycle (all state transitions happen inside RoomDO, so they are atomic)
1. **create**: the Worker picks a random 6-digit code, then calls RoomDO `create()`. If that code already has a live room, the DO answers "exists" and the Worker retries with a new code. On success the DO returns a `hostToken`.
2. **join**: valid only while `status = waiting`. The DO verifies the code, creates a `guestToken`, sets `status = active`, and notifies the host over WebSocket. **After this, the code can never be used to join again.** A room has exactly two devices.
3. **active**: both devices can upload, list, view, and delete files. Each action resets the idle alarm.
4. **end**: triggered by either device (`POST /end`) or by the alarm. The DO deletes every R2 object it knows about, wipes its SQLite tables, broadcasts `ended`, and closes sockets.

### 8.3 Codes
- **6 digits**, because the code namespace is global. (A 4-digit code is NOT safe here: with only 10,000 values and several live rooms, brute force succeeds too easily.)
- A code is joinable only while the room is `waiting` (maximum 5 minutes) and only once.
- Never log codes.
- **UI note:** the Stitch screens may show 4 digit boxes. Change them to **6** digit boxes.

### 8.4 Auth between requests
- On create or join, the Worker sets an **HttpOnly, Secure, SameSite=Strict cookie** containing `roomCode.role.token`.
- Every room endpoint (including the WebSocket upgrade and file fetch) must verify this cookie against the hashed token in RoomDO.
- No token, wrong token, or wrong role gives 404 (not 403), so the existence of rooms isn't leaked.

### 8.5 Files
- Upload: `POST /api/rooms/:code/files`, with the filename in a header and the raw body streamed. Do not buffer the whole body in memory.
- Validation in the Worker, **before** storing:
  - Size limit: 15 MB per file.
  - Max 20 files and 50 MB total per room.
  - **Magic-byte check on the first bytes**: allow only PDF (`%PDF`), JPEG, PNG (and optionally WebP). Reject everything else regardless of extension or declared type.
  - Sanitize the filename (strip path characters and control characters, cap the length).
- Store in R2 under `rooms/{randomRoomId}/{randomUuid}`. Never use the code or the filename in the R2 key.
- Serving: `GET /api/rooms/:code/files/:fileId`, streamed from R2, only with a valid cookie. Headers:
  `Cache-Control: no-store`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and the stored (validated) content type.
- **Backstops for deletion** (in case an alarm ever fails):
  1. A Cron Trigger every hour deletes R2 objects older than 1 hour.
  2. An R2 lifecycle rule deletes objects after 1 day (the minimum granularity).
  3. An automated test proves normal deletion works.

### 8.6 API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/rooms` | Create room |
| POST | `/api/rooms/join` | Join with `{code}` |
| GET | `/api/rooms/:code/state` | Status, file list, expiry |
| GET | `/api/rooms/:code/ws` | WebSocket for live events |
| POST | `/api/rooms/:code/files` | Upload a file |
| GET | `/api/rooms/:code/files/:fileId` | Stream a file for viewing |
| DELETE | `/api/rooms/:code/files/:fileId` | Remove a file (its sender only) |
| POST | `/api/rooms/:code/end` | End session now |
| GET | `/health` | Uptime check |

**WebSocket events (server to client):** `peer_joined`, `peer_left`, `file_added`, `file_removed`, `ended`, `expires_at`. Client to server: a simple `ping` to count as activity.

## 9. Security requirements

- **Brute force:**
  - LimiterDO per IP: max 10 room creations per hour, max 5 failed joins per 10 minutes.
  - Also cap failed joins globally per minute so distributed guessing slows down.
- **Rate limits** on uploads: per IP per hour.
- **Headers on all pages:**
  - `Strict-Transport-Security`
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' blob: data:; connect-src 'self' wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera allowed only for "take photo").
- **Logging:** never log codes, tokens, filenames, or file contents. Keep Workers observability minimal or off. No analytics.
- **No server-side parsing of files.** The Worker only reads the first bytes for the magic-byte check. This limits attack surface and fits the 10 ms CPU limit. Antivirus scanning is not available on this runtime, so safety relies on the strict type allow-list, short life, and sandboxed rendering (pdf.js does not run PDF JavaScript).
- **Tokens:** generate with `crypto.getRandomValues` (32 bytes), compare in constant time, store only hashes.
- **Opened/deleted visibility:** both devices always see live status, so a surprise disconnect or an unexpected end is visible immediately.
- **Abuse handling:** a visible "Report abuse" link (mailto), a Terms and Privacy page in plain language, and a rule in the Terms against illegal content.
- **Legal:** this handles personal documents, so India's DPDP Act 2023 may apply. Add a short privacy policy. Get a legal review before real public use (this file is not legal advice).

## 10. Client-side features (cost the server nothing)

- **Image compression** before upload (canvas, max about 2000 px, quality about 0.8).
- **Take photo**: `<input type="file" accept="image/*" capture="environment">`.
- **Hide Aadhaar number (v1.1):** a simple "draw black boxes over areas" tool for images, applied before sending.
  - For PDFs, render the page to an image and **flatten** it. Never rely on drawing a box over live text, because the text stays recoverable underneath.
  - Optional later: auto-detect the first 8 digits with an on-device OCR library (runs fully in the browser, nothing leaves the device).
- **Languages:** English, Malayalam, Hindi via a simple JSON dictionary and a dropdown. Persist the choice in `localStorage`.

## 11. UI

The UI screens were designed in **Stitch** and exported as HTML.

- Convert the exported HTML/CSS to React components. **Keep the markup and styling.** Do not redesign, and do not introduce a CSS library.
- Wire the existing elements to the API using React state and hooks.
- Style tokens: white or light-grey background, primary teal `#0F766E`, success green, warning amber, Inter or system font, rounded 12 to 16 px corners, buttons at least 48 px tall.
- Screens: Home (create/join), Waiting, Room (connected), Send file sheet, File viewer, Status/error cards, "Share this app" QR card.
- Accessibility: visible focus states, labels on every input, never rely on colour alone.
- Compatibility: must work on old Android WebViews and older desktop Chrome. Avoid modern-only CSS or JS features without fallbacks.

## 12. Suggested repo structure

```
safe-drop/
├─ idea.md                # this file
├─ AGENTS.md              # rules for the AI agent (see Section 16)
├─ wrangler.jsonc         # DO bindings, R2 binding, static assets, cron, vars
├─ package.json
├─ src/
│  ├─ index.ts            # Worker entry, routing, headers, cookie auth
│  ├─ room.ts             # RoomDO
│  ├─ limiter.ts          # LimiterDO
│  ├─ files.ts            # magic bytes, filename sanitizer, size checks
│  └─ cron.ts             # hourly orphan cleanup
├─ frontend/              # React frontend
│  ├─ index.html
│  ├─ src/                # React components
│  └─ public/vendor/pdfjs/# pinned, self-hosted
├─ test/
└─ .github/workflows/deploy.yml
```

## 13. Build phases (finish and test each phase before the next)

1. **Skeleton:** Worker, static assets, `/health`, security headers, CI deploy to a `*.workers.dev` URL.
2. **RoomDO core:** create, join (once), end, alarm auto-delete, hashed tokens, cookie auth. Tests for all of it.
3. **Files:** upload with magic-byte validation, R2 storage, streamed viewing, delete, per-room limits, deletion on end.
4. **Realtime:** WebSocket events and idle-timer reset on activity.
5. **UI wiring:** connect the Stitch screens: create, join, room list, send, viewer (pdf.js and images).
6. **Hardening:** LimiterDO, global failed-join cap, cron cleanup, R2 lifecycle rule.
7. **Polish:** image compression, take-photo, Aadhaar box tool, three languages, error states, QR code generation, Terms and Privacy pages.
8. **Final checks:** run every item in Section 14 and the old-device test.

## 14. Acceptance tests (automated where possible)

- A code can join exactly once; a third device can never join.
- Wrong code, expired code, ended room, and never-existed code all return the same 404.
- 6 failed joins from one IP trigger rate limiting lockout.
- Uploading a `.exe` renamed to `.pdf` is rejected (magic bytes).
- Files over 15 MB, more than 20 files, or over 50 MB total are rejected.
- A guest cannot delete the host's file, and the reverse.
- `End session` deletes all R2 objects and DO state (verify by listing the bucket).
- Idle for 15 minutes (use a short test timeout) triggers the alarm and a full wipe.
- File fetch without a valid cookie returns 404.
- Responses for files include `no-store` and `nosniff`.
- Logs contain no codes, tokens, or filenames.
- Manual: test on an old Android phone and an old desktop Chrome.

## 15. Zero-maintenance practices

- Near-zero dependencies, all pinned. Fixed `compatibility_date`.
- All data self-deletes. No migrations, no backups, no database growth.
- Free uptime monitoring (a ping on `/health`) with email alerts, plus Cloudflare notifications.
- Auto-deploy on push to `main`.
- Once a year: re-check Cloudflare free-tier limits and update dependencies (about 30 minutes).
- Document the "if the free tier changes" fallback: the paid Workers plan is about $5/month and the code is unchanged.

## 16. Rules for the AI agent (copy into `AGENTS.md`)

- Follow `idea.md` exactly. If something is ambiguous or you want to deviate, ask first.
- Use only the stack in Section 6. Do not add databases, auth providers, or SaaS.
- Prefer built-in Web APIs. Justify every new dependency in the PR description.
- TypeScript on the server, React on the client, no CSS libraries.
- Never log codes, tokens, filenames, or file contents.
- Never store raw tokens. Never put codes or filenames in R2 keys.
- Write tests alongside each phase. Do not move to the next phase with failing tests.
- Keep Worker code CPU-light (the free plan allows about 10 ms CPU per request). No heavy processing on the server.
- Keep the code small, commented, and readable. The project owner will maintain it alone.
- Review security-critical code (RoomDO, cookie auth, file validation) especially carefully and explain it in comments.

## 17. Open decisions for the owner

- Final project name and domain (free option: `*.workers.dev`; custom domain is about ₹800/year).
- Keep both directions of sharing, or allow host-only sending? (Default: both directions.)
- Add an optional "Save a copy" button? (Default: no.)
- Idle timeout: 15 minutes by default; the absolute maximum room life is 1 hour.
- Contact email for abuse reports.

## 18. Future ideas (not in v1)

- End-to-end encryption using a PAKE handshake so the server never sees file contents.
- Multi-device rooms (3 or more) with a host approval step.
- Text snippets and links alongside files.
- Installable PWA with offline shell.
- Optional auto-detect Aadhaar masking with on-device OCR.