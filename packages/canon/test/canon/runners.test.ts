/**
 * Which calls the checker reads as tests: only a call that a runner of the
 * project declares a test with. A hook, a fixture, a call with no body, a call
 * inside a test, and a call of a name the module declares itself are none.
 */
import { describe, expect, it } from 'vitest';
import { canon, check, tagged } from './project.ts';

const LEAF = `
### @spec a-leaf-says-one-thing

> A leaf says one thing.
`;

/** A declared suite: one tagged test, and `rest` after it. */
const suite = (rest: string): string => `${tagged('spec-a-leaf-says-one-thing')}${rest}`;

describe('a call that declares no test', () => {
  /**
   * @canon spec-a-member-no-runner-names-is-no-test
   */
  it('reports no uncitation for a hook or a fixture', async () => {
    const rest = `test.beforeEach(() => {});\nconst fixtures = test.extend({ page: async ({}, use) => use(1) });\ntest.describe('a group', () => {});\n`;
    expect((await check(canon(LEAF), suite(rest)))['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-a-call-with-no-body-is-no-test
   */
  it('reports no uncitation for a call with no function after its first argument', async () => {
    const rest = `it.todo('later');\ntest.skip(process.env.CI !== undefined, 'not on CI');\n`;
    expect((await check(canon(LEAF), suite(rest)))['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-a-call-inside-a-test-is-no-test
   */
  it('reports no uncitation for a call inside the body of a test', async () => {
    const tag = ['@', 'canon'].join('');
    const tests = `/**\n * ${tag} spec-a-leaf-says-one-thing\n */\nit('checks one thing', () => {\n  it('looks like a test', () => {});\n});\n`;
    expect((await check(canon(LEAF), tests))['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-a-name-the-module-declares-is-no-runner
   */
  it('reports no uncitation for a call of a name the module declares itself', async () => {
    const rest = `function test(label: string, run: () => void): void {}\ntest('a check of its own', () => {});\n`;
    expect((await check(canon(LEAF), suite(rest)))['uncited']).toBeUndefined();
  });
});

describe('the setting runners', () => {
  /**
   * @canon spec-a-runner-set-in-the-settings-replaces-the-presets
   */
  it('reads no test through a runner the project does not list', async () => {
    const rest = `import { test as pw } from '@playwright/test';\npw('a test of playwright', () => {});\n`;
    expect((await check(canon(LEAF), suite(rest), { settings: { runners: ['vitest'] } }))['uncited']).toBeUndefined();
    expect((await check(canon(LEAF), suite(rest), { settings: { runners: ['playwright'] } }))['uncited']).toBe(1);
  });

  /**
   * @canon spec-an-empty-list-of-runners-reads-no-test
   */
  it('reads no call as a test when the list of runners is empty', async () => {
    const tests = `it('an untagged check', () => {});\ntest('another', () => {});\n`;
    expect((await check(canon(LEAF), tests, { settings: { runners: [] } }))['uncited']).toBeUndefined();
    expect((await check(canon(LEAF), tests))['uncited']).toBe(2);
  });

  /**
   * @canon spec-a-runner-written-as-a-map-adds-its-calls
   */
  it('reads a call that a runner written as a map lists as a test, as a global or imported from its package', async () => {
    const rest = `specify('a global check in the style of mocha', () => {});\n`;
    const imported = `import { specify as spec } from 'mocha';\nspec('an imported check', () => {});\n`;
    const map = { calls: ['specify'], modifiers: ['only'], fails: [], from: ['mocha'], globals: true };
    expect((await check(canon(LEAF), suite(rest + imported), { settings: { runners: ['vitest', map] } }))['uncited']).toBe(2);
    expect((await check(canon(LEAF), suite(rest), { settings: { runners: ['vitest', { ...map, globals: false }] } }))['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-a-failure-modifier-of-a-runner-marks-an-expected-failure
   */
  it('reads a test marked with the failure modifier of a runner as an expected failure', async () => {
    const tests = tagged('spec-a-leaf-says-one-thing', 'test.failing');
    expect((await check(canon(LEAF), tests, { settings: { runners: ['jest'] } }))['fails-without-bug']).toBe(1);
  });
});

describe('where the name of a call leads', () => {
  /**
   * @canon spec-a-name-imported-from-no-runner-is-no-runner
   */
  it('reads no test through a name imported from a package of no runner, or a module that marks nothing', async () => {
    const rest = `import { test } from 'some-validator';\nimport { check } from './plain';\ntest('an input', () => {});\ncheck('another input', () => {});\n`;
    const files = { 'test/canon/plain.ts': `export const check = (name: string, fn: () => void) => fn();\n` };
    expect((await check(canon(LEAF), suite(rest), { files }))['uncited']).toBeUndefined();
    expect((await check(canon(LEAF), suite(`import { test } from 'vitest';\ntest('a test', () => {});\n`), { files }))['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-name-imported-from-a-runner-leads-to-its-call
   */
  it('reads a call imported from a package of a runner by its name, as its default export, or through its namespace', async () => {
    const rest = `import test from 'node:test';\nimport * as nt from 'node:test';\nimport pw from '@playwright/test';\ntest('a default import', () => {});\nnt.it.only('a member of a namespace', () => {});\npw('a default import of playwright', () => {});\n`;
    expect((await check(canon(LEAF), suite(rest)))['uncited']).toBe(3);
    const none = `import v from 'vitest';\nimport * as nt from 'node:test';\nv('vitest exports no default', () => {});\nnt.describe('a group', () => {});\nnt('a namespace is no call', () => {});\n`;
    expect((await check(canon(LEAF), suite(none)))['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-a-global-name-is-a-runner-only-where-a-runner-provides-globals
   */
  it('reads a global call as a test only where a runner of the project provides globals', async () => {
    const rest = `test('a global test', () => {});\n`;
    expect((await check(canon(LEAF), suite(rest), { settings: { runners: ['playwright', 'node'] } }))['uncited']).toBeUndefined();
    expect((await check(canon(LEAF), suite(rest), { settings: { runners: ['jest'] } }))['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-call-takes-the-modifiers-of-its-own-runner
   */
  it('reads the modifiers of a call by the runner its name leads to', async () => {
    const settings = { runners: ['vitest', 'playwright'] };
    const vitest = `import { test } from 'vitest';\ntest.fail('no modifier of vitest', () => {});\n`;
    const playwright = `import { test } from '@playwright/test';\ntest.fail('a modifier of playwright', () => {});\n`;
    expect((await check(canon(LEAF), suite(vitest), { settings }))['uncited']).toBeUndefined();
    expect((await check(canon(LEAF), suite(playwright), { settings }))['uncited']).toBe(1);
  });
});

describe('a runner marker', () => {
  const tag = ['@', 'canon'].join('');
  const marker = ['@', 'runner'].join('');

  /** A helper module beside the suites: a wrapper of `it`, and one of `it.fails`. */
  const HELPERS = {
    'test/canon/helpers.ts': `/**\n * ${marker}\n */\nexport const check = (name: string, fn: () => void) => it(name, fn);\n\n/**\n * ${marker} fails\n */\nexport function breaks(name: string, fn: () => void): void {\n  it.fails(name, fn);\n}\n`
  };

  /** The import of the helpers into a suite. */
  const IMPORT = `import { check, breaks } from './helpers';\n`;

  /** A test made by `call`, whose JSDoc names `unit`. */
  const made = (call: string, unit: string): string => `/**\n * ${tag} ${unit}\n */\n${call}('checks ${unit}', () => {});\n`;

  /**
   * @canon spec-a-call-of-a-marked-function-is-a-test
   */
  it('reads a call of a marked function as a test, which credits its tag and owes one', async () => {
    const tests = `${IMPORT}${made('check', 'spec-a-leaf-says-one-thing')}check('checks nothing', () => {});\n`;
    const found = await check(canon(LEAF), tests, { files: HELPERS });
    expect(found['untested']).toBeUndefined();
    expect(found['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-call-of-a-marked-function-is-a-test
   */
  it('follows a renamed import and a re-export to the marked function', async () => {
    const files = { ...HELPERS, 'test/canon/index.ts': `export { check as verify } from './helpers';\nexport * from './helpers';\n` };
    const tests = `import { verify as v, breaks as b } from './index';\n${made('v', 'spec-a-leaf-says-one-thing')}v('checks nothing', () => {});\n`;
    const found = await check(canon(LEAF), tests, { files });
    expect(found['untested']).toBeUndefined();
    expect(found['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-call-of-a-marked-function-is-a-test
   */
  it('follows a namespace import to the marked function', async () => {
    const tests = `import * as h from './helpers';\n${made('h.check', 'spec-a-leaf-says-one-thing')}h.check('checks nothing', () => {});\n`;
    const found = await check(canon(LEAF), tests, { files: HELPERS });
    expect(found['untested']).toBeUndefined();
    expect(found['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-call-of-a-marked-function-is-a-test
   */
  it('reads a call of a marked declaration only where its name leads to it', async () => {
    const tests = `describe('a', () => {\n  /** ${marker} */\n  const confirm = (name: string, fn: () => void) => it(name, fn);\n${made('confirm', 'spec-a-leaf-says-one-thing')}});\ndescribe('b', () => {\n  const confirm = (label: string, run: () => void) => run();\n  confirm('not a test', () => {});\n});\nfunction validate(check: (x: string, f: () => void) => void): void {\n  check('an input', () => {});\n}\n`;
    const found = await check(canon(LEAF), tests, { files: HELPERS });
    expect(found['untested']).toBeUndefined();
    expect(found['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-a-call-of-a-function-marked-fails-is-an-expected-failure
   */
  it('reads a call of a function marked fails as an expected failure', async () => {
    expect((await check(canon(LEAF), IMPORT + made('breaks', 'spec-a-leaf-says-one-thing'), { files: HELPERS }))['fails-without-bug']).toBe(1);
  });

  /**
   * @canon spec-a-call-of-a-marked-function-is-a-test
   */
  it('reads no marker in prose that names it, and reads a marker on one line', async () => {
    const files = {
      'test/canon/helpers.ts': `/** Wraps \`it\`; mark such a helper with \`${marker}\`. */\nexport const plain = (name: string, fn: () => void) => it(name, fn);\n\n/** ${marker} */\nexport const check = (name: string, fn: () => void) => it(name, fn);\n`
    };
    const found = await check(canon(LEAF), IMPORT + made('check', 'spec-a-leaf-says-one-thing'), { files });
    expect(found['untested']).toBeUndefined();
    expect(found['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-call-of-a-marked-function-is-a-test
   */
  it('reads a call of a marked declaration of any value: a default export, an alias, an extended test, a cast, an overload', async () => {
    const files = {
      'test/canon/helpers.ts': `import { test as base } from 'vitest';\n\n/** ${marker} */\nexport default function check(name: string, fn: () => void): void {\n  it(name, fn);\n}\n\n/** ${marker} */\nexport const verify = it;\n\n/** ${marker} */\nexport const fixture = base.extend({ page: async ({}, use) => use(1) });\n\n/** ${marker} */\nexport const cast = ((name: string, fn: () => void) => it(name, fn)) as typeof it;\n\n/** ${marker} */\nexport function overloaded(name: string, fn: () => void): void;\nexport function overloaded(name: string, fn: () => void): void {\n  it(name, fn);\n}\n`
    };
    const calls = ['check', 'verify', 'fixture', 'cast', 'overloaded'];
    const tests = `import check, { verify, fixture, cast, overloaded } from './helpers';\n${calls.map(c => made(c, 'spec-a-leaf-says-one-thing')).join('')}verify('checks nothing', () => {});\n`;
    const found = await check(canon(LEAF), tests, { files });
    expect(found['untested']).toBeUndefined();
    expect(found['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-call-inside-a-marked-function-is-no-test
   */
  it('reports no uncitation for the call of a runner inside a marked function', async () => {
    expect((await check(canon(LEAF), tagged('spec-a-leaf-says-one-thing'), { files: HELPERS }))['uncited']).toBeUndefined();
  });

  /**
   * @canon spec-only-a-relative-import-leads-to-a-marked-declaration
   */
  it('follows no import of a path that an alias maps to a marked declaration', async () => {
    const tests = `import { check } from '@/test/canon/helpers';\n${made('check', 'spec-a-leaf-says-one-thing')}`;
    expect((await check(canon(LEAF), tests, { files: HELPERS }))['untested']).toBe(1);
  });

  /**
   * @canon spec-a-marker-in-an-example-is-no-marker
   */
  it('reads no marker in an example or a fenced block of a JSDoc', async () => {
    const files = {
      'test/canon/helpers.ts': `/**\n * A limit.\n *\n * @example\n * ${marker} fails\n * ${marker} fail\n */\nexport function twice(name: string, fn: () => void): void {}\n\n/**\n * \`\`\`ts\n * ${marker}\n * \`\`\`\n */\nexport const thrice = (name: string, fn: () => void) => fn();\n`
    };
    const tests = `import { twice, thrice } from './helpers';\n${made('twice', 'spec-a-leaf-says-one-thing')}${made('thrice', 'spec-a-leaf-says-one-thing')}`;
    const found = await check(canon(LEAF), tests, { files });
    expect(found['untested']).toBe(1);
    expect(found['fails-without-bug']).toBeUndefined();
  });
});
