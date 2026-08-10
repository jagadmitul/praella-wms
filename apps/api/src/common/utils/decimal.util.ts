import type { Prisma } from '../../generated/prisma/client';

/** Anything Prisma may hand back for a `Decimal` column. */
type DecimalLike = Prisma.Decimal | string | number | null | undefined;

/**
 * Serialises a Prisma `Decimal` to a fixed-precision string.
 *
 * Money crosses the wire as a string rather than a JSON number on purpose:
 * `24999.00` survives the round trip intact, whereas a float would quietly
 * become `24998.999999999996` for some values once arithmetic is applied.
 *
 * @param value - Decimal, string or number from Prisma.
 * @param fractionDigits - Decimal places to emit.
 * @returns A fixed-precision string, e.g. `"24999.00"`.
 */
export function toMoneyString(value: DecimalLike, fractionDigits = 2): string {
  if (value === null || value === undefined) {
    return (0).toFixed(fractionDigits);
  }
  return Number(value.toString()).toFixed(fractionDigits);
}

/**
 * Serialises an optional Decimal, preserving `null`.
 *
 * @param value - Decimal, string or number from Prisma.
 * @returns A fixed-precision string, or `null` when the input was nullish.
 */
export function toNullableMoneyString(value: DecimalLike): string | null {
  return value === null || value === undefined ? null : toMoneyString(value);
}

/**
 * Multiplies a unit amount by a whole quantity in integer paise/cents, so the
 * line total never inherits binary floating-point drift.
 *
 * @param unitAmount - Per-unit amount as a Decimal, string or number.
 * @param quantity - Whole number of units.
 * @returns The line total as a fixed-precision string.
 */
export function multiplyMoney(unitAmount: DecimalLike, quantity: number): string {
  const minorUnits = Math.round(Number((unitAmount ?? 0).toString()) * 100) * quantity;
  return (minorUnits / 100).toFixed(2);
}

/**
 * Sums fixed-precision money strings without leaving integer arithmetic.
 *
 * @param amounts - Money strings, e.g. the line totals of an order.
 * @returns The total as a fixed-precision string.
 */
export function sumMoney(amounts: readonly string[]): string {
  const minorUnits = amounts.reduce(
    (total, amount) => total + Math.round(Number(amount) * 100),
    0,
  );
  return (minorUnits / 100).toFixed(2);
}
