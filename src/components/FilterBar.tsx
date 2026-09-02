"use client";

import { Search } from "lucide-react";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { QUALITY_BANDS, SORTS, type QualityBand, type Sort } from "@/lib/list-params";
import type { IntegrationCount } from "@/db/queries";

/**
 * Selects navigate on change; the search box still submits the form (Enter or Apply).
 * Both paths serialize the same form, so each keeps the other's current values, and
 * `page` is dropped either way because it is not a field.
 */
export function FilterBar({
  q, integration, quality, sort, tag, integrations,
}: {
  q?: string;
  integration?: string;
  quality?: QualityBand;
  sort: Sort;
  tag?: string;
  integrations: IntegrationCount[];
}) {
  const t = useTranslations("list");
  const tq = useTranslations("quality");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const sortLabel: Record<Sort, string> = {
    downloads: t("sortDownloads"), views: t("sortViews"), newest: t("sortNewest"), rating: t("sortRating"), source: t("sortSource"),
  };

  function apply(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string" && value) params.set(key, value);
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); apply(e.currentTarget); }}
      className={`card p-3 flex flex-wrap items-end gap-3 transition-opacity ${pending ? "opacity-60" : ""}`}
    >
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
        <select
          name="integration"
          defaultValue={integration ?? ""}
          onChange={(e) => apply(e.currentTarget.form!)}
          className="input min-w-40"
        >
          <option value="">{t("any")}</option>
          {integrations.map((i) => (
            <option key={i.name} value={i.name}>{i.name} ({i.count})</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold muted">{t("filterQuality")}</span>
        <select
          name="quality"
          defaultValue={quality ?? ""}
          onChange={(e) => apply(e.currentTarget.form!)}
          className="input min-w-32"
        >
          <option value="">{t("any")}</option>
          {QUALITY_BANDS.map((b) => (
            <option key={b} value={b}>{tq(b)}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold muted">{t("sort")}</span>
        <select
          name="sort"
          defaultValue={sort}
          onChange={(e) => apply(e.currentTarget.form!)}
          className="input min-w-44"
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>{sortLabel[s]}</option>
          ))}
        </select>
      </label>

      <button type="submit" className="btn btn-primary">{t("apply")}</button>
    </form>
  );
}
