/**
 * The answers that `alloy:logic` keeps from one run for the next: a search
 * asked again unchanged is answered without the analyzer, and a change to what
 * decides its answer asks the analyzer again. A stand-in for Java and the
 * analyzer counts the processes that each run starts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAlloy } from '../../src/alloy.ts';
import { fakeAnalyzer, forgetSweeps, INSTANCE } from '@bigmistqke/run-alloy/testing';
import { CLI, install, NAMES_PLUGIN } from './cli.ts';

/** The tags, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');
const TERM = ['@', 'term'].join('');

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'canon-cache-'));
  DIRS.push(dir);
  return dir;
};

/** A word for apples, a claim about them with `claim` as its formula, and a scenario: the analyzer is asked two searches. */
const doc = (claim = 'all a: Apple | a in Ripe'): string => `# Canon

## ${TERM} apple

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

## ${AXIOM} an-apple-is-ripe

\`\`\`alloy
${claim}
\`\`\`

\`\`\`alloy scenario
some Apple
\`\`\`
`;

/** The name of the scenario's predicate, as `show` gives it. */
const SCENARIO = 'scenario_1_axiom_an_apple_is_ripe';

describe('a search asked again', () => {
  /**
   * @canon spec-an-unchanged-search-is-answered-without-the-analyzer
   */
  it('is answered without the analyzer when nothing that decides its answer changed', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const options = { java: analyzer.java, jar: analyzer.jar, cache: join(dir, 'cache') };
    const first = await checkAlloy(doc(), options);
    expect(analyzer.calls()).toHaveLength(2);
    const second = await checkAlloy(doc(), options);
    expect(analyzer.calls()).toHaveLength(2);
    expect(second).toEqual(first);
  });

  /**
   * @canon spec-a-search-whose-program-changed-is-asked-again
   */
  it('is asked of the analyzer again when its program changed', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const options = { java: analyzer.java, jar: analyzer.jar, cache: join(dir, 'cache') };
    await checkAlloy(doc(), options);
    await checkAlloy(doc('some a: Apple | a in Ripe'), options);
    expect(analyzer.calls()).toHaveLength(4);
  });

  /**
   * @canon spec-a-search-with-other-options-is-asked-again
   */
  it('is asked of the analyzer again when it asks with other options: the world of a shown scenario', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const options = { java: analyzer.java, jar: analyzer.jar, cache: join(dir, 'cache') };
    await checkAlloy(doc(), options);
    await checkAlloy(doc(), { ...options, show: [SCENARIO] });
    // Only the search of the shown scenario asks with other options; the other one keeps its answer.
    expect(analyzer.calls()).toHaveLength(3);
  });

  /**
   * @canon spec-a-kept-answer-of-a-shown-scenario-holds-its-world
   */
  it('keeps the world of a shown scenario, and gives it again without the analyzer', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const options = { java: analyzer.java, jar: analyzer.jar, cache: join(dir, 'cache'), show: [SCENARIO] };
    await checkAlloy(doc(), options);
    const calls = analyzer.calls().length;
    const second = await checkAlloy(doc(), options);
    expect(analyzer.calls()).toHaveLength(calls);
    expect('worlds' in second && second.worlds.map(w => w.trace)).toEqual([INSTANCE]);
  });

});

describe('a kept answer', () => {
  /** Make each kept answer in `cache` look last used 31 days ago. */
  const age = (cache: string): void => {
    const then = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    for (const name of readdirSync(cache)) utimesSync(join(cache, name), then, then);
  };

  /**
   * @canon spec-logic-sweeps-the-kept-answers-after-a-document-it-answered
   */
  it('is removed by the next run once no run used it for thirty days', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const options = { java: analyzer.java, jar: analyzer.jar, cache: join(dir, 'cache') };
    await checkAlloy(doc(), options);
    const old = readdirSync(options.cache);
    age(options.cache);
    // The next run is another process, which sweeps the folder again.
    forgetSweeps();
    await checkAlloy(doc('some a: Apple | a in Ripe'), options);
    const now = readdirSync(options.cache);
    expect(now).toHaveLength(2);
    for (const name of old) expect(now).not.toContain(name);
  });

  /**
   * @canon spec-logic-sweeps-the-kept-answers-after-a-document-the-analyzer-did-not-answer
   */
  it('is removed by a run whose analyzer gave no answer', async () => {
    const dir = scratch();
    const working = fakeAnalyzer(join(dir, 'bin'));
    const cache = join(dir, 'cache');
    await checkAlloy(doc(), { java: working.java, jar: working.jar, cache });
    age(cache);
    forgetSweeps();
    const failing = fakeAnalyzer(join(dir, 'bin'), { fail: true, name: 'failing-java' });
    expect(await checkAlloy(doc('some a: Apple | a in Ripe'), { java: failing.java, jar: failing.jar, cache })).toMatchObject({ ok: false, error: expect.stringContaining('OutOfMemoryError') });
    expect(readdirSync(cache)).toEqual([]);
  });

});

/** A project of the document whose frontmatter adds `settings` to its suite, with the stand-in as its analyzer; `generate` has run over it. */
function project(extra = '') {
  const settings = `suites: test/canon\n${extra}`;
  const dir = scratch();
  const analyzer = fakeAnalyzer(join(dir, 'bin'));
  install(dir);
  writeFileSync(join(dir, 'CANON.md'), NAMES_PLUGIN.replace('\n---\n', `\n${settings}---\n`) + doc());
  spawnSync(process.execPath, [CLI, 'generate'], { cwd: dir });
  const logic = (env: Record<string, string> = {}) => {
    const { CANON_ALLOY_CACHE: _, CANON_ALLOY_CACHE_DIR: __, ...rest } = process.env;
    const run = spawnSync(process.execPath, [CLI, 'alloy:logic'], { cwd: dir, encoding: 'utf8', env: { ...rest, CANON_JAVA: analyzer.java, CANON_ALLOY_JAR: analyzer.jar, ...env } });
    return { out: run.stdout, err: run.stderr, code: run.status };
  };
  return { dir, analyzer, logic };
}

describe('the kept answers of a project', () => {
  /**
   * @canon spec-answers-are-kept-under-the-project-by-default
   */
  it('are kept in .cache/canon-alloy under the root of the project', () => {
    const { dir, analyzer, logic } = project();
    expect(logic()).toMatchObject({ code: 0 });
    expect(readdirSync(join(dir, '.cache', 'canon-alloy'))).toHaveLength(2);
    expect(logic()).toMatchObject({ code: 0 });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-the-cache-setting-names-the-folder-of-the-kept-answers
   */
  it('are kept in the folder that logic.alloy.cache names, also when CANON_ALLOY_CACHE_DIR names another', () => {
    const { dir, logic } = project('logic: {alloy: {cache: kept/answers}}\n');
    expect(logic({ CANON_ALLOY_CACHE_DIR: join(dir, 'shared') })).toMatchObject({ code: 0 });
    expect(existsSync(join(dir, 'shared'))).toBe(false);
    expect(readdirSync(join(dir, 'kept', 'answers'))).toHaveLength(2);
    expect(existsSync(join(dir, '.cache'))).toBe(false);
  });


  /**
   * @canon spec-canon-alloy-cache-dir-holds-the-answers-of-a-project-that-sets-no-folder
   */
  it('are kept in the folder that CANON_ALLOY_CACHE_DIR names when the project sets none', () => {
    const { dir, analyzer, logic } = project();
    const shared = join(dir, 'shared');
    expect(logic({ CANON_ALLOY_CACHE_DIR: shared })).toMatchObject({ code: 0 });
    expect(readdirSync(shared)).toHaveLength(2);
    expect(existsSync(join(dir, '.cache'))).toBe(false);
    expect(logic({ CANON_ALLOY_CACHE_DIR: shared })).toMatchObject({ code: 0 });
    expect(analyzer.calls()).toHaveLength(2);
  });
});
