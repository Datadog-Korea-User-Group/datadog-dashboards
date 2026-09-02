"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

export function CopyButton({ text, className = "btn btn-secondary" }: { text: string; className?: string }) {
  const t = useTranslations("detail");
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked (insecure origin or denied permission) — leave the label alone */
    }
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? t("copied") : t("copy")}
    </button>
  );
}
