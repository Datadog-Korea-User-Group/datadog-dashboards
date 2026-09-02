import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getDashboardBySlug } from "@/db/queries";
import { qualityBand } from "@/components/QualityBadge";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Datadog Dashboards";

const SITE = "Datadog Dashboards · Datadog Korea User Group";
const BRAND = "#632ca6";
const BLUE = "#006bc2";
const BAR = 90;
const SHOT_HEIGHT = size.height - BAR;

const headers = { "Cache-Control": "public, max-age=86400, s-maxage=86400" };

// Rendering an OG card costs a jsonb read, a sharp re-encode and a Satori layout, and the
// result only changes with the revision. Keep the bytes next to the image cache volume.
// undefined = not probed yet, null = nowhere writable, so stop trying.
let cacheDir: string | null | undefined;

async function dir(): Promise<string | null> {
  if (cacheDir !== undefined) return cacheDir;
  for (const candidate of [path.join(process.cwd(), ".next", "cache", "og"), path.join(os.tmpdir(), "dd-og")]) {
    try {
      await mkdir(candidate, { recursive: true });
      return (cacheDir = candidate);
    } catch {
      /* try the next one */
    }
  }
  return (cacheDir = null);
}

const png = (bytes: Buffer | Uint8Array) =>
  new Response(new Uint8Array(bytes), { headers: { ...headers, "content-type": "image/png" } });

async function cached(key: string): Promise<Buffer | null> {
  const base = await dir();
  if (!base) return null;
  try {
    return await readFile(path.join(base, `${key}.png`));
  } catch {
    return null;
  }
}

/** Renders, stores and returns the PNG. A cache write failure must not fail the request. */
async function renderAndStore(key: string | null, element: React.ReactElement): Promise<Response> {
  const bytes = Buffer.from(await new ImageResponse(element, { ...size, headers }).arrayBuffer());
  const base = key ? await dir() : null;
  if (base && key) await writeFile(path.join(base, `${key}.png`), bytes).catch(() => {});
  return png(bytes);
}

// A huge screenshot is not worth decoding for a 1200x630 card.
const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Satori cannot decode webp, so sharp re-encodes the screenshot as a JPEG data URL. */
const SHOT_ROOT = path.join(process.cwd(), "public", "screenshots");

async function screenshotDataUrl(screenshotUrl: string): Promise<string | null> {
  try {
    // The column is data, so treat it as untrusted: resolve, then require the result to
    // stay under public/screenshots and to name a .webp file.
    const target = path.resolve(process.cwd(), "public", `.${new URL(screenshotUrl, "http://x").pathname}`);
    if (!target.startsWith(SHOT_ROOT + path.sep)) return null;
    if (!/^[\w.-]+\.webp$/.test(path.basename(target))) return null;

    if ((await stat(target)).size > MAX_SHOT_BYTES) return null;

    const file = await readFile(target);
    const jpeg = await sharp(file)
      .resize(size.width, SHOT_HEIGHT, { fit: "cover", position: "top" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

function Fallback({ title, description }: { title: string; description: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 80px",
        background: `linear-gradient(135deg, ${BRAND} 0%, ${BLUE} 100%)`,
        color: "#fff",
      }}
    >
      <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>{truncate(title, 70)}</div>
      {description ? (
        <div style={{ fontSize: 30, marginTop: 24, opacity: 0.85 }}>{truncate(description, 110)}</div>
      ) : null}
      <div style={{ fontSize: 24, marginTop: 40, opacity: 0.75 }}>{SITE}</div>
    </div>
  );
}

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Never throw: an unknown slug still has to return an image.
  const found = await getDashboardBySlug(slug).catch(() => null);
  if (!found?.dashboard.isPublished) {
    return renderAndStore(null, <Fallback title="Datadog Dashboards" description="Community dashboards for Datadog." />);
  }

  const d = found.dashboard;
  const key = `${d.id}-${found.latest?.revision ?? 0}`;
  const hit = await cached(key);
  if (hit) return png(hit);

  const shot = d.screenshotUrl ? await screenshotDataUrl(d.screenshotUrl) : null;
  if (!shot) {
    return renderAndStore(key, <Fallback title={d.title} description={d.description} />);
  }

  const band = qualityBand(d.qualityScore);
  const pill = { good: "#2a7e41", fair: "#c15800", poor: "#bc2b3c", unknown: "#585f70" }[band];

  return renderAndStore(
    key,
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
        <img src={shot} width={size.width} height={SHOT_HEIGHT} alt="" style={{ objectFit: "cover" }} />
        <div style={{ height: BAR, display: "flex", alignItems: "center", gap: 20, padding: "0 32px", borderTop: `4px solid ${BRAND}` }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#1c2b34" }}>{truncate(d.title, 52)}</div>
            <div style={{ fontSize: 17, color: "#1c2b34ad" }}>{SITE}</div>
          </div>
          {band !== "unknown" ? (
            <div style={{ display: "flex", fontSize: 20, fontWeight: 700, color: "#fff", background: pill, borderRadius: 999, padding: "8px 18px" }}>
              {`${band[0].toUpperCase()}${band.slice(1)} ${d.qualityScore}`}
            </div>
          ) : null}
        </div>
      </div>
    ),
  );
}
