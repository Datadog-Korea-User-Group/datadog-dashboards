import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { getDashboardBySlug, getRevisionJson } from "@/db/queries";
import { RevisionForm } from "./RevisionForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditDashboardPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [found, session] = await Promise.all([getDashboardBySlug(slug), auth()]);
  if (!found) notFound();

  const isOwner = !!session?.user?.id && session.user.id === found.dashboard.authorId;
  if (!isOwner && session?.user?.role !== "admin") notFound();

  // The editor needs the actual JSON; the detail query no longer carries it.
  const latest = await getRevisionJson(found.dashboard.id);
  const t = await getTranslations("detail");
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t("edit")}</h1>
        <p className="muted text-sm">{found.dashboard.title}</p>
      </div>
      <RevisionForm slug={slug} json={JSON.stringify(latest?.dashboardJson ?? {}, null, 2)} />
    </div>
  );
}
