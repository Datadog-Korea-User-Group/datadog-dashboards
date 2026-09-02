"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CopyButton } from "./CopyButton";

export function JsonViewer({ json }: { json: string }) {
  const t = useTranslations("detail");
  const [open, setOpen] = useState(false);

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 font-semibold hover:text-primary">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("json")}
        </button>
        <CopyButton text={json} className="btn btn-secondary btn-sm" />
      </div>
      {open ? (
        <pre className="m-0 p-3 max-h-[28rem] overflow-auto text-xs font-mono leading-relaxed bg-code-bg text-code-text">
          {json}
        </pre>
      ) : null}
    </section>
  );
}
