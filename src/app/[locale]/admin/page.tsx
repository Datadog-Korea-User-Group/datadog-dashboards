import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAdminOverview } from "@/db/queries";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  const { pendingDashboards, pendingRevisions, recentComments } = await getAdminOverview();

  const cards = [
    { href: "/admin/reviews", label: t("pendingDashboards"), value: pendingDashboards },
    { href: "/admin/reviews", label: t("pendingRevisions"), value: pendingRevisions },
    { href: "/admin/comments", label: t("recentComments"), value: recentComments },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c, i) => (
        <Link key={i} href={c.href} className="card card-hover p-5 flex flex-col gap-1">
          <span className="text-2xl font-bold tabular-nums">{c.value}</span>
          <span className="text-xs muted">{c.label}</span>
        </Link>
      ))}
    </div>
  );
}
