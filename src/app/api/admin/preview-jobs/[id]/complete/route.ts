import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dashboards, previewJobs } from "@/db/schema";
import { json, requireAdminToken } from "@/lib/admin-api";
import { prepareScreenshot, writeScreenshot } from "@/lib/screenshot-upload";

export const runtime = "nodejs";

const MAX_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminToken(request);
  if (denied) return denied;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

  const [job] = await db
    .select({ dashboardId: previewJobs.dashboardId, revision: previewJobs.revision })
    .from(previewJobs)
    .where(eq(previewJobs.id, id))
    .limit(1);
  if (!job) return json({ error: "Not found" }, 404);

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Expected multipart/form-data" }, 400);

  // Same validate-and-re-encode path as a manual upload; format is sniffed, not trusted.
  const shot = await prepareScreenshot(form.get("screenshot") as File | null, MAX_BYTES);
  if (!shot.ok || !shot.webp) return json({ error: "Invalid screenshot" }, 400);

  const screenshotUrl = await writeScreenshot(shot.webp, job.dashboardId, job.revision);
  const ddDashboardId = String(form.get("ddDashboardId") ?? "").trim().slice(0, 200);

  const [current] = await db
    .select({ screenshotSource: dashboards.screenshotSource })
    .from(dashboards)
    .where(eq(dashboards.id, job.dashboardId))
    .limit(1);

  await db
    .update(dashboards)
    .set({
      // The author's own upload keeps its source and its URL.
      ...(current?.screenshotSource === "manual" ? {} : { screenshotUrl, screenshotSource: "auto" }),
      ...(ddDashboardId ? { ddDashboardId } : {}),
    })
    .where(eq(dashboards.id, job.dashboardId));

  await db.update(previewJobs).set({ status: "done", finishedAt: new Date(), error: null }).where(eq(previewJobs.id, id));
  return json({ ok: true, screenshotUrl });
}
