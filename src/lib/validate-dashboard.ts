export const MAX_JSON_BYTES = 2 * 1024 * 1024;

export type DashboardJson = {
  title?: string;
  layout_type: "ordered" | "free";
  widgets: unknown[];
  [key: string]: unknown;
};

/** Message key under `upload.errors` in messages/*.json. */
export type DashboardJsonError = "invalidJson" | "notDashboard" | "tooLarge";

export type ValidateResult =
  | { ok: true; json: DashboardJson }
  | { ok: false; error: DashboardJsonError };

/** Shape check for uploaded Datadog dashboard exports. Never evaluates the input. */
export function validateDashboardJson(raw: string): ValidateResult {
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) return { ok: false, error: "tooLarge" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalidJson" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "invalidJson" };
  }

  const o = parsed as Record<string, unknown>;
  const layoutOk = o.layout_type === "ordered" || o.layout_type === "free";
  if (!layoutOk || !Array.isArray(o.widgets) || typeof o.title !== "string" || !o.title.trim()) {
    return { ok: false, error: "notDashboard" };
  }

  return { ok: true, json: o as DashboardJson };
}
