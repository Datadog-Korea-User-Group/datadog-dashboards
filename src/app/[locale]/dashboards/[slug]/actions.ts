"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { DASHBOARDS_TAG, countRecentComments, enqueuePreview } from "@/db/queries";
import { REACTION_EMOJIS, comments, dashboardRevisions, dashboards, ratings, reactions } from "@/db/schema";
import { firstInWindow } from "@/lib/recent-actions";
import { redirectLocalized } from "@/lib/redirect-localized";

// ponytail: per-process budgets, same ceiling as the view counter. Move to the database
// or Redis if the site ever runs more than one instance.
const REACTIONS_PER_10_MIN = 60;
const RATINGS_PER_HOUR = 20;

/** Throws once a user exceeds `limit` calls to `bucket` inside `windowMs`. */
function spend(bucket: string, userId: string, limit: number, windowMs: number) {
  for (let slot = 0; slot < limit; slot++) {
    if (firstInWindow(`${bucket}:${userId}:${slot}`, windowMs)) return;
  }
  throw new Error("Too many requests");
}

/** Interactions only make sense on a dashboard the public can see. */
async function assertInteractable(dashboardId: number) {
  const [row] = await db
    .select({ isPublished: dashboards.isPublished, reviewStatus: dashboards.reviewStatus })
    .from(dashboards)
    .where(eq(dashboards.id, dashboardId))
    .limit(1);
  return !!row?.isPublished && row.reviewStatus === "approved";
}

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Forbidden");
  return session;
}

export async function rateDashboard(dashboardId: number, stars: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!(await assertInteractable(dashboardId))) throw new Error("Not available");
  spend("rate", session.user.id, RATINGS_PER_HOUR, 3600_000);
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


/** `error` is a key under `comments.errors` in messages/*.json. */
export type CommentState = { error: string | null };

const COMMENTS_PER_HOUR = 10;
const MAX_COMMENT_CHARS = 4000;

export async function addComment(_prev: CommentState, formData: FormData): Promise<CommentState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "signIn" };

  const dashboardId = Number(formData.get("dashboardId"));
  if (!(await assertInteractable(dashboardId))) return { error: "unavailable" };

  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 1 || body.length > MAX_COMMENT_CHARS) return { error: "length" };
  if ((await countRecentComments(session.user.id)) >= COMMENTS_PER_HOUR) return { error: "rateLimit" };

  await db.insert(comments).values({ dashboardId, userId: session.user.id, body });
  revalidatePath("/", "layout");
  return { error: null };
}

export async function deleteComment(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const id = Number(formData.get("commentId"));
  const [found] = await db.select({ userId: comments.userId }).from(comments).where(eq(comments.id, id)).limit(1);
  if (!found) return;
  if (found.userId !== session.user.id && session.user.role !== "admin") throw new Error("Forbidden");

  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, id));
  revalidatePath("/", "layout");
}

export async function toggleReaction(dashboardId: number, emoji: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) throw new Error("Unknown reaction");
  if (!(await assertInteractable(dashboardId))) throw new Error("Not available");
  spend("react", session.user.id, REACTIONS_PER_10_MIN, 600_000);

  const where = and(
    eq(reactions.dashboardId, dashboardId),
    eq(reactions.userId, session.user.id),
    eq(reactions.emoji, emoji),
  )!;
  const [mine] = await db.select({ emoji: reactions.emoji }).from(reactions).where(where).limit(1);

  if (mine) await db.delete(reactions).where(where);
  else await db.insert(reactions).values({ dashboardId, userId: session.user.id, emoji }).onConflictDoNothing();

  revalidatePath("/", "layout");
}

export async function regeneratePreview(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const dashboardId = Number(formData.get("dashboardId"));
  const revision = Number(formData.get("revision"));
  if (!Number.isInteger(dashboardId) || !Number.isInteger(revision) || revision < 1) {
    throw new Error("Bad request");
  }

  const [target] = await db
    .select({ authorId: dashboards.authorId })
    .from(dashboards)
    .where(eq(dashboards.id, dashboardId))
    .limit(1);
  if (!target) return;
  if (target.authorId !== session.user.id && session.user.role !== "admin") throw new Error("Forbidden");

  const [exists] = await db
    .select({ revision: dashboardRevisions.revision })
    .from(dashboardRevisions)
    .where(and(eq(dashboardRevisions.dashboardId, dashboardId), eq(dashboardRevisions.revision, revision))!)
    .limit(1);
  if (!exists) throw new Error("No such revision");

  await enqueuePreview(dashboardId, revision);
  revalidatePath("/", "layout");
}
