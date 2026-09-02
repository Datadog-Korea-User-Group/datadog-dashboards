import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { getUserByUsername, listDashboards, listOwnDashboards, parseSort } from "@/db/queries";
import { DashboardTable } from "@/components/DashboardTable";
import { LocalTime } from "@/components/LocalTime";
import { ReviewPill } from "@/components/ReviewPill";
import { Link } from "@/i18n/navigation";
import { Pagination } from "@/components/Pagination";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; username: string }> }): Promise<Metadata> {
  const { locale, username } = await params;
  const user = await getUserByUsername(username);
  if (!user) return { robots: { index: false } };
  const t = await getTranslations({ locale, namespace: "user" });
  return { title: t("dashboards", { name: user.name ?? user.username ?? username }), robots: { index: false, follow: true } };
}

export default async function UserPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string; username: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale, username } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const t = await getTranslations("user");
  const tl = await getTranslations("list");

  const sort = parseSort(one(sp.sort));
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const { items, total, pages } = await listDashboards({ authorId: user.id, sort, page });

  // Only the owner and admins see what has not cleared review yet.
  const session = await auth();
  const canSeeOwn = session?.user?.id === user.id || session?.user?.role === "admin";
  const own = canSeeOwn ? await listOwnDashboards(user.id) : [];
  const trv = await getTranslations("review");

  return (
    <div className="flex flex-col gap-4">
      <header className="card p-5 flex items-center gap-4">
        {user.image ? (
          <Image src={user.image} alt="" width={56} height={56} className="rounded-full" unoptimized />
        ) : null}
        <div>
          <h1 className="text-xl font-bold">{user.name ?? user.username}</h1>
          <p className="text-xs muted">
            @{user.username} · {t.rich("joined", { d: () => <LocalTime value={user.createdAt} mode="date" /> })}
          </p>
        </div>
      </header>

      {own.length > 0 ? (
        <section className="card p-4 flex flex-col gap-2">
          <h2 className="font-bold">{trv("yourSubmissions")}</h2>
          <ul className="flex flex-col gap-2">
            {own.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/dashboards/${d.slug}`} className="link">{d.title}</Link>
                <ReviewPill status={d.reviewStatus} />
                {d.reviewNote ? <span className="text-xs muted">{trv("note")}: {d.reviewNote}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex items-baseline gap-3">
        <h2 className="font-bold">{t("dashboards", { name: user.username ?? "" })}</h2>
        <span className="text-xs muted">{tl("results", { count: total.toLocaleString() })}</span>
      </div>

      {items.length === 0 ? (
        <div className="card p-10 text-center muted">{tl("empty")}</div>
      ) : (
        <>
          <DashboardTable items={items} />
          <Pagination page={page} pages={pages} params={{ sort }} basePath={`/users/${username}`} />
        </>
      )}
    </div>
  );
}
