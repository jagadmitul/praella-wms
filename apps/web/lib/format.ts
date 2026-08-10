/**
 * Presentation helpers.
 *
 * Money arrives from the API as a decimal string so no precision is lost in
 * transit; it is only turned into a `Number` here, at the very last moment
 * before it is drawn on screen.
 */

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat('en-IN');

/**
 * Formats a decimal money string for display.
 *
 * @param value - Money as a string or number, e.g. `"24999.00"`.
 * @returns A localised currency string.
 */
export function formatCurrency(value: string | number): string {
  return currencyFormatter.format(Number(value));
}

/**
 * Formats a large money value compactly, for headline tiles.
 *
 * @param value - Money as a string or number.
 * @returns A short currency string, e.g. `₹3.3Cr`.
 */
export function formatCompactCurrency(value: string | number): string {
  return compactCurrencyFormatter.format(Number(value));
}

/**
 * Formats a unit count with thousands separators.
 *
 * @param value - A whole number of units.
 * @returns A localised number string.
 */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/**
 * Formats an ISO timestamp as a short absolute date and time.
 *
 * @param value - ISO-8601 timestamp.
 * @returns A readable date, e.g. `10 Aug 2026, 16:04`.
 */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats an ISO timestamp as a date only.
 *
 * @param value - ISO-8601 timestamp.
 * @returns A readable date, e.g. `10 Aug 2026`.
 */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Describes how long ago something happened, in coarse units.
 *
 * @param value - ISO-8601 timestamp in the past.
 * @returns A phrase such as `3h ago`.
 */
export function formatRelative(value: string): string {
  const elapsedMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(elapsedMs / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(value);
}

/**
 * Turns an enum value such as `PARTIALLY_RECEIVED` into `Partially received`.
 *
 * @param value - Screaming snake case enum value.
 * @returns A sentence-case label.
 */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
