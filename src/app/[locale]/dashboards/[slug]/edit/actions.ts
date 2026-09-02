"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { dashboardRevisions, dashboards } from "@/db/schema";
import { redirectLocalized } from "@/lib/redirect-localized";
import { validateDashboardJson } from "@/lib/validate-dashboard";

/** `error` is a key under `upload.errors` in messages/*.json. */
export type RevisionState = { error: string | null };

export async function createRevision(_prev: RevisionState, formData: FormData): Promise<RevisionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "signIn" };

  const slug = String(formData.get("slug") ?? "");
  const [target] = await db
    .select({ id: dashboards.id, authorId: dashboards.authorId })
    .from(dashboards)
    .where(eq(dashboards.slug, slug))
    .limit(1);
  if (!target) return { error: "notDashboard" };
  if (target.authorId !== session.user.id && session.user.role !== "admin") throw new Error("Forbidden");

  const parsed = validateDashboardJson(String(formData.get("json") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  // ponytail: next revision read-then-insert. The unique(dashboard_id, revision) index
  // turns a concurrent double-submit into an error rather than a lost revision.
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${dashboardRevisions.revision}), 0) + 1` })
    .from(dashboardRevisions)
    .where(eq(dashboardRevisions.dashboardId, target.id));

  await db.insert(dashboardRevisions).values({
    dashboardId: target.id,
    revision: next,
    dashboardJson: parsed.json,
    changelog: String(formData.get("changelog") ?? "").slice(0, 500),
    createdBy: session.user.id,
  });
  await db.update(dashboards).set({ updatedAt: new Date() }).where(eq(dashboards.id, target.id));

  revalidatePath("/", "layout");
  redirectLocalized(`/dashboards/${slug}`, formData.get("locale"));
}
