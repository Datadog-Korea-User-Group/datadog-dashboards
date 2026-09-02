/**
 * Remembers "this client already did X recently" so a refresh loop cannot inflate a
 * counter. In-memory and per-process: a restart or a second instance forgets, which
 * only costs an extra count, never a wrong page.
 *
 * ponytail: single Map with insertion-order eviction. Swap for Redis if the site ever
 * runs more than one instance and the counts have to agree.
 */
const MAX_ENTRIES = 50_000;
const seen = new Map<string, number>();

/** First caller within `windowMs` gets true; repeats get false. */
export function firstInWindow(key: string, windowMs: number): boolean {
  const now = Date.now();
  const previous = seen.get(key);
  if (previous !== undefined && now - previous < windowMs) return false;

  // Map iterates in insertion order, so the first key is the oldest.
  seen.set(key, now);
  if (seen.size > MAX_ENTRIES) {
    const oldest = seen.keys().next();
    if (!oldest.done) seen.delete(oldest.value);
  }
  return true;
}

/**
 * Last hop of x-forwarded-for, not the first: our own proxy appends the peer it saw, so
 * the trailing entry is the only one a client cannot forge by sending its own header.
 */
export function clientIp(request: Request): string {
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || request.headers.get("x-real-ip")?.trim() || "unknown";
}
