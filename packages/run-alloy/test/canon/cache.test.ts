/**
 * The answers that run-alloy keeps from one run for the next: a program asked
 * again unchanged is answered without the analyzer, and a change to what
 * decides its answer asks the analyzer again. A stand-in for Java and the
 * analyzer counts the processes that each run starts.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ask, cacheFolder, sweep, type Program, type Ran } from '../../src/index.ts';
import { fakeAnalyzer, forgetSweeps, INSTANCE } from '../../src/testing.ts';

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'run-alloy-cache-'));
  DIRS.push(dir);
  return dir;
};

const ARGS = ['exec', '-f', '-t', 'text'];
const PROGRAM: Program = { text: 'sig Apple {}\nrun some_apple { some Apple } for 3\n' };

/** What the Alloy plugin reads of a process: the text of the instance the analyzer wrote. */
const instance = ({ out }: Ran): string => readFileSync(join(out, 'some_apple-solution-0.txt'), 'utf8');

describe('a program asked again', () => {
  /**
   * @canon spec-an-unchanged-program-is-answered-without-the-analyzer
   */
  it('is answered without the analyzer when nothing that decides its answer changed', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    expect(await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' })).toBe(INSTANCE);
    expect(await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' })).toBe(INSTANCE);
    expect(analyzer.calls()).toHaveLength(1);
  });

  /**
   * @canon spec-a-changed-program-is-asked-again
   */
  it('is asked of the analyzer again when its text changed', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    await ask(analyzer, { text: PROGRAM.text.replace('for 3', 'for 4') }, ARGS, instance, { folder, form: 'instance' });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-program-whose-files-beside-it-changed-is-asked-again
   */
  it('is asked of the analyzer again when a file beside it changed', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, { ...PROGRAM, beside: { 'util/fruit.als': 'module util/fruit\n' } }, ARGS, instance, { folder, form: 'instance' });
    await ask(analyzer, { ...PROGRAM, beside: { 'util/fruit.als': 'module util/fruit\nsig Pear {}\n' } }, ARGS, instance, { folder, form: 'instance' });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-program-with-another-analyzer-jar-is-asked-again
   */
  it('is asked of the analyzer again when the content of its jar changed, at the same path', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    writeFileSync(analyzer.jar, 'the analyzer, version two, which is longer');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-program-with-other-options-is-asked-again
   */
  it('is asked of the analyzer again with other options of the analyzer', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    await ask(analyzer, PROGRAM, ['exec', '-f', '-t', 'json'], () => 'json', { folder, form: 'instance' });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-program-with-other-options-is-asked-again
   */
  it('is asked of the analyzer again when the caller reads its answer in another form', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, () => 'receipt only', { folder, form: 'receipt' });
    expect(await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' })).toBe(INSTANCE);
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-program-on-another-major-version-of-java-is-asked-again
   */
  it('is asked of the analyzer again on another major version of Java, and not on another Java of the same one', async () => {
    const dir = scratch();
    const java21 = fakeAnalyzer(join(dir, 'bin'), { major: 21 });
    const other21 = fakeAnalyzer(join(dir, 'bin'), { major: 21, name: 'other-java' });
    const java17 = fakeAnalyzer(join(dir, 'bin'), { major: 17, name: 'java17' });
    const folder = join(dir, 'cache');
    await ask(java21, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    await ask(other21, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    expect(other21.calls()).toHaveLength(0);
    await ask(java17, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    expect(java17.calls()).toHaveLength(1);
  });

  /**
   * @canon spec-a-process-that-wrote-no-receipt-keeps-no-answer
   */
  it('is asked of the analyzer again after the analyzer wrote no receipt for it', async () => {
    const dir = scratch();
    const folder = join(dir, 'cache');
    const failing = fakeAnalyzer(join(dir, 'failing'), { fail: true });
    expect(await ask(failing, PROGRAM, ARGS, instance, { folder, form: 'instance' })).toEqual({ error: expect.stringContaining('OutOfMemoryError') });
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    // The same jar and the same major version of Java: only the failure is different.
    const working = fakeAnalyzer(join(dir, 'failing'), { name: 'working-java' });
    await ask(working, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    expect(working.calls()).toHaveLength(1);
  });

  /**
   * @canon spec-a-process-that-exited-with-another-code-than-0-keeps-no-answer
   */
  it('is asked of the analyzer again after a process that wrote a receipt and exited with code 1, whose reading the caller still gets', async () => {
    const dir = scratch();
    const folder = join(dir, 'cache');
    const exiting = fakeAnalyzer(join(dir, 'bin'), { exit: 1 });
    expect(await ask(exiting, PROGRAM, ARGS, instance, { folder, form: 'instance' })).toBe(INSTANCE);
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    await ask(exiting, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    expect(exiting.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-process-the-caller-reads-as-a-failure-keeps-no-answer
   */
  it('is asked of the analyzer again after the caller read its process as a failure', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    expect(await ask(analyzer, PROGRAM, ARGS, () => ({ error: 'no verdict' }), { folder, form: 'verdict' })).toEqual({ error: 'no verdict' });
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    await ask(analyzer, PROGRAM, ARGS, () => ({ error: 'no verdict' }), { folder, form: 'verdict' });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-a-process-whose-reading-throws-keeps-no-answer
   */
  it('is a failure with the message of the error, and is asked again, when reading its process throws', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    const malformed = ({ out }: Ran): unknown => JSON.parse(readFileSync(join(out, 'some_apple-solution-0.txt'), 'utf8'));
    expect(await ask(analyzer, PROGRAM, ARGS, malformed, { folder, form: 'json' })).toEqual({ error: expect.stringContaining('JSON') });
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    await ask(analyzer, PROGRAM, ARGS, malformed, { folder, form: 'json' });
    expect(analyzer.calls()).toHaveLength(2);
  });

  /**
   * @canon spec-an-answer-kept-under-an-earlier-rule-is-not-read
   */
  it('is asked of the analyzer again when its answer was kept before run-alloy required the code 0', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    // The key run-alloy gave a program before it kept only the answers of processes that exited with code 0.
    const jar = createHash('sha256').update(readFileSync(analyzer.jar)).digest('hex');
    const earlier = createHash('sha256')
      .update(JSON.stringify({ program: PROGRAM.text, path: 'model.als', beside: [], jar, options: ['-XX:+UseSerialGC', '-Xmx1g', ...ARGS], form: 'instance', java: 21 }))
      .digest('hex');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${earlier}.json`), JSON.stringify({ answer: 'what a process out of memory left' }));
    expect(await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' })).toBe(INSTANCE);
    expect(analyzer.calls()).toHaveLength(1);
  });
});

describe('the folder of the kept answers', () => {
  /**
   * @canon spec-a-folder-the-project-sets-holds-the-kept-answers
   */
  it('is the folder the project sets, over CANON_ALLOY_CACHE_DIR and the default', () => {
    expect(cacheFolder({ set: '/project/kept', fallback: '/project/.cache' }, { CANON_ALLOY_CACHE_DIR: '/shared' })).toBe('/project/kept');
  });

  /**
   * @canon spec-canon-alloy-cache-dir-holds-the-kept-answers-when-the-project-sets-none
   */
  it('is the folder CANON_ALLOY_CACHE_DIR names when the project sets none, over the default', () => {
    expect(cacheFolder({ fallback: '/project/.cache' }, { CANON_ALLOY_CACHE_DIR: '/shared' })).toBe('/shared');
    expect(cacheFolder({}, { CANON_ALLOY_CACHE_DIR: '/shared' })).toBe('/shared');
  });

  /**
   * @canon spec-the-callers-default-folder-holds-the-kept-answers-when-none-is-named
   */
  it("is the caller's default when nothing else names one, and none without a default", () => {
    expect(cacheFolder({ fallback: '/project/.cache' }, {})).toBe('/project/.cache');
    expect(cacheFolder({ fallback: '/project/.cache' }, { CANON_ALLOY_CACHE_DIR: '' })).toBe('/project/.cache');
    expect(cacheFolder({}, {})).toBeUndefined();
  });

  /**
   * @canon spec-canon-alloy-cache-0-keeps-no-answer-and-reads-none
   */
  it('is none when CANON_ALLOY_CACHE is 0, whatever names one', async () => {
    const env = { CANON_ALLOY_CACHE: '0', CANON_ALLOY_CACHE_DIR: '/shared' };
    expect(cacheFolder({ set: '/project/kept', fallback: '/project/.cache' }, env)).toBeUndefined();
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = cacheFolder({ fallback: join(dir, 'cache') }, env);
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    expect(analyzer.calls()).toHaveLength(2);
    expect(existsSync(join(dir, 'cache'))).toBe(false);
  });
});

describe('a kept answer', () => {
  /** Make each kept answer in `folder` look last used 31 days ago. */
  const age = (folder: string): void => {
    const then = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    for (const name of readdirSync(folder)) utimesSync(join(folder, name), then, then);
  };

  /**
   * @canon spec-a-kept-answer-unused-for-thirty-days-is-removed
   */
  it('is removed by the next sweep once no run used it for thirty days', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    const old = readdirSync(folder);
    age(folder);
    await ask(analyzer, { text: PROGRAM.text.replace('for 3', 'for 4') }, ARGS, instance, { folder, form: 'instance' });
    sweep(folder);
    const now = readdirSync(folder);
    expect(now).toHaveLength(1);
    for (const name of old) expect(now).not.toContain(name);
  });

  /**
   * @canon spec-a-folder-of-kept-answers-is-swept-once-in-a-process
   */
  it('is not removed by a second sweep of its folder in the same process', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    sweep(folder);
    age(folder);
    sweep(join(dir, '.', 'cache'));
    expect(readdirSync(folder)).toHaveLength(1);
    forgetSweeps();
    sweep(folder);
    expect(readdirSync(folder)).toHaveLength(0);
  });

  /**
   * @canon spec-a-kept-answer-that-a-run-uses-is-kept-for-thirty-more-days
   */
  it('that a run uses counts as used then, and stays', async () => {
    const dir = scratch();
    const analyzer = fakeAnalyzer(join(dir, 'bin'));
    const folder = join(dir, 'cache');
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    age(folder);
    await ask(analyzer, PROGRAM, ARGS, instance, { folder, form: 'instance' });
    sweep(folder);
    expect(analyzer.calls()).toHaveLength(1);
    const kept = readdirSync(folder);
    expect(kept).toHaveLength(1);
    for (const name of kept) expect(Date.now() - statSync(join(folder, name)).mtimeMs).toBeLessThan(60_000);
  });
});
