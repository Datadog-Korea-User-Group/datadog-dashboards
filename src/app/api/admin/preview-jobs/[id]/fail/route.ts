import { eq } from "drizzle-orm";
import { db } from "@/db";
import { previewJobs } from "@/db/schema";
import { json, requireAdminToken } from "@/lib/admin-api";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 2;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminToken(request);
  if (denied) return denied;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

  const body = await request.json().catch(() => ({}));
  const error = String((body as { error?: unknown }).error ?? "").slice(0, 2000);

  const [job] = await db.select({ attempts: previewJobs.attempts }).from(previewJobs).where(eq(previewJobs.id, id)).limit(1);
  if (!job) return json({ error: "Not found" }, 404);

  // Under the cap it goes back in the queue; at the cap it stops so a broken
  // dashboard cannot spin forever.
  const retry = job.attempts < MAX_ATTEMPTS;
  await db
    .update(previewJobs)
    .set({ status: retry ? "queued" : "failed", error, finishedAt: retry ? null : new Date() })
    .where(eq(previewJobs.id, id));

  return json({ ok: true, status: retry ? "queued" : "failed" });
}
