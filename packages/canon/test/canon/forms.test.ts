/**
 * The forms of a term: the words of its stem, and the spellings its grammar table
 * gives. A term mark names the term whose form its words spell, and the
 * checker reports a form that two terms could go by, and a grammar table it cannot
 * read.
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
   * @canon spec-a-term-mark-names-the-term-whose-listed-form-its-words-spell
   */
  it('lets a term mark that spells it name its term', async () => {
    const found = await check(document('Bugs have *outdated trackings*.', term('outdated-tracking', 'type | noun', 'plural | outdated trackings')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-each-spelling-of-a-grammar-table-is-a-form-of-its-term
   */
  it('names its term for each spelling a row separates by commas', async () => {
    const found = await check(document('An *index* holds *indices* or *indexes*.', term('index', 'type | noun', 'plural | indices, indexes')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-each-spelling-of-a-grammar-table-is-a-form-of-its-term
   */
  it('names its term whatever its role', async () => {
    const found = await check(document('Bugs have a *stale issue*.', term('outdated-tracking', 'type | noun', 'also | stale issue')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-a-term-with-no-grammar-table-has-the-words-of-its-stem-as-its-only-form
   */
  it('is no form of a term that has no grammar table', async () => {
    expect((await check(document('Bugs have *outdated trackings*.', term('outdated-tracking')), TEST))['rot']).toBe(1);
  });
});

describe('a grammar table in a fold', () => {
  /**
   * @canon spec-a-grammar-table-in-a-fold-is-the-grammar-table-of-its-term
   */
  it('gives its term the spellings it lists, as it would outside the fold', async () => {
    const folded = `\n## @term outdated-tracking\n\n> A outdated tracking is a thing.\n\nProse about it.\n\n<details>\n<summary>Grammar</summary>\n\n${grammar('type | noun', 'plural | outdated trackings')}\n\n</details>\n`;
    const found = await check(document('Bugs have *outdated trackings*.', folded), TEST);
    expect(found['rot']).toBeUndefined();
  });
});

describe('a form two terms could go by', () => {
  /**
   * @canon spec-a-stem-wins-over-a-form-of-another-term
   */
  it('lets a term mark that spells a stem name the term of the stem', async () => {
    // `tested` is the stem of term-tested and a form of term-test. When the mark named term-test, term-tested would be an orphaning.
    const found = await check(document('A *test* is *tested*.', term('test', 'type | verb', 'third person | tests', 'past | tested'), term('tested', 'type | adjective')), TEST);
    expect(found['dead']).toBeUndefined();
  });

  /**
   * @canon spec-a-form-that-two-terms-share-names-neither
   */
  it('lets a term mark that spells a form of two terms name neither', async () => {
    // One rotting for the form the two terms share, and one for the mark that spells it.
    const found = await check(
      document('An *analyse* gives an *analysis*, and *analyses* are kept.', term('analyse', 'type | verb', 'third person | analyses'), term('analysis', 'type | noun', 'plural | analyses')),
      TEST
    );
    expect(found['rot']).toBe(2);
  });

  /**
   * @canon spec-a-form-names-one-term
   */
  it('reports a rotting for a form that spells the stem of another term, though no mark spells it', async () => {
    const found = await check(document('A *test* is *tested*.', term('test', 'type | verb', 'past | tested'), term('tested', 'type | adjective')), TEST);
    expect(found['rot']).toBe(1);
  });

  /**
   * @canon spec-a-form-names-one-term
   */
  it('reports no rotting for a form that only its own term goes by', async () => {
    const found = await check(document('A *test* is *tested*.', term('test', 'type | verb', 'third person | tests'), term('tested', 'type | adjective')), TEST);
    expect(found['rot']).toBeUndefined();
  });
});

describe('a grammar table the checker cannot read', () => {
  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports a rotting for a type the checker does not know', async () => {
    expect((await check(document('A *test* holds.', term('test', 'type | nown')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports a rotting for a role that its type does not have', async () => {
    expect((await check(document('A *test* holds.', term('test', 'type | noun', 'plral | tests')), TEST))['rot']).toBe(1);
    expect((await check(document('A *test* holds.', term('test', 'type | adjective', 'plural | tests')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports a rotting for a role it names in two rows', async () => {
    expect((await check(document('A *test* holds.', term('test', 'type | verb', 'past | tested', 'past | trialled')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports one rotting for a table with no row type', async () => {
    expect((await check(document('A *test* holds.', term('test', 'plural | tests')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-grammar-table-names-a-type-and-its-roles
   */
  it('reports no rotting for each role of each type, and for also', async () => {
    const found = await check(
      document(
        'A *test* holds.',
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
    const out = await generated(document('Bugs have *outdated trackings*.', term('outdated-tracking', 'type | noun', 'plural | outdated trackings')));
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
    const dir = await scratch(document('A *test* holds.', term('test', 'type | noun', 'plural | tests')), TEST);
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
    const dir = await scratch(document('Bugs have *outdated trackings*.', term('outdated-tracking', 'type | noun', 'plural | outdated trackings')), TEST);
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
