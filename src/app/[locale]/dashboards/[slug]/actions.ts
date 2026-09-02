"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { DASHBOARDS_TAG } from "@/db/queries";
import { dashboards, ratings } from "@/db/schema";
import { redirectLocalized } from "@/lib/redirect-localized";

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Forbidden");
  return session;
}

export async function rateDashboard(dashboardId: number, stars: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const n = Math.min(5, Math.max(1, Math.round(stars)));

  await db
    .insert(ratings)
    .values({ dashboardId, userId: session.user.id, stars: n })
    .onConflictDoUpdate({ target: [ratings.dashboardId, ratings.userId], set: { stars: n } });

  await db
    .update(dashboards)
    .set({
      ratingAvg: sql`(select round(avg(stars)::numeric, 2) from ratings where dashboard_id = ${dashboardId})`,
      ratingCount: sql`(select count(*)::int from ratings where dashboard_id = ${dashboardId})`,
    })
    .where(eq(dashboards.id, dashboardId));

  revalidatePath("/", "layout");
  updateTag(DASHBOARDS_TAG);
}

export async function setPublished(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("dashboardId"));
  await db
    .update(dashboards)
    .set({ isPublished: formData.get("published") === "true", updatedAt: new Date() })
    .where(eq(dashboards.id, id));
  revalidatePath("/", "layout");
  updateTag(DASHBOARDS_TAG);
}

export async function deleteDashboard(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("dashboardId"));
  const locale = String(formData.get("locale") ?? "en");
  await db.delete(dashboards).where(eq(dashboards.id, id));
  revalidatePath("/", "layout");
  updateTag(DASHBOARDS_TAG);
  redirectLocalized("/dashboards", locale);
}

