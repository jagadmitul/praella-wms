/**
 * Converts a display name into a URL-safe slug.
 *
 * @param value - Human-entered name.
 * @returns A lowercase, hyphen-separated slug.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

/**
 * Produces a slug that does not collide with those already taken, appending
 * `-2`, `-3` … until it is unique.
 *
 * @param value - Human-entered name.
 * @param isTaken - Predicate returning whether a candidate slug already exists.
 * @returns A unique slug.
 */
export async function uniqueSlug(
  value: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(value) || 'organization';
  let candidate = base;
  let suffix = 1;

  while (await isTaken(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}
