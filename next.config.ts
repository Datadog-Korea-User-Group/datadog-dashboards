import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
    deviceSizes: [640, 960, 1280, 1920],
    imageSizes: [320, 480],
  },
  async headers() {
    return [
      {
        // Screenshots are content-addressed by source id and never rewritten.
        source: "/screenshots/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
