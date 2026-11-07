/**
 * The readings of the documents, listed and reworded through
 * `alloy:readings` over a small project.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI, install, named } from './cli.ts';

/** The tag of an axiom, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DONE = 'Done: {1} is done | {1} is not done';

/** A document whose term `node` keeps readings, and whose second term repeats a key when `twice` is set. */
const doc = (twice = false): string => `# Canon

## Terms

### @term node

> A node is a thing.

\`\`\`alloy vocabulary
sig Node {}
sig Done, Started in Node {}
\`\`\`

\`\`\`readings
noun Node: [node]
${DONE}
Started: {1} has started | {1} has not started
\`\`\`

### @term other

> Another thing.

\`\`\`readings
${twice ? 'Done: {1} is over | {1} is not over' : 'Started: {1} began | {1} did not begin'}
\`\`\`

## ${AXIOM} a-root

> A root.

### @spec a-leaf

Every node ends up done.

\`\`\`alloy
all n: Node | n in Done
\`\`\`

### @spec a-started-leaf

Every node starts.

\`\`\`alloy
all n: Node | n in Started
\`\`\`
`;

/** A project of the document, whose statements `generate` writes; it runs the command lines in turn. */
function project(document: string, ...commands: string[][]) {
  const dir = mkdtempSync(join(tmpdir(), 'canon-readings-'));
  DIRS.push(dir);
  mkdirSync(join(dir, 'test', 'canon'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ canon: { documents: ['CANON.md'], suites: 'test/canon', sources: ['test'], command: 'canon' } }));
  install(dir);
  writeFileSync(join(dir, 'CANON.md'), named(document));
  spawnSync(process.execPath, [CLI, 'generate'], { cwd: dir, encoding: 'utf8' });
  const before = readFileSync(join(dir, 'CANON.md'), 'utf8');
  const runs = commands.map(args => {
    const run = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
    return { out: run.stdout, err: run.stderr, code: run.status };
  });
  return { runs, before, after: readFileSync(join(dir, 'CANON.md'), 'utf8') };
}

/** The line of the document that holds `text`, counted from 1. */
const lineOf = (document: string, text: string): number => document.split('\n').indexOf(text) + 1;

describe('alloy:readings', () => {
  /**
   * @canon spec-a-line-of-readings-holds-the-place-the-unit-the-key-and-the-words-of-a-reading
   */
  it('prints each reading with its place, its unit, its key and its words', () => {
    const { runs, before } = project(doc(), ['alloy:readings']);
    expect(runs[0]?.code).toBe(0);
    expect(runs[0]?.out).toContain(`CANON.md:${lineOf(before, DONE)}  term-node  ${DONE}\n`);
    expect(runs[0]?.out).toContain('  term-other  Started: {1} began | {1} did not begin\n');
  });

  /**
   * @canon spec-a-noun-line-is-no-reading
   */
  it('lists no noun line', () => {
    const { runs } = project(doc(), ['alloy:readings']);
    expect(runs[0]?.out).not.toContain('noun');
    expect(runs[0]?.out.trim().split('\n')).toHaveLength(3);
  });
});

/** The document with the readings of its term `node` in tables, written out of line. */
const tabled = (): string =>
  doc().replace(
    `\`\`\`readings\nnoun Node: [node]\n${DONE}\nStarted: {1} has started | {1} has not started\n\`\`\``,
    '| reading | holds | does not hold |\n|---|---|---|\n| Done | {1} is done | {1} is not done |\n| Started | {1} has started | {1} has not started |'
  );

describe('a reading table', () => {
  /**
   * @canon spec-generate-aligns-the-columns-of-each-reading-table-and-noun-table
   */
  it('has its columns lined up by generate', () => {
    const { before } = project(tabled());
    expect(before).toContain(
      [
        '| reading | holds           | does not hold       |',
        '| ------- | --------------- | ------------------- |',
        '| Done    | {1} is done     | {1} is not done     |',
        '| Started | {1} has started | {1} has not started |'
      ].join('\n')
    );
  });

  /**
   * @canon spec-a-line-of-readings-holds-the-place-the-unit-the-key-and-the-words-of-a-reading
   */
  it('lists each of its rows as a reading, at the line of the row', () => {
    const { runs, before } = project(tabled(), ['alloy:readings']);
    const line = before.split('\n').findIndex(l => l.startsWith('| Done ')) + 1;
    expect(runs[0]?.out).toContain(`CANON.md:${line}  term-node  ${DONE}\n`);
  });

  /**
   * @canon spec-a-reword-changes-only-the-line-of-its-reading
   */
  it('has the row of a reading reworded, and no other line', () => {
    const { runs, before, after } = project(tabled(), ['alloy:readings', 'Done', '--write', '{1} has finished | {1} has not finished']);
    expect(runs[0]?.code).toBe(0);
    const row = before.split('\n').find(l => l.startsWith('| Done ')) as string;
    expect(after).toBe(before.replace(row, '| Done | {1} has finished | {1} has not finished |'));
  });
});

describe('alloy:readings --write', () => {
  const NEW = '{1} has finished | {1} has not finished';

  /**
   * @canon spec-a-reword-changes-only-the-line-of-its-reading
   */
  it('changes the line of the reading and no other line', () => {
    const { runs, before, after } = project(doc(), ['alloy:readings', 'Done', '--write', NEW]);
    expect(runs[0]?.code).toBe(0);
    expect(after).toBe(before.replace(DONE, `Done: ${NEW}`));
  });

  /**
   * @canon spec-a-reword-names-the-statements-that-are-stale-until-generate
   */
  it('says that the statements that use the reading are stale until generate, and names them', () => {
    const { runs } = project(doc(), ['alloy:readings', 'Done', '--write', NEW], ['generate']);
    expect(runs[0]?.out).toContain('stale until `canon generate`');
    expect(runs[0]?.out).toContain('CANON.md: spec-a-leaf: stale until `canon generate`');
    expect(runs[0]?.out).not.toContain('spec-a-started-leaf');
    expect(runs[1]?.out).toContain('wrote the statement of spec-a-leaf');
  });

  /**
   * @canon spec-a-reword-of-a-key-that-names-no-reading-is-refused
   */
  it('refuses a key that names no reading, and changes nothing', () => {
    const { runs, before, after } = project(doc(), ['alloy:readings', 'Ended', '--write', NEW]);
    expect(runs[0]?.err).toContain('no reading of the documents has the key "Ended"');
    expect(runs[0]?.code).toBe(2);
    expect(after).toBe(before);
  });

  /**
   * @canon spec-a-reword-of-a-key-that-names-more-than-one-reading-is-refused
   */
  it('refuses a key that two readings have, names both, and changes nothing', () => {
    const { runs, before, after } = project(doc(true), ['alloy:readings', 'Done', '--write', NEW]);
    expect(runs[0]?.err).toContain('2 readings have the key "Done"');
    expect(runs[0]?.err).toContain('term-node  Done:');
    expect(runs[0]?.err).toContain('term-other  Done:');
    expect(runs[0]?.code).toBe(2);
    expect(after).toBe(before);
  });

  /**
   * @canon spec-a-reword-that-is-not-two-sides-is-refused
   */
  it('refuses new words that are not two sides parted by one bar', () => {
    for (const words of ['{1} has finished', '{1} a | {1} b | {1} c', ' | {1} has not finished', '{1} has finished | ']) {
      const { runs, before, after } = project(doc(), ['alloy:readings', 'Done', '--write', words]);
      expect(runs[0]?.err).toContain('two sides parted by one bar');
      expect(runs[0]?.code).toBe(2);
      expect(after).toBe(before);
    }
  });
});
