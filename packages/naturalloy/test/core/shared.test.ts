/** The subject that conditions of a noun phrase share, counted in the words of their readings. */
import { describe, expect, it } from 'vitest';
import type { Clause, Var } from '../../src/core/ir.ts';
import { context } from '../../src/core/index.ts';
import { sharedSubject } from '../../src/core/passes/phrases.ts';
import { parseReadings } from '../../src/index.ts';

describe('the subject conditions share', () => {
  /**
   * @canon spec-relative-clauses-that-share-their-subject-say-it-once
   */
  it('counts a thing of its subject as one word, whatever words the thing has', () => {
    const readings = parseReadings('noun Issue: issue\nKnows.rel: {1} ^knows^ {2}\nCloses.rel: {1} ^has^ closed {2} | {1} has not closed {2}');
    const v: Var = { id: 'i', type: 'Issue' };
    const tracker = { t: 'string', value: 'the main tracker' } as const;
    const clauses: Clause[] = [
      { t: 'reading', key: 'Knows.rel', form: 'in', args: [tracker, { t: 'var', v }], negative: false },
      { t: 'reading', key: 'Closes.rel', form: 'in', args: [tracker, { t: 'var', v }], negative: true }
    ] as Clause[];
    expect(sharedSubject(clauses, v, context(readings))).toBe(1);
  });
});
