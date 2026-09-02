import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);

/** Same directory and naming the preview worker uses, so manual and auto shots interchange. */
export const UPLOAD_DIR = path.join(process.cwd(), "public", "screenshots", "uploads");
const fileName = (dashboardId: number, revision: number) => `u-${dashboardId}-${revision}.webp`;

export type PreparedScreenshot = { ok: true; webp: Buffer | null } | { ok: false };

/**
 * Validates and re-encodes an uploaded screenshot. Runs before the dashboard row exists,
 * so a bad file is rejected without leaving a half-made dashboard behind.
 *
 * `webp: null` means no file was supplied, which is not an error.
 */
export async function prepareScreenshot(
  file: File | null | undefined,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<PreparedScreenshot> {
  if (!file || file.size === 0) return { ok: true, webp: null };
  if (file.size > maxBytes) return { ok: false };

  try {
    const input = Buffer.from(await file.arrayBuffer());
    // Sniff the real format; the browser-supplied type is attacker-controlled.
    const { format } = await sharp(input).metadata();
    if (!format || !ALLOWED_FORMATS.has(format)) return { ok: false };

    const webp = await sharp(input)
      .resize(1920, 1080, { fit: "cover", position: "top" })
      .webp({ quality: 75 })
      .toBuffer();
    return { ok: true, webp };
  } catch {
    // Corrupt or malicious image data: sharp throws rather than returning metadata.
    return { ok: false };
  }
}

/** Writes the prepared image and returns the screenshot_url to store. */
export async function writeScreenshot(webp: Buffer, dashboardId: number, revision: number): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, fileName(dashboardId, revision)), webp);
  // The query string busts the immutable cache header when a file is replaced.
  return `/screenshots/uploads/${fileName(dashboardId, revision)}?v=${Date.now()}`;
}
