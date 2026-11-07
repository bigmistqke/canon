/**
 * The reading tables and noun tables of a document: the readings and the
 * nouns of its words, as markdown tables in the own text of a unit. A row of a
 * reading table says what a `readings` line says, `Key: positive | negative`,
 * and a row of a noun table what a `noun` line says, `noun Key: words`, so
 * each table reads as the lines of a `readings` fence, and every reader of
 * readings takes both.
 */
import { readBlocks } from '@bigmistqke/canon/blocks';
import { alignTable, cellsOf, maskFences, readUnits, type Unit } from '@bigmistqke/canon/units';

export type TableKind = 'reading' | 'noun';

const HEADERS: Record<TableKind, string[]> = {
  reading: ['reading', 'holds', 'does not hold'],
  noun: ['signature', 'noun']
};

const SEPARATOR = /^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*(:?-+:?[ \t]*)?$/;
const ROW = /^[ \t]*\|/;

/** One row of a table: the line it is on, counted from 0, and its cells. */
export interface Row {
  line: number;
  cells: string[];
}

/** A reading table or a noun table: the unit whose own text holds it, and the lines of its header and of its last row, counted from 0. */
export interface Table {
  unit: string;
  kind: TableKind;
  at: number;
  end: number;
  rows: Row[];
}

const kindOf = (line: string): TableKind | undefined => {
  if (!ROW.test(line)) return undefined;
  const cells = cellsOf(line).map(cell => cell.toLowerCase());
  return (Object.keys(HEADERS) as TableKind[]).find(kind => HEADERS[kind].length === cells.length && HEADERS[kind].every((h, i) => cells[i] === h));
};

/** The reading tables and noun tables in the own text of each unit, in document order; none inside a fenced block. */
export function tablesIn(src: string, units: Unit[] = readUnits(src)): Table[] {
  const lines = src.split('\n');
  const masked = maskFences(src).split('\n');
  const tables: Table[] = [];
  for (const unit of units) {
    const first = src.slice(0, unit.start).split('\n').length;
    const last = Math.min(first + unit.own.split('\n').length - 1, lines.length);
    for (let at = first; at < last; at++) {
      const kind = kindOf(masked[at] as string);
      if (kind === undefined || !SEPARATOR.test(masked[at + 1] ?? '')) continue;
      let end = at + 2;
      while (end < last && ROW.test(masked[end] as string)) end++;
      const rows = lines.slice(at + 2, end).map((text, i) => ({ line: at + 2 + i, cells: cellsOf(text) }));
      tables.push({ unit: unit.id, kind, at, end, rows });
      at = end - 1;
    }
  }
  return tables;
}

/** The `readings` line a row says. */
export function lineOf(kind: TableKind, cells: string[]): string {
  const [key = '', first = '', second = ''] = cells;
  if (kind === 'noun') return `noun ${key}: ${first}`;
  return second === '' ? `${key}: ${first}` : `${key}: ${first} | ${second}`;
}

/** The readings of a document as blocks of `readings` lines: each `readings` fence, and each table as the lines its rows say. */
export function readingBlocks(src: string, units: Unit[] = readUnits(src)): { unit: string; body: string }[] {
  const fenced = readBlocks(src, units).filter(b => b.lang === 'readings').map(b => ({ unit: b.unit, body: b.body }));
  const tabled = tablesIn(src, units).map(t => ({ unit: t.unit, body: t.rows.map(r => lineOf(t.kind, r.cells)).join('\n') }));
  return [...fenced, ...tabled];
}

/** The document with each reading table and noun table lined up: each cell padded to the width of its column. */
export function alignTables(src: string): string {
  const lines = src.split('\n');
  for (const table of tablesIn(src)) lines.splice(table.at, table.end - table.at, ...alignTable(lines.slice(table.at, table.end)));
  return lines.join('\n');
}
