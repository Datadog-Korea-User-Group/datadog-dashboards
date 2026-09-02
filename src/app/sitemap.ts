import type { MetadataRoute } from "next";
import { listSitemapDashboards } from "@/db/queries";
import { routing } from "@/i18n/routing";
import { absolute, languageAlternates } from "@/lib/site-url";

export const dynamic = "force-dynamic";

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
  const dashboards = await listSitemapDashboards();
  return [
    ...entries("", undefined, 1),
    ...entries("/dashboards", undefined, 0.9),
    ...dashboards.flatMap((d) => entries(`/dashboards/${d.slug}`, d.updatedAt, 0.7)),
  ];
}
