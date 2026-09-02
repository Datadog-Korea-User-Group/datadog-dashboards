import { createHash } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);

/** Same directory and naming the preview worker uses, so manual and auto shots interchange. */
export const UPLOAD_DIR = path.join(process.cwd(), "public", "screenshots", "uploads");
const prefix = (dashboardId: number, revision: number) => `u-${dashboardId}-${revision}-`;
const fileName = (dashboardId: number, revision: number, hash: string) =>
  `${prefix(dashboardId, revision)}${hash}.webp`;

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

/**
 * Writes the prepared image and returns the screenshot_url to store.
 *
 * The content hash is in the name, not a ?v= query: the image optimizer rejects a
 * query string, and a new name is what actually busts the immutable cache header.
 * Older shots for the same revision are removed once the new one is on disk.
 */
export async function writeScreenshot(webp: Buffer, dashboardId: number, revision: number): Promise<string> {
  const hash = createHash("sha256").update(webp).digest("hex").slice(0, 8);
  const name = fileName(dashboardId, revision, hash);

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), webp);

  // Best effort: a leftover file costs disk, never correctness.
  try {
    const stale = (await readdir(UPLOAD_DIR)).filter(
      (f) => f.startsWith(prefix(dashboardId, revision)) && f.endsWith(".webp") && f !== name,
    );
    await Promise.all(stale.map((f) => unlink(path.join(UPLOAD_DIR, f)).catch(() => {})));
  } catch {
    /* directory unreadable: the new file is written, which is what matters */
  }

  return `/screenshots/uploads/${name}`;
}
