/**
 * Joins conditional class names.
 *
 * Small enough not to warrant a dependency: this project never needs to merge
 * conflicting Tailwind utilities, only to drop falsy entries.
 *
 * @param values - Class names, or falsy values to ignore.
 * @returns A single space-separated class string.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
