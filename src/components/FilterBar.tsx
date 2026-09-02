import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { QUALITY_BANDS, SORTS, type IntegrationCount, type QualityBand, type Sort } from "@/db/queries";

/**
 * Plain GET form — filters are searchParams, so the list page stays a server component.
 * Submitting drops `page`, which resets paging to 1.
 */
export async function FilterBar({
  q, integration, quality, sort, tag, integrations,
}: {
  q?: string;
  integration?: string;
  quality?: QualityBand;
  sort: Sort;
  tag?: string;
  integrations: IntegrationCount[];
}) {
  const t = await getTranslations("list");
  const tq = await getTranslations("quality");
  const sortLabel: Record<Sort, string> = {
    downloads: t("sortDownloads"), views: t("sortViews"), newest: t("sortNewest"), rating: t("sortRating"), source: t("sortSource"),
  };

  return (
    <form className="card p-3 flex flex-wrap items-end gap-3">
      {tag ? <input type="hidden" name="tag" value={tag} /> : null}

      <label className="flex-1 min-w-56 flex flex-col gap-1">
        <span className="text-xs font-semibold muted">{t("search")}</span>
        <span className="relative block">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input name="q" defaultValue={q ?? ""} className="input w-full pl-8" placeholder={t("search")} />
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold muted">{t("filterIntegration")}</span>
        <select name="integration" defaultValue={integration ?? ""} className="input min-w-40">
          <option value="">{t("any")}</option>
          {integrations.map((i) => (
            <option key={i.name} value={i.name}>{i.name} ({i.count})</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold muted">{t("filterQuality")}</span>
        <select name="quality" defaultValue={quality ?? ""} className="input min-w-32">
          <option value="">{t("any")}</option>
          {QUALITY_BANDS.map((b) => (
            <option key={b} value={b}>{tq(b)}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold muted">{t("sort")}</span>
        <select name="sort" defaultValue={sort} className="input min-w-44">
          {SORTS.map((s) => (
            <option key={s} value={s}>{sortLabel[s]}</option>
          ))}
        </select>
      </label>

      <button type="submit" className="btn btn-primary">{t("apply")}</button>
    </form>
  );
}
