/**
 * The `logic` command over a small project: what it prints and the code it
 * exits with. It needs an Alloy jar and a Java 17 or later: set CANON_ALLOY_JAR,
 * and CANON_JAVA when `java` is older.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeAnalyzer } from '@bigmistqke/run-alloy/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI, install, named } from './cli.ts';

const AXIOM = ['@', 'axiom'].join('');
const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Two axioms about apples and pears, with `extra` added to the end. */
const doc = (extra = ''): string => `# Canon

## @term apple

\`\`\`alloy bounds
for 3
\`\`\`

\`\`\`alloy vocabulary
sig Apple {}
sig Ripe in Apple {}
\`\`\`

\`\`\`readings
noun Apple: apple
Ripe: {1} is ripe | {1} is not ripe
\`\`\`

## @term pear

\`\`\`alloy vocabulary
sig Pear {}
sig Sweet in Pear {}
\`\`\`

\`\`\`readings
noun Pear: pear
Sweet: {1} is sweet | {1} is not sweet
\`\`\`

## ${AXIOM} an-apple-is-ripe

\`\`\`alloy
all a: Apple | a in Ripe
\`\`\`

## ${AXIOM} a-pear-is-sweet

\`\`\`alloy
all p: Pear | p in Sweet
\`\`\`
${extra}`;

/** A project of the document, whose statements `generate` writes; what `logic` printed and its code, with the analyzer where the environment has it, or without. */
function logic(document: string, withAnalyzer = true, args: string[] = [], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'canon-logic-'));
  DIRS.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ canon: { documents: ['CANON.md'], suites: 'test/canon', sources: ['test'], command: 'canon' } }));
  install(dir);
  writeFileSync(join(dir, 'CANON.md'), named(document));
  spawnSync(process.execPath, [CLI, 'generate'], { cwd: dir });
  const run = spawnSync(process.execPath, [CLI, 'logic', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...(withAnalyzer ? {} : { CANON_ALLOY_JAR: '' }), ...env } });
  return { out: run.stdout, err: run.stderr, code: run.status };
}

describe.skipIf(!process.env.CANON_ALLOY_JAR)('the logic command', () => {
  afterEach(() => new Promise(resolve => setTimeout(resolve, 0)));

  /**
   * @canon spec-logic-succeeds-when-nothing-is-reported
   */
  it('succeeds for a canon whose units hold together, and says how many it checked', { timeout: 600_000 }, () => {
    const { out, code } = logic(doc());
    expect(out).toContain('CANON.md: 2 units, 0 scenarios');
    expect(code).toBe(0);
  });

  /**
   * @canon spec-a-reported-scenario-or-contradiction-fails-logic
   * @canon spec-a-scenario-that-cannot-happen-while-every-unit-holds-is-reported
   */
  it('fails when a scenario cannot happen, and names the unit that holds it and the units to change', { timeout: 600_000 }, () => {
    const { out, code } = logic(doc('\n```alloy scenario\nsome a: Apple | a not in Ripe\n```\n'));
    expect(out).toContain('the scenario of axiom-a-pear-is-sweet cannot happen while every unit holds');
    expect(code).toBe(1);
  });

  /**
   * @canon spec-a-reported-scenario-or-contradiction-fails-logic
   * @canon spec-units-that-cannot-all-hold-are-named
   */
  it('fails when the units contradict each other, and names them', { timeout: 600_000 }, () => {
    const { out, code } = logic(doc('\n## @axiom an-apple-is-unripe\n\n```alloy\nsome a: Apple | a not in Ripe\n```\n'.replace('@axiom', AXIOM)));
    expect(out).toContain('the units contradict each other in every trace within the bounds');
    expect(out).toContain('axiom-an-apple-is-ripe');
    expect(out).toContain('axiom-an-apple-is-unripe');
    expect(out).not.toContain('axiom-a-pear-is-sweet');
    expect(code).toBe(1);
  });
});

describe.skipIf(!process.env.CANON_ALLOY_JAR)('the logic command with --show', () => {
  afterEach(() => new Promise(resolve => setTimeout(resolve, 0)));

  /** The document with a scenario of a ripe apple on the axiom about pears, which can happen. */
  const RIPE = doc('\n```alloy scenario\nsome a: Apple | a in Ripe\n```\n');

  /**
   * @canon spec-show-prints-the-world-of-each-scenario-it-names
   */
  it('prints the world of the named scenario after the report, in its readings', { timeout: 120_000 }, () => {
    const { out, code } = logic(RIPE, true, ['--show', 'scenario-1-axiom-a-pear-is-sweet']);
    expect(out).toContain('CANON.md: 2 units, 1 scenario');
    const world = out.slice(out.indexOf('the world of scenario-1-axiom-a-pear-is-sweet:'));
    expect(world).toMatch(/a is apple_\d/);
    expect(world).toMatch(/throughout:\n\s+apple_\d is ripe/);
    expect(world).toContain('step 0:');
    expect(world).toContain('then back to step 0');
    expect(code).toBe(0);
  });

  /**
   * @canon spec-show-prints-the-world-of-each-scenario-it-names
   */
  it('prints nothing of a world when --show is not given', { timeout: 120_000 }, () => {
    const { out } = logic(RIPE);
    expect(out).not.toContain('the world of');
  });

  /**
   * @canon spec-show-of-a-scenario-that-cannot-happen-prints-no-world
   */
  it('prints no world for a scenario that cannot happen, and reports it', { timeout: 120_000 }, () => {
    const { out, code } = logic(doc('\n```alloy scenario\nsome a: Apple | a not in Ripe\n```\n'), true, ['--show', 'scenario-1-axiom-a-pear-is-sweet']);
    expect(out).toContain('the scenario of axiom-a-pear-is-sweet cannot happen while every unit holds');
    expect(out).not.toContain('the world of');
    expect(code).toBe(1);
  });

  /**
   * @canon spec-show-names-a-scenario-by-its-place-among-the-scenarios-of-its-unit
   */
  it('shows the scenario its name counts in the document, when the scenarios of a unit sit in different groups', { timeout: 120_000 }, () => {
    const two = doc('\n```alloy scenario\nsome a: Apple | a in Ripe\n```\n\n```alloy scenario\nsome p: Pear | p in Sweet\n```\n');
    const { out, code } = logic(two, true, ['--show', 'scenario-2-axiom-a-pear-is-sweet']);
    expect(out.split('the world of ').length - 1).toBe(1);
    expect(out).toContain('the world of scenario-2-axiom-a-pear-is-sweet:');
    expect(out).toMatch(/pear_\d is sweet/);
    expect(out).not.toMatch(/apple_\d is ripe/);
    expect(code).toBe(0);
  });

  /**
   * @canon spec-a-world-the-analyzer-did-not-write-is-reported-and-the-report-stands
   */
  it('says that the analyzer wrote no world, and keeps the report and its code, when the world is missing', { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-java-'));
    DIRS.push(dir);
    const java = join(dir, 'java');
    // A Java that runs the analyzer and then takes away the text of every instance it wrote.
    writeFileSync(java, `#!/bin/sh\n"${process.env.CANON_JAVA ?? 'java'}" "$@"\ncode=$?\nfor a in "$@"; do case "$a" in */out) rm -f "$a"/*-solution-0.txt;; esac; done\nexit $code\n`);
    chmodSync(java, 0o755);
    // No kept answer: one that holds the world would be given without this Java.
    const { out, code } = logic(RIPE, true, ['--show', 'scenario-1-axiom-a-pear-is-sweet'], { CANON_JAVA: java, CANON_ALLOY_CACHE: '0' });
    expect(out).toContain('CANON.md: 2 units, 1 scenario');
    expect(out).toContain('the world of scenario-1-axiom-a-pear-is-sweet: the analyzer wrote none');
    expect(code).toBe(0);
  });

  /**
   * @canon spec-show-of-a-name-that-is-no-scenario-stops-logic
   */
  it('stops with code 2 when --show names a scenario of a document that logic does not check', { timeout: 120_000 }, () => {
    const bare = `# Canon\n\n## ${AXIOM} a-root\n\n\`\`\`alloy vocabulary\nsig Apple {}\n\`\`\`\n\n\`\`\`alloy scenario\nsome Apple\n\`\`\`\n`;
    const { err, code } = logic(bare, true, ['--show', 'scenario-1-axiom-a-root']);
    expect(err).toContain('scenario-1-axiom-a-root');
    expect(code).toBe(2);
  });

  /**
   * @canon spec-show-of-a-name-that-is-no-scenario-stops-logic
   */
  it('stops with code 2 and no report when --show names no scenario', { timeout: 120_000 }, () => {
    const { out, err, code } = logic(RIPE, true, ['--show', 'scenario-2-axiom-a-pear-is-sweet']);
    expect(err).toContain('scenario-2-axiom-a-pear-is-sweet');
    expect(out).not.toContain('CANON.md:');
    expect(code).toBe(2);
  });
});

describe('the logic command without the analyzer', () => {
  /**
   * @canon spec-logic-stops-when-the-analyzer-does-not-start
   */
  it('stops with code 2 and says that the analyzer did not run', () => {
    const { err, code } = logic(doc(), false);
    expect(err).toContain('the Alloy analyzer did not run');
    expect(code).toBe(2);
  });
});

describe('the logic command with an analyzer that leaves a search unsolved', () => {
  /**
   * @canon spec-logic-stops-when-the-analyzer-leaves-a-search-unsolved
   */
  it('stops with code 2, says what the analyzer printed, and keeps nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-unsolved-'));
    DIRS.push(dir);
    const analyzer = fakeAnalyzer(join(dir, 'bin'), { unsolved: true, exit: 1 });
    const cache = join(dir, 'cache');
    const { err, code } = logic(doc(), true, [], { CANON_JAVA: analyzer.java, CANON_ALLOY_JAR: analyzer.jar, CANON_ALLOY_CACHE_DIR: cache, CANON_ALLOY_CACHE: '1' });
    expect(err).toContain('the Alloy analyzer did not run');
    expect(code).toBe(2);
    expect(existsSync(cache) ? readdirSync(cache) : []).toEqual([]);
  });
});
