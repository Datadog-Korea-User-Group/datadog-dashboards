import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
    // Optimized variants are revalidated hourly against the file on disk, so re-captured screenshots refresh without
    // cache-busting query strings (which would let anyone mint unbounded optimizer cache entries).
    minimumCacheTTL: 3600,
    localPatterns: [{ pathname: "/screenshots/**", search: "" }],
    deviceSizes: [640, 960, 1280, 1920],
    imageSizes: [320, 480],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Screenshots keep a stable path and may be re-captured; an hour of client caching is enough.
        source: "/screenshots/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
