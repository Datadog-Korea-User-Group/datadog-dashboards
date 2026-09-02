import { getTranslations, setRequestLocale } from "next-intl/server";
import { listDashboards, listIntegrations, parseQuality, parseSort } from "@/db/queries";
import { DashboardTable } from "@/components/DashboardTable";
import { FilterBar } from "@/components/FilterBar";
import { Pagination } from "@/components/Pagination";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function DashboardsPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("list");

  const q = one(sp.q);
  const tag = one(sp.tag);
  const integration = one(sp.integration);
  const quality = parseQuality(one(sp.quality));
  const sort = parseSort(one(sp.sort));
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const [{ items, total, pages }, integrations] = await Promise.all([
    listDashboards({ q, tag, integration, quality, sort, page }),
    listIntegrations(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <span className="text-xs muted">{t("results", { count: total.toLocaleString() })}</span>
      </div>

      <FilterBar q={q} tag={tag} integration={integration} quality={quality} sort={sort} integrations={integrations} />

      {items.length === 0 ? (
        <div className="card p-10 text-center muted">{t("empty")}</div>
      ) : (
        <>
          <DashboardTable items={items} />
          <Pagination page={page} pages={pages} params={{ q, tag, integration, quality, sort }} />
        </>
      )}
    </div>
  );
}
