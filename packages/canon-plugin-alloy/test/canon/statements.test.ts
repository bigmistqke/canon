/**
 * What the checker does with the statements of a document's units: which it
 * writes, which it leaves, and what it reports.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { afterEach, describe, expect, it } from 'vitest';
import { regionName, states, write } from '../../src/statements.ts';
import { CLI, install, named } from './cli.ts';

/** The tag of an axiom, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');


const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const READINGS = '```readings\nnoun Node: node\nStarted: {1} has started | {1} has not started\nDone: {1} is done | {1} is not done\n```';

/** A document of one unit with a predicate; its statement is `statement` when given. */
const doc = (predicate = 'always all n: Node | n in Started implies eventually n in Done', statement = '', readings = READINGS): string => `# Canon

## ${AXIOM} a-root

> A root.

\`\`\`alloy vocabulary
sig Node {}
var sig Started, Done in Node {}
fact started { always Done in Started }
\`\`\`

${readings}

### @spec a-leaf

${statement}A node that starts ends up done.

\`\`\`alloy
${predicate}
\`\`\`
`;

const REGION = regionName('spec-a-leaf');

describe('the states of the statements', () => {
  /**
   * @canon spec-a-document-that-keeps-no-readings-is-left-as-it-is
   */
  it('has none for a document that keeps no readings', () => {
    expect(states(doc(undefined, '', ''))).toEqual([]);
    expect(write(doc(undefined, '', '')).written).toEqual([]);
  });

  /**
   * @canon spec-a-unit-with-a-formula-and-no-statement-is-unwritten
   */
  it('calls a unit with a predicate and no statement missing', () => {
    expect(states(doc())).toMatchObject([{ unit: 'spec-a-leaf', kind: 'missing' }]);
  });

  /**
   * @canon spec-generate-writes-the-statement-of-an-unwritten-unit-between-markers
   * @canon spec-a-generated-statement-that-its-formula-would-say-again-is-current
   * @canon spec-generate-leaves-a-current-statement-as-it-is
   */
  it('writes the statement below the heading, between markers, and then finds it current', () => {
    const { src, written } = write(doc());
    expect(written).toEqual(['spec-a-leaf']);
    expect(src).toContain(`### @spec a-leaf\n\n<!-- ${REGION}:begin`);
    expect(src).toContain(`<!-- ${REGION}:end -->\n\nA node that starts ends up done.\n\n\`\`\`alloy`);
    expect(states(src)).toMatchObject([{ kind: 'current' }]);
    expect(write(src)).toEqual({ src, written: [] });
  });

  /**
   * @canon spec-a-generated-statement-that-differs-from-its-formula-is-stale
   * @canon spec-generate-writes-the-statement-of-a-stale-unit-again
   */
  it('finds a statement stale when its predicate changes, and writes it again', () => {
    const { src } = write(doc());
    const changed = src.replace('implies eventually n in Done', 'implies n in Done');
    expect(states(changed)).toMatchObject([{ kind: 'stale' }]);
    const again = write(changed);
    expect(again.written).toEqual(['spec-a-leaf']);
    expect(again.src).toContain('whenever the node has started, the node is done.');
    expect(states(again.src)).toMatchObject([{ kind: 'current' }]);
  });

  /**
   * @canon spec-a-generated-statement-that-differs-from-its-formula-is-stale
   */
  it('overwrites an edit made inside the markers', () => {
    const { src } = write(doc());
    const edited = src.replace('> From now on', '> Sometimes');
    expect(edited).not.toBe(src);
    expect(states(edited)).toMatchObject([{ kind: 'stale' }]);
  });

  /**
   * @canon spec-a-statement-that-a-person-wrote-is-handwritten
   * @canon spec-generate-never-overwrites-a-handwritten-statement
   */
  it('never overwrites a statement that a person wrote', () => {
    const handwritten = doc(undefined, '> A node that has started is done.\n\n');
    expect(states(handwritten)).toMatchObject([{ kind: 'handwritten' }]);
    expect(write(handwritten)).toEqual({ src: handwritten, written: [] });
  });

  /**
   * @canon spec-a-formula-with-a-word-that-has-no-reading-is-unsayable
   * @canon spec-the-report-of-an-unsayable-formula-says-why
   * @canon spec-generate-leaves-an-unsayable-unit-as-it-is
   */
  it('says why a predicate cannot be said, and leaves the document alone', () => {
    const odd = doc('always all n: Node | n in Mystery implies eventually n in Done');
    expect(states(odd)).toMatchObject([{ kind: 'unsayable', message: 'no reading for "Mystery"' }]);
    expect(write(odd).written).toEqual([]);
  });

  /**
   * @canon spec-a-unit-with-two-formulas-is-unsayable
   * @canon spec-the-report-of-an-unsayable-formula-says-why
   */
  it('says why a unit with two predicates cannot be said', () => {
    const one = doc();
    const end = one.lastIndexOf('```\n');
    const two = `${one.slice(0, end)}\`\`\`\n\n\`\`\`alloy\nalways all n: Node | n in Done\n\`\`\`\n`;
    expect(states(two)).toMatchObject([{ kind: 'unsayable', message: expect.stringContaining('more than one predicate') }]);
  });

  /**
   * @canon spec-generate-writes-the-statement-of-an-unwritten-unit-between-markers
   */
  it('writes every missing statement of a document without moving the others', () => {
    const second = '\n### @spec b-leaf\n\n```alloy\nalways all n: Node | n in Done\n```\n';
    const { src, written } = write(doc() + second);
    expect(written.sort()).toEqual(['spec-a-leaf', 'spec-b-leaf']);
    expect(src.indexOf('### @spec a-leaf')).toBeLessThan(src.indexOf(`${regionName('spec-a-leaf')}:begin`));
    expect(src.indexOf(`${regionName('spec-a-leaf')}:end`)).toBeLessThan(src.indexOf('### @spec b-leaf'));
    expect(states(src).map(s => s.kind)).toEqual(['current', 'current']);
  });

  /**
   * @canon spec-generate-writes-a-statement-as-a-quote-that-markdown-reads-as-paragraphs-and-lists
   */
  it('writes a quote that Markdown reads as paragraphs and a bulleted list', () => {
    const { src } = write(doc('always all n: Node | n in Started and n not in Done and n in Started and n not in Done implies eventually n in Done'));
    const quote = src.split('\n').filter(l => l.startsWith('>')).slice(1).join('\n');
    const tree = unified().use(remarkParse).parse(quote) as { children: { type: string; children: { type: string }[] }[] };
    const inner = tree.children[0]?.children.map(n => n.type);
    expect(inner).toEqual(['paragraph', 'paragraph', 'list', 'paragraph']);
  });
});

describe('a statement whose region names no unit', () => {
  /** The document with its statement written, and a region left behind by a unit that went by another name. */
  const orphaned = (): string => {
    const { src } = write(doc());
    return src.replace('### @spec a-leaf\n', `### @spec a-leaf\n\n<!-- ${regionName('spec-a-gone-leaf')}:begin — generated by \`canon generate\`; edits are overwritten -->\n> An old statement.\n<!-- ${regionName('spec-a-gone-leaf')}:end -->\n`);
  };

  /**
   * @canon spec-check-reports-a-statement-whose-region-names-no-unit
   */
  it('is reported, and the region of the unit it sits in is not', () => {
    const found = states(orphaned());
    expect(found).toContainEqual(expect.objectContaining({ unit: 'spec-a-gone-leaf', kind: 'orphaned' }));
    expect(found.find(s => s.unit === 'spec-a-leaf')?.kind).toBe('current');
  });

  /**
   * @canon spec-check-reports-a-statement-whose-region-names-no-unit
   */
  it('is not reported for the region of a scenario', () => {
    const scened = `${write(doc()).src}\n\`\`\`alloy scenario\nsome n: Node | n in Started\n\`\`\`\n`;
    expect(states(write(scened).src).filter(s => s.kind === 'orphaned')).toEqual([]);
  });
});

describe('a word that names a term', () => {
  /** A document whose terms hold the readings: `node` says its stem, and `done` says "finished", which spells no form of it. */
  const TERMS = `# Canon

## ${AXIOM} a-root

> A root.

\`\`\`alloy vocabulary
sig Node {}
var sig Started, Done in Node {}
fact started { always Done in Started }
\`\`\`

\`\`\`readings
Started: {1} has started | {1} has not started
\`\`\`

### @spec a-leaf

A node that starts ends up done.

\`\`\`alloy
always all n: Node | n in Started implies eventually n in Done
\`\`\`

## @term node

> A node is a thing that runs.

\`\`\`readings
noun Node: [node]
\`\`\`

## @term done

> A node is done when it has finished.

\`\`\`readings
Done: {1} is [finished] | {1} is not [finished]
\`\`\`
`;

  /**
   * @canon spec-generate-writes-a-word-of-a-term-of-the-document-as-a-term-mark
   */
  it('is a term mark when it spells a form of a term of the document, and a link when it does not', () => {
    const { src } = write(TERMS);
    const statement = src.split('\n').filter(l => l.startsWith('>')).join('\n');
    expect(statement).toContain('*node*');
    expect(statement).not.toContain('[node](#term-node)');
    expect(statement).toContain('[finished](#term-done)');
  });

  /**
   * @canon spec-generate-writes-a-word-of-a-term-of-the-document-as-a-term-mark
   */
  it('is a term mark when it spells a form that the grammar table of the term holds', () => {
    const listed = TERMS.replace('> A node is done when it has finished.\n', '> A node is done when it has finished.\n\n| grammar | |\n|---|---|\n| type | adjective |\n| also | finished |\n');
    const statement = write(listed).src.split('\n').filter(l => l.startsWith('>')).join('\n');
    expect(statement).toContain('*finished*');
  });
});

describe('the statements of scenarios', () => {
  /** The document with a scenario in its leaf; the scenario says `formula`. */
  const scened = (formula = 'some n: Node | n in Started'): string => `${doc()}\n\`\`\`alloy scenario\n${formula}\n\`\`\`\n`;
  const KEY = 'scenario-1-spec-a-leaf';
  const stateOf = (src: string) => states(src).find(s => s.unit === KEY);

  /**
   * @canon spec-a-scenario-gets-a-statement-that-says-it-must-be-possible
   * @canon spec-the-statement-of-a-scenario-sits-just-above-its-block
   * @canon spec-generate-writes-the-statement-of-a-scenario-that-is-missing-or-stale
   */
  it('writes the statement of a scenario just above its block, as something that must be possible', () => {
    expect(stateOf(scened())).toMatchObject({ kind: 'missing' });
    const { src, written } = write(scened());
    expect(written).toContain(KEY);
    expect(src).toContain(`<!-- ${regionName(KEY)}:end -->\n\n\`\`\`alloy scenario`);
    expect(src).toContain('> It must be possible that:');
    expect(src).toContain('> There is a node that has started.');
    expect(stateOf(src)).toMatchObject({ kind: 'current' });
  });

  /**
   * @canon spec-the-statement-of-a-scenario-is-not-the-statement-of-its-unit
   */
  it('finds a unit whose only quote is the statement of its scenario missing, and writes its statement below the heading', () => {
    const scenarioOnly = write(scened()).src.replace(/<!-- statement-spec-a-leaf:begin[^]*?:end -->\n\n/, '');
    expect(scenarioOnly).toContain('> It must be possible that:');
    expect(states(scenarioOnly).find(s => s.unit === 'spec-a-leaf')).toMatchObject({ kind: 'missing' });
    const { src, written } = write(scenarioOnly);
    expect(written).toEqual(['spec-a-leaf']);
    expect(src).toContain(`### @spec a-leaf\n\n<!-- ${REGION}:begin`);
  });

  /**
   * @canon spec-generate-leaves-the-statement-of-a-scenario-that-is-current-as-it-is
   */
  it('leaves a scenario statement that is current as it is', () => {
    const { src } = write(scened());
    expect(write(src)).toEqual({ src, written: [] });
  });

  /**
   * @canon spec-generate-writes-the-statement-of-a-scenario-that-is-missing-or-stale
   * @canon spec-check-reports-a-statement-of-a-scenario-that-is-not-current
   */
  it('finds a scenario statement stale when its formula changes, and writes it again', () => {
    const { src } = write(scened());
    const changed = src.replace('some n: Node | n in Started', 'some n: Node | n in Done');
    expect(stateOf(changed)).toMatchObject({ kind: 'stale' });
    const again = write(changed);
    expect(again.written).toContain(KEY);
    expect(again.src).toContain('> There is a node that is done.');
  });

  /**
   * @canon spec-check-reports-a-statement-of-a-scenario-that-is-not-current
   */
  it('reports a scenario statement that is missing, in the findings of check', () => {
    const { runs } = project(scened(), ['check']);
    expect(runs[0]?.out).toContain(`CANON.md: ${KEY}: missing:`);
    expect(runs[0]?.code).toBe(1);
  });

  /**
   * @canon spec-check-reports-a-statement-of-a-scenario-that-is-not-current
   * @canon spec-generate-writes-the-statement-of-a-scenario-that-is-missing-or-stale
   */
  it('says why a scenario cannot be said, and leaves the document alone', () => {
    const odd = scened('some n: Node | n in Mystery');
    expect(stateOf(odd)).toMatchObject({ kind: 'unsayable', message: 'no reading for "Mystery"' });
    expect(write(odd).written).not.toContain(KEY);
  });
});

/** A project of one document; runs the command line over it and returns what it printed, its code and the document. */
function project(document: string, ...commands: string[][]) {
  const dir = mkdtempSync(join(tmpdir(), 'canon-statements-'));
  DIRS.push(dir);
  mkdirSync(join(dir, 'test', 'canon'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ canon: { documents: ['CANON.md'], suites: 'test/canon', sources: ['test'], command: 'canon' } }));
  install(dir);
  writeFileSync(join(dir, 'CANON.md'), named(document));
  const runs = commands.map(args => {
    const run = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
    return { out: `${run.stdout}${run.stderr}`, code: run.status };
  });
  return { runs, document: readFileSync(join(dir, 'CANON.md'), 'utf8'), dir };
}

describe('a statement read back', () => {
  /**
   * @canon spec-a-statement-that-does-not-read-back-to-its-formula-is-not-current
   */
  it('is misread where two readings say the same words, and current once they differ', () => {
    const twice = '```readings\nnoun Node: node\nStarted: {1} has started | {1} has not started\nDone: {1} has started | {1} is not done\n```';
    const formula = 'all n: Node | n in Done';
    const written = write(doc(formula, '', twice)).src;
    expect(states(written, [])).toMatchObject([{ unit: 'spec-a-leaf', kind: 'misread' }]);
    expect(states(write(doc(formula)).src, [])).toMatchObject([{ unit: 'spec-a-leaf', kind: 'current' }]);
  });
});

describe('the command line', () => {
  /**
   * @canon spec-generate-writes-the-statement-of-an-unwritten-unit-between-markers
   * @canon spec-check-does-not-report-a-current-statement
   * @canon spec-generate-leaves-a-current-statement-as-it-is
   */
  it('generates the statements, and check then finds them current', () => {
    const { runs, document } = project(doc(), ['generate'], ['check'], ['generate']);
    expect(runs[0]?.out).toContain('wrote the statement of spec-a-leaf in CANON.md');
    expect(runs[0]?.code).toBe(0);
    expect(runs[1]?.out).not.toContain('spec-a-leaf: ');
    expect(runs[2]?.out).not.toContain('wrote the statement');
    expect(document).toContain(`${REGION}:begin`);
  });

  /**
   * @canon spec-check-reports-a-statement-that-is-not-current
   * @canon spec-a-report-of-a-statement-fails-check
   */
  it('reports a statement that is missing or stale as a finding of check, before the summary', () => {
    const { runs } = project(doc(), ['check']);
    expect(runs[0]?.out).toContain('CANON.md: spec-a-leaf: missing:');
    expect(runs[0]?.out.indexOf('missing:')).toBeLessThan(runs[0]?.out.indexOf('finding') ?? 0);
    expect(runs[0]?.code).toBe(1);
  });

  /**
   * @canon spec-generate-fails-on-a-handwritten-statement-and-says-so
   */
  it('stops generate on a statement that a person wrote, and says so', () => {
    const { runs, document } = project(doc(undefined, '> A node that has started is done.\n\n'), ['generate']);
    expect(runs[0]?.out).toContain('spec-a-leaf: handwritten: has a statement of its own');
    expect(runs[0]?.code).toBe(1);
    expect(document).toContain('> A node that has started is done.');
  });

  /**
   * @canon spec-a-document-that-does-not-name-the-plugin-is-left-as-it-is
   */
  it('leaves a document alone that does not name the plugin', () => {
    const { runs, document } = project(`---\nplugins: []\n---\n${doc()}`, ['generate'], ['check']);
    expect(runs[0]?.out).not.toContain('wrote the statement');
    expect(runs[1]?.out).not.toContain('spec-a-leaf: ');
    expect(document).not.toContain(':begin');
  });

  /**
   * @canon spec-the-prose-check-does-not-read-a-generated-statement
   */
  it('is not read by the prose check', () => {
    const long = doc('always all n: Node | n in Started and n not in Done and n in Started and n not in Done implies eventually n in Done');
    const { runs } = project(`---\nplugins: ["@bigmistqke/canon-plugin-alloy", "@bigmistqke/canon-plugin-retext"]\n---\n${long}`, ['generate'], ['lint']);
    expect(runs[1]?.out).not.toContain('sentence-length');
    expect(runs[1]?.code).toBe(0);
  });

  /**
   * @canon spec-generate-fails-on-an-unsayable-formula-and-says-why
   */
  it('stops generate on a formula the readings cannot say, and says why', () => {
    const { runs } = project(doc('always all n: Node | n in Mystery implies eventually n in Done'), ['generate']);
    expect(runs[0]?.out).toContain('spec-a-leaf: unsayable: no reading for "Mystery"');
    expect(runs[0]?.code).toBe(1);
  });
});
