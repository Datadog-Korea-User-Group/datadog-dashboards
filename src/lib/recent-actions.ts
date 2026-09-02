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

/** First hop of x-forwarded-for is the client; the rest are proxies we do not trust. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]!.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}
