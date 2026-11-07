/**
 * How many analyzer processes `alloy:logic` runs at once. run-alloy counts them;
 * the processes themselves are a stand-in for the analyzer.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAlloy } from '../../src/alloy.ts';
import { fakeAnalyzer } from '@bigmistqke/run-alloy/testing';

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The tag, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');

/** Three units that share no word, so the analyzer is asked three searches. */
const THREE = ['apple', 'pear', 'plum']
  .map(fruit => `## ${AXIOM} a-${fruit}-exists\n\n\`\`\`alloy\nsome ${fruit[0]?.toUpperCase()}${fruit.slice(1)}\n\`\`\`\n\n\`\`\`alloy vocabulary\nsig ${fruit[0]?.toUpperCase()}${fruit.slice(1)} {}\n\`\`\`\n`)
  .join('\n');

describe('the number of analyzer processes at once', () => {
  /**
   * @canon spec-logic-runs-as-many-searches-at-once-as-run-alloy-allows
   */
  it('keeps the searches to the number CANON_ALLOY_JOBS says', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'canon-jobs-'));
    DIRS.push(dir);
    const analyzer = fakeAnalyzer(dir, { ms: 300 });
    const before = process.env.CANON_ALLOY_JOBS;
    process.env.CANON_ALLOY_JOBS = '1';
    try {
      // No folder of kept answers: each search starts a process.
      const result = await checkAlloy(THREE, { java: analyzer.java, jar: analyzer.jar });
      expect(result).toMatchObject({ ok: true });
    } finally {
      process.env.CANON_ALLOY_JOBS = before;
    }
    expect(analyzer.calls()).toHaveLength(3);
    expect(analyzer.most()).toBe(1);
  });
});
