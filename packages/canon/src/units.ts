/**
 * The units of a canon document, as the checker reads them: each heading that
 * declares one, its kind and stem, the unit it sits in, its statement, its own
 * text and its site. Whatever else reads a canon reads it through this, so a
 * unit is one thing everywhere.
 */

import { FRONTMATTER } from './frontmatter.ts';

/**
 * Blank out the frontmatter, fenced-code bodies and the generated index, keeping every byte
 * offset and every newline.
 *
 * The index has to go: it links every unit in the document, so leaving it
 * readable makes `dead` vacuous — every unit is cited by the table of contents
 * that was generated FROM it. A generated link is not evidence that anything
 * derives from a unit, which is the only thing `dead` is asking.
 */
export const maskFences = (src: string): string =>
  src
    .replace(FRONTMATTER, m => m.replace(/[^\n]/g, ' '))
    .replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, m =>
      m.replace(/[^\n]/g, ' ')
    )
    .replace(/<!--[ \t]*toc:begin\b[^>]*-->[\s\S]*?<!-- toc:end -->/g, m =>
      m.replace(/[^\n]/g, ' ')
    );

/**
 * A unit heading: `### @spec <stem> — <prose>`, whose id is `spec-<stem>`. The
 * stem is declared rather than slugged from the prose, so the sentence after the
 * em dash can be reworded without breaking a citation.
 */
export const UNIT_HEADING = /^(#{1,6})[ \t]+@([a-z]+)[ \t]+(\S+)[ \t]*$/gm;
/** Any heading, including a plain section one — it ends the unit above it. */
const ANY_HEADING = /^(#{1,6})[ \t]+/gm;
/**
 * A spec's site — the one place in the code that does what it states, on a
 * line of its own in the body. The statement stays the claim alone, so a tree
 * shows what the system does rather than where.
 */
const SITE = /^Site: (.+)$/m;

/** The roles that each type of a grammar table allows; `also` is allowed for each. */
export const ROLES: Readonly<Record<string, readonly string[]>> = {
  noun: ['plural'],
  verb: ['third person', 'past', 'participle', 'gerund'],
  adjective: [],
  name: []
};

/** A term's grammar table: its type, the spellings of each role it lists, and what in it the checker cannot read. */
export interface Grammar {
  /** The part of speech its row `type` names, as written; undefined when it has no such row. */
  type?: string;
  forms: Array<{ role: string; spelling: string }>;
  /** Each type or role the table names that the checker does not know, as written. */
  unknown: string[];
  /** Each type or role the table names in more than one row. */
  repeated: string[];
}

/** The cells of a table row, trimmed: `| a | b |` gives `['a', 'b']`. */
const cellsOf = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

const GRAMMAR_HEADER = /^[ \t]*\|[ \t]*grammar[ \t]*\|[ \t]*\|[ \t]*$/;
const SEPARATOR = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|?[ \t]*$/;

/**
 * Where the grammar table of a text lies, by line: the header `| grammar | |`,
 * the line of dashes under it, and each row after them that starts with a pipe.
 */
function grammarLines(lines: string[]): { at: number; end: number } | undefined {
  const at = lines.findIndex((line, i) => GRAMMAR_HEADER.test(line) && SEPARATOR.test(lines[i + 1] ?? ''));
  if (at === -1) return undefined;
  let end = at + 2;
  while (end < lines.length && /^[ \t]*\|/.test(lines[end] as string)) end++;
  return { at, end };
}

/**
 * The grammar table in a unit's own text: a table whose headers are `grammar`
 * and nothing, with a row `type` and a row for each role, whose spellings
 * are separated by commas. Undefined when the own text has no such table.
 */
export function grammarOf(own: string): Grammar | undefined {
  const lines = own.split('\n');
  const table = grammarLines(lines);
  if (!table) return undefined;
  const rows = lines.slice(table.at + 2, table.end).map(cellsOf);
  const grammar: Grammar = { forms: [], unknown: [], repeated: [] };
  const seen = new Set<string>();
  for (const [key = '', value = ''] of rows) {
    if (seen.has(key)) grammar.repeated.push(key);
    seen.add(key);
    if (key === 'type' && grammar.type === undefined) grammar.type = value;
  }
  const roles = grammar.type === undefined ? undefined : ROLES[grammar.type];
  if (grammar.type !== undefined && roles === undefined) grammar.unknown.push(grammar.type);
  const done = new Set<string>();
  for (const [key = '', value = ''] of rows) {
    if (key === 'type' || done.has(key)) continue;
    done.add(key);
    // A role is unknown only to a type the checker knows; a table with no type or an unknown one has its one rotting already.
    if (key !== 'also' && roles !== undefined && !roles.includes(key)) grammar.unknown.push(key);
    else for (const spelling of value.split(',').map(s => s.trim()).filter(s => s !== '')) grammar.forms.push({ role: key, spelling });
  }
  return grammar;
}

/**
 * The document with the cells of each grammar table padded, so that every
 * cell of a column is as wide as its widest cell, and the dashes under the
 * headers as wide too, with at least three. A table inside a fenced block or
 * the index is left as it is.
 */
export function alignGrammarTables(src: string): string {
  const md = maskFences(src);
  const lines = src.split('\n');
  const masked = md.split('\n');
  // Each table starts on a line of a term's own text, so the line of every term heading bounds the search.
  const starts = new Map<number, number>();
  let line = 0;
  let offset = 0;
  const lineAt = (at: number): number => {
    for (; offset + (masked[line] as string).length + 1 <= at; line++) offset += (masked[line] as string).length + 1;
    return line;
  };
  for (const unit of readUnits(src)) {
    if (unit.kind !== 'term') continue;
    const first = lineAt(unit.start) + 1;
    starts.set(first, first + unit.own.split('\n').length);
  }
  for (const [first, last] of starts) {
    const table = grammarLines(masked.slice(first, last));
    if (!table) continue;
    const at = first + table.at;
    const end = first + table.end;
    const rows = lines.slice(at, end).map(cellsOf);
    rows.splice(1, 1);
    const width = [0, 1].map(col => Math.max(3, ...rows.map(row => (row[col] ?? '').length)));
    const print = (row: string[]): string => `| ${(row[0] ?? '').padEnd(width[0] as number)} | ${(row[1] ?? '').padEnd(width[1] as number)} |`;
    const out = rows.map(print);
    out.splice(1, 0, `| ${'-'.repeat(width[0] as number)} | ${'-'.repeat(width[1] as number)} |`);
    lines.splice(at, end - at, ...out);
  }
  return lines.join('\n');
}

export interface Unit {
  /** `spec-<stem>`: the kind and the stem, joined. */
  id: string;
  /** The word after the `@`: `axiom`, `spec`, `term`, … */
  kind: string;
  stem: string;
  /** The heading's depth, and the byte range of the unit, up to the next heading of its depth or above. */
  level: number;
  start: number;
  end: number;
  /** The unit it sits in, found by extent: a plain section heading between the two breaks the relation. */
  parent?: string;
  /**
   * The unit's statement: the blockquote opening its own text, its lines
   * joined by a space, or kept as lines where it holds a list. Declared by the line prefix rather than inferred from
   * emphasis, so marking a term inside it changes nothing about what is read.
   */
  statement?: string;
  /** The unit's own text, before its first nested heading. */
  own: string;
  /** The place in the code its "Site:" line names. */
  site?: string;
  /** A term's grammar table. */
  grammar?: Grammar;
}

/** The statement a unit's own text opens with: its first blockquote, joined. */
function statementOf(own: string): string | undefined {
  const lines = own.split('\n');
  const first = lines.findIndex(line => line.startsWith('>'));
  if (first === -1) return undefined;
  const quote: string[] = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith('>')) break;
    quote.push(line.replace(/^>[ \t]?/, ''));
  }
  // A list keeps its lines, so its items and what follows it keep the indentation that says where each one ends.
  if (quote.some(line => /^\s*[-*+] /.test(line))) {
    const kept = quote.map(line => line.trimEnd());
    while (kept.at(-1) === '') kept.pop();
    return kept.join('\n');
  }
  const text = quote.join(' ').replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text;
}

/** Every unit a canon document declares, in document order. */
export function readUnits(src: string): Unit[] {
  const md = maskFences(src);
  const levels = [...md.matchAll(ANY_HEADING)].map(m => ({ level: m[1].length, at: m.index ?? 0 }));
  const units: Unit[] = [];
  for (const m of md.matchAll(UNIT_HEADING)) {
    const start = m.index ?? 0;
    const level = m[1].length;
    // A plain section heading closes the unit above it: it is not a unit, but
    // it is not part of one either.
    const next = levels.find(h => h.at > start && h.level <= level);
    units.push({ id: `${m[2]}-${m[3]}`, kind: m[2], stem: m[3], level, start, end: next ? next.at : md.length, own: '' });
  }
  // Nesting IS the derivation link, so each unit records the unit it sits
  // inside. A plain section heading between the two breaks the relation, which
  // is why the enclosing unit is found by extent rather than by heading depth.
  for (const unit of units) {
    unit.parent = units
      .filter(u => u !== unit && unit.start > u.start && unit.start < u.end)
      .sort((a, b) => b.start - a.start)[0]?.id;
  }
  for (const unit of units) {
    const body = md.slice(unit.start, unit.end).split('\n').slice(1).join('\n');
    // Only the unit's own text, before its first nested heading, holds its statement and names its site.
    unit.own = body.split(/^#{1,6}[ \t]/m)[0];
    unit.statement = statementOf(unit.own);
    unit.site = SITE.exec(unit.own)?.[1]?.trim();
    if (unit.kind === 'term') unit.grammar = grammarOf(unit.own);
  }
  return units;
}
