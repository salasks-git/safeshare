// src/cron.ts
// Hourly cron cleanup: delete any R2 objects older than 1 hour as a backstop
// in case a RoomDO alarm ever failed. This runs inside the Worker, not a DO.

interface Env {
  FILES_KV: KVNamespace;
}

export async function handleCron(env: Env): Promise<void> {
  // KV has a built-in TTL which we set on upload (expirationTtl: 3600).
  // No need for a manual cron job to delete old files in KV!
  return;
}
