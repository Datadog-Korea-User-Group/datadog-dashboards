// Minimal Datadog API client for the migration (Bearer PAT).
import "../env";

const PAT = process.env.DD_PAT;
const API_KEY = process.env.DD_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
const SITE = process.env.DD_SITE ?? "datadoghq.com";

/** Bearer PAT when present, otherwise API key + application key. */
export function authHeaders(): Record<string, string> {
  if (PAT) return { Authorization: `Bearer ${PAT}` };
  if (API_KEY && APP_KEY) return { "DD-API-KEY": API_KEY, "DD-APPLICATION-KEY": APP_KEY };
  throw new Error("Set DD_PAT, or DD_API_KEY and DD_APP_KEY, in .env.local");
}
export const DD_APP = `https://app.${SITE}`;
const API = `https://api.${SITE}/api`;

export class DdApiError extends Error {
  constructor(public readonly status: number, public readonly body: string, public readonly url: string) { super(`${status} ${url}: ${body.slice(0, 400)}`); }
}

export async function dd<T>(method: string, path: string, body?: unknown, attempt = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000), // a flapping link must not hang a wave for the TCP timeout
    });
  } catch (e) {
    // network error / timeout: retry with backoff. Creating a dashboard is the one non-idempotent call (a lost
    // response would leave an untracked duplicate), so that one surfaces the error and is retried by the next wave.
    if (attempt > 5 || (method === "POST" && path === "/v1/dashboard")) throw e;
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return dd<T>(method, path, body, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 5) throw new DdApiError(res.status, await res.text(), path);
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
    await new Promise((r) => setTimeout(r, Math.max(2000 * attempt, reset * 1000)));
    return dd<T>(method, path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new DdApiError(res.status, text, path);
  return (text ? JSON.parse(text) : {}) as T;
}
