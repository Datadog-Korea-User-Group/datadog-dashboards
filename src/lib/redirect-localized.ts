import { hasLocale } from "next-intl";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Redirect to `href` under the caller's locale prefix. Throws like next/navigation's
 * redirect, which lets server actions declare a plain return type.
 */
export function redirectLocalized(href: string, rawLocale: unknown): never {
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  redirect(getPathname({ href, locale }));
}
