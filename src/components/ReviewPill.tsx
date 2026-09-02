import { getTranslations } from "next-intl/server";

const style: Record<string, string> = {
  pending: "pill-warning",
  approved: "pill-success",
  rejected: "pill-danger",
};

/** Review state as a pill. An approved but unpublished dashboard reads as unpublished. */
export async function ReviewPill({ status, published }: { status: string; published?: boolean }) {
  const t = await getTranslations("review");
  if (status === "approved" && published === false) {
    return <span className="pill pill-neutral">{t("status_unpublished")}</span>;
  }
  return <span className={`pill ${style[status] ?? "pill-neutral"}`}>{t(`status_${status}`)}</span>;
}
