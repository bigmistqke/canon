/**
 * The layout of a statement: a line, a list, a block, or a rule, and the lines it is laid out in. The printer lays a
 * statement out, and the parser reads the lines back into the layout they came from, by the same conventions: a list
 * is bullets below its intro, a block is indented below its intro, and a rule puts each side after its word, with the
 * lines that go on from it indented to stand under that side.
 */
import { RULE } from './constructs.ts';

/** What a sentence becomes before it is laid out: a clause, a list that ends in a colon, a block, or a rule. */
export type Doc =
  | string
  | { kind: 'list'; intro: string; items: Doc[] }
  | { kind: 'block'; intro: string; body: Doc; every?: Every }
  | { kind: 'rule'; lead: string; when: Doc; then: Doc; otherwise?: Doc };

/**
 * A "for every" that the words could leave out: the intro it has, and for each of its variables the name, and "a" or
 * "an" with the name, said where the words first name the variable in its place.
 */
export interface Every {
  intro: string;
  /** Each variable of the "for every", in the order the words first name them. */
  vars: { name: string; said: string }[];
}

export const isList = (doc: Doc): doc is Extract<Doc, { kind: 'list' }> => typeof doc !== 'string' && doc.kind === 'list';

/** How far the lines after the first line of the side after "then" and after "otherwise" stand in, under that side. */
const THEN = `${RULE.then} `.length;
const OTHERWISE = `${RULE.otherwise} `.length;

/** A doc as lines of text, with its lists bulleted, its blocks indented, and each rule on lines of its own. */
export function lines(doc: Doc): string[] {
  if (typeof doc === 'string') return [doc];
  if (doc.kind === 'list') {
    const items = doc.items.flatMap(item => {
      const [first = '', ...rest] = lines(item);
      return [`- ${first}`, ...rest.map(line => `  ${line}`)];
    });
    return [`${doc.intro}:`, ...items.map(line => `  ${line}`)];
  }
  if (doc.kind === 'block') return [`${doc.intro}:`, ...lines(doc.body).map(line => `  ${line}`)];
  const [when, then] = [lines(doc.when), lines(doc.then)];
  const otherwise = doc.otherwise === undefined ? undefined : lines(doc.otherwise);
  return [
    `${doc.lead} ${when[0]}`,
    ...when.slice(1),
    `${RULE.then} ${then[0]}`,
    ...then.slice(1).map(line => `${' '.repeat(THEN)}${line}`),
    ...(otherwise === undefined ? [] : [`${RULE.otherwise} ${otherwise[0]}`, ...otherwise.slice(1).map(line => `${' '.repeat(OTHERWISE)}${line}`)])
  ];
}

/** A doc as lines of Markdown: blank lines and lists carry the structure that indentation carries in text. */
export function markdownLines(doc: Doc): string[] {
  if (typeof doc === 'string') return [doc];
  if (doc.kind === 'list') {
    const items = doc.items.flatMap(item => {
      const [first = '', ...rest] = markdownLines(item);
      return [`- ${first}`, ...rest.map(line => (line === '' ? '' : `  ${line}`))];
    });
    return [`${doc.intro}:`, ...items];
  }
  if (doc.kind === 'block') return broken([`${doc.intro}:`], markdownLines(doc.body));
  const [when, then] = [markdownLines(doc.when), markdownLines(doc.then)];
  const otherwise = doc.otherwise === undefined ? undefined : markdownLines(doc.otherwise);
  const first = broken([`${doc.lead} ${when[0]}${when.length === 1 ? ',' : ''}`, ...when.slice(1)], [`${RULE.then} ${then[0]}`, ...then.slice(1)]);
  return otherwise === undefined ? first : broken(first, [`${RULE.otherwise} ${otherwise[0]}`, ...otherwise.slice(1)]);
}

/**
 * Two parts of a doc, one after the other, as lines of Markdown. A line break, a `\` at the end of the first part's
 * last line, keeps the second on a line of its own with no empty line above it. A list needs no break before it,
 * since it opens on a line of its own; after one, a blank line ends it, as text right after a list would read as
 * part of its last item.
 */
function broken(before: string[], after: string[]): string[] {
  if ((after[0] ?? '').startsWith('- ')) return [...before, ...after];
  if (before.some(line => line.startsWith('- '))) return [...before, '', ...after];
  return [...before.slice(0, -1), `${before.at(-1) ?? ''}\\`, ...after];
}

interface Line {
  indent: number;
  text: string;
}

/** The lines of a statement in the text layout, without the capital it starts with and the period it ends with. */
function linesOf(text: string): Line[] {
  const out = text.split('\n').map(line => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  const first = out[0] as Line;
  first.text = first.text.replace(/^([A-Z])/, c => c.toLowerCase());
  const last = out[out.length - 1] as Line;
  last.text = last.text.replace(/\.$/, '');
  return out;
}

/** Every layout the lines of a statement in the text layout can be read as. */
export function readLayout(text: string): Doc[] {
  return layoutOf(linesOf(text));
}

function layoutOf(all: Line[]): Doc[] {
  const [first, ...rest] = all;
  if (first === undefined) return [];
  const base = first.indent;
  const lead = [RULE.whenever, RULE.when].find(word => first.text.startsWith(`${word} `));
  const thenAt = rest.findIndex(line => line.indent === base && line.text.startsWith(`${RULE.then} `));
  if (lead !== undefined && thenAt !== -1) {
    const otherwiseAt = rest.findIndex(line => line.indent === base && line.text.startsWith(`${RULE.otherwise} `));
    const side = (at: number, end: number, word: string, inset: number): Line[] => [
      { indent: base, text: (rest[at] as Line).text.slice(word.length + 1) },
      ...rest.slice(at + 1, end).map(line => ({ indent: line.indent - inset, text: line.text }))
    ];
    const whens = layoutOf([{ indent: base, text: first.text.slice(lead.length + 1) }, ...rest.slice(0, thenAt)]);
    const thens = layoutOf(side(thenAt, otherwiseAt === -1 ? rest.length : otherwiseAt, RULE.then, THEN));
    const otherwises = otherwiseAt === -1 ? [undefined] : layoutOf(side(otherwiseAt, rest.length, RULE.otherwise, OTHERWISE));
    return whens.flatMap(when => thens.flatMap(then => otherwises.map((otherwise): Doc => (otherwise === undefined ? { kind: 'rule', lead, when, then } : { kind: 'rule', lead, when, then, otherwise }))));
  }
  if (rest.length === 0) return [first.text];
  if (!first.text.endsWith(':')) return [];
  const intro = first.text.slice(0, -1);
  const below = rest[0] as Line;
  if (below.indent === base + 2 && below.text.startsWith('- ')) {
    // Each item opens at a bullet at the indent below the intro, and goes on with the lines below it.
    const starts = rest.flatMap((line, i) => (line.indent === base + 2 && line.text.startsWith('- ') ? [i] : []));
    const items = starts.map((start, k) => [{ indent: base + 4, text: (rest[start] as Line).text.slice(2) }, ...rest.slice(start + 1, starts[k + 1] ?? rest.length)]);
    let all_: Doc[][] = [[]];
    for (const item of items) all_ = all_.flatMap(done => layoutOf(item).map(doc => [...done, doc]));
    return all_.map(docs => ({ kind: 'list', intro, items: docs }));
  }
  return layoutOf(rest).map(body => ({ kind: 'block', intro, body }));
}
