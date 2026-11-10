/** The order of the passes: each runs after the passes whose shapes it reads, as the canon says. */
import { describe, expect, it } from 'vitest';
import { context, lower, lowerDefinition } from '../../src/core/index.ts';
import type { Sentence } from '../../src/core/ir.ts';
import type { Context } from '../../src/core/pass.ts';
import { PASSES } from '../../src/core/passes/index.ts';
import { parts } from '../../src/core/walk.ts';
import { isDefinition, parseReadings, withDefinitions } from '../../src/index.ts';
import { READINGS, SWEEP, VOCABULARY } from '../canon/sweep.ts';

/** Where a pass stands in the pipeline. */
const at = (name: string): number => {
  const index = PASSES.findIndex(pass => pass.name === name);
  if (index === -1) throw new Error(`no pass "${name}"`);
  return index;
};

describe('the order of the passes', () => {
  /**
   * @canon spec-a-thing-of-a-some-goes-inside-before-noun-phrases-are-said
   */
  it('says a thing of a "some" inside its clauses before it says noun phrases', () => {
    expect(at('some-inside')).toBeLessThan(at('noun-phrases'));
  });

  /**
   * @canon spec-two-rules-become-one-equivalence-before-an-equivalence-is-said-with-exactly-when
   */
  it('makes two rules one equivalence before it says an equivalence with "exactly when"', () => {
    expect(at('rules-as-equivalence')).toBeLessThan(at('exactly-when'));
  });

  /**
   * @canon spec-a-negation-moves-inward-before-noun-phrases-are-said
   */
  it('moves a negation inward before it says noun phrases', () => {
    expect(at('negation-inward')).toBeLessThan(at('noun-phrases'));
  });

  /**
   * @canon spec-conditions-step-apart-before-noun-phrases-are-said
   */
  it('says a condition apart from its quantifier before it says noun phrases', () => {
    expect(at('conditions-apart')).toBeLessThan(at('noun-phrases'));
  });

  /**
   * @canon spec-two-things-of-a-kind-are-paired-before-noun-phrases-are-said
   */
  it('pairs two things of a kind before it says noun phrases', () => {
    expect(at('another-of-a-kind')).toBeLessThan(at('noun-phrases'));
  });

  /**
   * @canon spec-noun-phrases-are-said-before-there-is-a-that
   */
  it('says noun phrases before "there is a … that"', () => {
    expect(at('noun-phrases')).toBeLessThan(at('there-is-a-that'));
  });

  /**
   * @canon spec-a-set-equal-to-a-variable-is-said-before-quantifiers-of-for-every-become-one
   */
  it('says a set equal to a variable before quantifiers of "for every" become one', () => {
    expect(at('x-and-no-other')).toBeLessThan(at('for-every-together'));
  });

  /**
   * @canon spec-clauses-become-a-sentence-before-a-second-side-goes-first
   */
  it('says clauses as a sentence before it says the second side of a rule first', () => {
    expect(at('clauses-in-a-sentence')).toBeLessThan(at('claim-first'));
  });

  /**
   * @canon spec-a-rule-is-said-whenever-before-a-second-side-goes-first
   */
  it('says a rule "whenever" before it says the second side of a rule first', () => {
    expect(at('from-now-on-whenever')).toBeLessThan(at('claim-first'));
  });

  /**
   * @canon spec-until-is-said-in-a-sentence-before-a-time-phrase-goes-in-front
   */
  it('says until in a sentence before a time phrase goes in front', () => {
    expect(at('until-in-a-sentence')).toBeLessThan(at('time-phrase-in-front'));
  });

  /**
   * @canon spec-a-time-phrase-goes-in-front-before-clauses-become-a-sentence
   */
  it('puts a time phrase in front before clauses become a sentence', () => {
    expect(at('time-phrase-in-front')).toBeLessThan(at('clauses-in-a-sentence'));
  });

  /**
   * @canon spec-clauses-become-a-sentence-before-their-shared-words-are-said-once
   */
  it('makes clauses a sentence before it says the words negative clauses share once', () => {
    expect(at('clauses-in-a-sentence')).toBeLessThan(at('none-of-these'));
  });

  /**
   * @canon spec-clauses-become-a-sentence-before-a-rule-goes-on-one-line
   */
  it('makes clauses a sentence before a rule goes on one line', () => {
    expect(at('clauses-in-a-sentence')).toBeLessThan(at('rule-on-one-line'));
  });
});

const readings = withDefinitions(parseReadings(READINGS), VOCABULARY);

/** The sentences of the IR. A node a pass rebuilds, or rebuilds below, is a new object, so one still there is unchanged. */
const sentences = (s: Sentence): Set<Sentence> => new Set([...parts(s)].flatMap(part => ('sentence' in part ? [part.sentence] : [])));

/**
 * Over the sweep, each part whose words a pass weighed, and left as it was, that a later pass then changed: the pass
 * that weighed it, the pass that changed it, and the formula.
 */
function weighedThenChanged(): { weighed: string; changed: string; formula: string }[] {
  const base = context(readings);
  const found: { weighed: string; changed: string; formula: string }[] = [];
  for (const { formula } of SWEEP) {
    let at: Sentence;
    try {
      at = isDefinition(formula) ? lowerDefinition(formula, readings) : lower(formula, readings);
    } catch {
      continue;
    }
    let held: { pass: string; part: Sentence }[] = [];
    for (const pass of PASSES) {
      if (!('run' in pass)) continue;
      const before = sentences(at);
      const weighed = new Set<Sentence>();
      const weigh = (s: Sentence): void => void (before.has(s) && weighed.add(s));
      const watched: Context = { ...base, words: s => (weigh(s), base.words(s)), opening: s => (weigh(s), base.opening(s)) };
      at = pass.run(at, watched);
      const after = sentences(at);
      for (const { pass: by } of held.filter(h => !after.has(h.part))) found.push({ weighed: by, changed: pass.name, formula });
      held = [...held.filter(h => after.has(h.part)), ...[...weighed].filter(part => after.has(part)).map(part => ({ pass: pass.name, part }))];
    }
  }
  return found;
}

/** Where the bug below has a time phrase weigh a part before a later pass changes it. */
const TIME_PHRASE_WEIGHS_EARLY = (v: { weighed: string; changed: string }): boolean =>
  v.weighed === 'time-phrase-in-front' && (v.changed === 'rule-on-one-line' || v.changed === 'clauses-in-a-sentence');

describe('the words a pass weighs', () => {
  /**
   * @canon spec-a-pass-weighs-only-words-that-no-later-pass-changes
   */
  it('are the words the part ends with, over the sweep, but for the bug below', () => {
    expect(weighedThenChanged().filter(v => !TIME_PHRASE_WEIGHS_EARLY(v))).toEqual([]);
  }, 600_000);

  /**
   * @canon bug-a-time-phrase-weighs-a-part-that-a-later-pass-changes
   */
  it.fails('are the words the part ends with, below a time phrase too', () => {
    expect(weighedThenChanged()).toEqual([]);
  }, 600_000);
});
