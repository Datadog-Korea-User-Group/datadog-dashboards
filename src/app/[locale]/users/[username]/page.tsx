import Image from "next/image";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getUserByUsername, listDashboards, parseSort } from "@/db/queries";
import { DashboardTable } from "@/components/DashboardTable";
import { Pagination } from "@/components/Pagination";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

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
  const format = await getFormatter();

  const sort = parseSort(one(sp.sort));
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const { items, total, pages } = await listDashboards({ authorId: user.id, sort, page });

  return (
    <div className="flex flex-col gap-4">
      <header className="card p-5 flex items-center gap-4">
        {user.image ? (
          <Image src={user.image} alt="" width={56} height={56} className="rounded-full" unoptimized />
        ) : null}
        <div>
          <h1 className="text-xl font-bold">{user.name ?? user.username}</h1>
          <p className="text-xs muted">
            @{user.username} · {t("joined", { date: format.dateTime(user.createdAt, { dateStyle: "medium" }) })}
          </p>
        </div>
      </header>

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
