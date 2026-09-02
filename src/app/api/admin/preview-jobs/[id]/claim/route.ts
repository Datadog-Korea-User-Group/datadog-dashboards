import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { previewJobs } from "@/db/schema";
import { json, requireAdminToken } from "@/lib/admin-api";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminToken(request);
  if (denied) return denied;

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

  // One statement so two runners cannot claim the same job: the WHERE loses for the second.
  const claimed = await db
    .update(previewJobs)
    .set({ status: "running", startedAt: new Date(), attempts: sql`${previewJobs.attempts} + 1` })
    .where(and(eq(previewJobs.id, id), eq(previewJobs.status, "queued"))!)
    .returning();

  if (claimed.length === 0) return json({ error: "Not queued" }, 409);
  return json({ job: claimed[0] });
}
