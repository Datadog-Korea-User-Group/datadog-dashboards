"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { DASHBOARDS_TAG } from "@/db/queries";
import { dashboardRevisions, dashboards, previewJobs } from "@/db/schema";

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Forbidden");
  return session;
}

const stamp = (userId: string, note?: string) => ({
  reviewedBy: userId,
  reviewedAt: new Date(),
  reviewNote: note ?? null,
});

function done() {
  revalidatePath("/", "layout");
  updateTag(DASHBOARDS_TAG);
}

export async function approveDashboard(formData: FormData) {
  const session = await requireAdmin();
  const id = Number(formData.get("dashboardId"));
  const revision = Number(formData.get("revision"));
  if (!Number.isInteger(id) || !Number.isInteger(revision)) throw new Error("Bad request");

  const [row] = await db
    .select({ screenshotSource: dashboards.screenshotSource })
    .from(dashboards)
    .where(eq(dashboards.id, id))
    .limit(1);
  if (!row) return;

  await db
    .update(dashboards)
    .set({ reviewStatus: "approved", isPublished: true, ...stamp(session.user.id) })
    .where(eq(dashboards.id, id));
  await db
    .update(dashboardRevisions)
    .set({ reviewStatus: "approved", ...stamp(session.user.id) })
    .where(and(eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.revision, revision))!);

  // The author's own screenshot wins; otherwise the worker renders one now that it is public.
  if (row.screenshotSource !== "manual") await db.insert(previewJobs).values({ dashboardId: id, revision });
  done();
}

export async function rejectDashboard(formData: FormData) {
  const session = await requireAdmin();
  const id = Number(formData.get("dashboardId"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!Number.isInteger(id) || !note) throw new Error("Bad request");

  await db
    .update(dashboards)
    .set({ reviewStatus: "rejected", isPublished: false, ...stamp(session.user.id, note) })
    .where(eq(dashboards.id, id));
  done();
}

export async function approveRevision(formData: FormData) {
  const session = await requireAdmin();
  const id = Number(formData.get("dashboardId"));
  const revision = Number(formData.get("revision"));
  if (!Number.isInteger(id) || !Number.isInteger(revision)) throw new Error("Bad request");

  const [row] = await db
    .select({ screenshotSource: dashboards.screenshotSource })
    .from(dashboards)
    .where(eq(dashboards.id, id))
    .limit(1);
  if (!row) return;

  await db
    .update(dashboardRevisions)
    .set({ reviewStatus: "approved", ...stamp(session.user.id) })
    .where(and(eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.revision, revision))!);
  await db.update(dashboards).set({ updatedAt: new Date() }).where(eq(dashboards.id, id));

  if (row.screenshotSource !== "manual") await db.insert(previewJobs).values({ dashboardId: id, revision });
  done();
}

export async function rejectRevision(formData: FormData) {
  const session = await requireAdmin();
  const id = Number(formData.get("dashboardId"));
  const revision = Number(formData.get("revision"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!Number.isInteger(id) || !Number.isInteger(revision) || !note) throw new Error("Bad request");

  await db
    .update(dashboardRevisions)
    .set({ reviewStatus: "rejected", ...stamp(session.user.id, note) })
    .where(and(eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.revision, revision))!);
  done();
}
