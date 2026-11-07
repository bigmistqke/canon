/**
 * `canon alloy:readings`: the readings of the documents, listed and reworded
 * by their keys. A reading is a row of a reading table, or a line
 * `<key>: <positive> | <negative>` of a `readings` fence; a noun names a
 * signature, and is no reading.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBlocks } from '@bigmistqke/canon/blocks';
import { readUnits } from '@bigmistqke/canon/units';
import * as statements from './statements.ts';
import { tablesIn } from './tables.ts';
import type { Context } from './statements.ts';

/** One reading, where it is and what it says. */
export interface Reading {
  doc: string;
  file: string;
  /** The line it is on, counted from 1. */
  line: number;
  unit: string;
  key: string;
  positive: string;
  negative: string | undefined;
  /** Whether it is a row of a reading table, rather than a line of a fence. */
  row: boolean;
}

/** A line of readings that is a reading: its key, and its words after the colon. */
const READING = /^(\s*)([\w.'/]+)(\s*:\s*)(.+?)\s*$/;

/** Every reading of the documents, in document order. */
export function readingsIn(documents: string[], root: string): Reading[] {
  const all: Reading[] = [];
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const found: Reading[] = [];
    for (const block of readBlocks(src, readUnits(src)).filter(b => b.lang === 'readings')) {
      const first = src.slice(0, block.at).split('\n').length;
      block.body.split('\n').forEach((text, i) => {
        const trimmed = text.trim();
        if (trimmed === '' || trimmed.startsWith('#') || /^noun\s/.test(trimmed)) return;
        const m = READING.exec(text);
        if (m === null) return;
        const [positive, negative] = (m[4] as string).split('|').map(part => part.trim());
        found.push({ doc, file, line: first + i, unit: block.unit, key: m[2] as string, positive: positive as string, negative, row: false });
      });
    }
    for (const table of tablesIn(src).filter(t => t.kind === 'reading')) {
      for (const { line, cells } of table.rows) {
        const [key = '', positive = '', negative = ''] = cells;
        if (key === '') continue;
        found.push({ doc, file, line: line + 1, unit: table.unit, key, positive, negative: negative === '' ? undefined : negative, row: true });
      }
    }
    all.push(...found.sort((a, b) => a.line - b.line));
  }
  return all;
}

const say = (r: Reading): string => `${r.doc}:${r.line}  ${r.unit}  ${r.key}: ${r.positive}${r.negative === undefined ? '' : ` | ${r.negative}`}`;

/** Print each reading of the documents on a line of its own; the exit code: 0. */
export function listReadings(documents: string[], root: string): number {
  const readings = readingsIn(documents, root);
  if (readings.length === 0) console.log('no readings in the documents');
  for (const reading of readings) console.log(say(reading));
  return 0;
}

/**
 * Put new words in place of the words of the one reading with the key, and
 * name the statements that are stale until `generate`; the exit code: 0, or 2
 * with no file changed when the reword cannot hold.
 */
export function rewordReading(documents: string[], root: string, args: string[], contextOf: (file: string) => Context[]): number {
  const refuse = (why: string): number => {
    console.error(`canon: alloy:readings --write: ${why}`);
    return 2;
  };
  if (args.length !== 2) return refuse('it takes the key of a reading and its new words, as `<key> --write "<positive> | <negative>"`');
  const [key, words] = args as [string, string];
  const sides = words.split('|').map(side => side.trim());
  if (words.includes('\n') || sides.length !== 2 || sides.some(side => side === '')) {
    return refuse(`the new words must be two sides parted by one bar, "<positive> | <negative>", not "${words}"`);
  }
  const matching = readingsIn(documents, root).filter(r => r.key === key);
  if (matching.length === 0) return refuse(`no reading of the documents has the key "${key}"`);
  if (matching.length > 1) return refuse(`${matching.length} readings have the key "${key}", so it cannot say which one to reword:\n${matching.map(r => `  ${say(r)}`).join('\n')}`);
  const reading = matching[0] as Reading;
  const lines = readFileSync(reading.file, 'utf8').split('\n');
  if (reading.row) {
    lines[reading.line - 1] = `| ${reading.key} | ${sides[0]} | ${sides[1]} |`;
  } else {
    const m = READING.exec(lines[reading.line - 1] as string) as RegExpExecArray;
    lines[reading.line - 1] = `${m[1]}${m[2]}${m[3]}${sides[0]} | ${sides[1]}`;
  }
  const next = lines.join('\n');
  writeFileSync(reading.file, next);
  console.log(say({ ...reading, positive: sides[0] as string, negative: sides[1] }));
  console.log('the statements that use this reading are stale until `canon generate` writes them again');
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    let stale: string[];
    try {
      stale = statements.states(readFileSync(file, 'utf8'), contextOf(file)).filter(s => s.kind === 'stale').map(s => s.unit);
    } catch {
      // A fault of the verbalizer is reported by check and generate, which say it in full.
      continue;
    }
    for (const unit of stale) console.log(`${doc}: ${unit}: stale until \`canon generate\``);
  }
  return 0;
}
