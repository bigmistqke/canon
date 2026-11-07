/**
 * Units that share no word are asked about apart.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CACHE } from '../../src/alloy.support.ts';
import { alloyProgram, checkAlloy, groups } from '../../src/alloy.ts';

/** The tag of an axiom, spelled apart so the checker does not read this file's templates as citations. */
const AXIOM = ['@', 'axiom'].join('');

/** Two terms that share nothing, and an axiom for each; `extra` is added to the end. */
const doc = (extra = '', bounds = '```alloy bounds\nfor 3 but 2 Apple, 1 Pear\n```\n'): string => `# Canon

## @term apple

\`\`\`alloy vocabulary
sig Apple {}
sig Ripe in Apple {}
\`\`\`

## @term pear

\`\`\`alloy vocabulary
sig Pear {}
sig Sweet in Pear {}
\`\`\`

${bounds}
## ${AXIOM} an-apple-is-ripe

\`\`\`alloy
all a: Apple | a in Ripe
\`\`\`

## ${AXIOM} a-pear-is-sweet

\`\`\`alloy
all p: Pear | p in Sweet
\`\`\`
${extra}`;

const names = (src: string): string[][] => groups(src).map(g => [...new Set(g.map(b => b.unit))].sort());

describe('the groups of a document', () => {
  /**
   * @canon spec-units-that-share-no-word-are-asked-about-apart
   */
  it('keep units apart when they share no signature, field or predicate', () => {
    expect(names(doc())).toEqual([['axiom-an-apple-is-ripe', 'term-apple'], ['axiom-a-pear-is-sweet', 'term-pear']]);
  });

  /**
   * @canon spec-units-that-share-a-word-are-asked-about-together
   */
  it('join the units of a claim that mentions both', () => {
    const joined = doc('\n## @spec a-pear-and-an-apple-differ\n\n```alloy\nsome a: Apple, p: Pear | a in Ripe and p in Sweet\n```\n');
    expect(names(joined)).toEqual([['axiom-a-pear-is-sweet', 'axiom-an-apple-is-ripe', 'spec-a-pear-and-an-apple-differ', 'term-apple', 'term-pear']]);
  });

  /**
   * @canon spec-units-that-share-a-word-are-asked-about-together
   */
  it('join a scenario to the units whose words it mentions', () => {
    const scene = doc().replace(`## ${AXIOM} an-apple-is-ripe\n`, `## ${AXIOM} an-apple-is-ripe\n\n\`\`\`alloy scenario\nsome Ripe\n\`\`\`\n`);
    expect(names(scene)).toEqual([['axiom-an-apple-is-ripe', 'term-apple'], ['axiom-a-pear-is-sweet', 'term-pear']]);
  });

  /**
   * @canon spec-a-unit-in-a-group-with-no-claim-and-no-scenario-is-not-asked-about
   */
  it('leave out a group with no unit to hold and no scenario', () => {
    const lone = doc().replace('## @term pear', '## @term plum\n\n```alloy vocabulary\nsig Plum {}\n```\n\n## @term pear');
    expect(groups(lone).flat().map(b => b.unit)).not.toContain('term-plum');
  });

  /**
   * @canon spec-a-formula-with-no-keyword-is-a-claim-to-hold
   */
  it('are not made by the program of the whole document, which keeps every unit in one model', () => {
    expect(alloyProgram(doc()).units.sort()).toEqual(['axiom-a-pear-is-sweet', 'axiom-an-apple-is-ripe']);
  });
});

describe.skipIf(!process.env.CANON_ALLOY_JAR)('the check of groups', () => {
  afterEach(() => new Promise(resolve => setTimeout(resolve, 0)));

  /**
   * @canon spec-the-scope-of-a-group-names-only-the-signatures-it-declares
   * @canon spec-units-that-share-no-word-are-asked-about-apart
   */
  it('asks about the groups apart, with the sizes of only the signatures each declares', { timeout: 600_000 }, async () => {
    expect(await checkAlloy(doc(), { cache: CACHE })).toMatchObject({ ok: true, units: expect.arrayContaining(['axiom-an-apple-is-ripe', 'axiom-a-pear-is-sweet']) });
  });

  /**
   * @canon spec-the-report-of-a-scenario-names-each-unit-whose-removal-lets-it-happen
   * @canon spec-the-report-of-a-scenario-names-no-other-unit
   * @canon spec-units-that-share-no-word-are-asked-about-apart
   */
  it('names the units of the group that cannot hold, and no unit of the other', { timeout: 600_000 }, async () => {
    const contra = doc('\n## @spec an-apple-is-unripe\n\n```alloy\nall a: Apple | a not in Ripe\n```\n\n```alloy scenario\nsome Apple\n```\n');
    const result = await checkAlloy(contra, { cache: CACHE });
    expect(result).toMatchObject({ ok: false });
    expect('failures' in result && result.failures.map(f => f.conflict.sort())).toEqual([['axiom-an-apple-is-ripe', 'spec-an-apple-is-unripe']]);
  });

  /**
   * @canon spec-units-that-cannot-all-hold-are-named
   * @canon spec-the-report-of-a-contradiction-names-all-the-units-of-the-group
   * @canon spec-units-that-share-no-word-are-asked-about-apart
   */
  it('names every unit of the group that contradicts itself, and no unit of the other', { timeout: 600_000 }, async () => {
    const result = await checkAlloy(doc('\n## @spec an-apple-is-unripe\n\n```alloy\nsome a: Apple | a not in Ripe\n```\n'), { cache: CACHE });
    expect(result).toMatchObject({ ok: false, failures: [{ scenario: 'consistent' }] });
    expect('failures' in result && result.failures.map(f => f.conflict.sort())).toEqual([['axiom-an-apple-is-ripe', 'spec-an-apple-is-unripe']]);
  });
});
