import Image from "next/image";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { getDashboardBySlug, getSketchWidgets, getUserRating, listRevisions } from "@/db/queries";
import type { ConversionSummary } from "@/db/schema";
import { CopyButton } from "@/components/CopyButton";
import { DownloadButton } from "@/components/DownloadButton";
import { Giscus } from "@/components/Giscus";
import { JsonViewer } from "@/components/JsonViewer";
import { LayoutSketch } from "@/components/LayoutSketch";
import { QualityBadge } from "@/components/QualityBadge";
import { RatingStars } from "@/components/RatingStars";
import { ViewPing } from "@/components/ViewPing";
import { Markdown } from "@/lib/markdown";
import { deleteDashboard, rateDashboard, setPublished } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await getDashboardBySlug(slug);
  if (!found) return {};
  return { title: found.dashboard.title, description: found.dashboard.description || undefined };
}

const STATUSES = ["native", "openmetrics", "partial", "unsupported"] as const;
const STATUS_COLOR: Record<(typeof STATUSES)[number], string> = {
  native: "bg-success",
  openmetrics: "bg-primary",
  partial: "bg-warning",
  unsupported: "bg-danger",
};

async function ConversionQuality({ summary, score }: { summary: ConversionSummary; score: number | null }) {
  const t = await getTranslations("detail");
  const tq = await getTranslations("quality");
  const total = Math.max(1, summary.counts?.total ?? 0);

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold">{t("quality")}</h2>
        <QualityBadge score={score} showScore />
      </div>
      <p className="text-xs muted">{t("qualityHelp")}</p>

      <ul className="flex flex-col gap-1.5">
        {STATUSES.map((s) => {
          const n = summary.counts?.[s] ?? 0;
          return (
            <li key={s} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 muted">{tq(s)}</span>
              <span className="h-1.5 flex-1 max-w-64 rounded-full bg-bg-tertiary overflow-hidden">
                <span className={`block h-full ${STATUS_COLOR[s]}`} style={{ width: `${Math.round((n / total) * 100)}%` }} />
              </span>
              <span className="tabular-nums muted">{n}</span>
            </li>
          );
        })}
      </ul>

      {summary.unmappedMetrics?.length ? (
        <div>
          <h3 className="text-xs font-bold">{t("unmapped")}</h3>
          <p className="text-xs muted mt-0.5">{t("unmappedHelp")}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {summary.unmappedMetrics.map((m) => (
              <code key={m.metric} className="code">{m.metric}{m.count > 1 ? ` ×${m.count}` : ""}</code>
            ))}
          </div>
        </div>
      ) : null}

      {summary.unsupportedPanels?.length ? (
        <div>
          <h3 className="text-xs font-bold">{t("unsupported")}</h3>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs muted">
            {summary.unsupportedPanels.map((p, i) => (
              <li key={i}>{p.title || "—"} <code className="code">{p.grafanaType}</code></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default async function DashboardDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [found, session] = await Promise.all([getDashboardBySlug(slug), auth()]);
  if (!found) notFound();

  const { dashboard: d, author, latest } = found;
  const isAdmin = session?.user?.role === "admin";
  const isOwner = !!session?.user?.id && session.user.id === d.authorId;
  if (!d.isPublished && !isAdmin && !isOwner) notFound();

  const t = await getTranslations("detail");
  const tc = await getTranslations("comments");
  const format = await getFormatter();
  const [revisions, myRating] = await Promise.all([
    listRevisions(d.id),
    session?.user?.id ? getUserRating(d.id, session.user.id) : Promise.resolve(null),
  ]);

  // The JSON is fetched by the viewer on demand, so it never reaches the HTML.
  // Without a screenshot the sketch still needs layouts, trimmed to layout fields in SQL.
  const sketch = d.screenshotUrl ? null : (await getSketchWidgets([d.id])).get(d.id);
  const downloadHref = `/api/dashboards/${encodeURIComponent(d.slug)}/download`;
  const giscus = process.env.GISCUS_REPO_ID
    ? {
        repo: process.env.GISCUS_REPO ?? "",
        repoId: process.env.GISCUS_REPO_ID,
        category: process.env.GISCUS_CATEGORY ?? "",
        categoryId: process.env.GISCUS_CATEGORY_ID ?? "",
      }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <ViewPing slug={d.slug} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{d.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
            {!d.isPublished ? <span className="pill pill-danger">{t("unpublished")}</span> : null}
            <QualityBadge score={d.qualityScore} showScore />
            <span className="pill pill-neutral">{t("downloads", { count: d.downloads.toLocaleString() })}</span>
            <span className="pill pill-neutral">{t("views", { count: d.views.toLocaleString() })}</span>
            {latest ? <span className="pill pill-neutral">{t("revision", { n: latest.revision })}</span> : null}
            <span className="muted">{t("created", { date: format.dateTime(d.createdAt, { dateStyle: "medium" }) })}</span>
            {author?.username ? (
              <Link href={`/users/${author.username}`} className="link">{author.username}</Link>
            ) : null}
            {d.source === "grafana" && d.sourceId ? (
              <a href={d.sourceUrl ?? "#"} target="_blank" rel="noreferrer noopener" className="link inline-flex items-center gap-1">
                {t("source", { id: d.sourceId, org: d.sourceOrgName ?? d.sourceOrgSlug ?? "—" })}
                <ExternalLink size={11} />
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DownloadButton href={downloadHref} count={d.downloads} label={t("download")} />
          <CopyButton url={`${downloadHref}?revision=${latest?.revision ?? 1}&inline=1`} />
          <details className="relative">
            <summary className="btn btn-secondary list-none cursor-pointer [&::-webkit-details-marker]:hidden">
              {t("importGuide")}
            </summary>
            <p className="card p-3 mt-2 text-xs muted w-80 absolute right-0 z-10 shadow-lg">{t("importSteps")}</p>
          </details>
        </div>
      </header>

      {d.description ? <p className="text-base">{d.description}</p> : null}

      <div className="card overflow-hidden">
        {d.screenshotUrl ? (
          <Image
            src={d.screenshotUrl}
            alt={d.title}
            width={1920}
            height={1080}
            sizes="100vw"
            priority
            className="w-full h-auto"
          />
        ) : (
          <LayoutSketch widgets={sketch} />
        )}
      </div>

      {d.readme ? <section className="card p-5"><Markdown>{d.readme}</Markdown></section> : null}

      {d.conversionSummary ? <ConversionQuality summary={d.conversionSummary} score={d.qualityScore} /> : null}

      {(d.tags.length > 0 || d.integrations.length > 0) ? (
        <section className="flex flex-wrap gap-4">
          {d.tags.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold muted">{t("tags")}</span>
              {d.tags.map((tag) => (
                <Link key={tag} href={`/dashboards?tag=${encodeURIComponent(tag)}`} className="pill pill-neutral">{tag}</Link>
              ))}
            </div>
          ) : null}
          {d.integrations.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold muted">{t("integrations")}</span>
              {d.integrations.map((i) => (
                <Link key={i} href={`/dashboards?integration=${encodeURIComponent(i)}`} className="pill pill-brand">{i}</Link>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {latest ? <JsonViewer slug={d.slug} revision={latest.revision} size={latest.jsonBytes} /> : null}

      {revisions.length > 0 ? (
        <section className="card">
          <h2 className="font-bold px-3 py-2 border-b border-border">{t("revisions")}</h2>
          <ul>
            {revisions.map((r) => (
              <li key={r.revision} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0 text-xs">
                <span className="pill pill-neutral">{t("revision", { n: r.revision })}</span>
                <span className="muted whitespace-nowrap">{format.dateTime(r.createdAt, { dateStyle: "medium" })}</span>
                <span className="flex-1 truncate">{r.changelog}</span>
                <a href={`${downloadHref}?revision=${r.revision}`} download className="link whitespace-nowrap">{t("download")}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-bold">{t("rate")}</h2>
          {session?.user?.id ? (
            <RatingStars dashboardId={d.id} initial={myRating} action={rateDashboard} />
          ) : (
            <span className="text-xs muted">{t("signInToRate")}</span>
          )}
          {d.ratingCount > 0 ? (
            <span className="text-xs muted">★ {d.ratingAvg} · {d.ratingCount}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isOwner || isAdmin ? (
            <Link href={`/dashboards/${d.slug}/edit`} className="btn btn-secondary btn-sm">{t("edit")}</Link>
          ) : null}
          {isAdmin ? (
            <>
              <form action={setPublished}>
                <input type="hidden" name="dashboardId" value={d.id} />
                <input type="hidden" name="published" value={String(!d.isPublished)} />
                <button type="submit" className="btn btn-secondary btn-sm">{d.isPublished ? t("unpublish") : t("publish")}</button>
              </form>
              <form action={deleteDashboard}>
                <input type="hidden" name="dashboardId" value={d.id} />
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="btn btn-danger btn-sm">{t("delete")}</button>
              </form>
            </>
          ) : null}
        </div>
      </section>

      {giscus ? (
        <section className="card p-4 flex flex-col gap-3">
          <h2 className="font-bold">{tc("title")}</h2>
          <Giscus {...giscus} term={d.slug} />
        </section>
      ) : null}
    </div>
  );
}
