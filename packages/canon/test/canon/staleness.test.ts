/**
 * What the checker reports when the canon could go out of date unnoticed: a
 * leaf no test checks, a tag that names no unit, and a test whose tags do not
 * say which leaf it checks.
 */
import { describe, expect, it } from 'vitest';
import { canon, check, generated, tagged } from './project.ts';

const LEAF = `
### @spec a-leaf-says-one-thing

> A leaf says one thing.
`;

/** A spec that a nested spec refines, and the nested spec. */
const PARENT = `
### @spec a-parent-says-two-things

> A parent says two things.

#### @spec the-first-thing-holds

> The first thing holds.
`;

describe('an unguarded claim', () => {
  /**
   * @canon spec-an-unguarded-claim-is-untested
   */
  it('reports an untesting for a leaf no test checks', async () => {
    expect((await check(canon(LEAF)))['untested']).toBe(1);
  });

  /**
   * @canon spec-an-unguarded-claim-is-untested
   */
  it('reports an untesting for a leaf only the comment of a declaration in a module of the sources names', async () => {
    const tag = ['@', 'canon'].join('');
    const module = `/** Says one thing. ${tag} spec-a-leaf-says-one-thing */\nexport function say(): void {}\n\n/**\n * ${tag} spec-a-leaf-says-another-thing\n */\ntest('checks another thing', () => {});\n`;
    const files = { 'test/say.ts': module };
    const document = canon(`${LEAF}\n### @spec a-leaf-says-another-thing\n\n> A leaf says another thing.\n`);
    expect((await check(document, '', { files }))['untested']).toBe(1);
  });

  /**
   * @canon spec-an-unguarded-claim-is-untested
   */
  it('reports an untesting for a leaf only a string in a module of the sources names', async () => {
    const tag = ['@', 'canon'].join('');
    const module = `export const example = \`\n/**\n * ${tag} spec-a-leaf-says-one-thing\n */\ntest('checks one thing', () => {});\n\`;\n`;
    const files = { 'test/example.ts': module };
    expect((await check(canon(LEAF), '', { files }))['untested']).toBe(1);
  });
});

describe('a tag', () => {
  /**
   * @canon spec-a-tag-names-a-unit
   */
  it('reports a rotting for a tag that names no unit', async () => {
    expect((await check(canon(LEAF), tagged('spec-a-leaf-says-one-thing') + tagged('spec-a-leaf-says-nothing')))['rot']).toBe(1);
  });
});

describe('a tag outside a test', () => {
  const tag = ['@', 'canon'].join('');

  /**
   * @canon spec-a-tag-in-any-comment-names-a-unit
   */
  it('reports a rotting for a tag in a comment of a suite that names no unit', async () => {
    const tests = `/** ${tag} spec-renamed-away */\ndescribe('a group', () => {\n  // see ${tag} spec-also-gone\n${tagged('spec-a-leaf-says-one-thing')}});\n`;
    expect((await check(canon(LEAF), tests))['rot']).toBe(2);
  });

  /**
   * @canon spec-a-tag-outside-a-test-tests-nothing
   */
  it('reports an untesting for a leaf only a comment of a suite names', async () => {
    const tests = `// covers ${tag} spec-a-leaf-says-one-thing\ndescribe('a group', () => {});\n`;
    expect((await check(canon(LEAF), tests))['untested']).toBe(1);
  });
});

describe('a reference from a source', () => {
  const tag = ['@', 'canon'].join('');
  /** The file name of the document, spelled apart so this file's comments hold no mention of it. */
  const doc = ['CANON', 'md'].join('.');
  const settings = { sources: ['src', 'test'] };
  const TEST = tagged('spec-a-leaf-says-one-thing');

  /**
   * @canon spec-a-link-in-any-comment-names-a-target
   */
  it('reports no finding for a link in a comment of a source that leads to a unit', async () => {
    const files = { 'src/engine/say.ts': `/**\n * Says [one thing](../../${doc}#spec-a-leaf-says-one-thing).\n */\nexport function say(): void {}\n` };
    expect(await check(canon(LEAF), TEST, { files, settings })).toEqual({});
  });

  /**
   * @canon spec-a-link-in-any-comment-names-a-target
   */
  it('reports a rotting for a link in a comment of a source whose fragment names no unit', async () => {
    const files = { 'src/say.ts': `// says [one thing](../${doc}#spec-a-leaf-says-nothing)\nexport function say(): void {}\n` };
    expect((await check(canon(LEAF), TEST, { files, settings }))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-link-in-any-comment-names-a-target
   */
  it('reports a rotting for a link in a comment of a source whose path leads to no file', async () => {
    const files = { 'src/engine/say.ts': `// says [one thing](../${doc}#spec-a-leaf-says-one-thing)\nexport function say(): void {}\n` };
    expect((await check(canon(LEAF), TEST, { files, settings }))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-link-in-any-comment-names-a-target
   */
  it('reads no link in a string of a source', async () => {
    const files = { 'src/say.ts': `export const say = '[one thing](../${doc}#spec-a-leaf-says-nothing)';\n` };
    expect(await check(canon(LEAF), TEST, { files, settings })).toEqual({});
  });

  /**
   * @canon spec-a-bare-mention-of-a-document-is-a-rotting
   */
  it('reports a rotting for a bare mention of the document in a comment, though its unit lives', async () => {
    const files = { 'src/say.ts': `// a tap is reported (${doc}#spec-a-leaf-says-one-thing).\nexport const a = 1; // \`${doc}#spec-a-leaf-says-one-thing\`\n` };
    expect((await check(canon(LEAF), TEST, { files, settings }))['rot']).toBe(2);
  });

  /**
   * @canon spec-a-bare-mention-of-a-document-is-a-rotting
   */
  it('reports a mention that a tag holds once, as a tag that names a file', async () => {
    const files = { 'src/say.ts': `// ${tag} ${doc}#spec-a-leaf-says-one-thing\nexport const a = 1;\n` };
    expect((await check(canon(LEAF), TEST, { files, settings }))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-bare-mention-of-a-document-is-a-rotting
   */
  it('reads no mention of a file that is no canon document', async () => {
    const files = { 'src/say.ts': `// see README.md#install\nexport const a = 1;\n` };
    expect(await check(canon(LEAF), TEST, { files, settings })).toEqual({});
  });

  /**
   * @canon spec-a-comment-makes-no-unit-used
   */
  it('reports an orphaning for a fact that only a tag and a link in a source name', async () => {
    const fact = `\n## @fact a-platform-says-one-thing\n\n> A platform says one thing.\n`;
    const files = { 'src/say.ts': `/**\n * Works around [it](../${doc}#fact-a-platform-says-one-thing).\n *\n * ${tag} fact-a-platform-says-one-thing\n */\nexport function say(): void {}\n` };
    expect(await check(canon(LEAF + fact), TEST, { files, settings })).toEqual({ dead: 1 });
  });
});

describe('an adrift test', () => {
  /**
   * @canon spec-a-declared-test-carries-a-tag
   */
  it('reports an uncitation for a declared test that carries no tag', async () => {
    expect((await check(canon(LEAF), `${tagged('spec-a-leaf-says-one-thing')}it('checks nothing', () => {});\n`))['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-declared-test-carries-a-tag
   */
  it('reports an uncitation for a test that a helper module in the declared directory makes and carries no tag', async () => {
    const files = { 'test/canon/matrix.ts': `export function matrix(rows: string[]): void {\n  for (const row of rows) test(row, () => {});\n}\n` };
    expect((await check(canon(LEAF), tagged('spec-a-leaf-says-one-thing'), { files }))['uncited']).toBe(1);
  });

  /**
   * @canon spec-a-declared-test-checks-only-claims
   */
  it('reports a misaiming for a declared test that checks an axiom', async () => {
    expect((await check(canon(LEAF), tagged('spec-a-leaf-says-one-thing') + tagged('axiom-a-program-means-one-thing')))['missing-spec']).toBe(1);
  });

  /**
   * @canon spec-a-test-checks-only-leaves
   */
  it('reports an overreach for a test that checks a refined spec', async () => {
    expect((await check(canon(PARENT), tagged('spec-the-first-thing-holds') + tagged('spec-a-parent-says-two-things')))['parent-cited']).toBe(1);
  });
});

describe('a pointer', () => {
  const TEST = tagged('spec-a-leaf-says-one-thing');

  /**
   * @canon spec-a-pointer-names-a-target
   */
  it('reports a rotting for a fragment pointer to an id no file holds', async () => {
    expect((await check(canon(`${LEAF}\nSee [the spec](#spec-a-leaf-says-nothing).\n`), TEST))['rot']).toBe(1);
  });

  /**
   * @canon bug-a-file-pointer-is-not-checked
   */
  it.fails('reports a rotting for a file pointer to a file that is gone', async () => {
    expect((await check(canon(`${LEAF}\nSee [the notes](notes.md).\n`), TEST))['rot']).toBe(1);
  });
});

describe('a unit nothing uses', () => {
  /**
   * @canon spec-a-unit-is-used
   */
  it('reports an orphaning for a fact nothing uses', async () => {
    expect((await check(canon(`${LEAF}\n## @fact the-platform-is-one-way\n\n> The platform is one way.\n`), tagged('spec-a-leaf-says-one-thing')))['dead']).toBe(1);
  });

  /**
   * @canon spec-a-unit-is-used
   */
  it('reports no orphaning for a term that only a term mark names', async () => {
    const marked = canon(`${LEAF}\nA bug can have an *outdated tracking*.\n\n## @term outdated-tracking\n\n> An outdated tracking is a finding.\n`);
    expect((await check(marked, tagged('spec-a-leaf-says-one-thing')))['dead']).toBeUndefined();
  });
});

describe('a heading', () => {
  /**
   * @canon spec-a-heading-ends-with-its-id
   */
  it('reports a misanchoring for a heading with a word after its id', async () => {
    expect((await check(canon(LEAF.replace('a-leaf-says-one-thing', 'a-leaf-says-one-thing at length')), tagged('spec-a-leaf-says-one-thing')))['unreachable']).toBe(1);
  });
});

describe('an index', () => {
  const TEST = tagged('spec-a-leaf-says-one-thing');

  /**
   * @canon spec-a-document-holds-an-index
   */
  it('reports a misindexing for a document with units and no index', async () => {
    const bare = canon(LEAF).replace(/<!-- toc:begin[^\n]*\n<!-- toc:end -->\n/, '');
    expect((await check(bare, TEST))['stale-toc']).toBe(1);
  });

  /**
   * @canon spec-an-index-matches-its-document
   */
  it('reports a misindexing for an index generate has not written since a unit changed', async () => {
    expect((await check(canon(LEAF), TEST, { generate: false }))['stale-toc']).toBe(1);
  });

  /**
   * @canon spec-the-index-lists-each-unit-by-its-kind-and-stem-alone
   */
  it('lists each unit by a link to its kind and stem, under the unit it sits in, with no statement', async () => {
    const SPEC = ['@', 'spec'].join('');
    const listed = await generated(canon(`\n#### ${SPEC} a-rule\n\n> when these hold:\n> - a holds\n> - b holds\n>\n> then c holds.\n`));
    const index = /<!-- toc:begin[^\n]*\n([^]*?)<!-- toc:end -->/.exec(listed)?.[1];
    expect(index).toBe('- [`@axiom a-program-means-one-thing`](#axiom-a-program-means-one-thing)\n  - [`@spec a-rule`](#spec-a-rule)\n');
  });
});

describe('a site', () => {
  const SITED = `${LEAF}\nSite: \`queue.ts:drain\`\n`;
  const TEST = tagged('spec-a-leaf-says-one-thing');

  /**
   * @canon spec-a-site-is-held-by-a-source
   */
  it('reports a mislocation for a site whose symbol no source declares', async () => {
    expect((await check(canon(SITED), TEST, { files: { 'test/queue.ts': 'export const flush = (): void => {};\n' } }))['stale-site']).toBe(1);
  });

  /**
   * @canon bug-a-site-named-in-a-comment-is-held
   */
  it.fails('reports a mislocation for a site whose symbol only a comment holds', async () => {
    const source = '// drain is now flush.\nexport const flush = (): void => {};\n';
    expect((await check(canon(SITED), TEST, { files: { 'test/queue.ts': source } }))['stale-site']).toBe(1);
  });
});

describe('a code span', () => {
  /**
   * @canon bug-a-link-in-a-code-span-uses-a-unit
   */
  it.fails('reports an orphaning for a fact that only a code span names', async () => {
    const named = `${LEAF}\nWrite a link as \`[the platform](#fact-the-platform-is-one-way)\`.\n\n## @fact the-platform-is-one-way\n\n> The platform is one way.\n`;
    expect((await check(canon(named), tagged('spec-a-leaf-says-one-thing')))['dead']).toBe(1);
  });
});

describe('a unit that repeats another', () => {
  const TEST = tagged('spec-a-leaf-says-one-thing');

  /**
   * @canon spec-a-unit-is-declared-once
   */
  it('reports a rotting for an id that two documents declare', async () => {
    const other = `# Other\n\n<!-- toc:begin — generated by \`canon generate\`; edits are overwritten -->\n<!-- toc:end -->\n${LEAF}`;
    expect((await check(canon(LEAF), TEST, { files: { 'OTHER.md': other }, documents: ['OTHER.md'] }))['rot']).toBe(1);
  });

  /**
   * @canon bug-a-unit-repeated-in-one-document-is-not-reported
   */
  it.fails('reports a rotting for an id that one document declares twice', async () => {
    expect((await check(canon(`${LEAF}${LEAF}`), TEST))['rot']).toBe(1);
  });
});
