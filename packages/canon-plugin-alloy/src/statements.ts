/**
 * The statements of a document's units, said from their predicates. A document
 * that keeps a table of readings in a `readings` block has the statement of
 * each unit with an Alloy predicate written between two markers, from that
 * predicate, so the statement cannot say anything the predicate does not.
 * A document without a `readings` block is left as it is.
 *
 * `states` says what each statement is, `write` makes the stale and missing
 * ones current, and neither touches a statement a person wrote: the person
 * deletes it to let it be generated.
 */
import { readBlocks, type Block } from '@bigmistqke/canon/blocks';
import { beginMarker, regionAt, replaceRegion } from '@bigmistqke/canon/regions';
import { maskFences, readUnits, type Unit } from '@bigmistqke/canon/units';
import { PARAGRAPHS } from './words.ts';
import { AlloyParseError } from '@bigmistqke/parse-alloy';
import { isDefinition, isRefusal, parseReadings, readsBack, verbalize, verbalizeDefinition, withDefinitions, type Readings } from '@bigmistqke/naturalloy';

/** The name of the region that holds the generated statement of a unit. */
export const regionName = (unit: string): string => `statement-${unit}`;
const endMarker = (region: string): string => `<!-- ${region}:end -->`;

/** Whether the statement of the unit sits between the markers of a generated region. */
export const isGenerated = (src: string, unit: string): boolean => regionAt(src, regionName(unit), endMarker(regionName(unit))) !== undefined;

/**
 * The statement is as the predicate says, or is not; `handwritten` is a
 * statement that a person wrote, which is never overwritten; `unsayable` is a
 * predicate the words cannot say, with the reason.
 */
export type StatementKind = 'current' | 'stale' | 'missing' | 'handwritten' | 'unsayable' | 'misread' | 'orphaned';

export interface StatementState {
  unit: string;
  kind: StatementKind;
  /** For `unsayable`, what cannot be said. */
  message?: string;
  /** For the others, the statement as the predicate says it, as a blockquote. */
  quote?: string;
}

/** A document that a document extends: where it is from the folder of the document, and its text. */
export interface Context {
  path: string;
  src: string;
}

/**
 * The readings a document keeps, with the definitions of its vocabulary, and
 * those of the documents it extends, whose words link to the document that
 * holds them; undefined when neither keeps any. The nearer a document, the
 * more its readings count, and the document's own count most.
 */
export function readingsOf(src: string, context: Context[] = []): Readings | undefined {
  const own = readBlocks(src);
  const documents = [...[...context].reverse().map(c => ({ path: c.path, blocks: readBlocks(c.src) })), { path: undefined, blocks: own }];
  if (!documents.some(d => d.blocks.some(b => b.lang === 'readings'))) return undefined;
  // The predicates a document defines, in its vocabulary and in the units that define them: the blocks that are Alloy paragraphs, and not bare formulas.
  const model = documents.flatMap(d => d.blocks).filter(b => b.lang === 'alloy' && (b.role === 'vocabulary' || (b.role === 'unit' && PARAGRAPHS.test(b.body))));
  // Each block is read for the unit that holds it, so that a word in brackets links to the term that says it.
  const merged = parseReadings('');
  for (const { path, blocks } of documents) {
    for (const block of blocks.filter(b => b.lang === 'readings')) {
      const part = parseReadings(block.body, `${path ?? ''}#${block.unit}`, path);
      for (const [key, value] of part.nouns) merged.nouns.set(key, value);
      for (const [key, value] of part.nounTargets) merged.nounTargets.set(key, value);
      for (const [key, value] of part.articles) merged.articles.set(key, value);
      for (const [key, value] of part.atoms) merged.atoms.set(key, value);
    }
  }
  return withDefinitions(merged, model.map(b => b.body).join('\n'));
}

const quote = (words: string): string =>
  words
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${line}`))
    .join('\n');

/**
 * The state of a statement as it stands: a current one that does not read back to one meaning, the one its formula
 * has, is misread, and says so.
 */
function read(unit: string, kind: 'current' | 'stale', quote: string, formula: string, readings: Readings): StatementState {
  if (kind === 'stale') return { unit, kind, quote };
  const back = readsBack(formula, readings);
  if (back.meanings.length === 1 && back.meanings[0] === back.meant) return { unit, kind, quote };
  const message =
    back.meanings.length === 0
      ? 'the statement does not read back by the reading rules of naturalloy'
      : back.meanings.length > 1
        ? `the statement reads ${back.meanings.length} ways by the reading rules of naturalloy; give two readings that say the same words different words`
        : 'the statement reads back as something its formula does not say';
  return { unit, kind: 'misread', message, quote };
}

/**
 * Which words a statement writes as a term mark: a word whose link leads to a
 * term of the document itself, `#term-…`, and that spells a form of that term,
 * the words of its stem or a spelling of its grammar table. A link to another
 * document needs its path, so it stays a link.
 */
function markedBy(units: Unit[]): (target: string, word: string) => boolean {
  const spelling = (words: string): string => words.trim().toLowerCase().split(/\s+/).join(' ');
  const forms = new Map<string, Set<string>>();
  for (const unit of units) {
    if (unit.kind !== 'term') continue;
    forms.set(`#${unit.id}`, new Set([spelling(unit.stem.replace(/-/g, ' ')), ...(unit.grammar?.forms ?? []).map(f => spelling(f.spelling))]));
  }
  return (target, word) => forms.get(target)?.has(spelling(word)) === true;
}

/** What each statement of a document is, in document order; empty for a document with no readings. */
export function states(src: string, context: Context[] = []): StatementState[] {
  let readings: Readings | undefined;
  try {
    readings = readingsOf(src, context);
  } catch (error) {
    if (!isRefusal(error) && !(error instanceof AlloyParseError)) throw error;
    return [{ unit: '(readings)', kind: 'unsayable', message: error.message }];
  }
  if (readings === undefined) return [];
  const units = readUnits(src);
  const blocks = readBlocks(src, units);
  const marked = markedBy(units);
  const found: StatementState[] = [];
  for (const unit of units) {
    const predicates = blocks.filter(b => b.unit === unit.id && b.lang === 'alloy' && b.role === 'unit');
    if (predicates.length === 0) continue;
    if (predicates.length > 1) {
      found.push({ unit: unit.id, kind: 'unsayable', message: 'has more than one predicate; a statement says one' });
      continue;
    }
    let words: string;
    let body = '';
    try {
      ({ body } = predicates[0] as { body: string });
      words = quote(isDefinition(body) ? verbalizeDefinition(body, readings, 'markdown', `#${unit.id}`, marked) : verbalize(body, readings, 'markdown', `#${unit.id}`, marked));
    } catch (error) {
      // A refusal says why the unit has no statement; anything else is a fault of naturalloy, and is not hidden as one.
      if (!isRefusal(error)) throw error;
      found.push({ unit: unit.id, kind: 'unsayable', message: error.message });
      continue;
    }
    const region = regionName(unit.id);
    const at = regionAt(src, region, endMarker(region));
    if (at !== undefined) found.push(read(unit.id, src.slice(at.body, at.to) === `\n${words}\n` ? 'current' : 'stale', words, body, readings));
    else found.push({ unit: unit.id, kind: statedByAPerson(unit.own, unit.id) ? 'handwritten' : 'missing', quote: words });
  }
  for (const { key, unit, body } of scenarios(src, blocks)) {
    let words: string;
    try {
      words = quote(`It must be possible that:\n\n${verbalize(body, readings, 'markdown', `#${unit}`, marked)}`);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      found.push({ unit: key, kind: 'unsayable', message: error.message });
      continue;
    }
    const region = regionName(key);
    const at = regionAt(src, region, endMarker(region));
    if (at === undefined) found.push({ unit: key, kind: 'missing', quote: words });
    else found.push(read(key, src.slice(at.body, at.to) === `\n${words}\n` ? 'current' : 'stale', words, body, readings));
  }
  // A region that names no unit and no scenario of the document is one that generate will never write again.
  const named = new Set([...units.map(u => u.id), ...scenarios(src, blocks).map(s => s.key)]);
  for (const m of maskFences(src).matchAll(/<!-- statement-([a-z0-9-]+):begin\b/g)) {
    const name = m[1] as string;
    if (!named.has(name)) found.push({ unit: name, kind: 'orphaned' });
  }
  return found;
}

/**
 * Whether the unit's own text holds a quote that a person wrote. The
 * generated statement of a scenario is a quote too, but it says what must be
 * possible, and is not the statement of the unit.
 */
function statedByAPerson(own: string, unit: string): boolean {
  const scenario = new RegExp(`<!-- statement-scenario-\\d+-${unit}:begin[^]*?<!-- statement-scenario-\\d+-${unit}:end -->`, 'g');
  return own.replace(scenario, '').split('\n').some(line => line.startsWith('>') && line.slice(1).trim() !== '');
}

/** The scenarios of a document, each with the key its statement goes by: its place among the scenarios of its unit, and the unit. */
function scenarios(src: string, blocks = readBlocks(src, readUnits(src))): { key: string; unit: string; body: string; block: Block }[] {
  const counted = new Map<string, number>();
  return blocks
    .filter(b => b.lang === 'alloy' && b.role === 'scenario')
    .map(block => {
      const nth = (counted.get(block.unit) ?? 0) + 1;
      counted.set(block.unit, nth);
      return { key: `scenario-${nth}-${block.unit}`, unit: block.unit, body: block.body, block };
    });
}

/**
 * The document with the stale statements rewritten and the missing ones
 * written below their headings, and the units that changed.
 */
export function write(src: string, context: Context[] = []): { src: string; written: string[] } {
  const todo = states(src, context).filter(s => s.quote !== undefined && (s.kind === 'stale' || s.kind === 'missing'));
  let text = src;
  for (const { unit, kind, quote: words } of todo) {
    if (kind !== 'stale') continue;
    const region = regionName(unit);
    text = replaceRegion(text, region, endMarker(region), words as string) ?? text;
  }
  // The missing ones go in from the last place to the first, so that no insertion moves one still to come: a unit's below its heading, and a scenario's just above its block.
  const starts = new Map(readUnits(text).map(u => [u.id, u.start]));
  const fences = new Map(scenarios(text).map(({ key, block }) => [key, text.lastIndexOf('\n', block.info.at - 1) + 1]));
  const inserts = todo
    .filter(s => s.kind === 'missing')
    .flatMap(({ unit, quote: words }) => {
      const region = regionName(unit);
      const fence = fences.get(unit);
      if (fence !== undefined) return [{ at: fence, text: `${beginMarker(region)}\n${words}\n${endMarker(region)}\n\n` }];
      const start = starts.get(unit);
      if (start === undefined) return [];
      const eol = text.indexOf('\n', start);
      return [{ at: eol === -1 ? text.length : eol + 1, text: `\n${beginMarker(region)}\n${words}\n${endMarker(region)}\n` }];
    })
    .sort((a, b) => b.at - a.at);
  for (const { at, text: inserted } of inserts) text = `${text.slice(0, at)}${inserted}${text.slice(at)}`;
  return { src: text, written: todo.map(s => s.unit) };
}
