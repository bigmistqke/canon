/**
 * The reading tables and noun tables of a document, and the noun a signature
 * takes from the term that declares it.
 */
import { describe, expect, it } from 'vitest';
import { checkDefinedWords } from '../../src/defined.ts';
import { states, write } from '../../src/statements.ts';

/** The tag of an axiom, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');

/** A document whose term `term` declares `sig Node` and keeps `readings`, with a leaf that says every node is done. */
const doc = (readings: string, term = 'node'): string => `# Canon

## Terms

### @term ${term}

> A ${term} is a thing.

\`\`\`alloy vocabulary
sig Node {}
sig Done in Node {}
\`\`\`

${readings}

## ${AXIOM} a-root

> A root.

### @spec a-leaf

Every node ends up done.

\`\`\`alloy
all n: Node | n in Done
\`\`\`
`;

/** The statement that generate writes for the leaf. */
const statementOf = (src: string): string =>
  write(src)
    .src.split('\n')
    .filter(line => line.startsWith('>') && !line.startsWith('> A '))
    .join('\n');

const FENCE = '```readings\nnoun Node: [node]\nDone: {1} is done | {1} is not done\n```';
const READING_TABLE = '| reading | holds | does not hold |\n|---|---|---|\n| Done | {1} is done | {1} is not done |';

describe('a reading table', () => {
  /**
   * @canon spec-a-row-of-a-reading-table-is-a-reading
   */
  it('says a statement as the readings fence of the same lines does', () => {
    const tabled = statementOf(doc(`| signature | noun |\n|---|---|\n| Node | [node] |\n\n${READING_TABLE}`));
    expect(tabled).toContain('is done');
    expect(tabled).toBe(statementOf(doc(FENCE)));
  });
});

describe('a noun table', () => {
  /**
   * @canon spec-a-row-of-a-noun-table-gives-the-noun-of-its-signature
   */
  it('gives its signature the noun of its row, linked to the term that holds the row', () => {
    const statement = statementOf(doc(`| signature | noun |\n|---|---|\n| Node | vertex |\n\n${READING_TABLE}`));
    // "vertex" is no form of the term node, so it links as a plain link rather than a term mark.
    expect(statement).toContain('[vertex](#term-node)');
    expect(statement).not.toMatch(/\bnode\b(?!\))/);
  });
});

describe('a verb term', () => {
  /**
   * @canon spec-a-verb-term-gives-the-forms-of-a-verb-that-links-to-it
   */
  it('gives a verb that a reading marks and links to it the forms its negative takes', () => {
    const term = '### @term tend\n\n> To tend a thing is to look after it.\n\n| grammar | |\n|---|---|\n| type | verb |\n| third person | tends |\n| participle | tended |\n\n';
    const marked = '| reading | holds | does not hold |\n|---|---|---|\n| Done | {1} ^[tends](#term-tend)^ readings | |';
    const src = doc(marked).replace('## Terms\n\n', `## Terms\n\n${term}`).replace('all n: Node | n in Done', 'all n: Node | n not in Done');
    const statement = statementOf(src);
    expect(statement).toContain('does not');
    expect(statement).toContain('[*tend*](#term-tend) readings');
  });
});

describe('a signature named after the term that declares it', () => {
  /**
   * @canon spec-a-signature-named-after-the-term-that-declares-it-has-the-term-as-its-noun
   */
  it('has the term as its noun, linked as a noun in brackets would be', () => {
    const inferred = statementOf(doc(READING_TABLE));
    expect(inferred).toContain('*node*');
    expect(inferred).toBe(statementOf(doc(FENCE)));
  });

  /**
   * @canon spec-a-signature-named-after-the-term-that-declares-it-has-the-term-as-its-noun
   */
  it('gives no noun to a signature whose name does not spell the stem of its term', () => {
    const state = states(doc(READING_TABLE, 'vertex')).find(s => s.unit === 'spec-a-leaf');
    expect(state?.kind).toBe('unsayable');
    expect(state?.message).toContain('noun');
  });

  /**
   * @canon spec-a-signature-named-after-the-term-that-declares-it-has-the-term-as-its-noun
   */
  it('keeps the noun that a noun table gives', () => {
    expect(statementOf(doc(`| signature | noun |\n|---|---|\n| Node | [vertex] |\n\n${READING_TABLE}`))).toContain('vertex');
  });
});

describe('a word that a reading links', () => {
  const reading = (row: string): string => doc(`| reading | holds | does not hold |\n|---|---|---|\n${row}`);

  /**
   * @canon spec-check-reports-a-linked-word-that-no-form-of-its-term-spells
   */
  it('is reported when no form of the term it links to spells it', () => {
    const found = checkDefinedWords(reading('| Done | {1} is a [finished thing] | {1} is not a [finished thing] |'));
    expect(found.map(f => [f.unit, f.kind])).toEqual([
      ['term-node', 'undefined'],
      ['term-node', 'undefined']
    ]);
    expect(found[0]?.message).toContain('"finished thing" links to #term-node');
  });

  /**
   * @canon spec-check-reports-a-linked-word-that-no-form-of-its-term-spells
   */
  it('is not reported when it spells a form of its term, or of the term its link names', () => {
    expect(checkDefinedWords(reading('| Done | {1} is a [node] that is done | {1} is a [node] that is not done |'))).toEqual([]);
    const linked = `${reading('| Done | {1} is a [root](#axiom-a-root) | {1} is no [node] |')}`;
    expect(checkDefinedWords(linked).map(f => f.message)).toEqual(['"root" links to #axiom-a-root, which is no term']);
  });

  /**
   * @canon spec-check-reports-a-linked-word-that-no-form-of-its-term-spells
   */
  it('does not look at a noun', () => {
    expect(checkDefinedWords(doc(`| signature | noun |\n|---|---|\n| Node | [vertex] |\n\n${READING_TABLE}`))).toEqual([]);
  });
});

describe('a signature declared in a nested term', () => {
  const NESTED = `# Canon

## Terms

### @term plugin

> A plugin is a package.

\`\`\`alloy vocabulary
sig Plugin {}
sig Ran in Plugin {}
\`\`\`

| reading | holds | does not hold |
|---|---|---|
| Ran | {1} has run | {1} has not run |

#### @term installed-plugin

> An installed plugin is a plugin whose package the project has.

\`\`\`alloy vocabulary
sig Installed in Plugin {}
\`\`\`

## ${AXIOM} a-root

> A root.

### @spec a-leaf

Every installed plugin runs.

\`\`\`alloy
all i: Installed | i in Ran
\`\`\`
`;

  /**
   * @canon spec-a-signature-declared-in-a-nested-term-has-the-term-as-its-noun
   */
  it('has the nested term as its noun, linked to it', () => {
    expect(statementOf(NESTED)).toContain('[*installed plugin*](#term-installed-plugin)');
  });
});
