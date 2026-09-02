"use server";

import { revalidatePath, updateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { DASHBOARDS_TAG, countRecentUploads } from "@/db/queries";
import { dashboardRevisions, dashboards } from "@/db/schema";
import { redirectLocalized } from "@/lib/redirect-localized";
import { prepareScreenshot, writeScreenshot } from "@/lib/screenshot-upload";
import { uniqueSlug } from "@/lib/slug";
import { validateDashboardJson } from "@/lib/validate-dashboard";

/** `error` is a key under `upload.errors` in messages/*.json. */
export type UploadState = { error: string | null };

const UPLOADS_PER_HOUR = 10;

// Not exported: every export of a "use server" module must be an async function.
function parseTags(input: string): string[] {
  return [...new Set(input.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 10);
}

export async function createDashboard(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "signIn" };

  const title = String(formData.get("title") ?? "").trim();
  if (title.length < 3 || title.length > 120) return { error: "title" };

  const parsed = validateDashboardJson(String(formData.get("json") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  if ((await countRecentUploads(session.user.id)) >= UPLOADS_PER_HOUR) return { error: "rateLimit" };

  // Validated before the insert so a bad image cannot leave a dashboard behind.
  const shot = await prepareScreenshot(formData.get("screenshot") as File | null);
  if (!shot.ok) return { error: "screenshot" };

  const slug = uniqueSlug(title);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dashboards)
      .values({
        slug,
        title,
        description: String(formData.get("description") ?? "").trim().slice(0, 500),
        readme: String(formData.get("readme") ?? ""),
        tags: parseTags(String(formData.get("tags") ?? "")),
        authorId: session.user.id,
        source: "user",
        // Held until an admin approves; the preview job is enqueued on approval.
        reviewStatus: "pending",
        isPublished: false,
      })
      .returning({ id: dashboards.id });

    await tx.insert(dashboardRevisions).values({
      dashboardId: row.id,
      revision: 1,
      dashboardJson: parsed.json,
      createdBy: session.user.id,
      reviewStatus: "pending",
    });

    // A manual shot is kept so the reviewer sees something; the worker runs on approval.
    if (shot.webp) {
      await tx
        .update(dashboards)
        .set({ screenshotUrl: await writeScreenshot(shot.webp, row.id, 1), screenshotSource: "manual" })
        .where(eq(dashboards.id, row.id));
    }
  });

  revalidatePath("/", "layout");
  updateTag(DASHBOARDS_TAG);
  redirectLocalized(`/dashboards/${slug}`, formData.get("locale"));
}
