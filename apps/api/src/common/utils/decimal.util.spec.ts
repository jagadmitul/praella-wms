import {
  multiplyMoney,
  sumMoney,
  toMoneyString,
  toNullableMoneyString,
} from './decimal.util';

describe('money helpers', () => {
  describe('toMoneyString', () => {
    it('formats to two decimal places', () => {
      expect(toMoneyString(24999)).toBe('24999.00');
      expect(toMoneyString('1234.5')).toBe('1234.50');
      expect(toMoneyString(0.1)).toBe('0.10');
    });

    it('treats a missing value as zero', () => {
      expect(toMoneyString(null)).toBe('0.00');
      expect(toMoneyString(undefined)).toBe('0.00');
    });

    it('preserves null when nullability is meaningful', () => {
      expect(toNullableMoneyString(null)).toBeNull();
      expect(toNullableMoneyString(12)).toBe('12.00');
    });
  });

  describe('multiplyMoney', () => {
    it('multiplies without floating-point drift', () => {
      // 0.1 * 3 is 0.30000000000000004 in binary floating point.
      expect(multiplyMoney(0.1, 3)).toBe('0.30');
      expect(multiplyMoney(1.15, 3)).toBe('3.45');
      expect(multiplyMoney('62.50', 200)).toBe('12500.00');
    });

    it('handles a zero quantity', () => {
      expect(multiplyMoney(99.99, 0)).toBe('0.00');
    });
  });

  describe('sumMoney', () => {
    it('sums line totals exactly', () => {
      expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
      expect(sumMoney(['12500.00', '3.45', '0.05'])).toBe('12503.50');
    });

    it('returns zero for an empty list', () => {
      expect(sumMoney([])).toBe('0.00');
    });

    it('stays exact across many small amounts where floats would drift', () => {
      const hundredth = Array.from({ length: 100 }, () => '0.01');
      expect(sumMoney(hundredth)).toBe('1.00');
    });
  });
});
