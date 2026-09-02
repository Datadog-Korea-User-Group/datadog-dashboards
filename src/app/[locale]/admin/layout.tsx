import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Every admin route re-checks the session server-side; non-admins get a 404, not a redirect. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user?.role !== "admin") notFound();

  const t = await getTranslations("admin");
  const tabs = [
    { href: "/admin", label: t("overview") },
    { href: "/admin/reviews", label: t("reviews") },
    { href: "/admin/comments", label: t("comments") },
    { href: "/admin/dashboards", label: t("dashboards") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <nav className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="btn btn-secondary btn-sm">{tab.label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
