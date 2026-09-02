"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";

export type TimeMode = "date" | "datetime";

/** Nothing ever changes, so the store never notifies. */
const subscribe = () => () => {};

// At most a handful of (locale, options) pairs; keeps Intl construction off every render.
const formatters = new Map<string, Intl.DateTimeFormat>();

function format(locale: string | undefined, options: Intl.DateTimeFormatOptions, iso: string) {
  const date = new Date(iso);
  // A bad timestamp must not take the page down: Intl throws on an invalid date.
  if (Number.isNaN(date.getTime())) return iso;

  const key = `${locale ?? "*"}|${options.dateStyle}|${options.timeStyle}|${options.timeZone ?? ""}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}

const textOptions = (mode: TimeMode): Intl.DateTimeFormatOptions =>
  mode === "datetime" ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };

const titleOptions: Intl.DateTimeFormatOptions = { dateStyle: "full", timeStyle: "long" };

/**
 * Renders a timestamp in the visitor's own locale and timezone.
 *
 * The server has no way to know either, so it renders the page locale in UTC and the
 * browser swaps in its own formatting on hydration. useSyncExternalStore keeps those two
 * passes from tripping the hydration check, and both snapshots return plain strings, so
 * equal output compares equal and never loops.
 */
export function LocalTime({
  value,
  mode = "datetime",
  className,
}: {
  value: string | Date;
  mode?: TimeMode;
  className?: string;
}) {
  const locale = useLocale();
  const iso = typeof value === "string" ? value : value.toISOString();

  const text = useSyncExternalStore(
    subscribe,
    useCallback(() => format(undefined, textOptions(mode), iso), [iso, mode]),
    useCallback(() => format(locale, { ...textOptions(mode), timeZone: "UTC" }, iso), [iso, mode, locale]),
  );

  const title = useSyncExternalStore(
    subscribe,
    useCallback(() => format(undefined, titleOptions, iso), [iso]),
    useCallback(() => format(locale, { ...titleOptions, timeZone: "UTC" }, iso), [iso, locale]),
  );

  return (
    <time dateTime={iso} title={title} className={className}>
      {text}
    </time>
  );
}
