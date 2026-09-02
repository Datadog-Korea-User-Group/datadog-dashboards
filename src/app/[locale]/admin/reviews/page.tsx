import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSketchWidgets, listPendingDashboards, listPendingRevisions } from "@/db/queries";
import { JsonViewer } from "@/components/JsonViewer";
import { LayoutSketch } from "@/components/LayoutSketch";
import { LocalTime } from "@/components/LocalTime";
import { approveDashboard, approveRevision, rejectDashboard, rejectRevision } from "../actions";

/** Approve is one click; reject needs a note, which the uploader sees. */
async function Decision({
  dashboardId, revision, approve, reject,
}: {
  dashboardId: number;
  revision: number;
  approve: (formData: FormData) => Promise<void>;
  reject: (formData: FormData) => Promise<void>;
}) {
  const t = await getTranslations("review");
  return (
    <div className="flex flex-wrap items-end gap-3 pt-1">
      <form action={approve}>
        <input type="hidden" name="dashboardId" value={dashboardId} />
        <input type="hidden" name="revision" value={revision} />
        <button type="submit" className="btn btn-primary btn-sm">{t("approve")}</button>
      </form>
      <form action={reject} className="flex items-end gap-2 flex-1 min-w-64">
        <input type="hidden" name="dashboardId" value={dashboardId} />
        <input type="hidden" name="revision" value={revision} />
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-xs muted">{t("note")}</span>
          <input name="note" required maxLength={1000} className="input" placeholder={t("notePlaceholder")} />
        </label>
        <button type="submit" className="btn btn-danger btn-sm">{t("reject")}</button>
      </form>
    </div>
  );
}

export default async function AdminReviewsPage() {
  const t = await getTranslations("review");
  const [pending, revisions] = await Promise.all([listPendingDashboards(), listPendingRevisions()]);
  const sketches = await getSketchWidgets([
    ...pending.filter((d) => !d.screenshotUrl).map((d) => d.id),
    ...revisions.filter((r) => !r.screenshotUrl).map((r) => r.dashboardId),
  ]);

  if (pending.length === 0 && revisions.length === 0) {
    return <p className="card p-8 text-center muted">{t("queueEmpty")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-bold">{t("newDashboards")}</h2>
          {pending.map((d) => (
            <article key={d.id} className="card p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{d.title}</h3>
                  <p className="text-xs muted">
                    {d.authorUsername ?? "—"} · <LocalTime value={d.createdAt} />
                  </p>
                </div>
                <span className="flex gap-1 flex-wrap">
                  {d.tags.slice(0, 5).map((tag) => <span key={tag} className="pill pill-neutral">{tag}</span>)}
                </span>
              </div>
              {d.description ? <p className="text-sm">{d.description}</p> : null}
              <div className="max-w-md">
                {d.screenshotUrl ? (
                  <Image src={d.screenshotUrl} alt={d.title} width={1920} height={1080} sizes="480px" className="w-full h-auto rounded" />
                ) : (
                  <LayoutSketch widgets={sketches.get(d.id)} />
                )}
              </div>
              <JsonViewer slug={d.slug} revision={1} size={d.jsonBytes ?? 0} />
              <Decision dashboardId={d.id} revision={1} approve={approveDashboard} reject={rejectDashboard} />
            </article>
          ))}
        </section>
      ) : null}

      {revisions.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="font-bold">{t("newRevisions")}</h2>
          {revisions.map((r) => (
            <article key={`${r.dashboardId}-${r.revision}`} className="card p-4 flex flex-col gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">
                  <Link href={`/dashboards/${r.slug}`} className="link">{r.title}</Link>
                  <span className="muted font-normal"> · {t("revisionN", { n: r.revision })}</span>
                </h3>
                <p className="text-xs muted">{r.authorUsername ?? "—"} · <LocalTime value={r.createdAt} /></p>
              </div>
              {r.changelog ? <p className="text-sm">{r.changelog}</p> : null}
              <JsonViewer slug={r.slug} revision={r.revision} size={r.jsonBytes ?? 0} />
              <Decision dashboardId={r.dashboardId} revision={r.revision} approve={approveRevision} reject={rejectRevision} />
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
