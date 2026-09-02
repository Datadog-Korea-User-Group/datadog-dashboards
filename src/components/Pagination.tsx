import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function Pagination({
  page, pages, params, basePath = "/dashboards",
}: {
  page: number;
  pages: number;
  params: Record<string, string | undefined>;
  basePath?: string;
}) {
  const t = await getTranslations("list");
  if (pages <= 1) return null;

  const href = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (n > 1) sp.set("page", String(n));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn btn-secondary"><ChevronLeft size={14} />{t("prev")}</Link>
      ) : (
        <span className="btn btn-secondary opacity-50 pointer-events-none"><ChevronLeft size={14} />{t("prev")}</span>
      )}
      <span className="text-xs muted">{t("page", { page, pages })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className="btn btn-secondary">{t("next")}<ChevronRight size={14} /></Link>
      ) : (
        <span className="btn btn-secondary opacity-50 pointer-events-none">{t("next")}<ChevronRight size={14} /></span>
      )}
    </nav>
  );
}
