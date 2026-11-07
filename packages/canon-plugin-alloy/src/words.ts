/**
 * The words of a document that keeps readings: what its Alloy blocks declare,
 * where, and what says them. A word is a signature, a field of a signature that
 * holds a relation, or a predicate. The terms of a document are the places that
 * name its words, so a word belongs in the term that names it, with the readings
 * that say it, and a word that nothing uses is a model element no claim relies
 * on. These checks read text only and need no solver.
 */
import { readBlocks } from '@bigmistqke/canon/blocks';
import { parseModule } from '@bigmistqke/parse-alloy';
import { readUnits } from '@bigmistqke/canon/units';
import { readingBlocks } from './tables.ts';

export type WordKind = 'signature' | 'field' | 'predicate';

export interface Word {
  /** `Freelancing`, `Sit.rel` for the field `rel` of the signature `Sit`, or `cites`. */
  name: string;
  kind: WordKind;
  /** The unit that holds the declaration. */
  unit: string;
}

export type WordFindingKind = 'undeclared' | 'misplaced' | 'apart' | 'unused';

export interface WordFinding {
  unit: string;
  kind: WordFindingKind;
  message: string;
}

/** A text of Alloy without its comments. */
export const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?:--|\/\/)[^\n]*/g, ' ');

/** Whether a block is Alloy paragraphs, a vocabulary or a definition, and not a bare formula. */
export const PARAGRAPHS = /^\s*(?:(?:var|one|lone|some|abstract|private)\s+)*(?:sig|pred|fun|fact|assert|enum|open|let|run|check)\b/;

/** The signatures that the text of a module declares, as the parser reads them, with what their declaration says of them. */
export function signaturesIn(body: string): { name: string; var: boolean; one: boolean; subset: boolean }[] {
  return parseModule(body).paragraphs.flatMap(p => (p.t === 'sig' ? p.names.map(name => ({ name, var: p.var === true, one: p.mult === 'one', subset: p.parent?.kind === 'in' })) : []));
}

/**
 * The words that one model block declares: its signatures, the fields of a
 * signature it declares alone, `Holder.field`, and its predicates, as the
 * parser reads them. A bare formula declares nothing, and neither does a block
 * the parser cannot read, which the statements report.
 */
export function declaredIn(body: string): { name: string; kind: WordKind }[] {
  if (!PARAGRAPHS.test(strip(body))) return [];
  let module;
  try {
    module = parseModule(body);
  } catch {
    return [];
  }
  const found: { name: string; kind: WordKind }[] = [];
  for (const p of module.paragraphs) {
    if (p.t === 'sig') {
      for (const name of p.names) found.push({ name, kind: 'signature' });
      if (p.names.length === 1) for (const field of p.fields.flatMap(d => d.names)) found.push({ name: `${p.names[0]}.${field}`, kind: 'field' });
    }
    if (p.t === 'pred') found.push({ name: p.name, kind: 'predicate' });
  }
  return found;
}

/** The words that the model blocks of a document declare, each with the unit that holds it. */
export function declared(src: string): Word[] {
  const found: Word[] = [];
  for (const block of readBlocks(src, readUnits(src))) {
    if (block.lang !== 'alloy' || block.role === 'bounds' || block.role === 'scenario') continue;
    for (const word of declaredIn(block.body)) found.push({ ...word, unit: block.unit });
  }
  return found;
}

/** What a unit's model blocks, formulas and scenarios say, apart from the names they declare: where a word is used. */
function usedText(src: string): string {
  return readBlocks(src, readUnits(src))
    .filter(b => b.lang === 'alloy' && b.role !== 'bounds')
    .map(b => strip(b.body))
    .join('\n');
}

/** The declared field a key names: `Sit.rel`, or just the field, `on`, as the sentence for `x.on = y` is keyed. */
function fieldOf(words: Word[], key: string): Word[] {
  return words.filter(w => w.kind === 'field' && (w.name === key || w.name.endsWith(`.${key}`)));
}

/** The key of a reading line, `Sit.rel`, `Throwing'` or `cites`, and each noun, with the unit that holds it. */
function readingKeys(src: string): { key: string; unit: string; noun: boolean }[] {
  const keys: { key: string; unit: string; noun: boolean }[] = [];
  for (const block of readingBlocks(src)) {
    for (const raw of block.body.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const noun = /^noun\s+(\w+)\s*:/.exec(line);
      if (noun) {
        keys.push({ key: noun[1] as string, unit: block.unit, noun: true });
        continue;
      }
      const atom = /^([\w.']+)\s*:/.exec(line);
      if (atom) keys.push({ key: (atom[1] as string).replace(/'$/, ''), unit: block.unit, noun: false });
    }
  }
  return keys;
}

/**
 * The findings about the words of a document, in document order: a reading for
 * a word nothing declares, a declaration that is not in a term, a reading apart
 * from the declaration it says, and a word that no claim, definition or fact
 * uses. A document with no readings is left alone.
 */
export function checkWords(src: string, context: string[] = []): WordFinding[] {
  const keys = readingKeys(src);
  if (keys.length === 0) return [];
  const kinds = new Map(readUnits(src).map(u => [u.id, u.kind]));
  const words = declared(src);
  // The words of the documents it extends are declared there, and are the document's words as well.
  const inherited = context.flatMap(declared);
  const byName = new Map(words.map(w => [w.name, w]));
  const found: WordFinding[] = [];

  for (const { key, unit, noun } of keys) {
    const candidates = byName.has(key) ? [byName.get(key) as Word] : fieldOf(words, key);
    if (candidates.length === 0 && (inherited.some(w => w.name === key) || fieldOf(inherited, key).length > 0)) continue;
    if (candidates.length === 0) {
      found.push({ unit, kind: 'undeclared', message: `${noun ? 'the noun' : 'the reading'} "${key}" says a word that nothing in the document declares` });
    } else if (!candidates.some(w => w.unit === unit)) {
      found.push({ unit, kind: 'apart', message: `"${key}" is declared in ${(candidates[0] as Word).unit}, so its ${noun ? 'noun' : 'reading'} belongs there` });
    }
  }

  for (const word of words) {
    if (kinds.get(word.unit) !== 'term') {
      found.push({ unit: word.unit, kind: 'misplaced', message: `declares the ${word.kind} "${word.name}", which belongs in the term that names it` });
    }
  }

  const text = usedText(src);
  for (const word of words) {
    const uses = word.kind === 'field' ? usesOfField(text, words, word) : (text.match(new RegExp(`\\b${word.name}\\b`, 'g')) ?? []).length - declarations(words, word);
    if (uses <= 0) found.push({ unit: word.unit, kind: 'unused', message: `declares "${word.name}", which no claim, definition or fact uses` });
  }
  return found;
}

export interface LoneFinding {
  unit: string;
  kind: 'lone';
  message: string;
}

/** The text of a model block with the name list of each signature declaration blanked out: what the block names, apart from what it declares. */
const naming = (body: string): string =>
  strip(body).replace(/\bsig\s+([\w\s,]+?)(?=(?:\s+(?:extends|in)\s+[\w\s+]+?)?\s*\{)/g, m => m.replace(/\w+/g, w => (w === 'sig' ? w : ' ')));

/**
 * The formulas of a document that keeps readings that are lone on a signature,
 * in document order: the formula of a unit that is not a term uses a signature
 * that no other unit of the document or of the documents it extends names, and
 * that no scenario names. Nothing else constrains such a signature, so no
 * other formula can contradict the formula. Fields and predicates are left out.
 */
export function checkLoneFormulas(src: string, context: string[] = []): LoneFinding[] {
  if (readingKeys(src).length === 0) return [];
  const units = readUnits(src);
  const kinds = new Map(units.map(u => [u.id, u.kind]));
  const signatures = new Set([...declared(src), ...context.flatMap(declared)].filter(w => w.kind === 'signature').map(w => w.name));
  const model = (text: string, doc: number) =>
    readBlocks(text, readUnits(text))
      .filter(b => b.lang === 'alloy' && b.role !== 'bounds')
      .map(b => ({ unit: `${doc}:${b.unit}`, role: b.role, names: new Set(naming(b.body).match(/\b\w+\b/g) ?? []) }));
  const blocks = [...model(src, 0), ...context.flatMap((text, i) => model(text, i + 1))];
  const found: LoneFinding[] = [];
  for (const block of blocks) {
    if (block.role !== 'unit' || !block.unit.startsWith('0:')) continue;
    const unit = block.unit.slice(2);
    if (kinds.get(unit) === 'term') continue;
    for (const name of block.names) {
      if (!signatures.has(name)) continue;
      const named = blocks.some(b => b.names.has(name) && (b.unit !== block.unit || b.role === 'scenario'));
      if (!named) found.push({ unit, kind: 'lone', message: `rests on the signature "${name}", which no other unit and no scenario names, so no other formula can contradict it` });
    }
  }
  return found;
}

/** How many times a signature or a predicate is named in the declarations of words of that name: once each. */
const declarations = (words: Word[], word: Word): number => words.filter(w => w.name === word.name && w.kind !== 'field').length;

/**
 * How many times a field is used: written `Holder.field`, or, when no other
 * signature has a field of that name, named anywhere apart from its
 * declaration, `x.field`, `field.x`, `x->y in field` or `field` alone.
 */
function usesOfField(text: string, words: Word[], word: Word): number {
  const [holder, field] = word.name.split('.') as [string, string];
  const shared = words.filter(w => w.kind === 'field' && w.name.endsWith(`.${field}`)).length > 1;
  if (shared) return (text.match(new RegExp(`\\b${holder}\\s*\\.\\s*${field}\\b`, 'g')) ?? []).length;
  // the declaration of the field names it once
  return (text.match(new RegExp(`\\b${field}\\b`, 'g')) ?? []).length - 1;
}
