// Pure listing params. Separate from db/queries so client components can import
// them without pulling the database driver into the browser bundle.

export const PAGE_SIZE = 24;

export const SORTS = ["downloads", "views", "newest", "rating", "source"] as const;
export const QUALITY_BANDS = ["good", "fair", "poor", "unknown"] as const;
export type Sort = (typeof SORTS)[number];
export type QualityBand = (typeof QUALITY_BANDS)[number];

export function parseSort(value?: string | null): Sort {
  return (SORTS as readonly string[]).includes(value ?? "") ? (value as Sort) : "downloads";
}

export function parseQuality(value?: string | null): QualityBand | undefined {
  return (QUALITY_BANDS as readonly string[]).includes(value ?? "") ? (value as QualityBand) : undefined;
}
