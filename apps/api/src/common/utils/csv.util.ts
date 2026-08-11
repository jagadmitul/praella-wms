/**
 * Minimal RFC 4180 CSV reader and writer.
 *
 * Hand-written rather than pulled from a package because the requirements are
 * small and completely specified: quoted fields, doubled quotes inside them,
 * and commas or newlines inside quotes. A dependency would be more code to
 * audit than the ~60 lines below, and warehouse exports are exactly the place
 * where a naïve `split(',')` corrupts data — a supplier called
 * "Acme, Industries" would silently shift every column after it.
 */

/** Splits CSV text into rows of raw string cells. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Normalise line endings so CRLF files from Excel behave like LF ones.
  const text = input.replace(/\r\n?/g, '\n');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Flush whatever the last line left behind.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) =>
    candidate.some((cell) => cell.trim() !== ''),
  );
}

/**
 * Parses CSV text with a header row into objects keyed by column name.
 *
 * @param input - Raw CSV text.
 * @returns One record per data row, with headers normalised to camelCase-ish keys.
 * @throws Error when the file has no header row.
 */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);

  if (rows.length === 0) {
    throw new Error('The CSV file is empty');
  }

  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).map((row) =>
    headers.reduce<Record<string, string>>((record, header, column) => {
      record[header] = (row[column] ?? '').trim();
      return record;
    }, {}),
  );
}

/** Escapes a single value for CSV output. */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Anything that is not already a primitive is serialised as JSON rather than
  // stringified: `String({})` yields "[object Object]", which is worse than
  // useless in an export a human is going to open in a spreadsheet.
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Renders rows as CSV text with a header line.
 *
 * @param columns - Column definitions, in output order.
 * @param rows - Records to render.
 * @returns CSV text, newline-terminated.
 */
export function toCsv<TRow>(
  columns: Array<{ header: string; value: (row: TRow) => unknown }>,
  rows: readonly TRow[],
): string {
  const lines = [columns.map((column) => escapeCell(column.header)).join(',')];

  for (const row of rows) {
    lines.push(
      columns.map((column) => escapeCell(column.value(row))).join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}
