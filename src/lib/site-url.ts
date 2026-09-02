import { routing } from "@/i18n/routing";

/** Read per call: SITE_URL reaches the container at runtime, not at build time. */
export const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Locale-prefixed path. `localePrefix: "as-needed"` means the default locale has no prefix. */
export function localePath(locale: string, path = "") {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  return `${prefix}${path}` || "/";
}

export const absolute = (locale: string, path = "") => `${siteUrl()}${localePath(locale, path)}`;

/** hreflang map for one path, plus x-default pointing at the default locale. */
export function languageAlternates(path = ""): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) languages[locale] = absolute(locale, path);
  languages["x-default"] = absolute(routing.defaultLocale, path);
  return languages;
}
