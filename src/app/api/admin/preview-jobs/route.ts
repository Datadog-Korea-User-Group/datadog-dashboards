import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dashboardRevisions, dashboards, previewJobs } from "@/db/schema";
import { json, requireAdminToken } from "@/lib/admin-api";

export const runtime = "nodejs";

/** Queued jobs, oldest first, with everything the local runner needs to build the preview. */
export async function GET(request: Request) {
  const denied = requireAdminToken(request);
  if (denied) return denied;

  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 50) : 5;

  const jobs = await db
    .select({
      id: previewJobs.id,
      dashboardId: previewJobs.dashboardId,
      revision: previewJobs.revision,
      slug: dashboards.slug,
      title: dashboards.title,
      ddDashboardId: dashboards.ddDashboardId,
      screenshotSource: dashboards.screenshotSource,
      dashboardJson: dashboardRevisions.dashboardJson,
    })
    .from(previewJobs)
    .innerJoin(dashboards, eq(previewJobs.dashboardId, dashboards.id))
    // Both keys: the job names a revision, and joining on dashboard alone would fan out.
    .innerJoin(
      dashboardRevisions,
      and(
        eq(dashboardRevisions.dashboardId, previewJobs.dashboardId),
        eq(dashboardRevisions.revision, previewJobs.revision),
      )!,
    )
    .where(eq(previewJobs.status, "queued"))
    .orderBy(asc(previewJobs.createdAt), asc(previewJobs.id))
    .limit(limit);

  return json({ jobs });
}
