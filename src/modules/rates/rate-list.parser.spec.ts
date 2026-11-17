import {
  convertRate,
  matchRateEntry,
  parseRateList,
  splitCsvLine,
} from './rate-list.parser';
import { RateEntry } from './schemas/rate-list.schema';

describe('parseRateList', () => {
  it('reads a clean list with flexible headers, units and thousands separators', () => {
    const { entries, errors } = parseRateList(
      '﻿Commodity,Unit,Min,Max,FQP\r\n' +
        'Wheat,100 kg,"9,800","10,400","10,100"\r\n' +
        '"Mango (Chaunsa)",Maund,6000,9000,\r\n' +
        '\r\n',
    );
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      {
        commodity: 'Wheat',
        unit: '100kg',
        minPrice: 9800,
        maxPrice: 10400,
        fairPrice: 10100,
      },
      {
        commodity: 'Mango (Chaunsa)',
        unit: '40kg',
        minPrice: 6000,
        maxPrice: 9000,
      },
    ]);
  });

  it('names each bad line and saves nothing from a file with problems', () => {
    const { entries, errors } = parseRateList(
      'commodity,unit,min,max,fqp\n' +
        'Wheat,100kg,9800,10400,10100\n' +
        'Rice,bag,7000,6000,\n' +
        ',kg,abc,10,\n' +
        'Wheat,100kg,1,2,5\n',
    );
    expect(entries).toEqual([]);
    expect(errors).toEqual([
      'Line 3: unit must be one of kg, 40kg, 100kg, ton, dozen, piece, litre; min is higher than max.',
      'Line 4: commodity is empty; min must be a price above zero.',
      'Line 5: fqp is outside min and max; commodity is listed twice.',
    ]);
  });

  it('rejects files without the required columns or without prices', () => {
    expect(parseRateList('').errors[0]).toContain('empty');
    expect(parseRateList('name,price\nWheat,10').errors[0]).toContain(
      'Missing: commodity, unit, min, max',
    );
    expect(parseRateList('commodity,unit,min,max').errors[0]).toContain(
      'no prices',
    );
  });

  it('splits quoted cells that contain commas and quotes', () => {
    expect(splitCsvLine('"Rice, Basmati","say ""hi""",3')).toEqual([
      'Rice, Basmati',
      'say "hi"',
      '3',
    ]);
  });
});

describe('matchRateEntry', () => {
  const entry = (commodity: string): RateEntry => ({
    commodity,
    unit: '100kg',
    minPrice: 1,
    maxPrice: 2,
  });
  const entries = [
    entry('Wheat'),
    entry('Mango (Chaunsa)'),
    entry('Mango (Sindhri)'),
    entry('Rice Basmati'),
    entry('Potato'),
  ];

  it('picks the most specific entry named by the listing', () => {
    expect(matchRateEntry('Chaunsa Mangoes', entries)?.commodity).toBe(
      'Mango (Chaunsa)',
    );
    expect(matchRateEntry('Fresh potatoes', entries)?.commodity).toBe('Potato');
    expect(matchRateEntry('Organic wheat grain', entries)?.commodity).toBe(
      'Wheat',
    );
    expect(matchRateEntry('Basmati', entries)?.commodity).toBe('Rice Basmati');
  });

  it('gives no answer rather than guess between varieties', () => {
    expect(matchRateEntry('Mango', entries)).toBeUndefined();
    expect(matchRateEntry('Tomato', entries)).toBeUndefined();
    expect(matchRateEntry('', entries)).toBeUndefined();
  });
});

describe('convertRate', () => {
  it('converts between weight units and refuses anything else', () => {
    expect(convertRate(10_000, '100kg', 'kg')).toBe(100);
    expect(convertRate(6000, '40kg', 'kg')).toBe(150);
    expect(convertRate(100, 'kg', 'ton')).toBe(100_000);
    expect(convertRate(300, 'dozen', 'dozen')).toBe(300);
    expect(convertRate(300, 'dozen', 'kg')).toBeUndefined();
  });
});
