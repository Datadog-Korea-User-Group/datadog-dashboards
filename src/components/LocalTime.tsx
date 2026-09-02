"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useLocale } from "next-intl";

export type TimeMode = "date" | "datetime";
export type TimeValue = string | Date | null | undefined;

const DASH = "—";

/** Nothing ever changes, so the store never notifies. */
const subscribe = () => () => {};

/**
 * ISO string, or null when there is nothing renderable. Guards before toISOString,
 * which throws on an invalid Date the same way Intl throws on an invalid time value.
 */
export function parseTimeValue(value: TimeValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// At most a handful of (locale, options) pairs; keeps Intl construction off every render.
const formatters = new Map<string, Intl.DateTimeFormat>();

function format(locale: string | undefined, options: Intl.DateTimeFormatOptions, iso: string | null) {
  if (iso === null) return DASH;
  try {
    const key = `${locale ?? "*"}|${options.dateStyle}|${options.timeStyle}|${options.timeZone ?? ""}`;
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, options);
      formatters.set(key, formatter);
    }
    return formatter.format(new Date(iso));
  } catch {
    // Last resort: an unsupported locale or option combination must not take the page down.
    return DASH;
  }
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
 *
 * An unusable value renders an em dash and no <time> element, never an exception: cached
 * rows outlive deploys and a single bad timestamp must not take a whole listing down.
 */
export function LocalTime({
  value,
  mode = "datetime",
  className,
}: {
  value: TimeValue;
  mode?: TimeMode;
  className?: string;
}) {
  const locale = useLocale();
  const iso = parseTimeValue(value);

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

  if (iso === null) return <span className={className}>{DASH}</span>;

  return (
    <time dateTime={iso} title={title} className={className}>
      {text}
    </time>
  );
}
