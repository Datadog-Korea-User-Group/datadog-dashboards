import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dashboards } from "@/db/schema";

/** Counted from the browser (see ViewPing), never on the server render. */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await db
    .update(dashboards)
    .set({ views: sql`${dashboards.views} + 1` })
    .where(and(eq(dashboards.slug, slug), eq(dashboards.isPublished, true))!);
  // 204 either way: the ping is fire-and-forget and reveals nothing about unknown slugs.
  return new Response(null, { status: 204 });
}
