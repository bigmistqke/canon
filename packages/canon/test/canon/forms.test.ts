/**
 * The forms of a term: the words of its stem, and the spellings its word list
 * gives. A term mark names the term whose form its words spell, and the
 * checker reports a form that two terms could go by, and a word list it cannot
 * read.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canon, check, run, scratch, tagged } from './project.ts';

const LEAF = `
### @spec a-leaf-says-one-thing

> A leaf says one thing.
`;
const TEST = tagged('spec-a-leaf-says-one-thing');

/** A term of the document, with the lines of its word list when it has one. */
const term = (stem: string, ...word: string[]): string =>
  `\n## @term ${stem}\n\n> A ${stem.replace(/-/g, ' ')} is a thing.\n${word.length > 0 ? `\n${word.join('\n')}\n` : ''}`;

/** A document with the leaf, a sentence after it, and `terms`. */
const document = (sentence: string, ...terms: string[]): string => canon(`${LEAF}\n${sentence}\n${terms.join('')}`);

describe('a form a word list gives', () => {
  /**
   * @canon spec-a-term-mark-names-the-term-whose-listed-form-its-words-spell
   */
  it('lets a term mark that spells it name its term', async () => {
    const found = await check(document('Bugs have *outdated trackings*.', term('outdated-tracking', 'Word: noun', '- plural: outdated trackings')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-each-spelling-of-a-word-list-is-a-form-of-its-term
   */
  it('names its term whatever its role', async () => {
    const found = await check(document('Bugs have a *stale issue*.', term('outdated-tracking', 'Word: noun', '- also: stale issue')), TEST);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-a-term-with-no-word-list-has-the-words-of-its-stem-as-its-only-form
   */
  it('is no form of a term that has no word list', async () => {
    expect((await check(document('Bugs have *outdated trackings*.', term('outdated-tracking')), TEST))['rot']).toBe(1);
  });
});

describe('a form two terms could go by', () => {
  /**
   * @canon spec-a-stem-wins-over-a-form-of-another-term
   */
  it('lets a term mark that spells a stem name the term of the stem', async () => {
    // `tested` is the stem of term-tested and a form of term-test. When the mark named term-test, term-tested would be an orphaning.
    const found = await check(document('A *test* is *tested*.', term('test', 'Word: verb', '- third person: tests', '- past: tested'), term('tested', 'Word: adjective')), TEST);
    expect(found['dead']).toBeUndefined();
  });

  /**
   * @canon spec-a-form-that-two-terms-share-names-neither
   */
  it('lets a term mark that spells a form of two terms name neither', async () => {
    // One rotting for the form the two terms share, and one for the mark that spells it.
    const found = await check(
      document('An *analyse* gives an *analysis*, and *analyses* are kept.', term('analyse', 'Word: verb', '- third person: analyses'), term('analysis', 'Word: noun', '- plural: analyses')),
      TEST
    );
    expect(found['rot']).toBe(2);
  });

  /**
   * @canon spec-a-form-names-one-term
   */
  it('reports a rotting for a form that spells the stem of another term, though no mark spells it', async () => {
    const found = await check(document('A *test* is *tested*.', term('test', 'Word: verb', '- past: tested'), term('tested', 'Word: adjective')), TEST);
    expect(found['rot']).toBe(1);
  });

  /**
   * @canon spec-a-form-names-one-term
   */
  it('reports no rotting for a form that only its own term goes by', async () => {
    const found = await check(document('A *test* is *tested*.', term('test', 'Word: verb', '- third person: tests'), term('tested', 'Word: adjective')), TEST);
    expect(found['rot']).toBeUndefined();
  });
});

describe('a word list the checker cannot read', () => {
  /**
   * @canon spec-a-word-list-names-a-part-of-speech-and-its-roles
   */
  it('reports a rotting for a part of speech the checker does not know', async () => {
    expect((await check(document('A *test* holds.', term('test', 'Word: nown')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-word-list-names-a-part-of-speech-and-its-roles
   */
  it('reports a rotting for a role that its part of speech does not have', async () => {
    expect((await check(document('A *test* holds.', term('test', 'Word: noun', '- plral: tests')), TEST))['rot']).toBe(1);
    expect((await check(document('A *test* holds.', term('test', 'Word: adjective', '- plural: tests')), TEST))['rot']).toBe(1);
  });

  /**
   * @canon spec-a-word-list-names-a-part-of-speech-and-its-roles
   */
  it('reports no rotting for each role of each part of speech, and for also', async () => {
    const found = await check(
      document(
        'A *test* holds.',
        term('test', 'Word: verb', '- third person: tests', '- past: tested', '- participle: tested', '- gerund: testing', '- also: trial'),
        term('unit', 'Word: noun', '- plural: units'),
        term('used', 'Word: adjective'),
        term('checker', 'Word: name')
      ),
      TEST
    );
    expect(found['rot']).toBeUndefined();
  });
});

describe('show of a term', () => {
  /**
   * @canon spec-show-of-a-term-lists-its-forms
   */
  it('lists its forms, the words of its stem first', async () => {
    const dir = await scratch(document('Bugs have *outdated trackings*.', term('outdated-tracking', 'Word: noun', '- plural: outdated trackings')), TEST);
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
