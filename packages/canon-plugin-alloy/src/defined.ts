/**
 * The words that the readings of a document link to a term, and
 * whether that term defines them: a generated statement writes such a word as
 * a link, and a link to a term that has no form the word spells leads the
 * reader to a definition that does not say it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readUnits, type Unit } from '@bigmistqke/canon/units';
import { readingBlocks } from './tables.ts';
import type { WordFinding } from './words.ts';

const BRACKETED = /\[([^\]]+)\](?:\(([^)\s]*)#([^)\s]+)\))?/g;
const spelling = (words: string): string => words.trim().toLowerCase().split(/\s+/).join(' ');

/** The forms of each term of a document: the words of its stem, and the spellings of its grammar table. */
const formsOf = (units: Unit[]): Map<string, Set<string>> =>
  new Map(units.filter(u => u.kind === 'term').map(u => [u.id, new Set([spelling(u.stem.replace(/-/g, ' ')), ...(u.grammar?.forms ?? []).map(f => spelling(f.spelling))])]));

/**
 * Each word a reading of the document links to a term that has no
 * form it spells, as `undefined`. `file` is where the document is, so that a
 * link to another document can be followed. A noun is not looked at: its
 * signature is declared in the term that defines it, and it links there.
 */
export function checkDefinedWords(src: string, file?: string): WordFinding[] {
  const units = readUnits(src);
  const own = formsOf(units);
  const others = new Map<string, Map<string, Set<string>> | undefined>();
  const formsIn = (path: string): Map<string, Set<string>> | undefined => {
    if (path === '') return own;
    if (file === undefined) return undefined;
    const at = resolve(dirname(file), path);
    if (!others.has(at)) others.set(at, existsSync(at) ? formsOf(readUnits(readFileSync(at, 'utf8'))) : undefined);
    return others.get(at);
  };
  const found: WordFinding[] = [];
  for (const block of readingBlocks(src, units)) {
    for (const raw of block.body.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#') || /^noun\s/.test(line)) continue;
      // The two sides of the reading, after its key.
      const words = line.replace(/^[\w.'/]+\s*:\s*/, '');
      for (const m of words.matchAll(BRACKETED)) {
        const word = m[1] as string;
        const path = m[2] ?? '';
        const target = m[3] ?? block.unit;
        const terms = formsIn(path);
        const where = `${path}#${target}`;
        if (terms === undefined) continue;
        const forms = terms.get(target);
        if (forms === undefined) found.push({ unit: block.unit, kind: 'undefined', message: `"${word}" links to ${where}, which is no term` });
        else if (!forms.has(spelling(word))) found.push({ unit: block.unit, kind: 'undefined', message: `"${word}" links to ${where}, which has no form that spells it; link the word the term defines, or give the word a term of its own` });
      }
    }
  }
  return found;
}
