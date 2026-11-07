/**
 * How many analyzer processes run-alloy runs at once, and how much memory each
 * may take. The count is worked out from the machine, so most cases give it a
 * machine; the processes themselves are a stand-in for the analyzer.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jobs, run } from '../../src/index.ts';
import { fakeAnalyzer } from '../../src/testing.ts';

const GB = 2 ** 30;
const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'run-alloy-jobs-'));
  DIRS.push(dir);
  return dir;
};

/** Run the program `run <name> {}` on the stand-in, and give whether it answered. */
const runOne = (analyzer: { java: string; jar: string }, name: string) =>
  run(analyzer, { text: `sig A {}\nrun ${name} {}\n` }, ['exec', '-f', '-t', 'text'], () => true);

describe('the number of analyzer processes at once', () => {
  /**
   * @canon spec-the-analyzer-runs-no-more-processes-at-once-than-the-machine-has-processors
   */
  it('is no more than the machine has processors', () => {
    expect(jobs({}, { processors: 2, memory: 64 * GB })).toBe(2);
  });

  /**
   * @canon spec-the-analyzer-runs-no-more-processes-at-once-than-half-the-memory-holds
   */
  it('is no more than half of the memory holds at the heap of each, a gigabyte or the one CANON_ALLOY_HEAP sets', () => {
    expect(jobs({}, { processors: 16, memory: 8 * GB })).toBe(4);
    expect(jobs({}, { processors: 4, memory: 16 * GB })).toBe(4);
    expect(jobs({ CANON_ALLOY_HEAP: '2g' }, { processors: 16, memory: 8 * GB })).toBe(2);
    expect(jobs({ CANON_ALLOY_HEAP: '512m' }, { processors: 16, memory: 8 * GB })).toBe(8);
  });

  /**
   * @canon spec-the-analyzer-runs-at-least-one-process
   */
  it('is one on a machine whose memory holds none', () => {
    expect(jobs({}, { processors: 4, memory: 1 * GB })).toBe(1);
  });

  /**
   * @canon spec-the-analyzer-runs-at-least-one-process
   */
  it('is still one after a process whose folder could not be made', async () => {
    const analyzer = fakeAnalyzer(scratch());
    const before = { jobs: process.env.CANON_ALLOY_JOBS, tmp: process.env.TMPDIR };
    process.env.CANON_ALLOY_JOBS = '1';
    try {
      // `tmpdir()` reads TMPDIR at each call: a folder that does not exist makes the process's own folder fail.
      process.env.TMPDIR = join(scratch(), 'gone');
      await expect(runOne(analyzer, 'a')).rejects.toThrow();
      process.env.TMPDIR = before.tmp;
      if (before.tmp === undefined) delete process.env.TMPDIR;
      expect(await runOne(analyzer, 'b')).toBe(true);
    } finally {
      if (before.jobs === undefined) delete process.env.CANON_ALLOY_JOBS;
      else process.env.CANON_ALLOY_JOBS = before.jobs;
      if (before.tmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before.tmp;
    }
  }, 10_000);

  /**
   * @canon spec-canon-alloy-jobs-sets-how-many-processes-run-at-once
   */
  it('is what CANON_ALLOY_JOBS says, more or fewer than the machine holds', () => {
    expect(jobs({ CANON_ALLOY_JOBS: '12' }, { processors: 2, memory: 4 * GB })).toBe(12);
    expect(jobs({ CANON_ALLOY_JOBS: '1' }, { processors: 16, memory: 64 * GB })).toBe(1);
    expect(jobs({ CANON_ALLOY_JOBS: '0' }, { processors: 2, memory: 64 * GB })).toBe(2);
  });

  /**
   * @canon spec-canon-alloy-jobs-sets-how-many-processes-run-at-once
   */
  it('keeps the processes that a caller starts at once to the number CANON_ALLOY_JOBS says', async () => {
    const analyzer = fakeAnalyzer(scratch(), { ms: 300 });
    const before = process.env.CANON_ALLOY_JOBS;
    process.env.CANON_ALLOY_JOBS = '2';
    try {
      expect(await Promise.all(['a', 'b', 'c', 'd', 'e'].map(name => runOne(analyzer, name)))).toEqual([true, true, true, true, true]);
    } finally {
      if (before === undefined) delete process.env.CANON_ALLOY_JOBS;
      else process.env.CANON_ALLOY_JOBS = before;
    }
    expect(analyzer.calls()).toHaveLength(5);
    expect(analyzer.most()).toBe(2);
  });

  /**
   * @canon spec-each-analyzer-process-takes-a-heap-of-at-most-one-gigabyte
   */
  it('each runs with a heap of at most a gigabyte', async () => {
    const analyzer = fakeAnalyzer(scratch());
    await runOne(analyzer, 'a');
    expect(analyzer.calls()).toHaveLength(1);
    for (const args of analyzer.calls()) expect(args).toContain('-Xmx1g');
  });

  /**
   * @canon spec-canon-alloy-heap-sets-the-heap-of-each-process
   */
  it('each runs with the heap CANON_ALLOY_HEAP sets', async () => {
    const analyzer = fakeAnalyzer(scratch());
    const before = process.env.CANON_ALLOY_HEAP;
    try {
      process.env.CANON_ALLOY_HEAP = '2g';
      await runOne(analyzer, 'a');
      process.env.CANON_ALLOY_HEAP = '1536m';
      await runOne(analyzer, 'b');
    } finally {
      if (before === undefined) delete process.env.CANON_ALLOY_HEAP;
      else process.env.CANON_ALLOY_HEAP = before;
    }
    expect(analyzer.calls().map(args => args.find(a => a.startsWith('-Xmx')))).toEqual(['-Xmx2g', '-Xmx1536m']);
  });
});
