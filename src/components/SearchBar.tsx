"use client";

import { Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";

export function SearchBar({ placeholder, initial = "" }: { placeholder: string; initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="relative w-full max-w-sm"
      onSubmit={(e) => { e.preventDefault(); router.push(q ? `/dashboards?q=${encodeURIComponent(q)}` : "/dashboards"); }}
    >
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
      <input className="input w-full pl-8 h-[30px]" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} name="q" />
    </form>
  );
}
