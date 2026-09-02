"use server";

import { revalidatePath, updateTag } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/db";
import { DASHBOARDS_TAG, countRecentUploads } from "@/db/queries";
import { dashboardRevisions, dashboards } from "@/db/schema";
import { redirectLocalized } from "@/lib/redirect-localized";
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
        isPublished: true,
      })
      .returning({ id: dashboards.id });

    await tx.insert(dashboardRevisions).values({
      dashboardId: row.id,
      revision: 1,
      dashboardJson: parsed.json,
      createdBy: session.user.id,
    });
  });

  revalidatePath("/", "layout");
  updateTag(DASHBOARDS_TAG);
  redirectLocalized(`/dashboards/${slug}`, formData.get("locale"));
}
