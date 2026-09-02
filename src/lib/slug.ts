/** URL slug from a title. Keeps Hangul so Korean titles stay readable. */
export function slugify(input: string): string {
  const s = input
    // NFKD then NFC: strips Latin diacritics (é → e) but recomposes Hangul jamo
    // back into syllables, which the character class below keeps.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "dashboard";
}

/** Slug + short random suffix, so two dashboards may share a title. */
export function uniqueSlug(title: string): string {
  return `${slugify(title)}-${Math.random().toString(36).slice(2, 8)}`;
}
