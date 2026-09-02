"use client";

import { Star } from "lucide-react";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

export function RatingStars({
  dashboardId, initial, action,
}: {
  dashboardId: number;
  initial: number | null;
  action: (dashboardId: number, stars: number) => Promise<void>;
}) {
  const t = useTranslations("detail");
  const [stars, setStars] = useState(initial ?? 0);
  const [hover, setHover] = useState(0);
  const [pending, startTransition] = useTransition();
  const shown = hover || stars;

  function rate(n: number) {
    setStars(n);
    startTransition(async () => { await action(dashboardId, n); });
  }

  return (
    <div className="flex items-center gap-2" onMouseLeave={() => setHover(0)}>
      <span className="text-xs font-semibold muted">{t("yourRating")}</span>
      <span className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={pending}
            onClick={() => rate(n)}
            onMouseEnter={() => setHover(n)}
            aria-label={`${n}`}
            className="p-0.5 disabled:opacity-50"
          >
            <Star size={18} className={n <= shown ? "fill-warning text-warning" : "text-text-tertiary"} />
          </button>
        ))}
      </span>
    </div>
  );
}
