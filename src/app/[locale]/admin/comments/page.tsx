import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listRecentComments } from "@/db/queries";
import { LocalTime } from "@/components/LocalTime";
import { deleteComment } from "../../dashboards/[slug]/actions";

export default async function AdminCommentsPage() {
  const t = await getTranslations("admin");
  const tc = await getTranslations("comments");
  const rows = await listRecentComments();

  if (rows.length === 0) return <p className="card p-8 text-center muted">{tc("empty")}</p>;

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{t("dashboard")}</th>
            <th className="w-32">{t("author")}</th>
            <th>{t("body")}</th>
            <th className="w-40">{t("date")}</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/dashboards/${c.slug}`} className="link">{c.title}</Link></td>
              <td className="muted">{c.username ?? "—"}</td>
              <td className="max-w-md"><p className="line-clamp-2 whitespace-pre-wrap">{c.body}</p></td>
              <td className="text-xs muted"><LocalTime value={c.createdAt} /></td>
              <td>
                <form action={deleteComment}>
                  <input type="hidden" name="commentId" value={c.id} />
                  <button type="submit" className="btn btn-danger btn-sm">{tc("delete")}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
