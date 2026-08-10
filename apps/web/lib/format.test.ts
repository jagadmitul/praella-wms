import { describe, expect, it } from 'vitest';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatRelative,
  humanise,
} from './format';

describe('formatters', () => {
  it('formats money from the decimal strings the API sends', () => {
    // Money crosses the wire as a string so precision survives; it is only
    // turned into a Number at the very last moment.
    expect(formatCurrency('24999.00')).toContain('24,999');
    expect(formatCurrency('0.00')).toContain('0');
  });

  it('formats large values compactly for headline tiles', () => {
    expect(formatCompactCurrency('32672784.10')).toMatch(/Cr|M/);
  });

  it('groups unit counts', () => {
    expect(formatNumber(119585)).toBe('1,19,585');
    expect(formatNumber(0)).toBe('0');
  });

  it('turns enum values into sentence case', () => {
    expect(humanise('PARTIALLY_RECEIVED')).toBe('Partially received');
    expect(humanise('INBOUND')).toBe('Inbound');
  });

  it('describes recent timestamps in coarse units', () => {
    const minutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const hoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();

    expect(formatRelative(minutesAgo)).toBe('5m ago');
    expect(formatRelative(hoursAgo)).toBe('3h ago');
    expect(formatRelative(new Date().toISOString())).toBe('just now');
  });

  it('falls back to an absolute date for anything older than a month', () => {
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60_000).toISOString();
    expect(formatRelative(longAgo)).toBe(formatDate(longAgo));
  });
});
