"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * The counter lives on the server, so the click bumps the shown number optimistically
 * and a refresh shortly after replaces it with the real value.
 */
export function DownloadButton({ href, count, label }: { href: string; count: number; label: string }) {
  const router = useRouter();
  const [shown, setShown] = useState(count);

  function download() {
    // A synthetic <a download> starts the transfer without navigating away.
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setShown((n) => n + 1);
    setTimeout(() => router.refresh(), 600);
  }

  return (
    <button type="button" onClick={download} className="btn btn-primary">
      <Download size={14} />
      {label}
      <span className="tabular-nums opacity-80">{shown.toLocaleString()}</span>
    </button>
  );
}
