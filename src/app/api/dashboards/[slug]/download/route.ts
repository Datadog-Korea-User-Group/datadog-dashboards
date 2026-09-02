import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { getRevisionJson } from "@/db/queries";
import { dashboards } from "@/db/schema";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [row] = await db
    .select({ id: dashboards.id, isPublished: dashboards.isPublished })
    .from(dashboards)
    .where(eq(dashboards.slug, slug))
    .limit(1);
  // Unpublished dashboards are 404 for everyone, admins included.
  if (!row?.isPublished) return notFound();

  const asked = Number(new URL(request.url).searchParams.get("revision"));
  const revision = Number.isInteger(asked) && asked > 0 ? asked : undefined;
  const found = await getRevisionJson(row.id, revision);
  if (!found) return notFound();

  db.update(dashboards)
    .set({ downloads: sql`${dashboards.downloads} + 1` })
    .where(eq(dashboards.id, row.id))
    .catch((e) => console.error("download counter", e));

  const filename = slug.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return new Response(JSON.stringify(found.dashboardJson, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.json"`,
      "cache-control": "no-store",
    },
  });
}
