import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { clientIp, firstInWindow } from "@/lib/recent-actions";
import { db } from "@/db";
import { getLatestApprovedRevision, getRevisionJson } from "@/db/queries";
import { dashboards } from "@/db/schema";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [row] = await db
    .select({
      id: dashboards.id,
      isPublished: dashboards.isPublished,
      reviewStatus: dashboards.reviewStatus,
      authorId: dashboards.authorId,
    })
    .from(dashboards)
    .where(eq(dashboards.slug, slug))
    .limit(1);
  if (!row) return notFound();

  // Public only once published and reviewed; the owner and admins can still fetch their own,
  // which is what the review queue reads.
  if (!row.isPublished || row.reviewStatus !== "approved") {
    const session = await auth();
    const privileged = session?.user?.role === "admin" || (!!session?.user?.id && session.user.id === row.authorId);
    if (!privileged) return notFound();
  }

  const query = new URL(request.url).searchParams;
  const asked = Number(query.get("revision"));
  const revision = Number.isInteger(asked) && asked > 0 ? asked : undefined;
  // Without an explicit revision, serve the newest one that passed review.
  // An explicit revision wins; otherwise the newest approved one, falling back to the newest
  // overall so an owner reviewing an unapproved upload still gets its JSON.
  const found = revision
    ? await getRevisionJson(row.id, revision)
    : ((await getLatestApprovedRevision(row.id)) ?? (await getRevisionJson(row.id)));
  if (!found) return notFound();

  // Awaited so a refresh right after the click sees the new number.
  // Still caught: a counter failure must never block the download.
  // `inline=1` is the JSON viewer and Copy button reading the same bytes; not a download.
  if (query.get("inline") !== "1" && firstInWindow(`download:${clientIp(request)}:${slug}`, 600_000)) {
    await db
      .update(dashboards)
      .set({ downloads: sql`${dashboards.downloads} + 1` })
      .where(eq(dashboards.id, row.id))
      .catch((e) => console.error("download counter", e));
  }

  const filename = slug.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return new Response(JSON.stringify(found.dashboardJson, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.json"`,
      "cache-control": "no-store",
    },
  });
}
