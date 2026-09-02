import { and, arrayContains, asc, count, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { PAGE_SIZE, type QualityBand, type Sort } from "@/lib/list-params";
import { db } from "./index";
import { comments, dashboardRevisions, dashboards, ratings, reactions, users, REACTION_EMOJIS, type ConversionSummary } from "./schema";

// Re-exported so server callers keep importing from one place; the definitions
// live in lib/list-params so client components can use them too.
export { PAGE_SIZE, QUALITY_BANDS, SORTS, parseQuality, parseSort } from "@/lib/list-params";
export type { QualityBand, Sort } from "@/lib/list-params";

export type DashboardListItem = {
  id: number;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  qualityScore: number | null;
  screenshotUrl: string | null;
  downloads: number;
  views: number;
  sourceOrgName: string | null;
  updatedAt: string;
  authorUsername: string | null;
  authorImage: string | null;
};

// Only what DashboardCard and DashboardTable render. No jsonb, readme or
// conversion_summary: sort columns work in ORDER BY without being selected.
const listColumns = {
  id: dashboards.id,
  slug: dashboards.slug,
  title: dashboards.title,
  description: dashboards.description,
  tags: dashboards.tags,
  qualityScore: dashboards.qualityScore,
  screenshotUrl: dashboards.screenshotUrl,
  downloads: dashboards.downloads,
  views: dashboards.views,
  sourceOrgName: dashboards.sourceOrgName,
  updatedAt: dashboards.updatedAt,
  authorUsername: users.username,
  authorImage: users.image,
};

export type ListParams = {
  q?: string;
  tag?: string;
  integration?: string;
  quality?: QualityBand;
  sort?: Sort;
  page?: number;
  authorId?: string;
};

function listWhere({ q, tag, integration, quality, authorId }: ListParams): SQL {
  const conds: SQL[] = [eq(dashboards.isPublished, true)];
  if (q?.trim()) conds.push(sql`${dashboards.search} @@ plainto_tsquery('simple', ${q.trim()})`);
  if (tag) conds.push(arrayContains(dashboards.tags, [tag]));
  if (integration) conds.push(arrayContains(dashboards.integrations, [integration]));
  if (authorId) conds.push(eq(dashboards.authorId, authorId));
  if (quality === "good") conds.push(gte(dashboards.qualityScore, 80));
  if (quality === "fair") conds.push(and(gte(dashboards.qualityScore, 50), lt(dashboards.qualityScore, 80))!);
  if (quality === "poor") conds.push(lt(dashboards.qualityScore, 50));
  if (quality === "unknown") conds.push(isNull(dashboards.qualityScore));
  return and(...conds)!;
}

function orderBy(sort: Sort): SQL[] {
  // id desc is the tie-breaker so paging stays stable.
  switch (sort) {
    case "views":
      return [desc(dashboards.views), desc(dashboards.downloads), desc(dashboards.id)];
    case "newest":
      return [desc(dashboards.createdAt), desc(dashboards.id)];
    case "rating":
      return [sql`${dashboards.ratingAvg} desc nulls last`, desc(dashboards.ratingCount), desc(dashboards.id)];
    case "source":
      return [desc(dashboards.sourceDownloads), desc(dashboards.id)];
    default:
      return [desc(dashboards.downloads), desc(dashboards.sourceDownloads), desc(dashboards.id)];
  }
}

async function queryDashboards(params: ListParams): Promise<{ items: DashboardListItem[]; total: number; page: number; pages: number }> {
  const where = listWhere(params);
  const page = Math.max(1, params.page ?? 1);

  const [items, [totals]] = await Promise.all([
    db
      .select(listColumns)
      .from(dashboards)
      .leftJoin(users, eq(dashboards.authorId, users.id))
      .where(where)
      .orderBy(...orderBy(params.sort ?? "downloads"))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(dashboards).where(where),
  ]);

  const total = totals?.n ?? 0;
  // ISO strings, not Date: unstable_cache round-trips this through JSON, so a Date would
  // reach callers as a string anyway and the type would be lying.
  const rows = items.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export const DASHBOARDS_TAG = "dashboards";

/** Listing is read-heavy and changes rarely; mutations call revalidateTag(DASHBOARDS_TAG). */
export const listDashboards = unstable_cache(queryDashboards, ["dashboards-list"], {
  revalidate: 60,
  tags: [DASHBOARDS_TAG],
});

/**
 * Widget layouts of each dashboard's latest revision, for the LayoutSketch fallback.
 * Trimmed in SQL because full dashboard_json averages ~76 KB and a grid needs 24 of them.
 */
export async function getSketchWidgets(dashboardIds: number[]): Promise<Map<number, unknown[]>> {
  const ids = [...new Set(dashboardIds)];
  if (ids.length === 0) return new Map();
  const res = await db.execute(sql`
    select distinct on (dr.dashboard_id) dr.dashboard_id as id,
      (select jsonb_agg(jsonb_build_object(
          'layout', w->'layout',
          'definition', jsonb_build_object(
            'type', w->'definition'->>'type',
            'widgets', (select jsonb_agg(jsonb_build_object('layout', c->'layout'))
                        from jsonb_array_elements(coalesce(w->'definition'->'widgets', '[]'::jsonb)) c))))
       from jsonb_array_elements(coalesce(dr.dashboard_json->'widgets', '[]'::jsonb)) w) as widgets
    from dashboard_revisions dr
    where dr.dashboard_id in (${sql.join(ids, sql`, `)})
    order by dr.dashboard_id, dr.revision desc
  `);
  const rows = res.rows as { id: number; widgets: unknown[] | null }[];
  return new Map(rows.map((r) => [r.id, r.widgets ?? []]));
}

export type DashboardDetail = {
  dashboard: typeof dashboards.$inferSelect;
  author: { id: string; name: string | null; username: string | null; image: string | null } | null;
  latest: { revision: number; jsonBytes: number; changelog: string; createdAt: Date } | null;
};

export async function getDashboardBySlug(slug: string): Promise<DashboardDetail | null> {
  const [row] = await db
    .select({
      dashboard: dashboards,
      author: { id: users.id, name: users.name, username: users.username, image: users.image },
    })
    .from(dashboards)
    .leftJoin(users, eq(dashboards.authorId, users.id))
    .where(eq(dashboards.slug, slug))
    .limit(1);
  if (!row) return null;

  const [latest] = await db
    .select({
      revision: dashboardRevisions.revision,
      // Size only. The full jsonb averages ~76 KB and would land in the HTML.
      jsonBytes: sql<number>`octet_length(${dashboardRevisions.dashboardJson}::text)`,
      changelog: dashboardRevisions.changelog,
      createdAt: dashboardRevisions.createdAt,
    })
    .from(dashboardRevisions)
    .where(eq(dashboardRevisions.dashboardId, row.dashboard.id))
    .orderBy(desc(dashboardRevisions.revision))
    .limit(1);

  return { dashboard: row.dashboard, author: row.author?.id ? row.author : null, latest: latest ?? null };
}

export async function listRevisions(dashboardId: number) {
  return db
    .select({
      revision: dashboardRevisions.revision,
      changelog: dashboardRevisions.changelog,
      createdAt: dashboardRevisions.createdAt,
      authorUsername: users.username,
    })
    .from(dashboardRevisions)
    .leftJoin(users, eq(dashboardRevisions.createdBy, users.id))
    .where(eq(dashboardRevisions.dashboardId, dashboardId))
    .orderBy(desc(dashboardRevisions.revision));
}

/** Dashboard JSON of one revision, or the latest when `revision` is undefined. */
export async function getRevisionJson(dashboardId: number, revision?: number) {
  const where = revision
    ? and(eq(dashboardRevisions.dashboardId, dashboardId), eq(dashboardRevisions.revision, revision))!
    : eq(dashboardRevisions.dashboardId, dashboardId);
  const [row] = await db
    .select({ revision: dashboardRevisions.revision, dashboardJson: dashboardRevisions.dashboardJson })
    .from(dashboardRevisions)
    .where(where)
    .orderBy(desc(dashboardRevisions.revision))
    .limit(1);
  return row ?? null;
}

export async function getUserRating(dashboardId: number, userId: string) {
  const [row] = await db
    .select({ stars: ratings.stars })
    .from(ratings)
    .where(and(eq(ratings.dashboardId, dashboardId), eq(ratings.userId, userId)))
    .limit(1);
  return row?.stars ?? null;
}

export async function getUserByUsername(username: string) {
  const [row] = await db
    .select({ id: users.id, name: users.name, username: users.username, image: users.image, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return row ?? null;
}

/** Dashboards created by a user in the last hour — the upload rate limit. */
export async function countRecentUploads(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(dashboards)
    .where(and(eq(dashboards.authorId, userId), gte(dashboards.createdAt, new Date(Date.now() - 3600_000)))!);
  return row?.n ?? 0;
}

/** Non-deleted comments, oldest first, with their author. */
export async function listComments(dashboardId: number) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      userId: comments.userId,
      username: users.username,
      name: users.name,
      image: users.image,
    })
    .from(comments)
    .leftJoin(users, eq(comments.userId, users.id))
    .where(and(eq(comments.dashboardId, dashboardId), isNull(comments.deletedAt))!)
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

/** Comments posted by a user in the last hour — the rate limit. */
export async function countRecentComments(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(comments)
    .where(and(eq(comments.userId, userId), gte(comments.createdAt, new Date(Date.now() - 3600_000)))!);
  return row?.n ?? 0;
}

export type ReactionTally = { emoji: string; count: number; mine: boolean };

/** All six emoji in a fixed order, zero-filled, with whether this viewer picked each. */
export async function listReactions(dashboardId: number, userId?: string): Promise<ReactionTally[]> {
  const rows = await db
    .select({
      emoji: reactions.emoji,
      count: count(),
      mine: sql<boolean>`coalesce(bool_or(${reactions.userId} = ${userId ?? null}), false)`,
    })
    .from(reactions)
    .where(eq(reactions.dashboardId, dashboardId))
    .groupBy(reactions.emoji);

  const found = new Map(rows.map((r) => [r.emoji, r]));
  return REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: found.get(emoji)?.count ?? 0,
    mine: found.get(emoji)?.mine ?? false,
  }));
}

export type IntegrationCount = { name: string; count: number };

export async function listIntegrations(limit = 60): Promise<IntegrationCount[]> {
  const res = await db.execute(sql`
    select i as name, count(*)::int as count
    from dashboards d, unnest(d.integrations) i
    where d.is_published
    group by i
    order by count(*) desc, i asc
    limit ${limit}
  `);
  return res.rows as IntegrationCount[];
}

async function queryHomeData() {
  const [[totals], popular, recent, integrations] = await Promise.all([
    db.select({ n: count() }).from(dashboards).where(eq(dashboards.isPublished, true)),
    listDashboards({ sort: "downloads" }),
    listDashboards({ sort: "newest" }),
    listIntegrations(12),
  ]);
  return {
    total: totals?.n ?? 0,
    popular: popular.items.slice(0, 12),
    recent: recent.items.slice(0, 12),
    integrations,
  };
}

export const getHomeData = unstable_cache(queryHomeData, ["dashboards-home"], {
  revalidate: 60,
  tags: [DASHBOARDS_TAG],
});

export type { ConversionSummary };

/** Every published dashboard, slug and mtime only, for the sitemap. */
export async function listSitemapDashboards() {
  return db
    .select({ slug: dashboards.slug, updatedAt: dashboards.updatedAt })
    .from(dashboards)
    .where(eq(dashboards.isPublished, true))
    .orderBy(desc(dashboards.updatedAt));
}
