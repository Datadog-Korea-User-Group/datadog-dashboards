import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Datadog Dashboards · Datadog Korea User Group";

/** Site-wide card. Detail pages override this with their own screenshot image. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 80px",
          background: "linear-gradient(135deg, #632ca6 0%, #006bc2 100%)",
          color: "#fff",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700 }}>Datadog Dashboards</div>
        <div style={{ fontSize: 32, marginTop: 24, opacity: 0.9 }}>
          Community dashboards for Datadog. Browse, download, import.
        </div>
        <div style={{ fontSize: 24, marginTop: 48, opacity: 0.75 }}>Datadog Korea User Group</div>
      </div>
    ),
    { ...size, headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } },
  );
}
