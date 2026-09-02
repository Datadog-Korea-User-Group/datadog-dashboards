import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { DASHBOARDS_TAG, listSitemapDashboards } from "@/db/queries";
import { routing } from "@/i18n/routing";
import { absolute, languageAlternates } from "@/lib/site-url";

// Dynamic so SITE_URL comes from the running container, not from the build. The row
// scan behind it is cached, which is the part that actually costs.
export const dynamic = "force-dynamic";

const cachedDashboards = unstable_cache(listSitemapDashboards, ["sitemap-dashboards"], {
  revalidate: 3600,
  tags: [DASHBOARDS_TAG],
});

/** One entry per locale per page, each carrying the hreflang set. */
function entries(path: string, lastModified?: Date, priority?: number): MetadataRoute.Sitemap {
  return routing.locales.map((locale) => ({
    url: absolute(locale, path),
    lastModified,
    priority,
    alternates: { languages: languageAlternates(path) },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dashboards = await cachedDashboards();
  return [
    ...entries("", undefined, 1),
    ...entries("/dashboards", undefined, 0.9),
    ...dashboards.flatMap((d) => entries(`/dashboards/${d.slug}`, d.updatedAt, 0.7)),
  ];
}
