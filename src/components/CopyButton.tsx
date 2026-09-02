"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

/** Fetches the JSON on click so the page never has to inline it. */
export function CopyButton({ url, className = "btn btn-secondary" }: { url: string; className?: string }) {
  const t = useTranslations("detail");
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function copy() {
    setState("loading");
    try {
      const text = await fetch(url).then((r) => r.text());
      await navigator.clipboard.writeText(text);
      setState("done");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      // clipboard blocked (insecure origin) or the fetch failed — drop back to idle
      setState("idle");
    }
  }

  return (
    <button type="button" onClick={copy} disabled={state === "loading"} className={className}>
      {state === "loading" ? <Loader2 size={14} className="animate-spin" /> : state === "done" ? <Check size={14} /> : <Copy size={14} />}
      {state === "done" ? t("copied") : t("copy")}
    </button>
  );
}
