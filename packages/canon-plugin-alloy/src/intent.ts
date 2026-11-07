/**
 * `canon alloy:intent`: the intent of a unit with a formula, read and written
 * by its unit. The intent is the author's prose between the statement of the
 * unit and its first fenced block, fold, reading table or noun table; a "Derives from:" or "Site:" line after the
 * statement comes before it, and a generated region ends it, as the statement
 * of a scenario does.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBlocks } from '@bigmistqke/canon/blocks';
import { readUnits, type Unit } from '@bigmistqke/canon/units';
import { regionName } from './statements.ts';
import { kindOf, readingBlocks } from './tables.ts';

/** Where the intent of a unit is, as lines of the document: `from` up to, not including, `to`; the two are equal when it has none. */
export interface Place {
  unit: Unit;
  /** The line the unit starts on, counted from 1. */
  line: number;
  from: number;
  to: number;
  /** The lines of the document. */
  lines: string[];
}

const FENCE = /^ {0,3}(```|~~~)/;
/** The line that opens a fold, a `<details>` element, which ends the intent as a fence does. */
const FOLD = /^ {0,3}<details[\s>]/i;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const COMMENT = /^\s*<!--/;
const QUOTE = /^ {0,3}>/;
const STRUCTURE = /^(Derives from:|Site:)/;

/** Whether the unit holds a formula: an `alloy` block that is no vocabulary, bounds or scenario. */
export const holdsFormula = (src: string, unit: Unit, units: Unit[] = readUnits(src)): boolean =>
  readBlocks(src, units).some(b => b.unit === unit.id && b.lang === 'alloy' && b.role === 'unit');

/** Where the intent of the unit is in the document. */
export function placeOf(src: string, unit: Unit): Place {
  const lines = src.split('\n');
  const line = src.slice(0, unit.start).split('\n').length;
  // The own text runs from the line after the heading to its first nested heading.
  const ownLines = unit.own.split('\n').length;
  const end = Math.min(line + ownLines - 1, lines.length);
  let at = line;
  const skipBlank = (): void => {
    while (at < end && (lines[at] as string).trim() === '') at++;
  };
  skipBlank();
  // The generated statement is the unit's own region, wherever it sits among other regions; a handwritten one is the quote the own text opens with.
  const regionEnd = lines.slice(at, end).findIndex(l => l.includes(`<!-- ${regionName(unit.id)}:end -->`));
  if (regionEnd !== -1) {
    at += regionEnd + 1;
  } else if (at < end && QUOTE.test(lines[at] as string)) {
    while (at < end && QUOTE.test(lines[at] as string)) at++;
  }
  // A derivation line and a site line come right after the statement, and are no part of the intent.
  for (;;) {
    skipBlank();
    if (at < end && STRUCTURE.test(lines[at] as string)) at++;
    else break;
  }
  const from = at;
  const ends = (line: string): boolean => FENCE.test(line) || FOLD.test(line) || kindOf(line) !== undefined || COMMENT.test(line);
  while (at < end && !ends(lines[at] as string)) at++;
  let to = at;
  while (to > from && (lines[to - 1] as string).trim() === '') to--;
  return { unit, line, from, to, lines };
}

/** The intent as the document writes it; empty when the unit has none. */
export const textOf = (place: Place): string => place.lines.slice(place.from, place.to).join('\n');

/** Why the text cannot be an intent, or undefined when it can. */
export function refusalOf(text: string): string | undefined {
  if (text.trim() === '') return 'the text is empty, and a unit with a formula owes an intent';
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) return `the text holds a fenced block, which would end the intent: ${line.trim()}`;
    if (FOLD.test(line)) return `the text holds a fold, which would end the intent: ${line.trim()}`;
    if (kindOf(line) !== undefined) return `the text holds the header of a ${kindOf(line)} table, which would end the intent: ${line.trim()}`;
    if (HEADING.test(line)) return `the text holds a heading, which would end the unit: ${line.trim()}`;
    if (QUOTE.test(line)) return `the text holds a quote, which the checker reads as a statement: ${line.trim()}`;
    if (STRUCTURE.test(line)) return `the text holds a line the checker reads as a derivation or a site: ${line.trim()}`;
    if (COMMENT.test(line)) return `the text holds a comment, which can mark a generated region: ${line.trim()}`;
  }
  return undefined;
}

/** The document with the intent of the place replaced by the text. */
export function withIntent(place: Place, text: string): string {
  const lines = text.replace(/\s+$/, '').replace(/^\s*\n/, '').split('\n').map(l => l.trimEnd());
  const { from, to } = place;
  const before = place.lines.slice(0, from);
  const after = place.lines.slice(to);
  // An intent written where there was none needs a blank line on each side of it.
  if (before.length > 0 && (before.at(-1) as string).trim() !== '') lines.unshift('');
  if (from === to && after.length > 0 && (after[0] as string).trim() !== '') lines.push('');
  return [...before, ...lines, ...after].join('\n');
}

/** A unit that holds a formula, found in one of the documents. */
interface Found {
  doc: string;
  file: string;
  src: string;
  unit: Unit;
}

/** Find each unit by id in the documents; the code 2 refusal when one is missing or holds no formula. */
function find(documents: string[], root: string, ids: string[]): Found[] | string {
  const read = documents
    .map(doc => ({ doc, file: resolve(root, doc) }))
    .filter(({ file }) => existsSync(file))
    .map(({ doc, file }) => {
      const src = readFileSync(file, 'utf8');
      return { doc, file, src, units: readUnits(src) };
    });
  const found: Found[] = [];
  for (const id of ids) {
    const at = read.find(d => d.units.some(u => u.id === id));
    const unit = at?.units.find(u => u.id === id);
    if (at === undefined || unit === undefined) return `no unit "${id}" in the documents the Alloy plugin runs over`;
    if (!holdsFormula(at.src, unit, at.units)) return `${id} holds no formula, so it has no intent`;
    found.push({ doc: at.doc, file: at.file, src: at.src, unit });
  }
  return found;
}

/**
 * The ids on a command line, with `-` in place of the ids that `stdin` gives,
 * one on each line, a line of blank space naming none. Standard input is read
 * once, however many times `-` stands on the line.
 *
 * @canon spec-intent-reads-the-ids-of-a-dash-from-standard-input
 */
export async function idsFrom(args: string[], stdin: () => Promise<string>): Promise<string[]> {
  if (!args.includes('-')) return args;
  const lines = (await stdin())
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  let read = false;
  return args.flatMap(arg => {
    if (arg !== '-') return [arg];
    if (read) return [];
    read = true;
    return lines;
  });
}

/**
 * Standard input, read as a stream: a pipe that a Node process writes to can
 * be non-blocking, and a synchronous read of it fails with EAGAIN before the
 * writer has written.
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Print the intent of each unit under a line with where it starts and its id;
 * the exit code: 0, or 2 when a unit is missing or holds no formula. A `-`
 * among the ids stands for the ids on standard input, and when it names none,
 * nothing is printed.
 */
export async function printIntents(documents: string[], root: string, args: string[], stdin: () => Promise<string> = readStdin): Promise<number> {
  if (args.length === 0) {
    console.error('canon: alloy:intent takes the id of a unit or more');
    return 2;
  }
  const ids = await idsFrom(args, stdin);
  const found = find(documents, root, ids);
  if (typeof found === 'string') {
    console.error(`canon: alloy:intent: ${found}`);
    return 2;
  }
  for (const { doc, src, unit } of found) {
    const place = placeOf(src, unit);
    const text = textOf(place);
    console.log(`${doc}:${place.line}  ${unit.id}\n\n${text === '' ? 'none' : text}\n`);
  }
  return 0;
}

/** Replace the intent of one unit with the text; the exit code: 0, or 2 with no file changed when the write cannot hold. */
export function writeIntent(documents: string[], root: string, ids: string[], text: string): number {
  const refuse = (why: string): number => {
    console.error(`canon: alloy:intent --write: ${why}`);
    return 2;
  };
  if (ids.length !== 1) return refuse(`it takes the id of exactly one unit, and was given ${ids.length}`);
  const found = find(documents, root, ids);
  if (typeof found === 'string') return refuse(found);
  const why = refusalOf(text);
  if (why !== undefined) return refuse(why);
  const { doc, file, src, unit } = found[0] as Found;
  const place = placeOf(src, unit);
  writeFileSync(file, withIntent(place, text));
  console.log(`${doc}:${place.line}  ${unit.id}  wrote its intent`);
  return 0;
}

/**
 * Report each unit with a formula and no intent, in each document that keeps
 * readings, its own or those of a document it extends; the exit code: 0, or 1
 * when there is one. A document that keeps none has statements a person wrote,
 * and asks no intent.
 */
export function checkIntents(documents: string[], root: string, contextOf: (file: string) => string[]): number {
  let code = 0;
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    if (![src, ...contextOf(file)].some(text => readingBlocks(text).length > 0)) continue;
    const units = readUnits(src);
    for (const unit of units) {
      if (!holdsFormula(src, unit, units) || textOf(placeOf(src, unit)).trim() !== '') continue;
      code = 1;
      console.log(`${doc}: ${unit.id}: intentless: holds a formula and no intent; write what the unit is for with \`canon alloy:intent ${unit.id} --write\``);
    }
  }
  return code;
}
