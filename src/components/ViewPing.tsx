"use client";

import { useEffect } from "react";

/** Counts one view per browser session per dashboard. Renders nothing. */
export function ViewPing({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `viewed:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked (private mode, cookies off) — count it and move on */
    }
    fetch(`/api/dashboards/${encodeURIComponent(slug)}/view`, { method: "POST" }).catch(() => {});
  }, [slug]);

  return null;
}
