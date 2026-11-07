/**
 * The fenced blocks of a canon document.
 */
import { describe, expect, it } from 'vitest';
import { readBlocks } from '../../src/blocks.ts';

const DOC = `# Canon

## @term cluster

> A cluster is a group of units.

\`\`\`alloy vocabulary
sig Owner {}
\`\`\`

\`\`\`alloy bounds
for 3
\`\`\`

\`\`\`alloy scenario
some Owner
\`\`\`

### @spec a-leaf

> A leaf says one thing.

\`\`\`alloy
always some Owner
\`\`\`

\`\`\`
no language, so prose
\`\`\`

#### @spec nested

> A nested unit.

\`\`\`smt
(assert true)
\`\`\`
`;

describe('the blocks of a document', () => {
  const blocks = readBlocks(DOC);

  /**
   * @canon spec-a-fenced-block-with-a-language-belongs-to-the-unit-whose-own-text-holds-it
   * @canon spec-a-fence-with-no-language-is-prose
   * @canon spec-a-block-whose-second-word-is-vocabulary-has-the-role-of-vocabulary
   * @canon spec-a-block-whose-second-word-is-bounds-has-the-role-of-bounds
   * @canon spec-a-block-whose-second-word-is-scenario-has-the-role-of-scenario
   * @canon spec-a-block-with-no-role-word-is-the-formula-of-its-unit
   */
  it('reads each fenced block of a language, with the unit that holds it, its language and its role', () => {
    expect(blocks.map(b => [b.unit, b.lang, b.role])).toEqual([
      ['term-cluster', 'alloy', 'vocabulary'],
      ['term-cluster', 'alloy', 'bounds'],
      ['term-cluster', 'alloy', 'scenario'],
      ['spec-a-leaf', 'alloy', 'unit'],
      ['spec-nested', 'smt', 'unit'],
    ]);
  });

  /**
   * @canon spec-a-fenced-block-in-a-fold-belongs-to-its-unit-as-any-other
   */
  it('reads a block inside a fold as a block of its unit', () => {
    const folded = DOC.replace('\`\`\`alloy\nalways some Owner\n\`\`\`', '<details>\n<summary>Alloy</summary>\n\n\`\`\`alloy\nalways some Owner\n\`\`\`\n\n</details>');
    expect(folded).toContain('<details>');
    const block = readBlocks(folded).find(b => b.unit === 'spec-a-leaf');
    expect([block?.lang, block?.role, block?.body]).toEqual(['alloy', 'unit', 'always some Owner\n']);
  });

  /**
   * @canon spec-the-body-of-a-block-is-the-lines-between-its-fences
   * @canon spec-the-offset-of-a-block-is-where-its-body-starts-in-the-document
   */
  it('keeps the block\'s body apart from its fences, and says where in the document it starts', () => {
    expect(blocks[0]?.body).toBe('sig Owner {}\n');
    expect(blocks.map(b => DOC.slice(b.at, b.at + b.body.length))).toEqual(blocks.map(b => b.body));
  });

  /**
   * @canon spec-a-nested-units-block-is-its-own
   */
  it('gives a nested unit\'s block to the nested unit alone', () => {
    expect(blocks.filter(b => b.unit === 'spec-a-leaf')).toHaveLength(1);
  });
});
