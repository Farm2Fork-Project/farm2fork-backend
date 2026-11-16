import { RATE_UNITS, RateEntry, RateUnit } from './schemas/rate-list.schema';

export const MAX_RATE_ROWS = 500;
export const MAX_RATE_FILE_BYTES = 512 * 1024;

export interface ParsedRateList {
  entries: RateEntry[];
  /** Human-readable problems, each naming its line. Empty when clean. */
  errors: string[];
}

const HEADER_ALIASES: Record<string, keyof RateEntry> = {
  commodity: 'commodity',
  item: 'commodity',
  crop: 'commodity',
  product: 'commodity',
  unit: 'unit',
  min: 'minPrice',
  minimum: 'minPrice',
  minprice: 'minPrice',
  max: 'maxPrice',
  maximum: 'maxPrice',
  maxprice: 'maxPrice',
  fqp: 'fairPrice',
  fair: 'fairPrice',
  fairprice: 'fairPrice',
};

const UNIT_ALIASES: Record<string, RateUnit> = {
  kg: 'kg',
  kilogram: 'kg',
  '40kg': '40kg',
  maund: '40kg',
  mann: '40kg',
  '100kg': '100kg',
  quintal: '100kg',
  ton: 'ton',
  tonne: 'ton',
  dozen: 'dozen',
  piece: 'piece',
  each: 'piece',
  litre: 'litre',
  liter: 'litre',
};

/** Splits one CSV line, honouring double-quoted fields and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

const toNumber = (text: string | undefined) => {
  if (text === undefined || text === '') return undefined;
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : NaN;
};

/**
 * Parses an admin-uploaded rate list. Expected columns, in any order:
 * commodity, unit, min, max and optionally fqp. Every problem is reported
 * with its line number so the admin can fix the file and upload again;
 * nothing is saved unless the whole file is clean.
 */
export function parseRateList(text: string): ParsedRateList {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== '');
  if (lines.length === 0) {
    return { entries: [], errors: ['The file is empty.'] };
  }
  const header = splitCsvLine(lines[0].line).map(
    (cell) => HEADER_ALIASES[cell.toLowerCase().replace(/[^a-z]/g, '')],
  );
  const column = (key: keyof RateEntry) => header.indexOf(key);
  const missing = (['commodity', 'unit', 'minPrice', 'maxPrice'] as const)
    .filter((key) => column(key) === -1)
    .map((key) => key.replace('Price', ''));
  if (missing.length > 0) {
    return {
      entries: [],
      errors: [
        `The first line must name the columns. Missing: ${missing.join(', ')}. Expected: commodity, unit, min, max, fqp.`,
      ],
    };
  }
  const rows = lines.slice(1);
  if (rows.length === 0) {
    return { entries: [], errors: ['The file has a header but no prices.'] };
  }
  if (rows.length > MAX_RATE_ROWS) {
    return {
      entries: [],
      errors: [`A rate list can hold at most ${MAX_RATE_ROWS} rows.`],
    };
  }

  const entries: RateEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const { line, number } of rows) {
    const cells = splitCsvLine(line);
    const commodity = cells[column('commodity')] ?? '';
    const unit =
      UNIT_ALIASES[
        (cells[column('unit')] ?? '').toLowerCase().replace(/[\s.]/g, '')
      ];
    const minPrice = toNumber(cells[column('minPrice')]);
    const maxPrice = toNumber(cells[column('maxPrice')]);
    const fairPrice =
      column('fairPrice') === -1
        ? undefined
        : toNumber(cells[column('fairPrice')]);
    const problems: string[] = [];
    if (!commodity) problems.push('commodity is empty');
    else if (commodity.length > 80) problems.push('commodity is too long');
    if (!unit) problems.push(`unit must be one of ${RATE_UNITS.join(', ')}`);
    if (minPrice === undefined || Number.isNaN(minPrice) || minPrice <= 0)
      problems.push('min must be a price above zero');
    if (maxPrice === undefined || Number.isNaN(maxPrice) || maxPrice <= 0)
      problems.push('max must be a price above zero');
    if (
      typeof minPrice === 'number' &&
      typeof maxPrice === 'number' &&
      minPrice > maxPrice
    )
      problems.push('min is higher than max');
    if (fairPrice !== undefined) {
      if (Number.isNaN(fairPrice) || fairPrice <= 0)
        problems.push('fqp must be a price above zero');
      else if (
        typeof minPrice === 'number' &&
        typeof maxPrice === 'number' &&
        (fairPrice < minPrice || fairPrice > maxPrice)
      )
        problems.push('fqp is outside min and max');
    }
    const key = `${commodity.toLowerCase()}|${unit}`;
    if (commodity && seen.has(key)) problems.push('commodity is listed twice');
    seen.add(key);
    if (problems.length > 0) {
      errors.push(`Line ${number}: ${problems.join('; ')}.`);
      continue;
    }
    entries.push({
      commodity,
      unit,
      minPrice: minPrice as number,
      maxPrice: maxPrice as number,
      ...(fairPrice !== undefined ? { fairPrice } : {}),
    });
  }
  return errors.length > 0
    ? { entries: [], errors: errors.slice(0, 25) }
    : { entries, errors: [] };
}

// --- matching a listing to a rate ---------------------------------------------

const KG_PER_UNIT: Partial<Record<string, number>> = {
  kg: 1,
  '40kg': 40,
  '100kg': 100,
  ton: 1000,
};

const singular = (word: string) =>
  word.endsWith('oes')
    ? word.slice(0, -2)
    : word.endsWith('ies')
      ? `${word.slice(0, -3)}y`
      : word.endsWith('s') && !word.endsWith('ss') && word.length > 3
        ? word.slice(0, -1)
        : word;

export const nameTokens = (name: string): string[] => [
  ...new Set(
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter(Boolean)
      .map(singular),
  ),
];

/**
 * The entry that names this product. Prefers the most specific entry whose
 * every word appears in the product name ("Mango (Chaunsa)" for "Chaunsa
 * mangoes"); otherwise the single entry containing every product word. Two
 * equally good candidates mean no answer rather than a guess.
 */
export function matchRateEntry(
  productName: string,
  entries: RateEntry[],
): RateEntry | undefined {
  const product = nameTokens(productName);
  if (product.length === 0) return undefined;
  const scored = entries.map((entry) => ({
    entry,
    tokens: nameTokens(entry.commodity),
  }));
  const within = scored
    .filter(
      ({ tokens }) =>
        tokens.length > 0 && tokens.every((token) => product.includes(token)),
    )
    .sort((a, b) => b.tokens.length - a.tokens.length);
  if (within.length > 0) {
    const best = within.filter(
      (s) => s.tokens.length === within[0].tokens.length,
    );
    return new Set(best.map((s) => s.entry.commodity)).size === 1
      ? best[0].entry
      : undefined;
  }
  const containing = scored.filter(({ tokens }) =>
    product.every((token) => tokens.includes(token)),
  );
  return new Set(containing.map((s) => s.entry.commodity)).size === 1
    ? containing[0].entry
    : undefined;
}

/** Price per `toUnit`, or undefined when the units cannot be converted. */
export function convertRate(
  price: number,
  fromUnit: string,
  toUnit: string,
): number | undefined {
  if (fromUnit === toUnit) return price;
  const from = KG_PER_UNIT[fromUnit];
  const to = KG_PER_UNIT[toUnit];
  if (!from || !to) return undefined;
  return Math.round(((price / from) * to + Number.EPSILON) * 100) / 100;
}
