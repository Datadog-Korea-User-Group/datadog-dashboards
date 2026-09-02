import Image from "next/image";
import { Download, Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { DashboardListItem } from "@/db/queries";
import { LocalTime } from "./LocalTime";
import { QualityBadge } from "./QualityBadge";

/** Datadog "Dashboard List" table: Name · Popularity · Author · Quality · Modified. */
export async function DashboardTable({ items }: { items: DashboardListItem[] }) {
  const t = await getTranslations("list");
  const td = await getTranslations("detail");
  const max = Math.max(1, ...items.map((i) => i.downloads));

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="w-1/2">{t("name")}</th>
            <th className="w-40">{t("popularity")}</th>
            <th className="w-44">{t("author")}</th>
            <th className="w-28">{t("quality")}</th>
            <th className="w-28">{t("modified")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <td>
                <Link href={`/dashboards/${d.slug}`} className="font-semibold hover:text-primary">
                  {d.title}
                </Link>
                {d.tags.length > 0 ? (
                  <span className="ml-2 inline-flex gap-1 align-middle">
                    {d.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="pill pill-neutral">{tag}</span>
                    ))}
                  </span>
                ) : null}
                {d.description ? <p className="text-xs muted line-clamp-1 mt-0.5">{d.description}</p> : null}
              </td>
              <td>
                <div className="flex items-center gap-2" title={td("downloads", { count: d.downloads.toLocaleString() })}>
                  <span className="h-1.5 flex-1 max-w-24 rounded-full bg-bg-tertiary overflow-hidden">
                    <span className="block h-full bg-brand" style={{ width: `${Math.round((d.downloads / max) * 100)}%` }} />
                  </span>
                  <Download size={12} className="text-text-tertiary shrink-0" />
                  <span className="text-xs tabular-nums muted">{d.downloads.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-xs muted" title={td("views", { count: d.views.toLocaleString() })}>
                  <Eye size={12} className="shrink-0" />
                  <span className="tabular-nums">{d.views.toLocaleString()}</span>
                </div>
              </td>
              <td>
                {d.authorUsername ? (
                  <Link href={`/users/${d.authorUsername}`} className="flex items-center gap-1.5 hover:text-primary">
                    {d.authorImage ? (
                      <Image src={d.authorImage} alt="" width={20} height={20} className="rounded-full" unoptimized />
                    ) : null}
                    <span className="truncate">{d.authorUsername}</span>
                  </Link>
                ) : d.sourceOrgName ? (
                  <span className="muted truncate">{d.sourceOrgName}</span>
                ) : (
                  <span className="text-text-tertiary">—</span>
                )}
              </td>
              <td><QualityBadge score={d.qualityScore} /></td>
              <td className="text-xs muted whitespace-nowrap">
                <LocalTime value={d.updatedAt} mode="date" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
