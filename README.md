# Safe-Drop

Connect two devices with a short code, then share files between them in both directions. No login, no install, no download button. Everything deletes itself when the session ends.

## Privacy Promise

> "We don't keep your files. They're deleted when the session ends or after 15 minutes of inactivity."

## Features

- **Dead simple:** One main action per screen.
- **No accounts:** Nothing to back up, no database of users.
- **Auto-deleting:** Files and sessions disappear when ended or after 15 minutes of inactivity.
- **Secure by default:** Short-lived codes, single-pair sessions, rate-limited, and no logs of sensitive data.

## Tech Stack

- **Cloudflare Workers (TypeScript):** Serverless compute.
- **Durable Objects (SQLite-backed):** Atomic single-use room state and WebSocket logic.
- **Cloudflare KV:** File storage (random UUID keys, short-lived).
- **React (Vite) + CSS:** Fast, lightweight frontend running on Workers Static Assets.

## Development

The project is structured into a Cloudflare Worker backend and a React Vite frontend.

1. **Install dependencies:**
   ```bash
   npm install
   cd frontend
   npm install
   ```

2. **Run locally:**
   Start the Cloudflare Worker and frontend development servers.
   ```bash
   npm run dev
   ```

## Deployment

Pushes to the `main` branch are automatically deployed via GitHub Actions using the `wrangler deploy` command.

## Security

- Codes are 6 digits and can only be used once to join a room.
- All files are scanned for valid magic bytes (e.g., PDF, JPEG, PNG) to prevent malicious executables.
- IP-based rate limiting is enforced for room creation and file uploads.
