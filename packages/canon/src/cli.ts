#!/usr/bin/env node
/**
 * `canon` — the derivation-link tooling for a project's canon: the gate over
 * the citations, and the writer that regenerates what the documents generate.
 * The protocol is the `canon` skill; this file's own `--help` is the manual.
 *
 * Depends on nothing outside Node.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { aNoun, CLAIMS, citable, type Kind, kindOf, noun, OWES, PREFIXES, REFINES } from './kinds.ts';
import { issueRefs, lookupIssues, refKey, trackerProblems, type IssueRef, type TrackerConfig } from './tracker.ts';
import type { PluginContext } from './plugin.ts';
import { configKeysOf, CORE_COMMANDS, documentsFor, findCommands, findNamed, type Found } from './plugins.ts';
import { beginMarker, replaceRegion } from './regions.ts';
import { contextOf } from './extends.ts';
import { hasSettings, readFrontmatter } from './frontmatter.ts';
import { alignGrammarTables, grammarOf, maskFences, readUnits, type Unit as UnitOfDocument } from './units.ts';
import { parseSource, testsOf, type Exports, type Syntax, type TestBlock } from './tests.ts';
import { MARKER, marksOf, runnersOf, type Runner } from './runners.ts';

// ---------------------------------------------------------------------------
// SCOPE — declared, never inferred.
//
// A project declares its scope in the `canon` field of its `package.json`. The
// protocol applies only to the documents and suites named there. An untagged
// file outside that scope is not ambiguous: it is simply not participating.
// ---------------------------------------------------------------------------

/** The `canon` field of `package.json`. Every key is optional. */
interface Config {
  /** The canon documents, relative to the project root. */
  documents?: string[];
  /** The declared suite directory. */
  suites?: string;
  /** The trees swept for voluntary citations and for the code a spec names. */
  sources?: string[];
  /** Prose documents whose citations must resolve but discharge nothing. */
  references?: string[];
  /** How a reader runs this tool, for the advice in findings. */
  command?: string;
  /** The runners whose calls are tests: preset names, or maps of calls, modifiers, fails, from and globals. */
  runners?: unknown;
  /**
   * The issue tracker the bugs name their issues in. With it, `check` asks the
   * tracker whether each issue exists and is open.
   */
  tracker?: TrackerConfig;
  /** A plugin's options, under the field its `config` names. */
  [plugin: string]: unknown;
}

/**
 * The entry document: the nearest document named CANON.md, from where the tool
 * was run upwards, whose frontmatter holds a setting. The settings of the
 * project live in its frontmatter. A document whose frontmatter cannot be read
 * is passed over here, and reported where the documents are read.
 */
const ENTRY = ((): string | undefined => {
  for (let dir = resolve(process.cwd()); ; dir = dirname(dir)) {
    const file = join(dir, 'CANON.md');
    if (existsSync(file)) {
      try {
        if (hasSettings(readFrontmatter(readFileSync(file, 'utf8'), true))) return file;
      } catch {
        // Reported when the documents are read.
      }
    }
    if (dirname(dir) === dir) return undefined;
  }
})();

/**
 * The project root: the folder of the entry document, or while no document
 * holds a setting, the nearest directory whose `package.json` carries a
 * `canon` field.
 */
const ROOT = ((): string => {
  if (ENTRY !== undefined) return dirname(ENTRY);
  for (let dir = resolve(process.cwd()); ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        canon?: unknown;
      };
      if (parsed.canon !== undefined) return dir;
    }
    if (dirname(dir) === dir) {
      console.error(
        'canon: no CANON.md with settings in its frontmatter and no package.json with a "canon" field between here and the filesystem root'
      );
      process.exit(2);
    }
  }
})();

/** The settings of the entry document, as the `canon` field of a package would hold them. */
function settingsOf(entry: string): Config {
  const { plugins, extends: extended, other, documents, ...settings } = readFrontmatter(readFileSync(entry, 'utf8'), true) ?? {};
  return { ...settings, documents: [...new Set([basename(entry), ...(documents ?? [])])], ...other } as Config;
}

const CONFIG: Config =
  ENTRY !== undefined
    ? settingsOf(ENTRY)
    : (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { canon: Config }).canon;

const DOCS = CONFIG.documents ?? ['CANON.md'];

/**
 * The declared suites: every file in this directory, no exceptions.
 *
 * Scope is a claim a suite makes, and here the claim is where it lives. Moving
 * a suite in is the declaration; moving it out withdraws it.
 *
 * Flat, and scoped by CLAIM rather than by module: one spec can bind several
 * modules at once, and filing its suites by the module they happen to drive
 * would silently re-partition the spec.
 */
const TESTS = CONFIG.suites ?? 'test/canon';

const SOURCES = CONFIG.sources ?? ['src', 'test'];

const REFERENCES = CONFIG.references ?? [];

const COMMAND = CONFIG.command ?? 'pnpm canon';

/** The runners of the project. A runner the checker does not know stops the run. */
const RUNNERS = ((): Runner[] => {
  try {
    return runnersOf(CONFIG.runners);
  } catch (error) {
    console.error(`canon: ${(error as Error).message}`);
    process.exit(2);
  }
})();

/** Whether the project reads the runner markers as runners. */
const MARKS = marksOf(CONFIG.runners);

/** Whether the project has a runner at all. With none it has no tests, and owes none. */
const HAS_RUNNER = RUNNERS.length > 0 || MARKS;

// ---------------------------------------------------------------------------
// A minimal element scanner: enough to know which element each anchor sits in.
// ---------------------------------------------------------------------------
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr'
]);

interface Element {
  tag: string;
  id: string | undefined;
  start: number;
  end: number;
  /** Heading depth, the enclosing unit and the prose after the em dash. */
  level?: number;
  parent?: string;
  label?: string;
  statement?: string;
  /** The unit's own text, before its first nested heading. */
  own?: string;
  /** The place in the code its "Site:" line names. */
  site?: string;
}

interface Anchor {
  href: string;
  /** Byte offset of the opening tag, used to find the element that owns it. */
  at: number;
}

/** Blank out comments and script/style bodies, keeping every byte offset. */
const mask = (src: string): string =>
  src
    .replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
    .replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g,
      (_, a: string, b: string, c: string) => a + ' '.repeat(b.length) + c
    )
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g,
      (_, a: string, b: string, c: string) => a + ' '.repeat(b.length) + c
    );

function scan(src: string): { withId: Element[]; anchors: Anchor[] } {
  const html = mask(src);
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const stack: Element[] = [];
  const withId: Element[] = [];
  const anchors: Anchor[] = [];
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html)) !== null) {
    const [full, closing, name, attrs] = m;
    const lower = name.toLowerCase();
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== lower) continue;
        // Everything above `i` is a descendant that never closed. Dropping it
        // here is what a browser does, and leaving it on the stack would let a
        // later close of the same name pop it — attributing an anchor to a
        // container that had already ended. The in-scope documents are all
        // balanced, so this is a guard on the checker's silence, not a live fix.
        const closed = stack.splice(i);
        for (const el of closed) {
          el.end = m.index + full.length;
          if (el.id) withId.push(el);
        }
        break;
      }
      continue;
    }
    if (VOID.has(lower) || attrs.trimEnd().endsWith('/')) {
      if (id)
        withId.push({
          tag: lower,
          id,
          start: m.index,
          end: m.index + full.length
        });
      continue;
    }
    stack.push({ tag: lower, id, start: m.index, end: html.length });
    if (lower === 'a') {
      const href = /\bhref="([^"]*)"/.exec(attrs)?.[1];
      if (href) anchors.push({ href, at: m.index });
    }
  }
  // Anything still open at EOF keeps its end-of-file extent.
  for (const el of stack) if (el.id) withId.push(el);
  return { withId, anchors };
}

// ---------------------------------------------------------------------------
// The markdown scanner, which answers the same two questions as `scan`.
// ---------------------------------------------------------------------------

/**
 * A unit heading carrying anything past its stem. The heading is the identifier
 * and nothing else, because a renderer slugs the WHOLE heading: prose after the
 * stem lands in the anchor, so `#spec-x` resolves to nothing and every citation
 * to that unit is a dead link in GitLab and in any local preview. Stripped, the
 * slug and the declared id are the same string by construction. The unit's
 * statement opens the body instead.
 */
const OVERFULL_HEADING = /^#{1,6}[ \t]+@[a-z]+[ \t]+\S+[ \t]+\S.*$/gm;
/** A `<tr>`/`<td>` unit in an HTML table the document kept. */
const TABLE_UNIT = /<t([rd])\b[^>]*\bid="([^"]*)"[^>]*>/g;

/** The words of the stem of a term: its stem with a space for each hyphen, `outdated tracking` for `term-outdated-tracking`. */
const stemWords = (id: string): string => id.slice(id.indexOf('-') + 1).replace(/-/g, ' ');

/** The spelling of the words of a term mark or a form, as the checker compares it: in lowercase, with single spaces. */
const spelling = (words: string): string => words.trim().toLowerCase().split(/\s+/).join(' ');

/** Text between two single asterisks, `*words*`: not touching a third asterisk, and with no space just inside either one. */
const TERM_MARK = /(?<![*\\\w])\*(?![*\s])([^*\n]+?)(?<![\s\\])\*(?![*\w])/g;

/**
 * The term marks of a document: the links whose whole text sits between two
 * single asterisks, `[*words*](href)`, with their words, where the first
 * asterisk stands, and the href. Frontmatter, fences, the index and code
 * spans hold no term mark.
 */
function termMarks(src: string): Array<{ words: string; at: number; href: string }> {
  const prose = maskFences(src).replace(/(`+)[^\n]*?\1/g, m => ' '.repeat(m.length));
  const marks: Array<{ words: string; at: number; href: string }> = [];
  for (const m of prose.matchAll(TERM_MARK)) {
    const at = m.index ?? 0;
    const after = at + m[0].length;
    // Only the text of a link is a term mark: single asterisks elsewhere are emphasis.
    const link = prose[at - 1] === '[' ? /^\]\(([^)\s]+)\)/.exec(prose.slice(after)) : null;
    if (link === null) continue;
    marks.push({ words: (m[1] as string).trim(), at, href: link[1] as string });
  }
  return marks;
}

function scanMarkdown(src: string): { withId: Element[]; anchors: Anchor[] } {
  const md = maskFences(src);
  const withId: Element[] = [];
  const anchors: Anchor[] = [];

  withId.push(
    ...readUnits(src).map(u => ({
      tag: 'heading',
      id: u.id,
      start: u.start,
      end: u.end,
      level: u.level,
      label: `@${u.kind} ${u.stem}`,
      parent: u.parent,
      statement: u.statement,
      own: u.own,
      site: u.site
    }))
  );

  for (const m of md.matchAll(TABLE_UNIT)) {
    const start = m.index ?? 0;
    const close = md.indexOf(`</t${m[1]}>`, start);
    withId.push({
      tag: `t${m[1]}`,
      id: m[2],
      start,
      end: close === -1 ? md.length : close
    });
  }

  // `[text](#spec-some-stem)`, and the raw anchors inside a kept HTML table.
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    anchors.push({ href: m[1], at: m.index ?? 0 });
  }
  for (const m of md.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
    anchors.push({ href: m[1], at: m.index ?? 0 });
  }

  return { withId, anchors };
}

const TOC_BEGIN = beginMarker('toc');
const TOC_END = '<!-- toc:end -->';
/**
 * A document's table of contents, which nesting has made its derivation tree:
 * every unit indented under the one it derives from. Generated rather than
 * written, because a hand-kept index is a second place for the hierarchy to be
 * stated and so a second place for it to be wrong.
 */
function tocOf(src: string): string {
  const units = scanMarkdown(src).withId.filter(u => u.tag === 'heading');
  const byId = new Map(units.map(u => [u.id, u]));
  const depth = (u: Element): number => {
    let n = 0;
    for (let p = u.parent; p; p = byId.get(p)?.parent) n++;
    return n;
  };
  // A line for each unit, by its kind and stem: the statements are for show and tree to print.
  const rows = units.map(u => `${'  '.repeat(depth(u))}- [\`${u.label}\`](#${u.id})`);
  return rows.join('\n');
}

/**
 * Specs carrying `least` tests or more and holding no nested specs.
 *
 * A spec that says several things and has no way to say so collects the tests
 * for all of them, so the count is the signal — and a test pinning one clause
 * then reads as covering the rest. It is a smell rather than a finding: a spec
 * can honestly carry several tests of ONE claim, enumerated per input or
 * attacked from several angles, and nested specs there would restate their
 * parent. So this reports and never gates. With `ids`, the id of each suspect
 * is pushed onto it, in the order listed.
 */
function suspectsOf(
  file: string,
  testsPer: Map<string, number>,
  least: number,
  ids?: string[]
): string {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const { withId } = scanMarkdown(src);
  const headings = withId.filter(u => u.tag === 'heading');

  // Specs a table holds are counted but do not excuse a spec: they are the
  // scenarios of a grid, not the clauses of the spec, so a spec can hold a
  // dozen of them and still say several things it has never separated.
  const linkedTo = new Map<string, number>();
  for (const m of src.matchAll(/href="#(spec-[\w-]+)"/g)) {
    linkedTo.set(m[1], (linkedTo.get(m[1]) ?? 0) + 1);
  }

  const rows = headings
    .filter(u => kindOf(u.id ?? '') === 'spec-')
    .filter(
      u =>
        !headings.some(h => h.parent === u.id && kindOf(h.id ?? '') === 'spec-')
    )
    .map(u => ({
      id: u.id ?? '',
      n: testsPer.get(`${rel}#${u.id}`) ?? 0,
      linked: linkedTo.get(u.id ?? '') ?? 0
    }))
    .filter(r => r.n >= least)
    .sort((a, b) => b.n - a.n);
  ids?.push(...rows.map(r => r.id));

  const head = `${rel} — specs with no nested specs carrying ${least}+ tests`;
  if (rows.length === 0) return `${head}\n\nnone`;
  return [
    head,
    '',
    ...rows.map(
      r =>
        `${String(r.n).padStart(4)}  ${prose(r.id).replace(/^@spec /, '')}` +
        (r.linked ? `  (+${r.linked} linked from a table)` : '')
    ),
    '',
    'A smell, not a finding — read each and decide.'
  ].join('\n');
}

const scanFile = (file: string): { withId: Element[]; anchors: Anchor[] } => {
  const src = readFileSync(file, 'utf8');
  return file.endsWith('.md') ? scanMarkdown(src) : scan(src);
};

// ---------------------------------------------------------------------------
// Colour, for the tree only. A pipe or a CI log gets none: the tree is also
// read through `| grep`, where an escape between the glyph and the stem stops
// a pattern matching what the eye can see.
// ---------------------------------------------------------------------------
const COLOUR = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string, s: string): string =>
  COLOUR && code ? `\x1b[${code}m${s}\x1b[0m` : s;

/**
 * kind → its colour, so a reader learns the tree's shape by hue rather than by
 * prefix. The `@tag` takes the dim companion of its kind: it says the same
 * thing the hue already does, so it sits behind the stem rather than competing
 * with it.
 */
const HUE: Record<Kind, string> = {
  'axiom-': '1;35', // bold magenta
  'fact-': '1;34', // bold blue — a given, but not a chosen one
  'spec-': '36', // cyan
  'exception-': '33', // yellow — where the shoe does not fit should catch the eye
  'bug-': '1;31', // bold red — a defect to fix
  'conflict-': '1;91', // bold bright red — a defect of the canon itself
  'thread-': '1;93', // bold bright yellow — a question still open, no defect
  'term-': '1;32' // bold green
};

/**
 * A statement is the unit talking about itself, so italic sets it apart, and
 * dim takes it a notch below the stem it hangs under.
 *
 * No colour: dim shades whatever foreground the terminal already chose, where a
 * shade picked for a dark theme is close to invisible on a light one.
 */
const SAID = '2;3';

const DIM: Record<Kind, string> = {
  'axiom-': '2;35',
  'fact-': '2;34',
  'spec-': '2;36',
  'exception-': '2;33',
  'bug-': '2;31',
  'conflict-': '2;91',
  'thread-': '2;93',
  'term-': '2;32'
};

/**
 * A unit id as a reader sees it: `@spec a-write-lands-at-once` reads as
 * `@spec A write lands at once`.
 *
 * Lossless, because a stem is lowercase and hyphenated by construction — lower
 * the words and join them with hyphens and the id is back. So a stem copied out
 * of the tree still leads to the unit.
 */
function prose(id: string): string {
  const kind = kindOf(id);
  if (!kind) return id;
  const stem = id.slice(kind.length).replace(/-/g, ' ');
  return `@${noun(kind)} ${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
}

/** One line of a statement, cut at a word so a tree stays a tree. */
function clip(said: string, indent: number): string {
  const room = Math.max(24, (process.stdout.columns || 100) - indent);
  // A statement with a list is shown by its first line: joined, the list would no longer show where it ends.
  const lines = said.split('\n');
  const flat = lines.length > 1 ? `${(lines[0] as string).trim()} …` : said.replace(/\s+/g, ' ').trim();
  if (flat.length <= room) return flat;
  const cut = flat.slice(0, room - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
}

/**
 * The derivation tree of one document, drawn for a terminal.
 *
 * The same relation the index in the document carries, shown with what the
 * document cannot: how many tests pin each claim. A unit with none is the
 * coverage backlog, so the tree doubles as the map of where it is.
 *
 * Two connectors, because there are two ways to cite. `├─` is nesting, which
 * is the ordinary way. `╌` is a link, drawn for the units a table holds: a
 * table cannot nest, so a matrix cell names its spec in an `href` instead, and
 * that difference is worth seeing rather than flattening away.
 *
 * With `from`, the tree is that unit and what sits in it, with no terms, facts
 * or conflicts. With `ids`, the id of each unit drawn is pushed onto it, in the
 * order drawn.
 */
function treeOf(
  file: string,
  testsPer: Map<string, number>,
  gapsOnly: boolean,
  verbose: boolean,
  links: Map<string, Array<{ target: string; derives: boolean }>> = new Map(),
  from?: string,
  ids?: string[]
): string {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const { withId } = scanMarkdown(src);
  const headings = withId.filter(u => u.tag === 'heading');
  const byId = new Map(headings.map(u => [u.id, u]));

  const tests = (id: string): number => testsPer.get(`${rel}#${id}`) ?? 0;

  /**
   * What a spec in a table says, which the heading scanner does not collect: a
   * cell has no statement, so its claim is the text of its first line, with
   * the markup stripped.
   */
  const cellStatements = new Map<string, string>();
  for (const m of src.matchAll(
    /<t[rd]\b[^>]*\bid="(spec-[\w-]+)"[^>]*>([\s\S]*?)<\/t[rd]>/g
  )) {
    const said = m[2]
      .split(/<br\s*\/?>/)[0]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[:;,\s]+/, '')
      .trim();
    if (said)
      cellStatements.set(m[1], said.charAt(0).toUpperCase() + said.slice(1));
  }
  /**
   * A leaf spec or exception owes a test of its own. A claim holding nested
   * claims is pinned through its leaves.
   */
  const owesTest = (id: string): boolean => {
    const kind = kindOf(id);
    if (kind === undefined || !CLAIMS.includes(kind)) return false;
    return !headings.some(h => h.parent === id && REFINES.includes(kindOf(h.id ?? '') ?? ('axiom-' as Kind)));
  };

  const linked = new Map<string, Element[]>();
  for (const cell of withId.filter(u => u.tag === 'td' || u.tag === 'tr')) {
    const body = src.slice(cell.start, cell.end);
    const target = /href="#((?:axiom|fact|spec|exception|bug)-[\w-]+)"/.exec(body);
    if (!target) continue;
    const list = linked.get(target[1]) ?? [];
    list.push(cell);
    linked.set(target[1], list);
  }

  const childrenOf = (id: string | undefined): Element[] =>
    headings.filter(u => u.parent === id);

  const keep = (u: Element): boolean => {
    if (!gapsOnly) return true;
    if (owesTest(u.id ?? '') && tests(u.id ?? '') === 0) return true;
    return childrenOf(u.id).some(keep);
  };

  const out: string[] = [];

  /**
   * The derivation edges nesting cannot show: the unit's further parents, each
   * after an arrow under its stem. They are part of the derivation graph, so
   * the tree always draws them; only the statements wait for `--verbose`.
   * References are reading aids, not part of the graph, so the tree leaves
   * them out. A parent in another document keeps its file name.
   */
  const furtherParents = (id: string, sill: string): void => {
    const own = links.get(`${rel}#${id}`) ?? [];
    for (const link of own.filter(l => l.derives)) {
      const [doc, target] = link.target.split('#');
      const kind = kindOf(target) ?? 'spec-';
      // The tag takes its kind's dim colour and the stem the full one, as in a
      // tree row, so a parent reads the same wherever it is drawn.
      const [tag, ...stem] = prose(target).split(' ');
      const label =
        doc === rel
          ? `${paint(DIM[kind], tag)} ${paint(HUE[kind], stem.join(' '))}`
          : paint(HUE[kind], `${doc}#${target}`);
      out.push(paint('90', `${sill}→ `) + label);
    }
  };

  const walk = (unit: Element, prefix: string): void => {
    const kids = childrenOf(unit.id).filter(keep);
    const cells = gapsOnly ? [] : (linked.get(unit.id ?? '') ?? []);
    const rows: Array<{ label: string; id: string; el?: Element }> = [
      ...kids.map(k => ({
        label: prose(k.id ?? ''),
        id: k.id ?? '',
        el: k
      })),
      ...cells.map(c => ({
        label: prose(c.id ?? ''),
        id: c.id ?? ''
      }))
    ];
    rows.forEach((row, i) => {
      const last = i === rows.length - 1;
      const link = row.el === undefined;
      // The corner is the tree's structure and the dash is the kind of
      // citation, so they vary independently: a linked spec still closes its
      // parent's branch when it is the last child.
      const stem = `${last ? '└' : '├'}${link ? '╌ ' : '─ '}`;
      const n = tests(row.id);
      const mark =
        n > 0
          ? paint('90', `  ${n}`)
          : owesTest(row.id)
            ? paint('31', '  — no test')
            : '';
      const kind = kindOf(row.id) ?? 'spec-';
      const hue = HUE[kind];
      const [tag, ...said] = row.label.split(' ');
      ids?.push(row.id);
      out.push(
        `${paint('90', prefix + stem)}${paint(DIM[kind], tag)} ` +
          `${paint(hue, said.join(' '))}${mark}`
      );
      const under = prefix + (last ? '   ' : '│  ');
      // Indented past the tag so what follows sits under the stem it belongs
      // to rather than under the @kind, which is the same word every time.
      const sill = under + ' '.repeat(tag.length + 1);
      if (verbose) {
        const said = row.el?.statement ?? cellStatements.get(row.id);
        if (said) {
          out.push(paint('90', sill) + paint(SAID, clip(said, sill.length)));
        }
      }
      furtherParents(row.id, sill);
      if (row.el) walk(row.el, under);
    });
  };

  // A term defines a word and derives from nothing, so it is no part of the
  // derivation tree. The terms are drawn first, as a list of their own, each
  // with its definition and the number of units that link to it: a term owes
  // no test, so that count, not a test count, says whether the word is in use.
  // Facts are drawn next, the same way: a fact holds no units, and units reach
  // it only through their "Derives from:" lines, so its count is the units
  // that derive from it, and its statement is what it says about the platform.
  const listGivens = (kind: Kind, derivesOnly: boolean): void => {
    const units = headings.filter(u => kindOf(u.id ?? '') === kind);
    if (units.length > 0) out.push('');
    for (const unit of units) {
      const target = `${rel}#${unit.id}`;
      let users = 0;
      for (const list of links.values()) {
        if (list.some(l => l.target === target && (!derivesOnly || l.derives))) users++;
      }
      const [tag, ...word] = prose(unit.id ?? '').split(' ');
      ids?.push(unit.id ?? '');
      out.push(
        `${paint(DIM[kind], tag)} ${paint(HUE[kind], word.join(' '))}` +
          (users > 0 ? paint('90', `  ${users}`) : paint('31', '  — unused'))
      );
      // A term is its definition and a fact is its statement, so either is
      // always drawn.
      if (unit.statement) {
        const sill = ' '.repeat(tag.length + 1);
        out.push(sill + paint(SAID, clip(unit.statement, sill.length)));
      }
    }
  };
  if (!gapsOnly && from === undefined) {
    listGivens('term-', false);
    listGivens('fact-', true);
  }

  // A conflict or a thread belongs to no unit and derives from none, so it is
  // no part of the tree either. It is drawn as what it is, a warning or an open
  // question, with its statement.
  for (const kind of ['conflict-', 'thread-'] as const) {
    const loose = gapsOnly || from !== undefined ? [] : headings.filter(u => kindOf(u.id ?? '') === kind);
    if (loose.length > 0) out.push('');
    for (const unit of loose) {
      const [tag, ...word] = prose(unit.id ?? '').split(' ');
      ids?.push(unit.id ?? '');
      out.push(`${paint(DIM[kind], tag)} ${paint(HUE[kind], word.join(' '))}`);
      if (unit.statement) {
        const sill = ' '.repeat(tag.length + 1);
        out.push(sill + paint(SAID, clip(unit.statement, sill.length)));
      }
    }
  }

  const roots = from === undefined ? headings.filter(u => !u.parent || !byId.has(u.parent)) : headings.filter(u => u.id === from);
  for (const root of roots) {
    if (from === undefined && ['term-', 'fact-', 'conflict-', 'thread-'].includes(kindOf(root.id ?? '') ?? '')) continue;
    if (!keep(root)) continue;
    const rootKind = kindOf(root.id ?? '') ?? 'axiom-';
    const [rootTag, ...rootLabel] = prose(root.id ?? '').split(' ');
    ids?.push(root.id ?? '');
    out.push('');
    out.push(
      // A root is an axiom or a fact when the document is sound, but a
      // freelancing unit is a root too, and it is drawn as what it is.
      paint(DIM[rootKind], rootTag) +
        ' ' +
        paint(HUE[rootKind], rootLabel.join(' '))
    );
    const sill = ' '.repeat(rootTag.length + 1);
    if (verbose && root.statement) {
      out.push(sill + paint(SAID, clip(root.statement, sill.length)));
    }
    furtherParents(root.id ?? '', sill);
    walk(root, '');
  }

  const tally = new Map<Kind, number>();
  for (const u of headings) {
    const k = kindOf(u.id ?? '');
    if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const counts = [...tally]
    .map(([k, n]) => `${n} ${noun(k)}${n === 1 ? '' : 's'}`)
    .join(' · ');
  const cells = [...linked.values()].reduce((n, l) => n + l.length, 0);

  const head = paint(
    '1',
    `${rel} — ${counts}${cells ? ` · ${cells} linked from tables` : ''}`
  );
  if (gapsOnly && out.length === 0) {
    return `${head}\n\nevery spec and exception is pinned by a test`;
  }
  return [head, ...out].join('\n');
}

/**
 * A heading's rendered anchor, by the rule GitHub and GitLab both slug with:
 * lowercase, drop punctuation, each space becomes a hyphen. Each space, not
 * each run of them: `P1 — Speculation` slugs to `p1--speculation`, because the
 * dropped dash leaves two spaces behind. A unit heading slugs to exactly its
 * declared id, which is what `OVERFULL_HEADING` protects.
 */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');

/**
 * Every fragment a citation could resolve to in one file — which is what the
 * RENDERER offers, not what the checker would like to see: a markdown heading
 * carries the anchor its text slugs to, and an explicit `id` carries its own.
 * A section cross-referenced by another document writes the explicit form, so
 * rewording its heading cannot silently break the link.
 */
const idsOf = (() => {
  const cache = new Map<string, Set<string>>();
  return (file: string): Set<string> => {
    let ids = cache.get(file);
    if (!ids) {
      const src = readFileSync(file, 'utf8');
      ids = new Set([...src.matchAll(/\bid="([^"]*)"/g)].map(m => m[1]));
      if (file.endsWith('.md')) {
        for (const m of maskFences(src).matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
          ids.add(slug(m[1]));
        }
      }
      cache.set(file, ids);
    }
    return ids;
  };
})();

// ---------------------------------------------------------------------------
// Findings.
// ---------------------------------------------------------------------------
type FindingName =
  | 'freelancing'
  | 'misnested'
  | 'cycle'
  | 'rot'
  | 'dead'
  | 'missing-spec'
  | 'uncited'
  | 'stale-toc'
  | 'unreachable'
  | 'untested'
  | 'parent-cited'
  | 'untracked-bug'
  | 'unpinned-bug'
  | 'fails-without-bug'
  | 'untracked-conflict'
  | 'lone-conflict'
  | 'missing-issue'
  | 'closed-issue'
  | 'unreachable-tracker'
  | 'stale-site';

const MEANING: Record<FindingName, string> = {
  freelancing: 'claim-bearing unit with no upward citation',
  misnested: 'unit nested inside a kind it may not cite',
  cycle: 'units whose citations lead back to themselves — a derivation must not depend on itself',
  rot: 'citation whose anchor does not resolve',
  dead: 'unit nothing cites',
  'missing-spec': 'test citing an axiom or a fact rather than a spec',
  uncited: 'test with no citation — the hierarchy inverted',
  'stale-toc': 'generated table of contents out of sync with the document',
  unreachable:
    'heading whose rendered anchor is not the id cited — a dead link',
  untested: 'leaf spec, exception or bug no test pins, directly or through a bug it holds — cited, but only from prose',
  'parent-cited': 'test citing a spec that holds nested specs or exceptions — cite the leaf it checks',
  'untracked-bug': 'bug that names no issue',
  'unpinned-bug': 'test citing a bug without being marked to fail — a bug is pinned by a test that fails until the fix',
  'fails-without-bug': 'test marked to fail that cites no bug or exception — an expected failure is a known defect, and the canon names it',
  'untracked-conflict': 'conflict that names no issue',
  'lone-conflict': 'conflict whose "Between:" line names fewer than two units — a contradiction needs two sides',
  'missing-issue': 'bug or conflict naming an issue the tracker does not hold, or one that is a pull request',
  'closed-issue': 'bug or conflict naming an issue that is closed — the fix landed and the unit goes, or the issue was closed too soon',
  'unreachable-tracker': 'bug or conflict whose issue the tracker could not be asked about — no token, no access or no network',
  'stale-site': 'unit naming a code site that is not there, or naming it in its statement'
};

/** The findings that need the tracker, and so appear only when a project names one. */
const TRACKER_FINDINGS: FindingName[] = ['missing-issue', 'closed-issue', 'unreachable-tracker'];

interface Unit {
  doc: string;
  id: string;
  kind: Kind;
  /** The kinds this unit cites — not which units, since only the kind is owed. */
  cites: Set<Kind>;
  statement?: string;
  /** The place in the code its "Site:" line names. */
  site?: string;
  /** The unit's own text, before its first nested heading. */
  own?: string;
  /** The unit it sits in. */
  parent?: string;
  /** Where its heading starts in its document: the offset, and the line from 1. */
  start: number;
  line: number;
}

/** A test that checks a unit: its file and line, as `<file>:<line>`, and its title. */
interface TestAt {
  where: string;
  title: string;
}

interface Analysis {
  findings: Record<FindingName, string[]>;
  units: Map<string, Unit>;
  suites: number;
  /** The files a writing run rewrote, relative to the repo root. */
  written: string[];
  /** How many tests pin each unit, by `<doc>#<id>`; absent means none. */
  testsPer: Map<string, number>;
  /** The tests that pin each unit, by `<doc>#<id>`, in the order they were read. */
  testsAt: Map<string, TestAt[]>;
  /**
   * Every unit a unit links to, by `<doc>#<id>`, and whether the link is a
   * further parent (it sits on the unit's "Derives from:" line) or a
   * reference. Further parents and nesting together are the derivation graph.
   */
  links: Map<string, Array<{ target: string; derives: boolean }>>;
  /** The text of each bug and conflict, by `<doc>#<id>`, which names its issues. */
  bugs: Map<string, string>;
}

/** A test file: `.test` or `.spec`, in TypeScript with or without JSX. */
const isSuite = (name: string): boolean => /\.(test|spec)(-d)?\.tsx?$/.test(name);

/** Every suite under a tree, so a voluntary citation is still read. */
function allSuites(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const entry = join(dir, name);
    if (statSync(entry).isDirectory()) {
      allSuites(entry, out);
    } else if (isSuite(name)) {
      out.push(entry);
    }
  }
  return out;
}

/** Every other `.ts` — the implementation, which may cite the canon in its JSDoc. */
function allModules(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const entry = join(dir, name);
    if (statSync(entry).isDirectory()) {
      allModules(entry, out);
    } else if (/\.tsx?$/.test(name) && !isSuite(name)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Every declared prose reference that is not itself in scope: the documents
 * that explain the canon, whose links must resolve.
 *
 * Markdown only. A `.ts` beside them may be tooling that writes the literal
 * `@canon` in its own strings because it is what parses the tag — so reading
 * it would find citations that were never citations.
 */
function allReferences(path: string, out: string[] = []): string[] {
  if (!existsSync(path)) return out;
  if (!statSync(path).isDirectory()) {
    if (path.endsWith('.md') && !DOCS.includes(relative(ROOT, path)))
      out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) allReferences(join(path, name), out);
  return out;
}

/**
 * Read every in-scope document, suite and module, and judge what they cite.
 *
 * With `write`, the generated regions are rewritten instead of reported as
 * `stale-toc`: it is the one difference between the two subcommands.
 */
function analyse(write: boolean): Analysis {
  // Insertion order is report order, so it reads worst-first.
  const findings: Record<FindingName, string[]> = {
    freelancing: [],
    misnested: [],
    cycle: [],
    rot: [],
    dead: [],
    'missing-spec': [],
    uncited: [],
    'stale-toc': [],
    unreachable: [],
    untested: [],
    'parent-cited': [],
    'untracked-bug': [],
    'unpinned-bug': [],
    'fails-without-bug': [],
    'untracked-conflict': [],
    'lone-conflict': [],
    'missing-issue': [],
    'closed-issue': [],
    'unreachable-tracker': [],
    'stale-site': []
  };

  /** every unit, keyed `${doc}#${id}` */
  const units = new Map<string, Unit>();
  /** every fragment cited from anywhere in scope, keyed `${file}#${frag}` */
  const citedTargets = new Set<string>();
  /**
   * The claims that hold nested claims. A test cites only a leaf: a parent is
   * pinned through its leaves, and owes no test of its own.
   */
  const claimParents = new Set<string>();
  /**
   * What a SUITE cites, which `citedTargets` cannot answer.
   *
   * `dead` counts nesting, prose links and tests alike, so a spec linked from
   * another spec's body leaves it whatever the suites do. That is the right
   * question for "is this reachable" and the wrong one for "does anything hold
   * this to account".
   */
  const testedTargets = new Set<string>();

  const testsPer = new Map<string, number>();
  const testsAt = new Map<string, TestAt[]>();

  /**
   * The spec each bug breaks: the one it sits in, or one its "Derives from:"
   * line names. A bug's pin asserts that spec's claim, so it pins the spec too.
   */
  const bugSpecs = new Map<string, string[]>();
  const addBugSpec = (bug: string, spec: string) =>
    bugSpecs.set(bug, [...(bugSpecs.get(bug) ?? []), spec]);

  /**
   * The derivation graph, by `<doc>#<id>`: every unit's citations, its nesting
   * parent and its explicit links alike. A cycle in it is a derivation that
   * depends on itself, which no ordering of the canon can resolve.
   */
  const edges = new Map<string, Set<string>>();
  const links = new Map<string, Array<{ target: string; derives: boolean }>>();
  const addEdge = (into: Map<string, Set<string>>, from: string, to: string): void => {
    const set = into.get(from) ?? new Set<string>();
    set.add(to);
    into.set(from, set);
  };
  /**
   * Whether the link at `at` names a further parent: it sits on a line that
   * opens "Derives from:". Every other link is a reference, which cites but
   * does not derive, so a reference back to a unit that derives from this one
   * is not a cycle.
   */
  const DERIVES = /^Derives from:/;
  const namesParent = (src: string, at: number): boolean => {
    const lineStart = src.lastIndexOf('\n', at - 1) + 1;
    return DERIVES.test(src.slice(lineStart, at));
  };

  const written: string[] = [];

  // -------------------------------------------------------------------------
  // Read the documents.
  // -------------------------------------------------------------------------
  for (const rel of DOCS) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) {
      findings.rot.push(`${rel}: in-scope document does not exist`);
      continue;
    }
    const { withId, anchors } = scanFile(file);
    const docSource = readFileSync(file, 'utf8');
    const docLineAt = linesOf(docSource);

    if (rel.endsWith('.md')) {
      for (const m of readFileSync(file, 'utf8').matchAll(OVERFULL_HEADING)) {
        findings.unreachable.push(
          `${rel}: "${m[0].trim()}" — the stem must end the heading`
        );
      }
    }

    // An id that the document declares twice names two units, and so does one that an extended document declares too.
    {
      const declared = readUnits(docSource).map(u => u.id);
      for (const id of new Set(declared.filter((id, i) => declared.indexOf(id) !== i)))
        findings.rot.push(`${rel}#${id} — ${rel} declares it ${declared.filter(other => other === id).length} times, so a pointer or a tag cannot say which unit it names`);
      const ids = new Set(declared);
      let context: string[] = [];
      try {
        context = contextOf(file, ROOT);
      } catch {
        // a path that names no document, or an extension that leads back, is refused by the plugins' pass
      }
      for (const other of context) {
        for (const unit of readUnits(readFileSync(other, 'utf8'))) {
          if (ids.has(unit.id)) findings.rot.push(`${rel}#${unit.id} — ${relative(ROOT, other)} declares it too, so a pointer or a tag cannot say which unit it names`);
        }
      }
    }

    for (const el of withId) {
      const kind = el.id ? kindOf(el.id) : undefined;
      if (kind && el.id)
        units.set(`${rel}#${el.id}`, {
          doc: rel,
          id: el.id,
          kind,
          cites: new Set(),
          statement: el.statement,
          site: el.site,
          own: el.own,
          parent: el.parent,
          start: el.start,
          line: docLineAt(el.start)
        });
    }

    // Nesting is a citation, and the strongest kind: a spec written inside its
    // axiom cannot claim one axiom and sit under another, the way a prose link
    // repeated in every spec eventually does. So a unit that sits inside another
    // has already cited it, and writes no link — an explicit citation is reserved
    // for the edges the tree cannot hold, a second parent or another document.
    for (const el of withId) {
      if (!el.id || !el.parent) continue;
      const parentKind = kindOf(el.parent);
      if (!parentKind) continue;
      units.get(`${rel}#${el.id}`)?.cites.add(parentKind);
      addEdge(edges, `${rel}#${el.id}`, `${rel}#${el.parent}`);
      citedTargets.add(`${rel}#${el.parent}`);
      const ownKind = kindOf(el.id);
      if (ownKind && REFINES.includes(ownKind) && CLAIMS.includes(parentKind)) {
        claimParents.add(`${rel}#${el.parent}`);
      }
      if (ownKind === 'bug-' && parentKind === 'spec-') {
        addBugSpec(`${rel}#${el.id}`, `${rel}#${el.parent}`);
      }

      // Nesting is a citation, so sitting somewhere a unit may not cite is
      // one — `freelancing` misses it, because a prose link to the right kind
      // satisfies the owes-check while the position goes on saying the wrong
      // thing. Position cannot contradict itself, but it can contradict OWES.
      const kind = kindOf(el.id);
      if (kind && !citable(kind).includes(parentKind)) {
        findings.misnested.push(
          `${rel}#${el.id} — ${aNoun(kind)} sitting in ${el.parent}, which ${aNoun(kind)} may not cite`
        );
      }
    }

    for (const a of anchors) {
      if (/^(https?:|mailto:)/.test(a.href) || !a.href.includes('#')) continue;
      const [path, frag] = a.href.split('#');
      const targetFile = path ? join(dirname(file), path) : file;
      const targetRel = relative(ROOT, targetFile);

      // rot — the anchor must resolve in the file it points at
      if (!existsSync(targetFile)) {
        findings.rot.push(`${rel}: href="${a.href}" — no such file`);
        continue;
      }
      if (!idsOf(targetFile).has(frag)) {
        findings.rot.push(
          `${rel}: href="${a.href}" — no id="${frag}" in ${targetRel}`
        );
        continue;
      }
      citedTargets.add(`${targetRel}#${frag}`);

      // Attribute the citation exactly the way the page's backlink script does:
      // the innermost element with an id that contains the anchor, and failing
      // that the nearest preceding one — so a spec stated by a heading is credited
      // with the citation in the paragraph beneath it. Whether the element that
      // wins is a claim-bearing unit is then a separate question; if it is not,
      // the citation belongs to no unit and lands nowhere, which is honest.
      const owner =
        withId
          .filter(e => a.at >= e.start && a.at < e.end)
          .sort((x, y) => y.start - x.start)[0] ??
        withId.filter(e => e.start < a.at).sort((x, y) => y.start - x.start)[0];
      const targetKind = kindOf(frag);
      if (owner?.id && targetKind)
        units.get(`${rel}#${owner.id}`)?.cites.add(targetKind);
      if (owner?.id && kindOf(owner.id) && targetKind) {
        const from = `${rel}#${owner.id}`;
        const to = `${targetRel}#${frag}`;
        // A unit that derives from itself is a loop of one. Any other link to itself is a reference, which cites nothing.
        if (from === to && namesParent(docSource, a.at)) addEdge(edges, from, to);
        if (from !== to) {
          const derives = namesParent(docSource, a.at);
          if (derives) addEdge(edges, from, to);
          if (derives && kindOf(from.split('#')[1] ?? '') === 'bug-' && kindOf(to.split('#')[1] ?? '') === 'spec-') {
            addBugSpec(from, to);
          }
          const list = links.get(from) ?? [];
          if (!list.some(l => l.target === to)) list.push({ target: to, derives });
          links.set(from, list);
        }
      }
    }

    // A term mark is a link to a term: it names the term its link names, and its words spell a form of that term.
    if (rel.endsWith('.md')) {
      for (const t of readUnits(docSource).filter(u => u.kind === 'term')) {
        if (t.grammar === undefined) continue;
        if (t.grammar.type === undefined) findings.rot.push(`${rel}#${t.id} — its grammar table has no row "type"`);
        for (const unknown of t.grammar.unknown)
          findings.rot.push(`${rel}#${t.id} — its grammar table names "${unknown}", which is no type or no role of "${t.grammar.type}"`);
        for (const repeated of new Set(t.grammar.repeated))
          findings.rot.push(`${rel}#${t.id} — its grammar table names "${repeated}" in more than one row`);
      }
      // The terms of each document a mark links into, by the path from this one: its own first.
      const termsIn = new Map<string, Map<string, UnitOfDocument> | undefined>([['', new Map<string, UnitOfDocument>(readUnits(docSource).filter(u => u.kind === 'term').map(u => [u.id, u]))]]);
      const termsOf = (path: string): Map<string, UnitOfDocument> | undefined => {
        if (!termsIn.has(path)) {
          const file = resolve(dirname(join(ROOT, rel)), path);
          termsIn.set(path, existsSync(file) ? new Map(readUnits(readFileSync(file, 'utf8')).filter(u => u.kind === 'term').map(u => [u.id, u])) : undefined);
        }
        return termsIn.get(path);
      };
      const formsOf = (term: UnitOfDocument): Set<string> => new Set([spelling(stemWords(term.id)), ...(term.grammar?.forms ?? []).map(f => spelling(f.spelling))]);
      const marks = termMarks(docSource).map(mark => {
        const [path = '', frag = ''] = mark.href.split('#');
        return { ...mark, term: frag.startsWith('term-') ? termsOf(path)?.get(frag) : undefined, frag, path };
      });
      for (const mark of marks) {
        const where = `${rel}:${docLineAt(mark.at)}`;
        if (!mark.frag.startsWith('term-')) {
          findings.rot.push(`${where} — term mark "*${mark.words}*" links to ${mark.href}, which is no term`);
          continue;
        }
        // A target that is not there is a pointer that names no target, which the pointers report.
        if (mark.term === undefined) continue;
        if (!formsOf(mark.term).has(spelling(mark.words)))
          findings.rot.push(`${where} — term mark "*${mark.words}*" spells no form of ${mark.frag}; list the spelling in its grammar table, or link the term these words name`);
      }
    }
  }

  // generate lines up the columns of each grammar table; check reports nothing for one out of line.
  if (write) {
    for (const rel of DOCS) {
      if (!rel.endsWith('.md')) continue;
      const file = join(ROOT, rel);
      if (!existsSync(file)) continue;
      const src = readFileSync(file, 'utf8');
      const next = alignGrammarTables(src);
      if (next === src) continue;
      writeFileSync(file, next);
      written.push(rel);
    }
  }

  // ---------------------------------------------------------------------------
  // The table of contents, regenerated by generate and checked by check.
  // ---------------------------------------------------------------------------
  for (const rel of DOCS) {
    if (!rel.endsWith('.md')) continue;
    const file = join(ROOT, rel);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    // A document with no units has no derivation tree, so it owes no index.
    if (!tocOf(src)) continue;
    const next = replaceRegion(src, 'toc', TOC_END, tocOf(src));
    if (next === undefined) {
      findings['stale-toc'].push(`${rel}: no ${TOC_BEGIN} … ${TOC_END} region`);
      continue;
    }
    if (next === src) continue;
    if (write) {
      writeFileSync(file, next);
      if (!written.includes(rel)) written.push(rel);
    } else {
      findings['stale-toc'].push(
        `${rel}: out of date — run \`${COMMAND} generate\``
      );
    }
  }

  // cycle — a derivation that depends on itself. Each cycle is reported once,
  // by the order it is first walked into.
  {
    const state = new Map<string, 'open' | 'done'>();
    const reported = new Set<string>();
    const walk = (node: string, path: string[]): void => {
      state.set(node, 'open');
      for (const next of edges.get(node) ?? []) {
        if (state.get(next) === 'open') {
          const loop = [...path.slice(path.indexOf(next)), next];
          const key = [...loop.slice(0, -1)].sort().join(' ');
          if (!reported.has(key)) {
            reported.add(key);
            findings.cycle.push(loop.map(k => k.split('#')[1]).join(' → '));
          }
        } else if (!state.has(next)) {
          walk(next, [...path, next]);
        }
      }
      state.set(node, 'done');
    };
    for (const node of edges.keys()) if (!state.has(node)) walk(node, [node]);
  }

  // freelancing — a claim-bearing unit with no upward citation
  for (const [key, unit] of units) {
    const owes = OWES[unit.kind];
    if (owes === null) continue;
    const unmet = owes.filter(group => !group.some(p => unit.cites.has(p)));
    if (unmet.length > 0) {
      findings.freelancing.push(
        `${key} (${aNoun(unit.kind)} owes ${unmet.map(group => group.map(noun).join(' | ')).join(' and ')})`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Read the test suites.
  // ---------------------------------------------------------------------------
  // Leaf tests only. A `describe` groups; it does not claim. Requiring a citation
  // on one produced two bad outcomes when tried: an outer grouping had to be given
  // some child's anchor arbitrarily, and an inner grouping restated a citation its
  // every child already carried. Neither adds a link that was missing, and the
  // first invents one that is not true. So the unit that owes a spec is the test
  // that asserts something.

  /** The line of each index of `src`, found by a binary search over where its lines start. */
  function linesOf(src: string): (at: number) => number {
    const starts = [0];
    for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
    return at => {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if ((starts[mid] as number) <= at) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };
  }

  /** Resolve each `@canon` tag in `text`, which starts at `offset` in its file. */
  function resolveTags(text: string, offset: number, rel: string, lineAt: (at: number) => number): void {
    for (const m of text.matchAll(/@canon\s+(\S+)/g)) {
      resolveCitation(m[1] as string, `${rel}:${lineAt(offset + (m.index ?? 0))}`);
    }
  }

  /** The syntax of a suite or a source; a file that does not parse stops the run. */
  function parse(file: string): Syntax & { lineAt: (at: number) => number } {
    const src = readFileSync(file, 'utf8');
    try {
      return { ...parseSource(src, file.endsWith('.tsx')), lineAt: linesOf(src) };
    } catch (error) {
      console.error(`canon: ${relative(ROOT, file)} does not parse as TypeScript: ${(error as Error).message}`);
      process.exit(2);
    }
  }

  /**
   * Every unit id, and the documents that declare it.
   *
   * A citation names a unit by its id alone — `@canon spec-x` — so an id must
   * be unique across every canon document. The file adds nothing a unique id
   * does not already say, and leaving it out means moving a unit between
   * documents breaks no test.
   */
  const docsOf = new Map<string, string[]>();
  for (const unit of units.values()) {
    docsOf.set(unit.id, [...(docsOf.get(unit.id) ?? []), unit.doc]);
  }
  for (const [id, docs] of docsOf) {
    if (docs.length > 1) {
      findings.rot.push(
        `${id} is declared in ${docs.join(' and ')} — a citation cannot tell which`
      );
    }
  }

  /**
   * Resolve one `@canon` or `@axiom` citation to its unit's key, reporting
   * `rot` and returning undefined when it names no unit or more than one.
   */
  function resolveCitation(cite: string, where: string): string | undefined {
    if (cite.includes('#')) {
      findings.rot.push(
        `${where} — citation "${cite}" names a file; cite the id alone, as "${cite.split('#').pop()}"`
      );
      return undefined;
    }
    const docs = docsOf.get(cite);
    if (docs === undefined) {
      findings.rot.push(`${where} — citation "${cite}" names no unit`);
      return undefined;
    }
    if (docs.length > 1) return undefined; // already reported above
    return `${docs[0]}#${cite}`;
  }

  /**
   * Read one suite's citations.
   *
   * `enforced` separates the two things declared scope was doing at once. A file
   * in scope has CLAIMED to derive from these documents, so an untagged test in
   * it is a finding — that is what the declaration buys, and it is why scope can
   * never be a glob. But a citation is a true statement about a link wherever it
   * is written, and refusing to read one because its neighbours are untagged
   * discards a real link to preserve a property about silence. So every suite is
   * READ, and only a declared one is JUDGED.
   *
   * The practical case is a suite most of which answers to mathematics or to
   * nothing in particular, holding two or three tests that do pin a spec. Putting
   * the whole file in scope to capture those would demand a citation from the
   * other thirty, and the only way to supply thirty is to invent them.
   */
  function readSuite(file: string, enforced: boolean): ReturnType<typeof parse> & { tests: TestBlock[] } {
    const rel = relative(ROOT, file);
    const syntax = parse(file);
    // A marker the checker cannot read would change which calls are tests.
    for (const problem of syntax.problems) {
      console.error(`canon: ${rel}:${syntax.lineAt(problem.at)} — ${problem.message}`);
      process.exit(2);
    }
    // A marker the setting does not pick asks for tests the setting says are none.
    if (!MARKS) {
      for (const node of syntax.marked.keys()) {
        console.error(`canon: ${rel}:${syntax.lineAt(node.start)} — a runner marker marks this declaration, but the setting "runners" does not list "${MARKER}"; add "${MARKER}" to it`);
        process.exit(2);
      }
    }
    exportsOf.set(file, syntax.exports);
    const parsed = { ...syntax, tests: testsOf(syntax, file, RUNNERS, lookup) };

    for (const { doc, title, fails, at } of parsed.tests) {
      // The reported line is the `it(` itself, not the top of its JSDoc.
      const line = parsed.lineAt(at);
      const axioms = [...doc.matchAll(/@axiom\s+(\S+)/g)].map(x =>
        x[1].startsWith('axiom-') ? x[1] : `axiom-${x[1]}`
      );
      const specs = [...doc.matchAll(/@canon\s+(\S+)/g)].map(x => x[1]);

      // A test owes a SPEC. Citing an axiom or a fact is not a different way
      // of saying the same thing — it says the canon has no addressable spec
      // for what is being asserted, which is a gap in the canon rather than in
      // the test. Both the dedicated tag and an `@canon` that happens to name
      // a given mean that, and only checking the tag let the second form
      // through unnoticed.
      const givenCitations = [
        ...axioms,
        ...specs.filter(s => {
          const kind = kindOf(s);
          return kind !== undefined && !CLAIMS.includes(kind);
        })
      ];
      for (const a of enforced ? givenCitations : []) {
        findings['missing-spec'].push(
          `${rel}:${line} "${title}" — cites ${a} (the canon has no addressable spec for this)`
        );
      }

      if (enforced && axioms.length === 0 && specs.length === 0) {
        findings.uncited.push(
          `${rel}:${line} "${title}" — no @canon / @axiom`
        );
      }

      // An expected failure is a known defect, and the canon names it as a
      // bug; a bug is pinned by a test that fails until the fix.
      if (fails && !specs.some(s => kindOf(s) === 'bug-' || kindOf(s) === 'exception-')) {
        findings['fails-without-bug'].push(`${rel}:${line} "${title}"`);
      }
      for (const s of specs) {
        if (kindOf(s) === 'bug-' && !fails) {
          findings['unpinned-bug'].push(`${rel}:${line} "${title}" — cites ${s}`);
        }
      }
      for (const s of [...specs, ...axioms]) {
        const key = resolveCitation(s, `${rel}:${line}`);
        if (key === undefined) continue;
        if (claimParents.has(key)) {
          findings['parent-cited'].push(`${rel}:${line} "${title}" — cites ${s}, which holds nested claims`);
        }
        citedTargets.add(key);
        testedTargets.add(key);
        testsPer.set(key, (testsPer.get(key) ?? 0) + 1);
        testsAt.set(key, [...(testsAt.get(key) ?? []), { where: `${rel}:${line}`, title }]);
      }
    }
    return parsed;
  }

  /**
   * Read a suite or a module of the sources: its tests, as `readSuite` does,
   * and every other `@canon` tag in a comment, which only resolves.
   * A tag in a string is no citation, the same as a test in a string is no test.
   *
   * A module that turns a table of cases into tests, which a suite then runs,
   * holds tests as real as the suite's own. Crediting only a suite's tests left
   * every leaf such a test checks reported untested, and the only way to quiet
   * that was to move working tests into the suite to suit the checker.
   *
   * `enforced` is set for every file in the declared directory: a suite, or a
   * helper module whose tests a suite there runs, so each of them owes a tag.
   */
  function readSource(file: string, enforced = false): void {
    const { tests, comments, lineAt } = readSuite(file, enforced);
    const rel = relative(ROOT, file);
    const docs = new Set(tests.flatMap(t => (t.span ? [t.span[0]] : [])));
    // Resolve-only: a unit a comment names still owes a test, and `dead` is
    // the list that says so.
    for (const comment of comments) {
      if (!docs.has(comment.start)) resolveTags(comment.value, comment.start + 2, rel, lineAt);
      readReferences(file, comment.value, comment.start + 2, lineAt);
    }
  }

  /** The file names of the canon documents, which a bare mention spells. */
  const documentNames = new Set(DOCS.map(doc => basename(doc)));

  /**
   * Check the references a comment of a suite or a source makes besides its
   * tags: each link with a fragment must lead to a file that holds the id, and
   * a canon document named with a fragment outside a link is no form a source
   * cites with, live or dead. Like a tag outside a test, a reference checks
   * nothing, so it makes no unit tested or used.
   */
  function readReferences(file: string, text: string, offset: number, lineAt: (at: number) => number): void {
    const rel = relative(ROOT, file);
    const where = (at: number): string => `${rel}:${lineAt(offset + at)}`;
    const LINK = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
    for (const m of text.matchAll(LINK)) {
      const href = m[1] as string;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !href.includes('#')) continue;
      const [path, frag] = href.split('#') as [string, string];
      const target = path ? join(dirname(file), path) : file;
      if (!existsSync(target) || !statSync(target).isFile()) {
        findings.rot.push(`${where(m.index ?? 0)} — link "${href}" leads to no file`);
      } else if (!idsOf(target).has(frag)) {
        findings.rot.push(`${where(m.index ?? 0)} — link "${href}" — no id="${frag}" in ${relative(ROOT, target)}`);
      }
    }
    // A link and a tag are read above; what is left of the text is prose.
    const prose = text.replace(LINK, m => ' '.repeat(m.length)).replace(/@canon\s+\S+/g, m => ' '.repeat(m.length));
    for (const m of prose.matchAll(/[\w./-]*?([\w.-]+\.md)#([\w-]+)/g)) {
      if (!documentNames.has(m[1] as string)) continue;
      findings.rot.push(
        `${where(m.index ?? 0)} — "${m[0]}" is no link; cite with "@canon ${m[2]}" or a link from this file`
      );
    }
  }

  // A project that has not written its first declared suite yet has no
  // directory to read, which is zero suites rather than an error.
  const enforcedFiles = new Set<string>(
    existsSync(join(ROOT, TESTS)) ? allSuites(join(ROOT, TESTS)) : []
  );
  const enforcedModules = new Set<string>(
    existsSync(join(ROOT, TESTS)) ? allModules(join(ROOT, TESTS)) : []
  );
  // Every suite and source, and whether it is declared. Every tree is swept,
  // read but not judged — the distinction `readSuite` draws. A citation is a
  // true statement about a link wherever it is written, so a spec pinned solely
  // by an undeclared suite is not dead, and sweeping only the declared tree
  // would report it as one: the exact misreading the `dead` list exists to
  // prevent.
  const files = new Map<string, boolean>([...enforcedFiles, ...enforcedModules].map(file => [file, true]));
  for (const root of SOURCES) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const file of [...allSuites(abs), ...allModules(abs)]) if (!files.has(file)) files.set(file, false);
  }

  /** What each file read so far exports, so an import that leads to it is followed without parsing it again. */
  const exportsOf = new Map<string, Exports>();

  /**
   * The file a relative import names, from the file that imports it, with what
   * it exports. Only a suite or a source counts: a marker elsewhere is none.
   */
  function lookup(file: string, source: string): { file: string; exports: Exports } | undefined {
    const base = resolve(dirname(file), source);
    const stem = base.replace(/\.(m?js|jsx)$/, '');
    for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      if (!files.has(candidate)) continue;
      let exports = exportsOf.get(candidate);
      if (exports === undefined) {
        exports = parse(candidate).exports;
        exportsOf.set(candidate, exports);
      }
      return { file: candidate, exports };
    }
    return undefined;
  }

  for (const [file, enforced] of files) readSource(file, enforced);

  /**
   * Check a reference's citations resolve, and nothing else.
   *
   * Its `@canon` tags, plus the markdown links prose cites with. Without this, a renamed unit leaves a dead link in the very
   * document a reader learns the canon from, and nothing reports it.
   *
   * Resolve-only: a worked example must not discharge the test a unit owes.
   */
  function readReference(file: string): void {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    resolveTags(src, 0, rel, linesOf(src));
    for (const a of scanFile(file).anchors) {
      if (/^(https?:|mailto:)/.test(a.href) || !a.href.includes('#')) continue;
      const [path, frag] = a.href.split('#');
      const target = path ? join(dirname(file), path) : file;
      if (!existsSync(target)) {
        findings.rot.push(`${rel}: href="${a.href}" — no such file`);
      } else if (!idsOf(target).has(frag)) {
        findings.rot.push(
          `${rel}: href="${a.href}" — no id="${frag}" in ${relative(ROOT, target)}`
        );
      }
    }
  }


  for (const ref of REFERENCES)
    for (const file of allReferences(join(ROOT, ref))) readReference(file);

  // dead — a unit nothing cites. Last, after every suite has been read: a spec
  // kept alive by a test it has not reached yet would otherwise report dead,
  // and the list would read as a canon full of unreachable units. A conflict is
  // no part of the theory, only a record of where it fails, and a thread only a
  // question it leaves open, so nothing cites either.
  for (const [key, unit] of units) {
    if (unit.kind === 'conflict-' || unit.kind === 'thread-') continue;
    if (!citedTargets.has(key))
      findings.dead.push(`${key} (${aNoun(unit.kind)})`);
  }

  // stale-site — a unit naming a code site that is not there.
  //
  // A spec that answers for one place names it on a line of its own:
  // `` Site: `queue.ts:drain` ``. That is a claim about the code, and the only one
  // in these documents a machine can check against the code itself — whether
  // every place has a spec cannot be, so this is the half that can.
  //
  // It is the rename it catches. Every citation of a renamed unit is caught by
  // `rot`, and nothing watched the leads: a spec would go on naming a symbol
  // that had not existed since the rename that moved everything else.
  //
  // The file may be a bare name, `queue.ts`, or a path that ends in it,
  // `dom/queue.ts`. Two modules can share a name, so a bare name finds every
  // module called that, and the symbol has to be in one of them; a path
  // narrows the search to the modules whose path ends in it.
  const NAMES_A_SITE = /^`([\w./-]+\.tsx?):([^`\s]+)`$/;
  // A statement opening with a file in either form, `queue.ts:drain` or
  // `queue.ts` `drain`, is a site written where the claim belongs.
  const OPENS_WITH_A_SITE = /^`[\w./-]+\.tsx?(:|`\s+`)/;
  const modules: string[] = [];
  for (const root of SOURCES) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    modules.push(...allModules(abs));
  }
  for (const [key, unit] of units) {
    if (!CLAIMS.includes(unit.kind)) continue;
    // A site in the statement hides the claim behind where it is made.
    if (unit.statement && OPENS_WITH_A_SITE.test(unit.statement)) {
      findings['stale-site'].push(
        `${key} names its site in its statement; move it to a "Site:" line`
      );
    }
    if (!unit.site) continue;
    const named = NAMES_A_SITE.exec(unit.site);
    if (!named) {
      findings['stale-site'].push(
        `${key} has a "Site:" line that is not \`file.ts:symbol\`: ${unit.site}`
      );
      continue;
    }
    const [, file, symbol] = named;
    const paths = modules.filter((m) => m === file || m.endsWith(`/${file}`));
    if (paths.length === 0) {
      findings['stale-site'].push(
        `${key} names ${file}, which is not in ${SOURCES.join(' or ')}`
      );
      continue;
    }
    // The leaf of a dotted name, and without a call's parentheses.
    const bare = symbol.split('.').pop()?.replace(/\(\)$/, '') ?? symbol;
    const pattern = new RegExp(
      `\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
    );
    if (!paths.some((path) => pattern.test(readFileSync(path, 'utf8')))) {
      findings['stale-site'].push(
        `${key} names \`${symbol}\` in ${file}, which is not there`
      );
    }
  }

  // untracked-bug, untracked-conflict — a bug or a conflict owes an issue,
  // named in its own text. Both wait on someone: a bug on its fix, a conflict on
  // the owner's ruling. The issue is where that wait is tracked. A project with
  // no tracker has no issues, so nothing is owed there.
  const bugs = new Map<string, string>();
  for (const [key, unit] of units) {
    if (unit.kind !== 'bug-' && unit.kind !== 'conflict-') continue;
    bugs.set(key, unit.own ?? '');
    if (CONFIG.tracker !== undefined && !/(?:^|[^\w&])#\d+\b|\/issues\/\d+/.test(unit.own ?? '')) {
      findings[unit.kind === 'bug-' ? 'untracked-bug' : 'untracked-conflict'].push(key);
    }
  }

  // lone-conflict — a conflict names, on its "Between:" line, the units that
  // cannot all hold. A contradiction has at least two sides, and a conflict is
  // never one of them.
  for (const [key, unit] of units) {
    if (unit.kind !== 'conflict-') continue;
    const line = /^Between:(.*)$/m.exec(unit.own ?? '')?.[1] ?? '';
    const sides = new Set(
      [...line.matchAll(/\]\([^)#]*#([\w-]+)\)/g)]
        .map(m => m[1] as string)
        .filter(id => kindOf(id) !== undefined && kindOf(id) !== 'conflict-')
    );
    if (sides.size < 2) {
      findings['lone-conflict'].push(`${key} (names ${sides.size} unit${sides.size === 1 ? '' : 's'})`);
    }
  }

  // untested — a leaf claim no test pins.
  //
  // Only a spec and an exception: an axiom or a fact is reached through the
  // specs that rely on it, and a test naming one is already reported. A claim
  // holding nested claims is pinned through its leaves, so only a leaf owes a
  // test. A bug's pin asserts the claim of the spec the bug breaks, so it pins
  // that spec as well as the bug.
  for (const [bug, specs] of bugSpecs) {
    if (testedTargets.has(bug)) for (const spec of specs) testedTargets.add(spec);
  }
  // A project with no runner has no tests, so none is owed.
  for (const [key, unit] of units) {
    if (!HAS_RUNNER) break;
    if (!CLAIMS.includes(unit.kind)) continue;
    if (claimParents.has(key)) continue;
    if (!testedTargets.has(key)) {
      findings.untested.push(`${key} (${aNoun(unit.kind)})`);
    }
  }

  return { findings, units, suites: enforcedFiles.size, written, testsPer, testsAt, links, bugs };
}

// ---------------------------------------------------------------------------
// The command line.
// ---------------------------------------------------------------------------

const HELP = `canon — derivation links for a project's canon

Every unit that makes a derived claim carries a machine-checkable link to what
it derives from — its position under the unit it derives from, a link on a
"Derives from:" line in a document, a @canon JSDoc tag in a test — and the
documents' index and the table of kinds are generated from those links rather
than hand-kept. check is the gate, generate is the writer, tree is the map, and
rename moves a unit's id and every name of it at once. show and find read a unit
with what the documents hold of it in other places.

Usage:
  ${COMMAND} check [--offline]     report every finding; exit 1 if there is one. With a
                                   "tracker" in the scope, also ask it about each bug's
                                   issue; --offline skips that and needs no network
  ${COMMAND} generate              rewrite the generated regions
  ${COMMAND} tree [unit …] [options]
                                   print the derivation tree with test counts; with units,
                                   only the tree from each, in the order named
  ${COMMAND} show <unit> …         print each unit's own text, the units it sits in up to its root,
                                   the units its "Derives from:" line names, the units that sit in
                                   it, the units that derive from it, and the tests that check it
  ${COMMAND} show <unit> … [--statement] [--body]
                                   print only those parts of each unit: its statement as it
                                   reads, or the rest of its own text as written
  ${COMMAND} find [word …] [--kind <kind>]… [--in <part>]
                                   list the units whose id or own text holds every word, in any
                                   case, each with where it starts, its id and its statement; with
                                   no word, every unit the filters let through. Exit 0 when a unit
                                   is listed, 1 when none is, 2 on bad usage, as grep does
  ${COMMAND} log [range]           list commits that change the implementation without naming a unit;
                                   the range defaults to the commits not yet pushed
  ${COMMAND} rename <id> <stem> [--dry-run]
                                   give the unit the new stem, keeping its kind, and move every pointer,
                                   tag, code span and generated region that names it to the new id; then
                                   write the generated regions. --dry-run prints each line it would change
                                   and changes nothing

Options for tree:
  --gaps          only the branches leading to a claim no test pins
  -v, --verbose   what each unit claims, under its stem
  --suspect [n]   specs with no nested specs carrying n or more tests (default 4)

Options for find:
  --kind <kind>   only units of the kind: axiom, fact, spec, exception, bug, conflict,
                  thread or term; repeat it for several kinds
  --in <part>     where a word must stand: id, statement (as show --statement prints
                  it), body (as show --body prints it), or all, the id or the own text
                  (the default)

In a pipeline:
  --ids           find, show and tree print the id of each unit they would print, one
                  on each line, and nothing else; tree prints each id once
  -               in place of the units of show, tree and alloy:intent (without --write):
                  the names on standard input, one on each line, in any form show reads;
                  a blank line names none, and no name at all prints nothing

  ${COMMAND} find ConditionApart --ids | ${COMMAND} show - --statement
  ${COMMAND} find --kind fact --ids | wc -l
  comm -12 <(${COMMAND} tree --gaps --ids | sort) <(${COMMAND} find flush --ids | sort)

Commands of plugins:
A plugin adds each command of its own under the name of its package: the package
@bigmistqke/canon-plugin-<name> adds <name>:<command>. The bare name, <command>,
runs it too while no other plugin that applies has a command of that name; when
two do, the run names their prefixed names and exits 2. A plugin's part of check
and generate runs under those commands, and no prefixed name asks for it.

  ${COMMAND} retext:lint [file …]  check the language of the documents' prose; exit 1 on a finding
  ${COMMAND} alloy:logic [file …]  check the alloy blocks of the documents together: whether each
                                   scenario can happen while every unit holds, and whether each unit's
                                   map from its statement to its predicate is current; exit 1 if not
  ${COMMAND} alloy:logic --review <unit>
                                   mark the unit's map reviewed as it now stands (repeat for more units)
  ${COMMAND} alloy:logic --show <scenario>
                                   print a world in which the scenario happens, step by step, in the
                                   document's readings (repeat for more scenarios)
  ${COMMAND} alloy:intent <unit> … print the intent of each unit with a formula: the prose between its
                                   statement and its first fenced block, under where the unit starts
                                   and its id; - reads the ids from standard input
  ${COMMAND} alloy:intent <unit> --write
                                   put the text on standard input in place of the unit's intent; refuse
                                   (exit 2) text with a fence, a heading, a quote, a comment or a
                                   "Derives from:" or "Site:" line, and leave the rest of the unit as it is
  ${COMMAND} alloy:readings      list each reading of the documents: where it is, the unit that holds it,
                                   its key and its positive and negative words
  ${COMMAND} alloy:readings <key> --write "<positive> | <negative>"
                                   reword the one reading with the key, in place; refuse (exit 2) a key
                                   of no reading or of several. The statements that say it are stale
                                   until generate, and the output names them
  ${COMMAND} pele:graph [--svg]   print the derivations of the documents as a Mermaid flowchart, or with
                                   --svg as the SVG that Pele renders from it

They come from @bigmistqke/canon-plugin-retext, @bigmistqke/canon-plugin-alloy and
@bigmistqke/canon-plugin-pele. The Alloy plugin also adds to generate and check: a
document with a "readings" block has the statement of each unit with a
predicate written from the predicate, and check reports one that is stale. It
also reports the words of such a document that are undeclared, misplaced,
apart from their declaration or unused, and each unit with a formula and no intent. A document's frontmatter chooses which
plugins apply to it, each named by its package ("plugins:
[\"@bigmistqke/canon-plugin-retext\"]"); with none, none applies. Each is a package
installed in the project, whose commands are added to these.

alloy:logic needs the Alloy analyzer's jar and a Java 17 or later: the "logic.alloy" setting
of the entry document gives their paths ("jar", "java"), or CANON_ALLOY_JAR and CANON_JAVA do.

The protocol is the canon skill. The scope is the frontmatter of the entry
document, the nearest CANON.md that holds a setting: documents, suites,
sources, references, command, tracker. A project that keeps it in the "canon"
field of package.json is served while no document holds a setting.

What check reports:
${(Object.keys(MEANING) as FindingName[])
  .map(name => `  ${name.padEnd(14)}${MEANING[name]}`)
  .join('\n')}

Terms come first in the tree, each with its definition and the number of units
that link to it. Facts come next, each with its statement and the number of
units that derive from it. Conflicts follow, each with its statement. The
derivation tree of the axioms comes last.

Tree connectors:
  ├─ └─   nesting — the ordinary citation
  ├╌ └╌   a link — a spec in a table, which cannot nest
  →       a further parent, from the unit's "Derives from:" line

Stems are shown as prose: @spec A write lands at once is the unit
spec-a-write-lands-at-once. Lower the words and hyphenate to get the id back.
show and tree take a unit in any of these forms: spec-a-stem, "@spec a-stem",
@spec a-stem, "@spec A stem", and CANON.md#spec-a-stem as check reports it. A
line of standard input after - is one name in any of these forms, quotes left out.

--suspect is a heuristic and deliberately not part of check. A spec carrying
many tests and no nested specs is usually saying several things with no way to
say so. But not always: a spec can carry several tests of one claim,
enumerated per input, and nested specs there would only restate their parent.

Exit codes:
  0  success
  1  check found something, or find listed no unit
  2  bad usage`;

/**
 * Hold each bug's issue to the tracker: it must exist, it must be open, and the
 * tracker must be reachable to say so. An issue the tracker cannot be asked
 * about is reported once for its project, not once for each bug that names it.
 */
async function holdToTracker(
  tracker: TrackerConfig,
  bugs: Map<string, string>,
  findings: Record<FindingName, string[]>
): Promise<void> {
  const problems = trackerProblems(tracker);
  if (problems.length > 0) {
    findings['unreachable-tracker'].push(`package.json canon.tracker: ${problems.join('; ')}`);
    return;
  }
  const named = new Map<string, IssueRef[]>();
  for (const [key, text] of bugs) named.set(key, issueRefs(text, tracker));
  const results = await lookupIssues([...named.values()].flat(), tracker, process.env);

  const unreachable = new Map<string, string[]>();
  for (const [key, refs] of named) {
    for (const ref of refs) {
      const result = results.get(refKey(ref));
      if (result === undefined) continue;
      if (result.problem !== undefined) {
        unreachable.set(result.problem, [...(unreachable.get(result.problem) ?? []), key]);
      } else if (result.state === 'missing') {
        findings['missing-issue'].push(`${key} names ${ref.written}, which ${ref.project} does not hold`);
      } else if (result.state === 'pull-request') {
        findings['missing-issue'].push(`${key} names ${ref.written}, which is a pull request`);
      } else if (result.state === 'closed') {
        findings['closed-issue'].push(`${key} names ${ref.written}, which is closed`);
      }
    }
  }
  for (const [problem, keys] of unreachable) {
    findings['unreachable-tracker'].push(`${problem} (${keys.length} bug(s) or conflict(s), such as ${keys[0]})`);
  }
}

async function check(offline: boolean): Promise<void> {
  const { findings, units, suites, bugs } = analyse(false);
  const tracker = CONFIG.tracker;
  const asked = tracker !== undefined && !offline;
  if (asked) await holdToTracker(tracker, bugs, findings);

  console.log(`canon check — ${ROOT}\n`);
  console.log(`scope: ${DOCS.length} document(s), ${suites} declared suite(s)`);
  console.log(`units: ${units.size}`);
  if (tracker !== undefined) {
    console.log(`issues: ${asked ? `held to the ${tracker.kind} tracker` : 'not checked (--offline)'}`);
  }
  if (!HAS_RUNNER) console.log('tests: none read (runners: []), so no claim owes a test');
  console.log('');

  let total = 0;
  for (const name of Object.keys(findings) as FindingName[]) {
    if (TRACKER_FINDINGS.includes(name) && !asked) continue;
    const list = findings[name];
    total += list.length;
    console.log(`${name} — ${MEANING[name]}: ${list.length}`);
    for (const entry of list) console.log(`  · ${entry}`);
    console.log('');
  }

  // What plugins find that the core cannot see, printed before the summary that would otherwise say "clean".
  const fromPlugins = (await runCommands('check', [], { offline })) ?? 0;
  if (total === 0 && fromPlugins === 0) console.log('clean');
  else console.log(total === 0 ? 'findings from plugins, above' : fromPlugins === 0 ? `${total} finding(s)` : `${total} finding(s), and findings from plugins above`);
  process.exit(total === 0 && fromPlugins === 0 ? 0 : fromPlugins === 2 ? 2 : 1);
}

/**
 * The source trees that hold the implementation: every declared source that is
 * not the suite directory or inside it.
 */
const IMPLEMENTATION = SOURCES.filter(
  s => s !== TESTS && !s.startsWith(`${TESTS}/`)
);

/** A unit id as it appears in prose: a kind prefix, then a hyphenated stem. */
const UNIT_ID = /\b(?:axiom|fact|spec|exception|bug)-[a-z0-9]+(?:-[a-z0-9]+)*/g;

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/**
 * Commits in `range` that change the implementation without naming a unit.
 *
 * The canon governs every change, but nothing links code back to it: per-symbol
 * tags were tried and dropped. The commit is where a change is made, so the
 * commit names the units the change serves or changes. A commit that touches
 * the implementation and names none is outside the canon, and this lists it.
 *
 * Any id-shaped name counts, whether or not the unit still exists: a commit
 * that retires a unit names a unit that is gone afterwards.
 *
 * With no range, the commits not yet pushed to the upstream branch, or the last
 * commit when there is no upstream: what a session has made.
 */
function log(range: string | undefined): void {
  let span = range;
  if (span === undefined) {
    try {
      git('rev-parse', '--abbrev-ref', '@{upstream}');
      span = '@{upstream}..HEAD';
    } catch {
      span = 'HEAD~1..HEAD';
    }
  }
  const commits = git('rev-list', '--reverse', '--no-merges', span)
    .split('\n')
    .filter(Boolean);

  const unnamed: string[] = [];
  for (const sha of commits) {
    const touched = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)
      .split('\n')
      .filter(f => IMPLEMENTATION.some(d => f === d || f.startsWith(`${d}/`)));
    if (touched.length === 0) continue;
    if (UNIT_ID.test(git('log', '-1', '--format=%B', sha))) {
      UNIT_ID.lastIndex = 0;
      continue;
    }
    UNIT_ID.lastIndex = 0;
    unnamed.push(
      `${git('log', '-1', '--format=%h %s', sha)}\n    changes ${touched.join(', ')}`
    );
  }

  console.log(
    `canon log — ${commits.length} commit(s) in ${span}, implementation in ${IMPLEMENTATION.join(', ')}\n`
  );
  console.log(
    `unnamed — commit changing the implementation without naming a unit: ${unnamed.length}`
  );
  for (const entry of unnamed) console.log(`  · ${entry}`);
  process.exit(unnamed.length === 0 ? 0 : 1);
}

/** Write the generated regions; the exit code of the plugins that write their own, which run first so that the core sees what they wrote. */
async function generate(): Promise<number> {
  const fromPlugins = (await runCommands('generate', [], {})) ?? 0;
  const { written } = analyse(true);
  if (written.length === 0) {
    console.log('every generated region is already what the units say');
    return fromPlugins;
  }
  for (const rel of written) console.log(`wrote ${rel}`);
  return fromPlugins;
}

/** A stem: words of lowercase letters and digits, joined by single hyphens. */
const STEM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `text` as a pattern that matches it literally. */
const literally = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Give the unit `old` the stem `stem`, and move every name of it to the new
 * id: the pointers whose path leads to its document, the tags and links in the comments
 * of the suites and the sources and in the references, the code spans that
 * spell it, and the markers of the regions named after it. Then write the
 * generated regions, as `generate` does. The exit code: 0, or 2 when the
 * rename cannot hold, with nothing changed.
 *
 * Every change is worked out before any file is written, so a refusal leaves
 * the project as it was, and a dry run prints what the rename would write.
 */
async function rename(old: string, stem: string, dryRun: boolean): Promise<number> {
  const refuse = (why: string): number => {
    console.error(`canon: rename: ${why}`);
    return 2;
  };

  // The units the project declares, and those of the documents it extends, which another project holds.
  const own = new Map<string, { doc: string; kind: string; start: number }>();
  const extended = new Map<string, string>();
  for (const rel of DOCS) {
    const file = join(ROOT, rel);
    if (!rel.endsWith('.md') || !existsSync(file)) continue;
    for (const unit of readUnits(readFileSync(file, 'utf8'))) {
      if (!own.has(unit.id)) own.set(unit.id, { doc: rel, kind: unit.kind, start: unit.start });
    }
    let context: string[] = [];
    try {
      context = contextOf(file, ROOT);
    } catch {
      // A path that names no document is refused before any command runs.
    }
    for (const other of context) {
      for (const unit of readUnits(readFileSync(other, 'utf8'))) extended.set(unit.id, relative(ROOT, other));
    }
  }

  const unit = own.get(old);
  if (unit === undefined) {
    const elsewhere = extended.get(old);
    return refuse(
      elsewhere === undefined
        ? `${old} names no unit of the project's documents`
        : `${old} is declared in ${elsewhere}, a document this project extends; rename it in the project that holds it`
    );
  }
  if (!STEM.test(stem)) {
    return refuse(`"${stem}" is not a stem: words of lowercase letters and digits, joined by single hyphens`);
  }
  const next = `${unit.kind}-${stem}`;
  const holder = own.get(next)?.doc ?? extended.get(next);
  if (holder !== undefined) return refuse(`${next} is already declared in ${holder}`);

  const home = join(ROOT, unit.doc);
  const id = literally(old);
  /** The id ends here: an id that goes on is another id. */
  const ends = '(?![\\w-])';
  const tags = new RegExp(`(@canon\\s+)${id}${ends}`, 'g');
  // An axiom tag names an axiom with its kind or without it.
  const axiomTags = unit.kind === 'axiom' ? new RegExp(`(@axiom\\s+)(axiom-)?${literally(old.slice('axiom-'.length))}${ends}`, 'g') : undefined;
  const retag = (text: string): string => {
    const moved = text.replace(tags, `$1${next}`);
    return axiomTags === undefined ? moved : moved.replace(axiomTags, (_, at: string, kind = '') => `${at}${kind}${stem}`);
  };

  /** A document or a reference, with every pointer to the unit, code span of its id and tag of it moved. */
  const reword = (file: string, src: string): string => {
    const leads = (path: string): boolean => (path === '' ? file === home : join(dirname(file), path) === home);
    return retag(
      src
        .replace(new RegExp(`(\\]\\()([^)\\s#]*)#${id}(?=\\))`, 'g'), (m, open: string, path: string) => (leads(path) ? `${open}${path}#${next}` : m))
        .replace(new RegExp(`(href=")([^"#]*)#${id}(?=")`, 'g'), (m, open: string, path: string) => (leads(path) ? `${open}${path}#${next}` : m))
        .replace(new RegExp(`(?<!\`)\`${id}\`(?!\`)`, 'g'), `\`${next}\``)
    );
  };

  /** Each file the rename changes, with its text as it is and as it will be. */
  const changes = new Map<string, { was: string; is: string }>();
  const change = (file: string, rewrite: (src: string) => string): void => {
    const was = changes.get(file)?.was ?? readFileSync(file, 'utf8');
    const is = rewrite(changes.get(file)?.is ?? was);
    changes.set(file, { was, is });
  };

  // The heading: its kind stays, and the stem after it is the new one.
  change(home, src => {
    const end = src.indexOf('\n', unit.start);
    const line = src.slice(unit.start, end === -1 ? undefined : end);
    return src.slice(0, unit.start) + line.replace(/^(#{1,6}[ \t]+@[a-z]+[ \t]+)\S+/, `$1${stem}`) + (end === -1 ? '' : src.slice(end));
  });
  // A region named after the unit, such as the statement a plugin writes for it, ends its markers with the id.
  const markers = new RegExp(`(<!--[ \\t]*(?:[\\w-]*-)?)${id}(:(?:begin|end)\\b)`, 'g');
  for (const rel of DOCS) {
    const file = join(ROOT, rel);
    if (rel.endsWith('.md') && existsSync(file)) change(file, src => reword(file, src).replace(markers, `$1${next}$2`));
  }
  for (const ref of REFERENCES) for (const file of allReferences(join(ROOT, ref))) change(file, src => reword(file, src));

  // A tag in a suite or a source is one in a comment: text in a string names no unit.
  const sources = new Set<string>(existsSync(join(ROOT, TESTS)) ? [...allSuites(join(ROOT, TESTS)), ...allModules(join(ROOT, TESTS))] : []);
  for (const root of SOURCES) {
    const abs = join(ROOT, root);
    if (existsSync(abs)) for (const file of [...allSuites(abs), ...allModules(abs)]) sources.add(file);
  }
  for (const file of sources) {
    const src = readFileSync(file, 'utf8');
    let comments: Array<{ start: number; end: number }>;
    try {
      comments = parseSource(src, file.endsWith('.tsx')).comments;
    } catch (error) {
      return refuse(`${relative(ROOT, file)} does not parse as TypeScript: ${(error as Error).message}`);
    }
    let out = '';
    let at = 0;
    // A link in a comment leads from the file that holds it, as one in a document does.
    const relink = (text: string): string =>
      text.replace(new RegExp(`(\\]\\()([^)\\s#]+)#${id}(?=\\))`, 'g'), (m, open: string, path: string) =>
        join(dirname(file), path) === home ? `${open}${path}#${next}` : m
      );
    for (const { start, end } of comments) {
      out += src.slice(at, start) + relink(retag(src.slice(start, end)));
      at = end;
    }
    out += src.slice(at);
    if (out !== src) changes.set(file, { was: src, is: out });
  }

  let lines = 0;
  let files = 0;
  for (const [file, { was, is }] of changes) {
    if (was === is) continue;
    files++;
    const before = was.split('\n');
    const after = is.split('\n');
    for (const [i, line] of before.entries()) {
      if (line === after[i]) continue;
      lines++;
      if (dryRun) console.log(`${relative(ROOT, file)}:${i + 1}\n  - ${line}\n  + ${after[i]}`);
    }
    if (!dryRun) writeFileSync(file, is);
  }
  if (dryRun) {
    console.log(`\nrename ${old} to ${next} would change ${lines} line(s) in ${files} file(s)`);
    return 0;
  }
  console.log(`renamed ${old} to ${next}: ${lines} line(s) in ${files} file(s)`);
  return generate();
}

function tree(options: {
  gaps: boolean;
  verbose: boolean;
  suspect: number | undefined;
  /** The names of the units to draw the trees from; undefined for the whole canon. */
  from: string[] | undefined;
  /** Print the id of each unit drawn, once, and nothing else. */
  ids: boolean;
}): void {
  const { units, testsPer, links } = analyse(false);
  const drawn: string[] = [];
  const collect = options.ids ? drawn : undefined;
  const print = (text: string): void => {
    if (!options.ids) console.log(text);
  };
  if (options.from !== undefined) {
    // Every name is looked up before any tree is drawn, so a name of no unit stops the run with nothing printed.
    const roots = options.from.map(name => unitNamed(units, name));
    for (const unit of roots) print(treeOf(join(ROOT, unit.doc), testsPer, options.gaps, options.verbose, links, unit.id, collect));
  } else {
    for (const doc of DOCS) {
      const file = join(ROOT, doc);
      if (!existsSync(file)) continue;
      print(
        options.suspect !== undefined
          ? suspectsOf(file, testsPer, options.suspect, collect)
          : treeOf(file, testsPer, options.gaps, options.verbose, links, undefined, collect)
      );
    }
  }
  for (const id of new Set(drawn)) console.log(id);
}

/**
 * The names on a command line, with a bare `@spec` joined to the stem after it,
 * so `canon show @spec a-stem` names one unit as a heading writes it.
 */
function namesOf(args: string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    names.push(/^@[a-z]+$/.test(arg) && i + 1 < args.length ? `${arg} ${args[++i]}` : arg);
  }
  return names;
}

/**
 * The names on a command line, with `-` in place of the names on standard
 * input: one on each line, a line of blank space naming none. Standard input
 * is read once, however many times `-` stands on the line.
 *
 * @canon spec-a-dash-stands-for-the-names-on-standard-input
 */
async function namesFrom(args: string[]): Promise<string[]> {
  const names = namesOf(args);
  if (!names.includes('-')) return names;
  // Read as a stream, not with readFileSync(0): a pipe that a Node process
  // writes to, or that a plugin touched as it loaded, can be non-blocking, and
  // a synchronous read of it fails with EAGAIN before the writer has written.
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const stdin = Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  let read = false;
  return names.flatMap(name => {
    if (name !== '-') return [name];
    if (read) return [];
    read = true;
    return stdin;
  });
}

/**
 * The id a name gives: the id itself, `@spec a-stem` as a heading writes it, or
 * `@spec A stem` as the tree writes it. A `<doc>#` before it, as check reports a
 * unit, is dropped.
 */
const idOf = (name: string): string =>
  name.slice(name.lastIndexOf('#') + 1).trim().replace(/^@/, '').toLowerCase().replace(/\s+/g, '-');

/** The unit an id names in any document, if one does. */
const unitOf = (units: Map<string, Unit>, id: string): Unit | undefined =>
  [...units.values()].find(unit => unit.id === id);

/** The unit a name names; a name that names none stops the run. */
function unitNamed(units: Map<string, Unit>, name: string): Unit {
  const unit = unitOf(units, idOf(name));
  if (unit === undefined) {
    console.error(`canon: "${name}" names no unit; \`${COMMAND} find <words>\` lists the units that hold them`);
    process.exit(2);
  }
  return unit;
}

/**
 * A unit on a line of its own: where it starts, its id, what follows the id,
 * and its statement, cut to fit a terminal. A pipe gets the whole statement, so
 * a reader that greps the line needs no second call for the rest.
 */
function unitLine(unit: Unit, after = '', indent = 0): string {
  const head = `${unit.doc}:${unit.line}  ${unit.id}${after}`;
  if (!unit.statement) return head;
  const said = process.stdout.isTTY ? clip(unit.statement, indent + head.length + 3) : unit.statement.replace(/\s+/g, ' ').trim();
  return `${head} — ${said}`;
}

/** The lines of a list under its title, or `none` under it. */
const listed = (title: string, lines: string[]): string =>
  [`${title}`, ...(lines.length > 0 ? lines : ['none']).map(line => `  ${line}`)].join('\n');

/** A generated region's marker, which says nothing of the unit. */
const MARKER_LINE = /^<!--\s*[\w-]+:(begin|end)\b.*-->\s*$/;

/** The parts of a unit `show` can print alone: the two the checker fixes the place of. */
interface Parts {
  statement: boolean;
  body: boolean;
}

/** A line of a statement as it reads: each link and each term mark as its words, and each code span as written. */
const asWords = (line: string): string =>
  line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(TERM_MARK, (_, words: string) => words)))
    .join('')
    // A backslash that ends the line is a line break of the page, no word of the statement.
    .replace(/\\$/, '');

/**
 * A unit's own text split at its statement: the statement as it reads, its
 * lines without the quote marks and each link and term mark as its words, and the body
 * after it as written. Generated regions' markers say nothing of the unit.
 */
function partsOf(own: string): { statement?: string; body?: string } {
  const lines = own.split('\n').filter(line => !MARKER_LINE.test(line));
  const first = lines.findIndex(line => line.startsWith('>'));
  const quote: string[] = [];
  let after = 0;
  if (first !== -1) {
    for (after = first; after < lines.length && lines[after]!.startsWith('>'); after++) {
      quote.push(asWords(lines[after]!.replace(/^>[ \t]?/, '')).trimEnd());
    }
  }
  while (quote.at(-1) === '') quote.pop();
  const body = lines.slice(after).join('\n').trim();
  return { statement: quote.length > 0 ? quote.join('\n') : undefined, body: body === '' ? undefined : body };
}

/** The text of each document, read once for the run. */
const SOURCES_READ = new Map<string, string>();
const sourceOf = (doc: string): string => {
  let src = SOURCES_READ.get(doc);
  if (src === undefined) {
    src = readFileSync(join(ROOT, doc), 'utf8');
    SOURCES_READ.set(doc, src);
  }
  return src;
};

/**
 * The own text of a unit as the document writes it, fenced blocks included,
 * and the offset in its document where that text starts; undefined for a unit
 * of a table, which has no own text.
 */
function ownOf(unit: Unit): { src: string; body: number; own: string } | undefined {
  if (unit.own === undefined) return undefined;
  const src = sourceOf(unit.doc);
  const body = src.indexOf('\n', unit.start) + 1;
  return { src, body, own: src.slice(body, body + unit.own.length) };
}

/**
 * Print each unit a name names, with what it follows from, what follows from
 * it and the tests that check it; with parts named, only those parts; with
 * `ids`, only its id. A name that names no unit is reported after the others
 * are printed, and the run exits with code 2.
 */
function show(names: string[], parts?: Parts, ids = false): void {
  const { units, testsPer, testsAt, links } = analyse(false);
  const keyOf = (unit: Unit): string => `${unit.doc}#${unit.id}`;
  const byStart = (a: Unit, b: Unit): number => DOCS.indexOf(a.doc) - DOCS.indexOf(b.doc) || a.start - b.start;
  const printed: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const unit = unitOf(units, idOf(name));
    if (unit === undefined) {
      unknown.push(name);
      continue;
    }
    if (ids) {
      console.log(unit.id);
      continue;
    }
    const key = keyOf(unit);
    const out = [`${unit.doc}:${unit.line}  ${unit.id}`];
    const { src, body, own } = ownOf(unit) ?? { src: '', body: 0, own: undefined };

    if (parts !== undefined) {
      const { statement, body: rest } = partsOf(own ?? '');
      const said = [parts.statement ? statement : undefined, parts.body ? rest : undefined].filter(part => part !== undefined);
      out.push('', ...(said.length > 0 ? said.join('\n\n') : 'none').split('\n'));
      printed.push(out.join('\n'));
      continue;
    }

    if (own !== undefined) {
      const text = src
        .slice(unit.start, body + own.length)
        .split('\n')
        .filter(line => !MARKER_LINE.test(line))
        .join('\n')
        .trimEnd();
      out.push('', text);
    }

    const above: Unit[] = [];
    for (let at = unit.parent; at !== undefined; ) {
      const parent = units.get(`${unit.doc}#${at}`);
      if (parent === undefined || above.includes(parent)) break;
      above.push(parent);
      at = parent.parent;
    }
    const derivesFrom = (links.get(key) ?? [])
      .filter(link => link.derives)
      .flatMap(link => units.get(link.target) ?? []);
    const within = [...units.values()].filter(other => other.doc === unit.doc && other.parent === unit.id).sort(byStart);
    const derivers = [...links]
      .filter(([, list]) => list.some(link => link.derives && link.target === key))
      .flatMap(([from]) => units.get(from) ?? [])
      .sort(byStart);

    // A leaf claim owes a test, so its count says whether it has one; a claim
    // holding claims is pinned through them, and owes none of its own.
    const tally = (other: Unit): string => {
      if (!CLAIMS.includes(other.kind)) return '';
      if ([...units.values()].some(u => u.doc === other.doc && u.parent === other.id && REFINES.includes(u.kind))) return '';
      const n = testsPer.get(keyOf(other)) ?? 0;
      return n === 0 ? '  no test' : `  ${n} test${n === 1 ? '' : 's'}`;
    };

    out.push(
      '',
      listed('Sits in:', above.map(u => unitLine(u, '', 2))),
      listed('Derives from:', derivesFrom.map(u => unitLine(u, '', 2))),
      listed('Sitting in it:', within.map(u => unitLine(u, tally(u), 2))),
      listed('Deriving from it:', derivers.map(u => unitLine(u, '', 2))),
      listed('Tested by:', (testsAt.get(key) ?? []).map(test => `${test.where}  ${test.title}`)),
      ...(unit.kind === 'term-' ? [listed('Forms:', [stemWords(unit.id), ...(grammarOf(unit.own ?? '')?.forms ?? []).map(f => spelling(f.spelling)).filter(f => f !== spelling(stemWords(unit.id)))])] : [])
    );
    printed.push(out.join('\n'));
  }
  if (printed.length > 0) console.log(printed.join('\n\n'));
  for (const name of unknown) {
    console.error(`canon: "${name}" names no unit; \`${COMMAND} find <words>\` lists the units that hold them`);
  }
  if (unknown.length > 0) process.exit(2);
}

/** The parts of a unit `find --in` can look in. */
const FIND_PARTS = ['id', 'statement', 'body', 'all'] as const;
type FindPart = (typeof FIND_PARTS)[number];

/**
 * Print a line for each unit whose id or own text holds every word, in any
 * case, in the order of the documents; with `kinds`, only the units of those
 * kinds; with a part other than `all`, the words are looked for in that part
 * alone; with `ids`, each line is the id alone. Returns grep's exit code: 0
 * when a unit is listed, 1 when none is, 2 when the command line cannot be read.
 *
 * @canon spec-find-exits-with-the-codes-of-grep
 */
function find(words: string[], kinds: string[], part: string, ids: boolean): number {
  const only: Kind[] = [];
  for (const kind of kinds) {
    const prefix = `${kind.replace(/^@/, '').replace(/-$/, '')}-`;
    const known = PREFIXES.find(p => p === prefix);
    if (known === undefined) {
      console.error(`canon: --kind takes one of ${PREFIXES.map(noun).join(', ')}, not "${kind}"`);
      return 2;
    }
    only.push(known);
  }
  if (!(FIND_PARTS as readonly string[]).includes(part)) {
    console.error(`canon: --in takes one of ${FIND_PARTS.join(', ')}, not "${part}"`);
    return 2;
  }
  const { units } = analyse(false);
  const lowered = words.map(word => word.toLowerCase());
  // The statement and the body are what `show --statement` and `show --body` print.
  const textOf = (unit: Unit): string => {
    const own = ownOf(unit)?.own ?? '';
    switch (part as FindPart) {
      case 'id':
        return unit.id;
      case 'statement':
        return partsOf(own).statement ?? '';
      case 'body':
        return partsOf(own).body ?? '';
      case 'all':
        return `${unit.id}\n${own}`;
    }
  };
  const found = [...units.values()]
    .filter(unit => only.length === 0 || only.includes(unit.kind))
    .filter(unit => {
      const text = textOf(unit).toLowerCase();
      return lowered.every(word => text.includes(word));
    })
    .sort((a, b) => DOCS.indexOf(a.doc) - DOCS.indexOf(b.doc) || a.start - b.start);
  if (found.length === 0) {
    console.error(words.length > 0 ? `canon: no unit holds ${words.map(word => `"${word}"`).join(' and ')}` : 'canon: no unit passes the filters');
    return 1;
  }
  for (const unit of found) console.log(ids ? unit.id : unitLine(unit));
  return 0;
}

/**
 * Run the plugin commands that `find` finds, each over the documents that
 * apply its plugin, and return the worst of their codes; undefined when it
 * finds none. A plugin that cannot be found or loaded, or a frontmatter that
 * cannot be read, stops the run before anything is checked.
 */
async function runFound(find: () => Promise<Found[]>, args: string[], options: PluginContext['options']): Promise<number | undefined> {
  let found: Found[];
  let applied: string[][];
  try {
    found = await find();
    applied = found.map(({ specifier }) => documentsFor(specifier, DOCS, ROOT));
  } catch (error) {
    console.error(`canon: ${(error as Error).message}`);
    process.exit(2);
  }
  if (found.length === 0) return undefined;
  let code = 0;
  for (const [i, { plugin, run }] of found.entries()) {
    const exit = await run({
      args,
      root: ROOT,
      documents: applied[i] as string[],
      config: plugin.config === undefined ? undefined : CONFIG[plugin.config],
      options
    });
    // 2, a check that could not run, outranks 1, a finding, which outranks 0.
    code = Math.max(code, exit);
  }
  return code;
}

/** Run what plugins add to the core command `command`, such as `check`; undefined when no plugin adds to it. */
const runCommands = (command: string, args: string[], options: PluginContext['options']): Promise<number | undefined> =>
  runFound(() => findCommands(command, DOCS, ROOT), args, options);

/**
 * Run a command that only plugins add, by its prefixed name or its bare name,
 * and exit with its code. A bare name that more than one command has runs
 * none of them, since it cannot say which job was asked for.
 */
async function runPlugin(command: string, args: string[], options: PluginContext['options']): Promise<never> {
  let names: string[] = [];
  const code = await runFound(
    async () => {
      const named = await findNamed(command, DOCS, ROOT);
      names = named.names;
      return named.found;
    },
    args,
    options
  );
  if (code === undefined && names.length > 1) {
    console.error(`canon: "${command}" is the bare name of more than one command; ask for one of them by its prefixed name:\n${names.map(name => `  ${COMMAND} ${name}`).join('\n')}`);
    process.exit(2);
  }
  if (code === undefined) {
    console.error(`canon: unknown command "${command}"\n\n${HELP}`);
    process.exit(2);
  }
  process.exit(code);
}

/**
 * Refuse a frontmatter that holds what only the entry document may hold: a
 * setting in another document the project checks, and a key that neither the
 * tool nor a plugin the document lists defines. The documents the entry
 * document extends are context, and are checked where they live.
 */
async function refuseSettings(): Promise<void> {
  for (const doc of DOCS) {
    const file = join(ROOT, doc);
    if (!existsSync(file)) continue;
    try {
      const frontmatter = readFrontmatter(readFileSync(file, 'utf8'), true);
      if (file !== ENTRY && hasSettings(frontmatter)) {
        throw new Error(
          `it holds a setting, but the settings of a project belong in its entry document${ENTRY === undefined ? '' : `, ${relative(ROOT, ENTRY)}`}. Move the setting there.`
        );
      }
      const known = await configKeysOf(doc, ROOT);
      for (const name of Object.keys(frontmatter?.other ?? {})) {
        if (!known.includes(name)) readFrontmatter(`---\n${name}: x\n---\n`, known);
      }
    } catch (error) {
      console.error(`canon: ${doc}: frontmatter: ${(error as Error).message}`);
      process.exit(2);
    }
  }
}

async function main(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        gaps: { type: 'boolean' },
        verbose: { type: 'boolean', short: 'v' },
        suspect: { type: 'string' },
        offline: { type: 'boolean' },
        review: { type: 'string', multiple: true },
        show: { type: 'string', multiple: true },
        svg: { type: 'boolean' },
        kind: { type: 'string', multiple: true },
        in: { type: 'string' },
        ids: { type: 'boolean' },
        statement: { type: 'boolean' },
        body: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        write: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });
  } catch (error) {
    // `--suspect` with no number is the default threshold, which parseArgs
    // cannot express for a string option, so it is retried as `--suspect 4`.
    const at = argv.indexOf('--suspect');
    if (at !== -1 && !/^\d+$/.test(argv[at + 1] ?? '')) {
      await main([...argv.slice(0, at + 1), '4', ...argv.slice(at + 1)]);
      return;
    }
    console.error(`canon: ${(error as Error).message}\n\n${HELP}`);
    process.exit(2);
  }

  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || command === undefined || command === 'help') {
    console.log(HELP);
    return;
  }
  await refuseSettings();
  if (!CORE_COMMANDS.has(command)) await runPlugin(command, rest, values);
  if (command === 'log') {
    if (rest.length > 1) {
      console.error(`canon: log takes at most one range\n\n${HELP}`);
      process.exit(2);
    }
    log(rest[0]);
    return;
  }
  if (command === 'rename') {
    if (rest.length !== 2) {
      console.error(`canon: rename takes the id of a unit and its new stem\n\n${HELP}`);
      process.exit(2);
    }
    process.exitCode = await rename(rest[0] as string, rest[1] as string, values['dry-run'] === true);
    return;
  }
  const ids = values.ids === true;
  if (command === 'show') {
    if (rest.length === 0) {
      console.error(`canon: show takes a unit or more\n\n${HELP}`);
      process.exit(2);
    }
    const asked = values.statement === true || values.body === true;
    show(await namesFrom(rest), asked ? { statement: values.statement === true, body: values.body === true } : undefined, ids);
    return;
  }
  if (command === 'find') {
    process.exitCode = find(rest, (values.kind as string[] | undefined) ?? [], typeof values.in === 'string' ? values.in : 'all', ids);
    return;
  }
  if (command !== 'tree' && rest.length > 0) {
    console.error(`canon: unexpected argument "${rest[0]}"\n\n${HELP}`);
    process.exit(2);
  }
  // With no name, tree draws the whole canon; with names, even none read from `-`, only the trees from them.
  const from = command === 'tree' && rest.length > 0 ? await namesFrom(rest) : undefined;

  switch (command) {
    case 'check':
      await check(values.offline === true);
      return;
    case 'generate':
      process.exitCode = await generate();
      return;
    case 'tree': {
      const suspect =
        typeof values.suspect === 'string' ? Number(values.suspect) : undefined;
      if (suspect !== undefined && !Number.isInteger(suspect)) {
        console.error('canon: --suspect takes a whole number');
        process.exit(2);
      }
      if (suspect !== undefined && from !== undefined) {
        console.error('canon: tree takes a unit or --suspect, not both');
        process.exit(2);
      }
      tree({
        gaps: values.gaps === true,
        verbose: values.verbose === true,
        from,
        suspect,
        ids
      });
      return;
    }
    default:
      console.error(`canon: unknown command "${command}"\n\n${HELP}`);
      process.exit(2);
  }
}

await main(process.argv.slice(2));
