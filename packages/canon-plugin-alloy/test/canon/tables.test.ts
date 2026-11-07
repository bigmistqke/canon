/**
 * The reading tables and noun tables of a document, and the noun a signature
 * takes from the term that declares it.
 */
import { describe, expect, it } from 'vitest';
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
  it('gives its signature the noun of its row', () => {
    const statement = statementOf(doc(`| signature | noun |\n|---|---|\n| Node | vertex |\n\n${READING_TABLE}`));
    expect(statement).toContain('vertex');
    expect(statement).not.toContain('node');
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
