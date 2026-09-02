import { getTranslations } from "next-intl/server";

export function qualityBand(score: number | null | undefined) {
  if (score === null || score === undefined) return "unknown" as const;
  if (score >= 80) return "good" as const;
  if (score >= 50) return "fair" as const;
  return "poor" as const;
}

const pill = { good: "pill-success", fair: "pill-warning", poor: "pill-danger", unknown: "pill-neutral" } as const;

export async function QualityBadge({ score, showScore = false }: { score: number | null | undefined; showScore?: boolean }) {
  const t = await getTranslations("quality");
  const band = qualityBand(score);
  return (
    <span className={`pill ${pill[band]}`}>
      {t(band)}
      {showScore && band !== "unknown" ? ` ${score}` : ""}
    </span>
  );
}
