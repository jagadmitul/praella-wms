import { parseCsv, parseCsvRecords, toCsv } from './csv.util';

describe('CSV utilities', () => {
  describe('parseCsv', () => {
    it('parses a simple grid', () => {
      expect(parseCsv('a,b\n1,2')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('keeps commas inside quoted fields', () => {
      // The exact case a naive split(',') corrupts.
      expect(parseCsv('name,city\n"Acme, Industries",Surat')).toEqual([
        ['name', 'city'],
        ['Acme, Industries', 'Surat'],
      ]);
    });

    it('unescapes doubled quotes', () => {
      expect(parseCsv('note\n"He said ""hello"""')).toEqual([
        ['note'],
        ['He said "hello"'],
      ]);
    });

    it('keeps newlines inside quoted fields', () => {
      expect(parseCsv('note\n"line one\nline two"')).toEqual([
        ['note'],
        ['line one\nline two'],
      ]);
    });

    it('handles CRLF line endings from Excel', () => {
      expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
    });

    it('skips entirely blank lines', () => {
      expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']]);
    });
  });

  describe('parseCsvRecords', () => {
    it('keys rows by header', () => {
      const records = parseCsvRecords('sku,delta\nABC-1,5\nABC-2,-3');

      expect(records).toEqual([
        { sku: 'ABC-1', delta: '5' },
        { sku: 'ABC-2', delta: '-3' },
      ]);
    });

    it('trims surrounding whitespace', () => {
      expect(parseCsvRecords(' sku , delta \n ABC-1 , 5 ')).toEqual([
        { sku: 'ABC-1', delta: '5' },
      ]);
    });

    it('fills missing trailing columns with empty strings', () => {
      expect(parseCsvRecords('a,b,c\n1,2')).toEqual([
        { a: '1', b: '2', c: '' },
      ]);
    });

    it('rejects an empty file', () => {
      expect(() => parseCsvRecords('')).toThrow('empty');
    });
  });

  describe('toCsv', () => {
    it('writes a header and rows', () => {
      const csv = toCsv(
        [
          { header: 'sku', value: (row: { sku: string }) => row.sku },
          { header: 'qty', value: (row: { qty: number }) => row.qty },
        ],
        [{ sku: 'A-1', qty: 5 }],
      );

      expect(csv).toBe('sku,qty\nA-1,5\n');
    });

    it('quotes values containing commas, quotes or newlines', () => {
      const csv = toCsv(
        [{ header: 'name', value: (row: { name: string }) => row.name }],
        [{ name: 'Acme, "Big" Co\nLtd' }],
      );

      expect(csv).toBe('name\n"Acme, ""Big"" Co\nLtd"\n');
    });

    it('renders null and undefined as empty cells', () => {
      const csv = toCsv(
        [{ header: 'v', value: (row: { v: unknown }) => row.v }],
        [{ v: null }, { v: undefined }],
      );

      expect(csv).toBe('v\n\n\n');
    });

    it('round-trips through the parser', () => {
      const rows = [{ name: 'Acme, Industries', note: 'He said "hi"' }];
      const csv = toCsv(
        [
          { header: 'name', value: (row: (typeof rows)[number]) => row.name },
          { header: 'note', value: (row: (typeof rows)[number]) => row.note },
        ],
        rows,
      );

      expect(parseCsvRecords(csv)).toEqual([
        { name: 'Acme, Industries', note: 'He said "hi"' },
      ]);
    });
  });
});
