import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listAllDashboards } from "@/db/queries";
import { LocalTime } from "@/components/LocalTime";
import { ReviewPill } from "@/components/ReviewPill";
import { deleteDashboard, regeneratePreview, setPublished } from "../../dashboards/[slug]/actions";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AdminDashboardsPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const td = await getTranslations("detail");
  const tl = await getTranslations("list");

  const q = one(sp.q);
  const status = one(sp.status);
  const rows = await listAllDashboards({ q, status });

  return (
    <div className="flex flex-col gap-4">
      <form className="card p-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 flex-1 min-w-56">
          <span className="text-xs font-semibold muted">{tl("search")}</span>
          <input name="q" defaultValue={q ?? ""} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold muted">{t("status")}</span>
          <select name="status" defaultValue={status ?? ""} className="input min-w-36">
            <option value="">{tl("any")}</option>
            {["pending", "approved", "rejected"].map((s) => (
              <option key={s} value={s}>{t(`status_${s}`)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">{tl("search")}</button>
      </form>

      {rows.length === 0 ? (
        <p className="card p-8 text-center muted">{tl("empty")}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{tl("name")}</th>
                <th className="w-28">{t("status")}</th>
                <th className="w-32">{tl("author")}</th>
                <th className="w-36">{tl("modified")}</th>
                <th className="w-72" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/dashboards/${d.slug}`} className="link">{d.title}</Link></td>
                  <td><ReviewPill status={d.reviewStatus} published={d.isPublished} /></td>
                  <td className="muted">{d.authorUsername ?? "—"}</td>
                  <td className="text-xs muted"><LocalTime value={d.updatedAt} mode="date" /></td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <form action={setPublished}>
                        <input type="hidden" name="dashboardId" value={d.id} />
                        <input type="hidden" name="published" value={String(!d.isPublished)} />
                        <button type="submit" className="btn btn-secondary btn-sm">
                          {d.isPublished ? td("unpublish") : td("publish")}
                        </button>
                      </form>
                      {d.screenshotSource !== "manual" ? (
                        <form action={regeneratePreview}>
                          <input type="hidden" name="dashboardId" value={d.id} />
                          <input type="hidden" name="revision" value={1} />
                          <button type="submit" className="btn btn-secondary btn-sm">{td("regeneratePreview")}</button>
                        </form>
                      ) : null}
                      <form action={deleteDashboard}>
                        <input type="hidden" name="dashboardId" value={d.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="btn btn-danger btn-sm">{td("delete")}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
