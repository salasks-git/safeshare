// src/limiter.ts
// LimiterDO: per-hashed-IP rate limiting using a simple in-memory sliding window.
// One Durable Object instance per hashed IP. Uses plain JS Map (no SQLite needed).

export class LimiterDO implements DurableObject {
  private creates: number[] = [];    // timestamps of room creations
  private failedJoins: number[] = []; // timestamps of failed join attempts

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1); // 'create' | 'failed-join' | 'check-join'
    const now = Date.now();

    if (action === 'create') {
      // Max 10 creations per hour
      const window = 3600_000;
      this.creates = this.creates.filter(t => now - t < window);
      if (this.creates.length >= 10) {
        return new Response('rate_limited', { status: 429 });
      }
      this.creates.push(now);
      return new Response('ok');
    }

    if (action === 'failed-join') {
      // Record a failed join attempt
      const window = 600_000; // 10 minutes
      this.failedJoins = this.failedJoins.filter(t => now - t < window);
      this.failedJoins.push(now);
      return new Response(String(this.failedJoins.length));
    }

    if (action === 'check-join') {
      // Returns current failed-join count in last 10 min
      const window = 600_000;
      this.failedJoins = this.failedJoins.filter(t => now - t < window);
      return new Response(String(this.failedJoins.length));
    }

    return new Response('not_found', { status: 404 });
  }
}
