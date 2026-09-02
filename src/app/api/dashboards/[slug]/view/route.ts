import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dashboards } from "@/db/schema";
import { clientIp, firstInWindow } from "@/lib/recent-actions";

/** Counted from the browser (see ViewPing), never on the server render. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Same client, same dashboard, within the hour: already counted.
  if (!firstInWindow(`view:${clientIp(request)}:${slug}`, 3600_000)) {
    return new Response(null, { status: 204 });
  }

  await db
    .update(dashboards)
    .set({ views: sql`${dashboards.views} + 1` })
    .where(and(eq(dashboards.slug, slug), eq(dashboards.isPublished, true))!);
  // 204 either way: the ping is fire-and-forget and reveals nothing about unknown slugs.
  return new Response(null, { status: 204 });
}
