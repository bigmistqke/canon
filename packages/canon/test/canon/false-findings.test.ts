/**
 * What the checker does not report: a finding for what breaks no rule of the
 * canon, such as an untesting for a claim that a test checks.
 */
import { describe, expect, it } from 'vitest';
import { canon, check, checkTracked, tagged } from './project.ts';

const LEAF = `
### @spec a-leaf-says-one-thing

> A leaf says one thing.
`;

/** The leaf, and a bug under it. */
const BUG = `${LEAF}
#### @bug the-leaf-breaks

> The code does another thing.

Issue: #1
`;

/** The leaf, a second leaf, a bug under the first and a conflict between them, neither with an issue line. */
const UNTRACKED = `${LEAF}
#### @bug the-leaf-breaks

> The code does another thing.

### @spec a-leaf-says-another-thing

> A leaf says another thing.

## Conflicts

### @conflict the-leaves-disagree

> The two leaves cannot both hold.

Between: [\`spec-a-leaf-says-one-thing\`](#spec-a-leaf-says-one-thing), [\`spec-a-leaf-says-another-thing\`](#spec-a-leaf-says-another-thing)
`;

/** A module that builds one test per case of a table, the way a suite of cases is written, and tags the test it builds. */
const MATRIX = `export function matrix(cases: string[]): void {
  for (const name of cases) {
    /**
     * ${['@', 'canon'].join('')} spec-a-leaf-says-one-thing
     */
    test(\`checks \${name}\`, () => {});
  }
}
`;

describe('a tested claim', () => {
  /**
   * @canon spec-a-claim-a-declared-test-checks-is-not-untested
   */
  it('reports no untesting for a leaf a declared test checks', async () => {
    expect((await check(canon(LEAF), tagged('spec-a-leaf-says-one-thing')))['untested']).toBeUndefined();
  });

  /**
   * @canon spec-a-claim-an-undeclared-test-checks-is-not-untested
   */
  it('reports no untesting for a leaf a test in an undeclared suite checks', async () => {
    const files = { 'test/other/a.test.ts': tagged('spec-a-leaf-says-one-thing') };
    expect((await check(canon(LEAF), '', { files }))['untested']).toBeUndefined();
  });

  /**
   * @canon spec-a-claim-an-undeclared-test-checks-is-not-untested
   */
  it('reports no untesting for a leaf a test that a module of the sources builds checks', async () => {
    const files = { 'test/matrix.ts': MATRIX };
    expect((await check(canon(LEAF), '', { files }))['untested']).toBeUndefined();
  });

  /**
   * @canon spec-a-claim-an-undeclared-test-checks-is-not-untested
   */
  it('reports no untesting for a leaf a test that a module builds checks, when the title of the test is no literal', async () => {
    const files = { 'test/matrix.ts': MATRIX.replace('`checks ${name}`', 'name') };
    expect((await check(canon(LEAF), '', { files }))['untested']).toBeUndefined();
  });

  /**
   * @canon spec-a-spec-whose-bug-a-test-checks-is-not-untested
   */
  it('reports no untesting for a spec whose bug a test checks', async () => {
    expect((await check(canon(BUG), tagged('bug-the-leaf-breaks', 'it.fails')))['untested']).toBeUndefined();
  });
});

describe('a project with no tracker', () => {
  /**
   * @canon spec-a-project-with-no-tracker-reports-no-untracking
   */
  it('reports no untracking for a bug or a conflict that names no issue', async () => {
    const tests = tagged('bug-the-leaf-breaks', 'it.fails') + tagged('spec-a-leaf-says-another-thing');
    const found = await check(canon(UNTRACKED), tests);
    expect(found['untracked-bug']).toBeUndefined();
    expect(found['untracked-conflict']).toBeUndefined();
  });
});

/** A thread, with `issue` as its issue line if one is given. */
const THREAD = (issue?: string): string => `
## Open Threads

### @thread the-leaf-may-say-more

> Whether a leaf says more is open.
${issue === undefined ? '' : `\nIssue: ${issue}\n`}`;

describe('a thread', () => {
  /**
   * @canon spec-a-thread-that-names-no-issue-is-not-untracked
   */
  it('reports no untracking for a thread that names no issue in a project with a tracker', async () => {
    const found = await check(canon(THREAD()), '', { settings: { tracker: { kind: 'github', repo: 'acme/app' } } });
    expect(Object.keys(found).filter(key => key.startsWith('untracked'))).toEqual([]);
  });

  /**
   * @canon spec-a-thread-that-names-an-issue-is-not-held-to-the-tracker
   */
  it('asks the tracker nothing about the issues a thread names', async () => {
    const found = await checkTracked(canon(THREAD('#2, #3')), '', { 2: 'closed' });
    expect(found['missing-issue']).toBeUndefined();
    expect(found['closed-issue']).toBeUndefined();
    expect(found['unreachable-tracker']).toBeUndefined();
  });

  /**
   * @canon spec-a-thread-nothing-uses-is-not-orphaned
   */
  it('reports no orphaning for a thread that nothing links to', async () => {
    const found = await check(canon(`${LEAF}${THREAD()}`), tagged('spec-a-leaf-says-one-thing'));
    expect(found['dead']).toBeUndefined();
  });
});

describe('a project with no runner', () => {
  /**
   * @canon spec-a-project-with-no-runner-reports-no-untesting
   */
  it('reports no untesting for a leaf or a bug that no test checks', async () => {
    expect((await check(canon(BUG), '', { settings: { runners: [] } }))['untested']).toBeUndefined();
    expect((await check(canon(BUG), ''))['untested']).toBe(2);
  });
});

describe('emphasis that is no term mark', () => {
  const TEST = tagged('spec-a-leaf-says-one-thing');
  /** The leaf with a sentence after it, in a document that declares no term. */
  const emphasised = (sentence: string): string => canon(`${LEAF}\n${sentence}\n`);

  /**
   * @canon spec-text-between-underscores-is-no-term-mark
   */
  it('reports no rotting for text between underscores', async () => {
    expect((await check(emphasised('For every _unit_ and every unit_1, it holds.'), TEST))['rot']).toBeUndefined();
  });

  /**
   * @canon spec-text-between-double-asterisks-is-no-term-mark
   */
  it('reports no rotting for text between double asterisks', async () => {
    expect((await check(emphasised('This **never** holds.'), TEST))['rot']).toBeUndefined();
  });

  /**
   * @canon spec-asterisks-in-code-make-no-term-mark
   */
  it('reports no rotting for asterisks in a code span or a fenced block', async () => {
    const code = 'Write `*tracker*` to mark it.\n\n```ts\nconst glob = "*any*";\n```';
    expect((await check(emphasised(code), TEST))['rot']).toBeUndefined();
  });
});
