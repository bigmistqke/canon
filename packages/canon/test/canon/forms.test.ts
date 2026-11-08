/**
 * The forms of a term: the words of its stem, and the spellings its grammar table
 * gives. The words of a term mark spell a form of the term its link names, and
 * the checker reports a grammar table it cannot read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canon, check, generated, run, scratch, tagged } from './project.ts';

const LEAF = `
### @spec a-leaf-says-one-thing

> A leaf says one thing.
`;
const TEST = tagged('spec-a-leaf-says-one-thing');

/** A grammar table of `rows`, each a key and a value as `type | noun`, its columns out of line. */
const grammar = (...rows: string[]): string => ['| grammar | |', '|---|---|', ...rows.map(row => `| ${row} |`)].join('\n');

/** A term of the document, with a grammar table of `rows` when there are any. */
const term = (stem: string, ...rows: string[]): string =>
  `\n## @term ${stem}\n\n> A ${stem.replace(/-/g, ' ')} is a thing.\n${rows.length > 0 ? `\n${grammar(...rows)}\n` : ''}`;

/** A document with the leaf, a sentence after it, and `terms`. */
const document = (sentence: string, ...terms: string[]): string => canon(`${LEAF}\n${sentence}\n${terms.join('')}`);

describe('a form a grammar table gives', () => {
  /**
   * @canon spec-each-spelling-of-a-grammar-table-is-a-form-of-its-term
   */
  it('is a spelling a term mark of its term may have', async () => {
    const found = await check(document('Bugs have [*outdated trackings*](#term-outdated-tracking).', term('outdated-tracking', 'type | noun', 'plural | outdated trackings')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-each-spelling-of-a-grammar-table-is-a-form-of-its-term
   */
  it('names its term for each spelling a row separates by commas', async () => {
    const found = await check(document('An [*index*](#term-index) holds [*indices*](#term-index) or [*indexes*](#term-index).', term('index', 'type | noun', 'plural | indices, indexes')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-each-spelling-of-a-grammar-table-is-a-form-of-its-term
   */
  it('names its term whatever its role', async () => {
    const found = await check(document('Bugs have a [*stale issue*](#term-outdated-tracking).', term('outdated-tracking', 'type | noun', 'also | stale issue')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-a-term-with-no-grammar-table-has-the-words-of-its-stem-as-its-only-form
   */
  it('is no form of a term that has no grammar table', async () => {
    expect((await check(document('Bugs have [*outdated trackings*](#term-outdated-tracking).', term('outdated-tracking')), TEST))['rot']).toBe(1);
  });
});

describe('a grammar table in a fold', () => {
  /**
   * @canon spec-a-grammar-table-in-a-fold-is-the-grammar-table-of-its-term
   */
  it('gives its term the spellings it lists, as it would outside the fold', async () => {
    const folded = `\n## @term outdated-tracking\n\n> A outdated tracking is a thing.\n\nProse about it.\n\n<details>\n<summary>Grammar</summary>\n\n${grammar('type | noun', 'plural | outdated trackings')}\n\n</details>\n`;
    const found = await check(document('Bugs have [*outdated trackings*](#term-outdated-tracking).', folded), TEST);
    expect(found['rot']).toBeUndefined();
  });
});

describe('a grammar table the checker cannot read', () => {
  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports a rotting for a type the checker does not know', async () => {
    expect((await check(document('A [*test*](#term-test) holds.', term('test', 'type | nown')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports a rotting for a role that its type does not have', async () => {
    expect((await check(document('A [*test*](#term-test) holds.', term('test', 'type | noun', 'plral | tests')), TEST))['rot']).toBe(1);
    expect((await check(document('A [*test*](#term-test) holds.', term('test', 'type | adjective', 'plural | tests')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports a rotting for a role it names in two rows', async () => {
    expect((await check(document('A [*test*](#term-test) holds.', term('test', 'type | verb', 'past | tested', 'past | trialled')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports one rotting for a table with no row type', async () => {
    expect((await check(document('A [*test*](#term-test) holds.', term('test', 'plural | tests')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports no rotting for each role of each type, and for also', async () => {
    const found = await check(
      document(
        'A [*test*](#term-test) holds.',
        term('test', 'type | verb', 'third person | tests', 'past | tested', 'participle | tested', 'gerund | testing', 'also | trial'),
        term('unit', 'type | noun', 'plural | units'),
        term('used', 'type | adjective'),
        term('checker', 'type | name')
      ),
      TEST
    );
    expect(found['rot']).toBeUndefined();
  });
});

describe('generate', () => {
  /**
   * @canon spec-generate-aligns-the-columns-of-each-grammar-table
   */
  it('pads each cell of a grammar table to the width of its column', async () => {
    const out = await generated(document('Bugs have [*outdated trackings*](#term-outdated-tracking).', term('outdated-tracking', 'type | noun', 'plural | outdated trackings')));
    expect(out).toContain(
      ['| grammar |                    |', '| ------- | ------------------ |', '| type    | noun               |', '| plural  | outdated trackings |'].join('\n')
    );
  });

  /**
   * @canon spec-generate-aligns-the-columns-of-each-grammar-table
   */
  it('leaves a table in a fenced block as it is', async () => {
    const fenced = ['```md', grammar('type | noun'), '```'].join('\n');
    expect(await generated(document(fenced, term('test', 'type | noun')))).toContain(fenced);
  });

  /**
   * @canon spec-generate-aligns-the-columns-of-each-grammar-table
   */
  it('leaves check with nothing to report for a grammar table out of line', async () => {
    const dir = await scratch(document('A [*test*](#term-test) holds.', term('test', 'type | noun', 'plural | tests')), TEST);
    const file = join(dir, 'CANON.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\| grammar \|[^]*?\| tests \|/, grammar('type | noun', 'plural | tests')));
    expect(readFileSync(file, 'utf8')).toContain('|---|---|');
    const { status } = await run(dir, 'check', '--offline');
    expect(status).toBe(0);
  });
});

describe('show of a term', () => {
  /**
   * @canon spec-show-of-a-term-lists-its-forms
   */
  it('lists its forms, the words of its stem first', async () => {
    const dir = await scratch(document('Bugs have [*outdated trackings*](#term-outdated-tracking).', term('outdated-tracking', 'type | noun', 'plural | outdated trackings')), TEST);
    const { stdout, status } = await run(dir, 'show', 'term-outdated-tracking');
    expect(status).toBe(0);
    expect(stdout).toContain('Forms:\n  outdated tracking\n  outdated trackings\n');
  });
});

describe('the package of the checker', () => {
  /**
   * @canon exception-the-checker-reads-the-code-of-a-project-with-a-parser
   */
  it('lists the parser of the code of a project as its only dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(['@sveltejs/acorn-typescript', 'acorn', 'periscopic']);
  });
});
