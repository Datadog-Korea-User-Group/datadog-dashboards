import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Dynamic: SITE_URL is supplied to the container at runtime, not at build time.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/upload", "/*/edit"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
