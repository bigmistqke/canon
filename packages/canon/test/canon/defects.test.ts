/**
 * What the checker reports for a known defect out of sight: a bug or a
 * conflict no open issue tracks, a bug no test checks, a conflict with one
 * side, and a test whose outcome says nothing true about a defect.
 */
import { describe, expect, it } from 'vitest';
import { canon, check, checkTracked, tagged } from './project.ts';

const LEAF = `
### @spec a-leaf-says-one-thing

> A leaf says one thing.
`;

const SECOND = `
### @spec a-leaf-says-another-thing

> A leaf says another thing.
`;

/** A bug under the leaf, with `issue` as its issue line if one is given. */
const BUG = (issue?: string) => `${LEAF}
#### @bug the-leaf-breaks

> The code does another thing.
${issue ? `\nIssue: ${issue}\n` : ''}`;

/** A test marked to fail that checks the bug. */
const PIN = tagged('bug-the-leaf-breaks', 'it.fails');

/** A conflict between the units `between` links to, with `issue` as its issue line if one is given. */
const CONFLICT = (between: string[], issue?: string) => `${LEAF}${SECOND}
## Conflicts

### @conflict the-leaves-disagree

> The two leaves cannot both hold.

Between: ${between.map((id) => `[\`${id}\`](#${id})`).join(', ')}
${issue ? `\nIssue: ${issue}\n` : ''}`;

/** The setting of a tracker, which the check run offline does not ask. */
const TRACKER = { settings: { tracker: { kind: 'github', repo: 'acme/app' } } };

const BOTH = ['spec-a-leaf-says-one-thing', 'spec-a-leaf-says-another-thing'];
const LEAVES = tagged('spec-a-leaf-says-one-thing') + tagged('spec-a-leaf-says-another-thing');

describe('a hidden bug', () => {
  /**
   * @canon spec-a-bug-names-an-issue
   */
  it('reports an untracking for a bug that names no issue', async () => {
    expect((await check(canon(BUG()), PIN, TRACKER))['untracked-bug']).toBe(1);
  });

  /**
   * @canon spec-a-bug-names-an-issue-the-tracker-knows
   */
  it('reports a mistracking for a bug that names an issue the tracker does not know', async () => {
    expect((await checkTracked(canon(BUG('#3')), PIN, {}))['missing-issue']).toBe(1);
  });

  /**
   * @canon spec-a-bug-names-an-open-issue
   */
  it('reports an outdated tracking for a bug that names an issue the tracker has closed', async () => {
    expect((await checkTracked(canon(BUG('#2')), PIN, { 2: 'closed' }))['closed-issue']).toBe(1);
  });

  /**
   * @canon spec-a-bug-is-tested
   */
  it('reports an untesting for a bug no test checks', async () => {
    expect((await check(canon(BUG('#1')), tagged('spec-a-leaf-says-one-thing')))['untested']).toBe(1);
  });
});

describe('a hidden conflict', () => {
  /**
   * @canon spec-a-conflict-names-an-issue
   */
  it('reports an untracking for a conflict that names no issue', async () => {
    expect((await check(canon(CONFLICT(BOTH)), LEAVES, TRACKER))['untracked-conflict']).toBe(1);
  });

  /**
   * @canon spec-a-conflict-names-an-issue-the-tracker-knows
   */
  it('reports a mistracking for a conflict that names an issue the tracker does not know', async () => {
    expect((await checkTracked(canon(CONFLICT(BOTH, '#3')), LEAVES, {}))['missing-issue']).toBe(1);
  });

  /**
   * @canon spec-a-conflict-names-an-open-issue
   */
  it('reports an outdated tracking for a conflict that names an issue the tracker has closed', async () => {
    expect((await checkTracked(canon(CONFLICT(BOTH, '#2')), LEAVES, { 2: 'closed' }))['closed-issue']).toBe(1);
  });

  /**
   * @canon spec-a-conflict-names-two-units
   */
  it('reports an unpairing for a conflict that names one unit', async () => {
    expect((await check(canon(CONFLICT(BOTH.slice(0, 1), '#1')), LEAVES))['lone-conflict']).toBe(1);
  });
});

describe('a misleading test', () => {
  /**
   * @canon spec-an-expected-failure-checks-a-bug-or-an-exception
   */
  it('reports an unexplained failure for an expected failure that checks a spec', async () => {
    expect((await check(canon(LEAF), tagged('spec-a-leaf-says-one-thing', 'it.fails')))['fails-without-bug']).toBe(1);
  });

  /**
   * @canon spec-a-plain-test-does-not-check-a-bug
   */
  it('reports an unpinning for a plain test that checks a bug', async () => {
    expect((await check(canon(BUG('#1')), tagged('bug-the-leaf-breaks')))['unpinned-bug']).toBe(1);
  });
});
