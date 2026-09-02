"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";

export type GiscusConfig = { repo: string; repoId: string; category: string; categoryId: string };

const GISCUS_ORIGIN = "https://giscus.app";
const currentTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

/** Comments and reactions from GitHub Discussions. Config comes from server env via props. */
export function Giscus({ repo, repoId, category, categoryId, term }: GiscusConfig & { term: string }) {
  const locale = useLocale();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const script = document.createElement("script");
    script.src = `${GISCUS_ORIGIN}/client.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    const attrs: Record<string, string> = {
      repo,
      "repo-id": repoId,
      category,
      "category-id": categoryId,
      mapping: "specific",
      term,
      strict: "1",
      "reactions-enabled": "1",
      "emit-metadata": "0",
      "input-position": "top",
      theme: currentTheme(),
      lang: locale,
      loading: "lazy",
    };
    for (const [k, v] of Object.entries(attrs)) script.setAttribute(`data-${k}`, v);
    el.appendChild(script);

    return () => el.replaceChildren();
  }, [repo, repoId, category, categoryId, term, locale]);

  // Follow the header theme toggle, which flips `.dark` on <html> (see ThemeToggle).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      document
        .querySelector<HTMLIFrameElement>("iframe.giscus-frame")
        ?.contentWindow?.postMessage({ giscus: { setConfig: { theme: currentTheme() } } }, GISCUS_ORIGIN);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return <div ref={host} className="giscus" />;
}
