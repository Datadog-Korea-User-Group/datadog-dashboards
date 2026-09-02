import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { auth, signIn } from "@/auth";
import { Link } from "@/i18n/navigation";
import { getDashboardBySlug, getPreviewJob, getSketchWidgets, getUserRating, listComments, listReactions, listRevisions } from "@/db/queries";
import type { ConversionSummary } from "@/db/schema";
import { CopyButton } from "@/components/CopyButton";
import { DownloadButton } from "@/components/DownloadButton";
import { JsonViewer } from "@/components/JsonViewer";
import { LayoutSketch } from "@/components/LayoutSketch";
import { LocalTime } from "@/components/LocalTime";
import { QualityBadge } from "@/components/QualityBadge";
import { Reactions } from "@/components/Reactions";
import { RatingStars } from "@/components/RatingStars";
import { ViewPing } from "@/components/ViewPing";
import { Markdown } from "@/lib/markdown";
import { absolute, languageAlternates } from "@/lib/site-url";
import { CommentForm } from "./CommentForm";
import { deleteComment, deleteDashboard, rateDashboard, regeneratePreview, setPublished, toggleReaction } from "./actions";

function metaDescription(d: { description: string; title: string; sourceId: number | null; sourceOrgName: string | null }) {
  if (d.description) return d.description;
  return d.sourceId
    ? `Datadog dashboard for ${d.title}, converted from Grafana dashboard #${d.sourceId}${d.sourceOrgName ? ` by ${d.sourceOrgName}` : ""}.`
    : `Datadog dashboard for ${d.title}. Download the JSON and import it into Datadog.`;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const found = await getDashboardBySlug(slug);
  if (!found) return {};

  const d = found.dashboard;
  const path = `/dashboards/${d.slug}`;
  const description = metaDescription(d);
  return {
    title: d.title,
    description,
    alternates: { canonical: absolute(locale, path), languages: languageAlternates(path) },
    openGraph: {
      type: "article",
      url: absolute(locale, path),
      title: d.title,
      description,
      siteName: "Datadog Dashboards",
      // Explicit: the file convention emits a locale-prefixed URL that 307s for "en".
      images: [{ url: `${absolute(locale, path)}/opengraph-image`, width: 1200, height: 630, alt: d.title }],
      modifiedTime: d.updatedAt.toISOString(),
      tags: d.tags,
    },
    twitter: { card: "summary_large_image", title: d.title, description },
  };
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

/** CreativeWork describing the dashboard. `<` is escaped so the block cannot close its own script tag. */
function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
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

  const { dashboard: d, author, latest, pendingRevision } = found;
  const isAdmin = session?.user?.role === "admin";
  const isOwner = !!session?.user?.id && session.user.id === d.authorId;
  // Public only when published and through review; the owner and admins always see it.
  const isPublicView = d.isPublished && d.reviewStatus === "approved";
  if (!isPublicView && !isAdmin && !isOwner) notFound();

  const t = await getTranslations("detail");
  const tc = await getTranslations("comments");
  const tr = await getTranslations("reactions");
  const trv = await getTranslations("review");
  const [revisions, myRating, thread, reactionTally] = await Promise.all([
    listRevisions(d.id),
    session?.user?.id ? getUserRating(d.id, session.user.id) : Promise.resolve(null),
    listComments(d.id),
    listReactions(d.id, session?.user?.id),
  ]);
  const previewJob = latest ? await getPreviewJob(d.id, latest.revision) : null;
  const canRegenerate = (isOwner || isAdmin) && d.screenshotSource !== "manual";

  // The JSON is fetched by the viewer on demand, so it never reaches the HTML.
  // Without a screenshot the sketch still needs layouts, trimmed to layout fields in SQL.
  const sketch = d.screenshotUrl ? null : (await getSketchWidgets([d.id])).get(d.id);
  const canonical = absolute(locale, `/dashboards/${d.slug}`);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: d.title,
    description: metaDescription(d),
    url: canonical,
    dateModified: d.updatedAt.toISOString(),
    image: `${canonical}/opengraph-image`,
    keywords: d.tags.length ? d.tags.join(", ") : undefined,
    author: author?.username
      ? { "@type": "Person", name: author.username, url: absolute(locale, `/users/${author.username}`) }
      : d.sourceOrgName
        ? { "@type": "Organization", name: d.sourceOrgName }
        : undefined,
    isBasedOn: d.sourceUrl ?? undefined,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/DownloadAction",
      userInteractionCount: d.downloads,
    },
  };
  const downloadHref = `/api/dashboards/${encodeURIComponent(d.slug)}/download`;

  return (
    <div className="flex flex-col gap-5">
      <ViewPing slug={d.slug} />
      <JsonLd data={jsonLd} />

      {(isOwner || isAdmin) && d.reviewStatus !== "approved" ? (
        <section className={`card p-4 text-sm ${d.reviewStatus === "rejected" ? "border-danger" : ""}`}>
          <p className="font-semibold">{d.reviewStatus === "rejected" ? trv("rejectedBanner") : trv("pendingBanner")}</p>
          {d.reviewNote ? <p className="muted mt-1">{trv("note")}: {d.reviewNote}</p> : null}
        </section>
      ) : null}

      {(isOwner || isAdmin) && pendingRevision ? (
        <section className="card p-4 text-sm">
          <p className="font-semibold">{trv("revisionPending", { n: pendingRevision })}</p>
        </section>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{d.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
            {!d.isPublished ? <span className="pill pill-danger">{t("unpublished")}</span> : null}
            <QualityBadge score={d.qualityScore} showScore />
            <span className="pill pill-neutral">{t("downloads", { count: d.downloads.toLocaleString() })}</span>
            <span className="pill pill-neutral">{t("views", { count: d.views.toLocaleString() })}</span>
            <span className="pill pill-neutral">{tc("count", { count: thread.length })}</span>
            {!d.screenshotUrl && (previewJob?.status === "queued" || previewJob?.status === "running") ? (
              <span className="pill pill-warning">{t("previewPending")}</span>
            ) : null}
            {latest ? <span className="pill pill-neutral">{t("revision", { n: latest.revision })}</span> : null}
            <span className="muted">{t.rich("created", { d: () => <LocalTime value={d.createdAt} mode="date" /> })}</span>
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

      <section className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xs font-bold muted">{tr("title")}</h2>
        <Reactions
          dashboardId={d.id}
          items={reactionTally}
          signedIn={!!session?.user?.id}
          signInHint={tr("signIn")}
          signIn={async () => { "use server"; await signIn("github"); }}
          toggle={toggleReaction}
        />
      </section>

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

      {canRegenerate ? (
        <form action={regeneratePreview} className="flex items-center gap-3 -mt-2">
          <input type="hidden" name="dashboardId" value={d.id} />
          <input type="hidden" name="revision" value={latest?.revision ?? 1} />
          {previewJob?.status === "failed" ? <span className="text-xs muted">{t("previewFailed")}</span> : null}
          <button type="submit" className="btn btn-secondary btn-sm">{t("regeneratePreview")}</button>
        </form>
      ) : null}

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
                <LocalTime value={r.createdAt} className="muted whitespace-nowrap" />
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

      <section className="card p-4 flex flex-col gap-4">
        <h2 className="font-bold">{tc("count", { count: thread.length })}</h2>

        {thread.length === 0 ? (
          <p className="text-xs muted">{tc("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {thread.map((c) => (
              <li key={c.id} className="flex gap-3">
                {c.image ? (
                  <Image src={c.image} alt="" width={32} height={32} className="rounded-full shrink-0" unoptimized />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-bg-tertiary shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    {c.username ? (
                      <Link href={`/users/${c.username}`} className="font-semibold hover:text-primary">{c.username}</Link>
                    ) : (
                      <span className="font-semibold">{c.name ?? "\u2014"}</span>
                    )}
                    <LocalTime value={c.createdAt} className="muted" />
                    {c.userId === session?.user?.id || isAdmin ? (
                      <form action={deleteComment}>
                        <input type="hidden" name="commentId" value={c.id} />
                        <button type="submit" className="link text-xs">{tc("delete")}</button>
                      </form>
                    ) : null}
                  </div>
                  <Markdown>{c.body}</Markdown>
                </div>
              </li>
            ))}
          </ul>
        )}

        {session?.user?.id ? (
          <CommentForm dashboardId={d.id} />
        ) : (
          <form action={async () => { "use server"; await signIn("github"); }}>
            <button type="submit" className="btn btn-secondary btn-sm">{tc("signIn")}</button>
          </form>
        )}
      </section>
    </div>
  );
}
