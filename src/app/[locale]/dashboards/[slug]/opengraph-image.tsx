import { readFile } from "node:fs/promises";
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
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Satori cannot decode webp, so sharp re-encodes the screenshot as a JPEG data URL. */
async function screenshotDataUrl(screenshotUrl: string): Promise<string | null> {
  try {
    const file = await readFile(path.join(process.cwd(), "public", screenshotUrl));
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
    return new ImageResponse(<Fallback title="Datadog Dashboards" description="Community dashboards for Datadog." />, { ...size, headers });
  }

  const d = found.dashboard;
  const shot = d.screenshotUrl ? await screenshotDataUrl(d.screenshotUrl) : null;
  if (!shot) {
    return new ImageResponse(<Fallback title={d.title} description={d.description} />, { ...size, headers });
  }

  const band = qualityBand(d.qualityScore);
  const pill = { good: "#2a7e41", fair: "#c15800", poor: "#bc2b3c", unknown: "#585f70" }[band];

  return new ImageResponse(
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
    { ...size, headers },
  );
}
