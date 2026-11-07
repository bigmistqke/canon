/**
 * The intent of a unit with a formula, read and written through `alloy:intent`
 * over a small project.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkIntents } from '../../src/intent.ts';
import { CLI, install, named } from './cli.ts';

/** The tag of an axiom, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const INTENT = 'Every node ends up done, so nothing is left half way.\n\nA second paragraph says why.';

const DOC = `# Canon

## ${AXIOM} a-root

> A root.

\`\`\`alloy vocabulary
sig Node {}
sig Done in Node {}
\`\`\`

\`\`\`readings
noun Node: node
Done: {1} is done | {1} is not done
\`\`\`

## ${AXIOM} another-root

> Another root.

### @spec a-leaf

Derives from: [\`axiom-another-root\`](#axiom-another-root)

${INTENT}

\`\`\`alloy
all n: Node | n in Done
\`\`\`

A node must be able to exist.

\`\`\`alloy scenario
some n: Node
\`\`\`

### @spec a-scenario-first

The scenario comes first here.

\`\`\`alloy scenario
some n: Node | n in Done
\`\`\`

\`\`\`alloy
some n: Node | n in Done
\`\`\`

### @spec a-folded-leaf

The fold comes after this.

<details>
<summary>Alloy</summary>

\`\`\`alloy
some n: Node | n in Done
\`\`\`

</details>

### @spec a-bare-leaf

\`\`\`alloy
no n: Node | n not in Done
\`\`\`

### @spec a-plain-leaf

> A plain claim.

This follows because it is plain.
`;

/** A command line with its standard input; `slowly`, the input comes through a pipe from a Node process that writes it after a pause. */
interface Command {
  args: string[];
  input?: string;
  slowly?: boolean;
}

/**
 * Run the checker with `args` in `dir`, at the end of a shell pipeline whose
 * first command is a Node process that writes `input` only after a pause, as
 * another run of the checker does. Node makes its pipes non-blocking, which a
 * reader of standard input has to bear.
 */
function pipedSlowly(dir: string, input: string, args: string[]) {
  const quote = (word: string): string => `'${word.replace(/'/g, `'\\''`)}'`;
  const writer = `const out = process.stdout; setTimeout(() => out.write(${JSON.stringify(input)}), 1500)`;
  const script = `${quote(process.execPath)} -e ${quote(writer)} | ${[process.execPath, CLI, ...args].map(quote).join(' ')}`;
  return spawnSync('sh', ['-c', script], { cwd: dir, encoding: 'utf8' });
}

/** A project of the document, whose statements `generate` writes; it runs the command lines in turn, each with its standard input. */
function projectOf(document: string, ...commands: Command[]) {
  const dir = mkdtempSync(join(tmpdir(), 'canon-intent-'));
  DIRS.push(dir);
  mkdirSync(join(dir, 'test', 'canon'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ canon: { documents: ['CANON.md'], suites: 'test/canon', sources: ['test'], command: 'canon' } }));
  install(dir);
  writeFileSync(join(dir, 'CANON.md'), named(document));
  spawnSync(process.execPath, [CLI, 'generate'], { cwd: dir, encoding: 'utf8' });
  const before = readFileSync(join(dir, 'CANON.md'), 'utf8');
  const runs = commands.map(({ args, input, slowly }) => {
    const run = slowly ? pipedSlowly(dir, input ?? '', args) : spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', input: input ?? '' });
    return { out: run.stdout, err: run.stderr, code: run.status };
  });
  return { runs, before, after: readFileSync(join(dir, 'CANON.md'), 'utf8') };
}

/** A project of the document with every kind of unit the tests need. */
const project = (...commands: Command[]) => projectOf(DOC, ...commands);

/** The line a unit's heading is on, counted from 1. */
const lineOf = (document: string, id: string): number => document.split('\n').indexOf(`### @spec ${id.replace(/^spec-/, '')}`) + 1;

describe('alloy:intent', () => {
  /**
   * @canon spec-intent-heads-each-intent-with-where-its-unit-starts-and-its-id
   */
  it('heads each intent with the document, the line and the id of its unit', () => {
    const { runs, before } = project({ args: ['alloy:intent', 'spec-a-leaf', 'spec-a-bare-leaf'] });
    const [run] = runs;
    expect(run?.code).toBe(0);
    expect(run?.out).toContain(`CANON.md:${lineOf(before, 'spec-a-leaf')}  spec-a-leaf\n`);
    expect(run?.out).toContain(`CANON.md:${lineOf(before, 'spec-a-bare-leaf')}  spec-a-bare-leaf\n`);
  });

  /**
   * @canon spec-intent-prints-the-prose-between-the-statement-and-the-first-fenced-block
   */
  it('prints the prose after the statement and before the first fenced block or generated region', () => {
    const { runs } = project({ args: ['alloy:intent', 'spec-a-leaf'] }, { args: ['alloy:intent', 'spec-a-scenario-first'] });
    expect(runs[0]?.out).toContain(`spec-a-leaf\n\n${INTENT}\n`);
    expect(runs[0]?.out).not.toContain('A node must be able to exist');
    expect(runs[0]?.out).not.toContain('all n: Node');
    expect(runs[1]?.out).toContain('spec-a-scenario-first\n\nThe scenario comes first here.\n');
    expect(runs[1]?.out).not.toContain('It must be possible');
  });

  /**
   * @canon spec-intent-prints-the-prose-between-the-statement-and-the-first-fenced-block
   */
  it('prints the prose before a fold, and reads the formula inside it', () => {
    const { runs } = project({ args: ['alloy:intent', 'spec-a-folded-leaf'] });
    expect(runs[0]?.code).toBe(0);
    expect(runs[0]?.out).toContain('spec-a-folded-leaf\n\nThe fold comes after this.\n');
    expect(runs[0]?.out).not.toContain('<details>');
  });

  /**
   * @canon spec-intent-prints-the-prose-between-the-statement-and-the-first-fenced-block
   */
  it('prints the prose before a reading table that stands outside a fold', () => {
    const tabled = DOC.replace('The fold comes after this.\n', 'The table comes after this.\n\n| reading | holds | does not hold |\n|---|---|---|\n| Done | {1} is done | {1} is not done |\n');
    const { runs } = projectOf(tabled, { args: ['alloy:intent', 'spec-a-folded-leaf'] });
    expect(runs[0]?.out).toContain('spec-a-folded-leaf\n\nThe table comes after this.\n');
    expect(runs[0]?.out).not.toContain('| reading');
  });

  /**
   * @canon spec-a-derives-from-line-before-the-intent-is-no-part-of-it
   */
  it('leaves the derivation line out of the intent', () => {
    const { runs } = project({ args: ['alloy:intent', 'spec-a-leaf'] });
    expect(runs[0]?.out).not.toContain('Derives from:');
  });

  /**
   * @canon spec-intent-of-a-unit-with-no-intent-says-none
   */
  it('says none for a unit with a formula and no intent', () => {
    const { runs } = project({ args: ['alloy:intent', 'spec-a-bare-leaf'] });
    expect(runs[0]?.out).toContain('spec-a-bare-leaf\n\nnone\n');
    expect(runs[0]?.code).toBe(0);
  });

  /**
   * @canon spec-intent-of-a-unit-that-holds-no-formula-is-refused
   */
  it('refuses a unit that holds no formula, to read or to write', () => {
    const { runs, before, after } = project({ args: ['alloy:intent', 'spec-a-plain-leaf'] }, { args: ['alloy:intent', 'spec-a-plain-leaf', '--write'], input: 'A reason.' });
    for (const run of runs) {
      expect(run.err).toContain('spec-a-plain-leaf holds no formula');
      expect(run.code).toBe(2);
    }
    expect(after).toBe(before);
  });

  /**
   * @canon spec-intent-of-a-name-that-names-no-unit-is-refused
   */
  it('refuses a name that names no unit', () => {
    const { runs } = project({ args: ['alloy:intent', 'spec-no-such-leaf'] });
    expect(runs[0]?.err).toContain('no unit "spec-no-such-leaf"');
    expect(runs[0]?.code).toBe(2);
  });

  /**
   * @canon spec-intent-reads-the-ids-of-a-dash-from-standard-input
   */
  it('reads the ids of - from standard input, one on each line, and no unit from a blank line', () => {
    const { runs } = project(
      { args: ['alloy:intent', '-'], input: '\nspec-a-leaf\n  \nspec-a-bare-leaf\n\n' },
      { args: ['alloy:intent', 'spec-a-leaf', 'spec-a-bare-leaf'] },
      { args: ['alloy:intent', '-'], input: '\n' }
    );
    expect(runs[0]?.code).toBe(0);
    expect(runs[0]?.out).toBe(runs[1]?.out);
    expect(runs[2]?.out).toBe('');
    expect(runs[2]?.code).toBe(0);
    // A command earlier in a pipeline can be slow to write, and the prose checks touch standard input as they load.
    const both = `---\nplugins: ["@bigmistqke/canon-plugin-alloy", "@bigmistqke/canon-plugin-retext"]\n---\n${DOC}`;
    const slow = projectOf(both, { args: ['alloy:intent', '-'], input: 'spec-a-leaf\nspec-a-bare-leaf\n', slowly: true }).runs[0];
    expect(slow?.err).toBe('');
    expect(slow?.out).toBe(runs[1]?.out);
  });
});

describe('alloy:intent --write', () => {
  const NEW = 'A new intent, in words of its own.\n\nIt has two paragraphs.';

  /**
   * @canon spec-write-puts-the-text-from-standard-input-in-place-of-the-intent
   */
  it('makes the text on standard input the intent of the unit', () => {
    const { runs } = project({ args: ['alloy:intent', 'spec-a-leaf', '--write'], input: `\n\n${NEW}\n\n` }, { args: ['alloy:intent', 'spec-a-leaf'] });
    expect(runs[0]?.code).toBe(0);
    expect(runs[0]?.out).toContain('spec-a-leaf  wrote its intent');
    expect(runs[1]?.out).toContain(`spec-a-leaf\n\n${NEW}\n`);
    // A command earlier in a pipeline can be slow to write, and the prose checks touch standard input as they load.
    const both = `---\nplugins: ["@bigmistqke/canon-plugin-alloy", "@bigmistqke/canon-plugin-retext"]\n---\n${DOC}`;
    const slow = projectOf(both, { args: ['alloy:intent', 'spec-a-leaf', '--write'], input: NEW, slowly: true }).runs[0];
    expect(slow?.err).toBe('');
    expect(slow?.code).toBe(0);
  });

  /**
   * @canon spec-write-changes-nothing-but-the-intent-of-its-unit
   */
  it('leaves every line outside the intent as it was', () => {
    const { before, after } = project({ args: ['alloy:intent', 'spec-a-leaf', '--write'], input: NEW });
    expect(before).toContain(INTENT);
    expect(after).toBe(before.replace(INTENT, NEW));
  });

  /**
   * @canon spec-write-gives-a-unit-with-no-intent-one-after-its-statement-and-its-derivation-line
   */
  it('puts the intent of a unit that had none after its statement and before its formula', () => {
    const { after, runs } = project({ args: ['alloy:intent', 'spec-a-bare-leaf', '--write'], input: NEW }, { args: ['alloy:intent', 'spec-a-bare-leaf'] });
    expect(after).toContain(`<!-- statement-spec-a-bare-leaf:end -->\n\n${NEW}\n\n\`\`\`alloy\nno n: Node`);
    expect(runs[1]?.out).toContain(`spec-a-bare-leaf\n\n${NEW}\n`);
  });

  /** Write `input` as the intent of `units`; what it said and whether the document changed. */
  const refused = (input: string, ...units: string[]) => {
    const { runs, before, after } = project({ args: ['alloy:intent', ...units, '--write'], input });
    return { err: runs[0]?.err ?? '', code: runs[0]?.code, changed: after !== before };
  };

  /**
   * @canon spec-a-write-of-text-with-a-fold-is-refused
   */
  it('refuses text with a fold', () => {
    const run = refused('Words.\n\n<details>\n<summary>More</summary>\n\nHidden.\n\n</details>\n', 'spec-a-leaf');
    expect(run.err).toContain('fold');
    expect(run.code).toBe(2);
    expect(run.changed).toBe(false);
  });

  /**
   * @canon spec-a-write-of-text-with-a-fold-is-refused
   */
  it('refuses text with the header of a reading table', () => {
    const run = refused('Words.\n\n| reading | holds | does not hold |\n|---|---|---|\n', 'spec-a-leaf');
    expect(run.err).toContain('reading table');
    expect(run.code).toBe(2);
    expect(run.changed).toBe(false);
  });

  /**
   * @canon spec-a-write-of-text-with-a-fenced-block-is-refused
   * @canon spec-a-refused-write-changes-no-file
   */
  it('refuses text with a fenced block', () => {
    const run = refused('Words.\n\n```alloy\nsome Node\n```\n', 'spec-a-leaf');
    expect(run.err).toContain('fenced block');
    expect(run.code).toBe(2);
    expect(run.changed).toBe(false);
  });

  /**
   * @canon spec-a-write-of-text-with-a-heading-is-refused
   * @canon spec-a-refused-write-changes-no-file
   */
  it('refuses text with a heading', () => {
    const run = refused('Words.\n\n#### A heading\n', 'spec-a-leaf');
    expect(run.err).toContain('heading');
    expect(run.code).toBe(2);
    expect(run.changed).toBe(false);
  });

  /**
   * @canon spec-a-write-of-text-with-a-line-the-checker-reads-as-structure-is-refused
   */
  it('refuses text with a quote, a derivation line, a site line or a comment', () => {
    for (const line of ['> A statement.', 'Derives from: [`axiom-a-root`](#axiom-a-root)', 'Site: `a.ts:b`', '<!-- statement-spec-a-leaf:end -->']) {
      const run = refused(`Words.\n${line}\n`, 'spec-a-leaf');
      expect(run.code).toBe(2);
      expect(run.changed).toBe(false);
    }
  });

  /**
   * @canon spec-a-write-of-no-text-is-refused
   */
  it('refuses text that holds only blank space', () => {
    const run = refused('\n  \n', 'spec-a-leaf');
    expect(run.err).toContain('empty');
    expect(run.code).toBe(2);
    expect(run.changed).toBe(false);
  });

  /**
   * @canon spec-a-write-that-names-more-than-one-unit-is-refused
   */
  it('refuses a command line that names two units', () => {
    const run = refused('Words.', 'spec-a-leaf', 'spec-a-bare-leaf');
    expect(run.err).toContain('exactly one unit');
    expect(run.code).toBe(2);
    expect(run.changed).toBe(false);
  });
});

describe('check', () => {
  /**
   * @canon spec-check-reports-a-unit-with-a-formula-and-no-intent
   */
  it('reports a unit with a formula and no intent, in a document that keeps readings', () => {
    const { runs } = project({ args: ['check', '--offline'] });
    expect(runs[0]?.out).toContain('CANON.md: spec-a-bare-leaf: intentless:');
  });

  /**
   * @canon spec-check-does-not-report-a-unit-with-an-intent
   */
  it('does not report a unit with an intent, nor one with no formula', () => {
    const { runs } = project({ args: ['check', '--offline'] });
    expect(runs[0]?.out).not.toContain('spec-a-leaf: intentless');
    expect(runs[0]?.out).not.toContain('spec-a-scenario-first: intentless');
    expect(runs[0]?.out).not.toContain('spec-a-plain-leaf: intentless');
  });

  /**
   * @canon spec-a-document-that-keeps-no-readings-has-no-missing-intent-reported
   */
  it('reports no missing intent in a document that keeps no readings', () => {
    const wordless = DOC.replace(/```readings[^]*?```\n/, '');
    expect(wordless).not.toContain('```readings');
    const { runs } = projectOf(wordless, { args: ['check', '--offline'] });
    expect(runs[0]?.out).not.toContain('intentless');
  });

  /**
   * @canon spec-a-report-of-a-missing-intent-fails-check
   */
  it('fails the plugin part of check, and the run, on a missing intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-intent-'));
    DIRS.push(dir);
    writeFileSync(join(dir, 'CANON.md'), DOC);
    expect(checkIntents(['CANON.md'], dir, () => [])).toBe(1);
    writeFileSync(join(dir, 'CANON.md'), DOC.replace('### @spec a-bare-leaf\n', '### @spec a-bare-leaf\n\nEvery node is done.\n'));
    expect(checkIntents(['CANON.md'], dir, () => [])).toBe(0);
    const { runs } = project({ args: ['check', '--offline'] });
    expect(runs[0]?.code).not.toBe(0);
  });
});
