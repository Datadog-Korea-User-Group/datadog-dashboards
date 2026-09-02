"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { routing } from "@/i18n/routing";

export function LocaleSwitch({ label }: { label: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  function change(next: string) {
    const qs = search.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { locale: next });
  }
  return (
    <select aria-label={label} className="input h-[26px] text-xs py-0" value={locale} onChange={(e) => change(e.target.value)}>
      {routing.locales.map((l) => (
        <option key={l} value={l}>{l === "ko" ? "한국어" : "English"}</option>
      ))}
    </select>
  );
}
