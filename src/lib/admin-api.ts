import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token gate for the preview endpoints, which are driven by a local CLI and so
 * carry no session cookie. Returns null when the caller is authorized, otherwise the
 * response to send. With no token configured the endpoints do not exist.
 */
export function requireAdminToken(request: Request): Response | null {
  const expected = process.env.ADMIN_API_TOKEN ?? "";
  if (!expected) return new Response("Not found", { status: 404 });

  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";

  // timingSafeEqual throws on a length mismatch, so compare lengths first. That leaks
  // the token length only, which is the standard trade for a constant-time compare.
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
