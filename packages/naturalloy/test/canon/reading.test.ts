/**
 * The rules a reader holds to read the words: each pinned by the words it describes, and for noun phrases by what the
 * IR of those words means in Alloy.
 */
import { describe, expect, it } from 'vitest';
import { BINARY, COMPARED, INTRO, MOMENT, RULE, WRAP } from '../../src/core/constructs.ts';
import { context, lower } from '../../src/core/index.ts';
import { meaning } from '../../src/core/ir.ts';
import { optimize } from '../../src/core/pass.ts';
import { PASSES } from '../../src/core/passes/index.ts';
import { parseReadings, readsBack, verbalize, verbalizeDefinition, withDefinitions } from '../../src/index.ts';
import { READINGS, VOCABULARY } from './sweep.ts';

const readings = withDefinitions(parseReadings(READINGS), VOCABULARY);
const say = (formula: string): string => verbalize(formula, readings);
/** What the words of a formula mean, as the IR the passes leave says in Alloy. */
const means = (formula: string): string => meaning(optimize(lower(formula, readings), PASSES, context(readings)).ir);

describe('the rules of reading', () => {
  /**
   * @canon spec-a-noun-phrase-covers-the-clause-it-stands-in
   */
  it('lets a noun phrase cover the clause it stands in', () => {
    expect(say('no o: Owner | o in c.on')).toBe('c is on no owner.');
    expect(means('no o: Owner | o in c.on')).toBe('(no v_1: Owner | c->v_1 in on)');
    expect(say('all c, d: Cleanup | some c.on and some d.on')).toBe('For every cleanup C1 and every cleanup C2:\n  cleanup C1 is on an owner and cleanup C2 is on an owner.');
  });

  /**
   * @canon spec-the-first-noun-phrase-of-a-clause-covers-the-next
   */
  it('lets the first noun phrase of a clause cover the next', () => {
    expect(say('no c: Cleanup | some o: Owner | o in c.on')).toBe('No cleanup is on an owner.');
    expect(means('no c: Cleanup | some o: Owner | o in c.on')).toBe('(no v_1: Cleanup | (some v_2: Owner | v_1->v_2 in on))');
  });

  /**
   * @canon spec-a-relative-clause-says-more-of-the-noun-it-follows
   */
  it('lets a relative clause say more of the noun it follows, and stand last', () => {
    expect(say('some o: Owner | o in c.on and o in Disposed')).toBe('c is on an owner that pulse has disposed.');
    expect(means('some o: Owner | o in c.on and o in Disposed')).toBe('(some v_1: Owner | (v_1 in Disposed) and (c->v_1 in on))');
  });

  /**
   * @canon spec-the-noun-alone-names-the-one-thing-of-its-kind
   */
  it('names the one thing of its kind by its noun, and two of a kind by their numbers', () => {
    expect(say('all c: Cleanup | c in Ran')).toBe('For every cleanup:\n  the cleanup has run.');
    expect(say('all c, d: Cleanup | c in Ran implies d in Ran')).toBe('For every cleanup C1 and every cleanup C2:\n  when cleanup C1 has run, cleanup C2 has run.');
  });

  /**
   * @canon spec-a-noun-the-words-name-again-in-a-when-is-every-thing-of-its-kind
   */
  it('reads "a cleanup" in a "when", or as the subject of "exactly when", as every cleanup where "the cleanup" follows', () => {
    const rule = readsBack('all c: Cleanup | c in Ran implies c in Registered', readings);
    expect(rule.words).toBe('When a cleanup has run, code has registered the cleanup.');
    expect(rule.meanings).toEqual([rule.meant]);
    const quiet = withDefinitions(
      parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run\nquiet: {1} is quiet | {1} is not quiet'),
      'sig Cleanup {} var sig Ran in Cleanup {} pred quiet[c: Cleanup] { c in Ran }'
    );
    // Two such nouns in one first side, and in a claim before "when": every pair.
    for (const formula of ['all c: Cleanup, o: Owner | (c in o.~on and o in Disposed) implies c in Ran', 'all c: Cleanup, o: Owner | (c in Registered and o in Disposed and o in Stopped and c in Ran) implies c in o.~on']) {
      const pair = readsBack(formula, readings);
      expect(pair.words).toMatch(/^(When a cleanup|A cleanup is on an owner)/);
      expect(pair.meanings).toEqual([pair.meant]);
    }
    const definition = readsBack('pred quiet[c: Cleanup] { c in Ran }', quiet);
    expect(definition.words).toBe('A cleanup is quiet exactly when the cleanup has run.');
    expect(definition.meanings).toEqual([definition.meant]);
  });

  /**
   * @canon spec-a-claim-before-when-holds-where-the-bullets-after-it-hold
   */
  it('reads a claim before "when" and its bullets as the rule, and "a cleanup" in the claim as every cleanup', () => {
    for (const formula of ['(c in Ran and c in Registered and o in Disposed and o in Stopped) implies p in Disposed', 'all d: Cleanup | (d in Ran and o in Disposed and o in Stopped and o in d.on) implies d in Registered']) {
      const back = readsBack(formula, readings, ['c', 'o', 'p']);
      expect(back.words).toMatch(/ when all of these hold:\n/);
      expect(back.meanings).toEqual([back.meant]);
    }
  });

  /**
   * @canon spec-now-is-the-moment-a-statement-is-read-at
   */
  it('reads "now" below a time phrase at each moment the phrase picks', () => {
    expect(say('always (c in Ran implies eventually o in Disposed)')).toBe('From now on:\n  when c has run, then now or later, pulse has disposed o.');
  });

  /**
   * @canon spec-a-time-phrase-covers-the-rest-of-its-sentence
   */
  it('lets a time phrase cover the rest of its sentence, or the lines below its colon', () => {
    expect(say('always (c in Ran implies after c in Registered)')).toBe('From now on, whenever c has run, then at the next moment, code has registered c.');
    expect(say('after (c in Ran and c in Registered)')).toBe('At the next moment, all of these hold:\n  - c has run\n  - code has registered c');
  });

  /**
   * @canon spec-until-then-stops-before-its-moment
   */
  it('says until of two clauses as "until then"', () => {
    expect(say('c in Registered until o in Disposed')).toBe('Pulse has disposed o now or later, and until then, code has registered c.');
  });

  /**
   * @canon spec-the-bullets-below-a-colon-are-the-parts-of-its-line
   */
  it('says the parts of a line as bullets below its colon', () => {
    expect(say('c in Ran and c in Registered and o in Disposed and o in Stopped')).toBe(
      'All of these hold:\n  - c has run\n  - code has registered c\n  - pulse has disposed o\n  - the dispose of o has been stopped'
    );
  });

  /**
   * @canon spec-a-sentence-joins-its-clauses-with-and-or-with-or-never-both
   */
  it('never joins clauses with "and" and "or" in one sentence', () => {
    expect(say('c in Ran or (c in Registered and o in Disposed)')).toBe('At least one of these holds:\n  - c has run\n  - code has registered c and pulse has disposed o');
  });

  /**
   * @canon spec-exactly-when-goes-both-ways-and-when-goes-one
   */
  it('says an equivalence with "exactly when" and a rule with "when"', () => {
    expect(say('c in Ran iff o in Disposed')).toBe('c has run exactly when pulse has disposed o.');
    expect(say('c in Ran implies o in Disposed')).toBe('When c has run, pulse has disposed o.');
  });

  /**
   * @canon spec-one-of-these-names-one-of-kinds-that-share-no-member
   */
  it('reads "is one of these" as one of the kinds below it, kinds that share no member', () => {
    const kinds = 'pred kept[x: univ] { (x in Owner and gone[x]) or (x in Cleanup and x in Ran) }';
    expect(verbalizeDefinition(kinds, readings)).toBe('A thing is kept exactly when the thing is one of these:\n  - an owner that is gone\n  - a cleanup that has run');
    const back = readsBack(kinds, readings);
    expect(back.meanings).toEqual([back.meant]);
  });
});

/** A statement for each fixed word of the printer, with the words it holds. */
const CONSTRUCTS: [string, string][] = [
  [INTRO.all, 'c in Ran and c in Registered and o in Disposed and o in Stopped'],
  [INTRO.any, 'c in Ran or c in Registered or o in Disposed or o in Stopped'],
  [INTRO.both, '(c in Ran and c in Registered) iff (o in Disposed and o in Stopped)'],
  [INTRO.exactlyOne, 'not ((c in Ran and c in Registered) iff (o in Disposed and o in Stopped))'],
  [INTRO.untrue, 'not one c.on'],
  [INTRO.noneOf, 'all d: Cleanup | d not in Labelled and d not in Flagged and d not in Pinned and d not in Marked'],
  [INTRO.apart, 'c in Ran implies (c in Registered implies o in Disposed)'],
  [`is ${INTRO.oneOf}`, 'pred kept[x: univ] { (x in Owner and gone[x]) or (x in Cleanup and x in Ran) }'],
  [MOMENT.always, 'always c in Ran'],
  [MOMENT.eventually, 'eventually c in Ran'],
  [MOMENT.after, 'after c in Ran'],
  [MOMENT.before, 'before c in Ran'],
  [MOMENT.once, 'once c in Ran'],
  [MOMENT.historically, 'historically c in Ran'],
  [BINARY.until.joint, 'c in Ran until o in Disposed'],
  [BINARY.until.first, '(c in Ran and c in Registered) until o in Disposed'],
  [BINARY.until.second, '(c in Ran and c in Registered) until o in Disposed'],
  [BINARY.since.joint, 'c in Ran since o in Disposed'],
  [BINARY.since.first, '(c in Ran and c in Registered) since o in Disposed'],
  [BINARY.since.second, '(c in Ran and c in Registered) since o in Disposed'],
  [RULE.when, 'c in Ran implies o in Disposed'],
  [RULE.whenever, 'always (c in Ran implies o in Disposed)'],
  [RULE.then, 'c in Ran implies after o in Disposed'],
  [RULE.otherwise, 'c in Ran implies o in Disposed else o in Stopped'],
  [WRAP, 'all x, y: Int | x < y'],
  ...Object.entries(COMPARED).map(([op, words]): [string, string] => [words, op === '=' || op === '!=' ? `all y: Int | #c.on ${op} y` : `all x, y: Int | x ${op} y`])
];

describe('the fixed words of the printer', () => {
  /**
   * @canon spec-each-fixed-word-of-the-printer-reads-back-to-its-meaning
   */
  it('each stand in a statement that reads back to its one meaning', () => {
    const fixed = [...Object.values(INTRO).filter(words => words !== INTRO.oneOf), `is ${INTRO.oneOf}`, ...Object.values(MOMENT), ...Object.values(BINARY).flatMap(b => Object.values(b)), ...Object.values(RULE), WRAP, ...Object.values(COMPARED)];
    expect(fixed.filter(words => !CONSTRUCTS.some(([held]) => held === words))).toEqual([]);
    const wrong = CONSTRUCTS.flatMap(([words, formula]) => {
      const back = readsBack(formula, readings, ['c', 'o', 'p']);
      const holds = back.words.toLowerCase().includes(words.trim().toLowerCase());
      return holds && back.meanings.length === 1 && back.meanings[0] === back.meant ? [] : [{ words, formula, said: back.words, meanings: back.meanings }];
    });
    expect(wrong).toEqual([]);
  });
});
