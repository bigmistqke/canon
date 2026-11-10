/**
 * An ignore line: a unit that says, in its own text, which finding does not break the canon there, and why.
 */
import { describe, expect, it } from 'vitest';
import { canon, check, run, scratch } from './project.ts';

/** A term nothing uses, below a plain heading so that it sits in no unit, with `lines` after its statement. */
const lonely = (lines: string): string =>
  canon(`
## Terms

### @term lonely

> A lonely is a word that nothing in this canon uses.

${lines}
`);

describe('an ignore line', () => {
  /**
   * @canon spec-an-ignore-line-keeps-its-finding-from-its-unit
   */
  it('keeps the finding it names from its unit', async () => {
    // The root axiom of the canon is dead too; the line keeps the finding of its own unit alone.
    const before = (await check(lonely('')))['dead'] ?? 0;
    const ignored = await check(lonely('Ignore: dead — a word that other canons use'));
    expect(ignored['dead'] ?? 0).toBe(before - 1);
    expect(ignored['rot']).toBeUndefined();
  });

  /**
   * @canon spec-an-ignore-line-that-names-nothing-it-ignores-is-a-rotting
   */
  it('is a rotting when it names no finding, gives no reason, or names a finding its unit does not have', async () => {
    expect((await check(lonely('Ignore: deadd — a word that other canons use')))['rot']).toBe(1);
    expect((await check(lonely('Ignore: dead')))['rot']).toBe(1);
    const stale = await check(lonely('Ignore: dead — a word that other canons use\nIgnore: untested — a term owes no test'));
    expect(stale['rot']).toBe(1);
    // A name that only an object of the language knows, and a hyphen in place of the dash, are rottings too.
    expect((await check(lonely('Ignore: toString — a word that other canons use')))['rot']).toBe(1);
    expect((await check(lonely('Ignore: dead - a word that other canons use')))['rot']).toBe(1);
  });

  /**
   * @canon spec-an-ignore-line-keeps-its-finding-from-its-unit
   */
  it('keeps a finding the checker reports by the line of its unit', async () => {
    const marked = lonely('Some [*lonelies*](#term-lonely) stand apart.\n\nIgnore: rot — a plural this term leaves out of its grammar on purpose');
    const found = await check(marked);
    expect(found['rot']).toBeUndefined();
  });

  /**
   * @canon spec-a-check-says-how-many-findings-it-ignored
   */
  it('makes the report of check say how many findings it ignored', async () => {
    const done = await run(await scratch(lonely('Ignore: dead — a word that other canons use')), 'check', '--offline');
    expect(done.stdout).toMatch(/^ignored: 1 finding\b/m);
    const none = await run(await scratch(lonely('')), 'check', '--offline');
    expect(none.stdout).not.toMatch(/^ignored:/m);
  });
});
