"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CopyButton } from "./CopyButton";

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Fetches the dashboard JSON the first time it is expanded, never on page load. */
export function JsonViewer({ slug, revision, size }: { slug: string; revision: number; size: number }) {
  const t = useTranslations("detail");
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // `inline` keeps the viewer from inflating the download counter.
  const url = `/api/dashboards/${encodeURIComponent(slug)}/download?revision=${revision}&inline=1`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || json !== null || loading) return;
    setLoading(true);
    try {
      setJson(await fetch(url).then((r) => r.text()));
    } catch {
      setJson("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <button type="button" onClick={toggle} className="flex items-center gap-1.5 font-semibold hover:text-primary">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("json")}
          <span className="text-xs muted font-normal">{formatBytes(size)}</span>
        </button>
        <CopyButton url={url} className="btn btn-secondary btn-sm" />
      </div>
      {open ? (
        loading ? (
          <p className="flex items-center gap-2 p-3 text-xs muted"><Loader2 size={14} className="animate-spin" />…</p>
        ) : (
          <pre className="m-0 p-3 max-h-[28rem] overflow-auto text-xs font-mono leading-relaxed bg-code-bg text-code-text">
            {json}
          </pre>
        )
      ) : null}
    </section>
  );
}
