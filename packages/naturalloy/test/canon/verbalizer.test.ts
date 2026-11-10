/**
 * The verbalizer: Alloy formulas said in words by a table of readings.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDefinition, parseDefinitions, parseReadings, Refusal, verbalize, verbalizeDefinition, withDefinitions } from '../../src/index.ts';
import { RULE } from '../../src/core/constructs.ts';
import { markdownLines } from '../../src/core/layout.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'lifetimes');
const read = (name: string): string => readFileSync(join(FIXTURE, name), 'utf8');

/** The readings and the vocabulary of the lifetimes example. */
const READINGS = withDefinitions(parseReadings(read('readings.txt')), read('vocabulary.als'));
const say = (formula: string, readings = READINGS): string => verbalize(formula, readings);
/** The words below a "for every" line, or all of them where the words leave the "for every" out. */
const inside = (words: string): string => (words.startsWith('For every ') ? words.split('\n').slice(1).join('\n').trim() : words);

/** Sets of things, each held by a signature, or not by one. */
const SETS = withDefinitions(
  parseReadings(
    [
      'noun Edge: an [edge]', 'noun Hour: an hour', 'noun Alarm: alarm',
      'Emitting: {1} is being delivered | {1} is not being delivered', 'Ringing: {1} is ringing | {1} is not ringing',
      'Alarm: {1} rings | {1} does not ring', 'Looped: {1} is sent back to {1} | {1} is not sent back to {1}',
      'Loose: {1} is loose | {1} is not loose', 'Unknown: {1} is unknown | {1} is not unknown', 'next: {2} follows {1} | {2} does not follow {1}'
    ].join('\n'),
    '#term-edge'
  ),
  'sig Edge { next: lone Edge } sig Hour {} sig Alarm {} var lone sig Emitting in Edge {} var sig Ringing extends Hour {} sig Looped in Edge {} sig Loose in Edge + Hour {}'
);

describe('the formulas of the lifetimes example', () => {
  const formulas = read('formulas.als').split(/\n\s*\n/).filter(block => !block.startsWith('--'));

  /**
   * @canon spec-a-formula-is-said-in-full
   */
  it('says all seven formulas, the scenario included, without leaving anything out', () => {
    expect(formulas).toHaveLength(7);
    for (const formula of formulas) {
      const words = say(formula);
      expect(words.length).toBeGreaterThan(0);
      expect(words).not.toMatch(/\{\d\}|\u0001/);
    }
  });

  /**
   * @canon spec-a-formula-is-said-the-same-way-every-time
   */
  it('says them the same way every time', () => {
    const all = (): string[] => formulas.map(formula => say(formula));
    expect(all()).toEqual(all());
  });
});

describe('a marked verb', () => {
  const marked = (lines: string): ReturnType<typeof parseReadings> => parseReadings(`noun Unit: unit\nverb keeps: keep, kept\n${lines}`);

  /**
   * @canon spec-a-mark-is-no-part-of-the-words-of-a-reading
   */
  it('is said without its carets', () => {
    expect(say('all u: Unit | u in Worded', marked('Worded: {1} ^keeps^ readings | {1} keeps no readings'))).toBe('For every unit:\n  the unit keeps readings.');
    expect(marked('Worded: {1} ^keeps^ readings').atoms.get('Worded')?.positive).toBe('{1} keeps readings');
  });

  /**
   * @canon spec-a-verb-line-gives-the-forms-of-a-marked-verb
   */
  it('takes its infinitive and its participle from a verb line', () => {
    expect(marked('').verbs.get('keeps')).toEqual({ infinitive: 'keep', participle: 'kept' });
  });

  /**
   * @canon spec-a-reading-with-no-negative-side-takes-the-negative-of-its-frame
   */
  it('gives a reading with no negative side the negative of its frame', () => {
    const readings = marked('Worded: {1} ^keeps^ readings\nAmbiguous: {1} ^is^ ambiguous\nPaired: the sides of {1} ^are^ paired |');
    expect(readings.atoms.get('Worded')?.negative).toBe('{1} does not keep readings');
    expect(readings.atoms.get('Ambiguous')?.negative).toBe('{1} is not ambiguous');
    expect(readings.atoms.get('Paired')?.negative).toBe('the sides of {1} are not paired');
    // A negative the author writes wins over the frame's.
    expect(marked('Worded: {1} ^keeps^ readings | {1} keeps no readings').atoms.get('Worded')?.negative).toBe('{1} keeps no readings');
    expect(say('all u: Unit | u not in Worded', readings)).toBe('For every unit:\n  the unit does not keep readings.');
  });

  /**
   * @canon spec-a-reading-whose-negative-its-frame-cannot-give-is-refused
   */
  it('refuses a line with no negative side whose verb has no infinitive', () => {
    expect(() => marked('Asked: {1} ^asks^ for help')).toThrow(Refusal);
    expect(() => marked('Asked: {1} ^asks^ for help')).toThrow(/asks/);
    // With a negative side, the verb needs no infinitive.
    expect(() => marked('Asked: {1} ^asks^ for help | {1} asks for no help')).not.toThrow();
  });
});

describe('two rules that go each way', () => {
  /**
   * @canon spec-two-rules-that-go-each-way-are-said-as-one-equivalence
   */
  it('are said as one equivalence of their sides, with a run of clauses second', () => {
    expect(say('all c: Cleanup | (c in Ran implies c in Registered) and (c in Registered implies c in Ran)')).toBe(
      'For every cleanup:\n  code has registered the cleanup exactly when the cleanup has run.'
    );
    const units = parseReadings('noun Unit: unit\nWritten: {1} is written | {1} is not written\nStale: {1} is stale | {1} is not stale\nFresh: {1} is unwritten | {1} is not unwritten');
    const both = say('all u: Unit | (u in Written implies (u in Fresh or u in Stale)) and ((u in Fresh or u in Stale) implies u in Written)', units);
    expect(both).not.toMatch(/\bwhen\b(?! all| at least)/);
    expect(both.indexOf('is written')).toBeLessThan(both.indexOf('unwritten'));
    // A rule that goes one way only, beside another, stays a rule.
    expect(say('all c: Cleanup | (c in Ran implies c in Registered) and (c in Registered implies c.on in Disposed)')).toMatch(/when the cleanup has run, code has registered the cleanup/);
  });
});

describe('the words', () => {
  /**
   * @canon spec-a-quantifier-is-said-with-the-noun-of-its-type-for-each-variable
   */
  it('says a quantifier with the noun of its type, repeated for each variable', () => {
    expect(say('all o: Owner, k: Owner, c: Cleanup | c in Ran')).toBe(
      'For every owner O1, every owner O2 and every cleanup:\n  the cleanup has run.'
    );
  });

  /**
   * @canon spec-three-things-a-for-every-names-are-a-list
   */
  it('writes three things a for every or a for some names as a list', () => {
    expect(say('all c: Cleanup, o, p: Owner | c in Ran implies o in Disposed')).toMatch(/^For every cleanup, every owner O1 and every owner O2:/);
    expect(say('some c: Cleanup, o, p: Owner | o in c.on and p not in c.on')).toMatch(/^For some cleanup, some owner O1 and some owner O2:/);
    expect(say('all c: Cleanup, o: Owner | c in Ran implies o in Disposed')).toMatch(/^For every cleanup and every owner:/);
  });

  /**
   * @canon spec-some-of-several-things-is-said-as-for-some
   */
  it('says some over several variables as for some each of them, and over one as there is', () => {
    expect(say('some c: Cleanup, o: Owner | o in c.on and c in Ran')).toBe('For some cleanup and some owner:\n  the cleanup is on the owner and has run.');
    expect(say('some c, d: Cleanup | c != d and c in Ran')).toContain('For some cleanup C1 and some cleanup C2:');
    expect(say('some c: Cleanup | c in Ran and c in Registered')).toMatch(/^There is a cleanup such that /);
  });

  /**
   * @canon spec-a-variable-is-named-after-its-noun-and-its-number
   */
  it('names a variable after its noun and the number it is, whatever the formula called it', () => {
    const readings = parseReadings('noun Unit: unit\nnoun Spec: spec\nnoun ExpectedFailure: expected failure\nRan: {1} has run | {1} has not run');
    expect(say('all x, y: Unit, z: Spec | x in Ran', readings)).toBe('For every unit U1, every unit U2 and every spec:\n  unit U1 has run.');
    expect(say('all u: Unit | all u2: Unit | u in Ran', readings)).toBe('For every unit U1 and every unit U2:\n  unit U1 has run.');
  });

  /**
   * @canon spec-a-variable-alone-of-its-noun-is-named-the-noun
   * @canon spec-a-variable-is-named-after-its-noun-and-its-number
   */
  it('names a variable the noun alone when no other variable or word has its noun, and a counted one by its number', () => {
    expect(say('some e: ExpectedFailure | e in Ran', parseReadings('noun ExpectedFailure: expected failure\nRan: {1} has run | {1} has not run'))).toBe(
      'There is an expected failure that has run.'
    );
    expect(say('one x: Owner | x in c.on')).toBe('There is exactly one owner such that c is on the owner.');
    // A link's target is not a word the reader sees: "(#term-unit)" does not say the noun again.
    const linked = parseReadings('noun Unit: [unit]\nRan: {1} has [run] | {1} has not [run]', '#term-unit');
    expect(verbalize('all u: Unit | u in Ran', linked, 'markdown')).toBe('For every [unit](#term-unit):\\\nthe unit has run.');
  });

  /**
   * @canon spec-a-variable-alone-of-its-noun-is-named-the-noun
   */
  it('names a variable the noun alone where the noun is said elsewhere only after "no" or after the last name of the variable', () => {
    // "no cleanup" names no thing that "the cleanup" could point at.
    expect(say('all c: Cleanup | (no o: Cleanup | o in Ran) and c in Registered')).toBe(
      'For every cleanup:\n  all of these hold:\n    - no cleanup has run\n    - code has registered the cleanup'
    );
    // "a cleanup" after the last name of the variable comes too late for "the cleanup" to point at it.
    expect(say('all c: Cleanup | c in Registered implies (some d: Cleanup | d in Ran)')).not.toMatch(/\bC\d\b/);
    // "a cleanup" before a later name of the variable is a thing that "the cleanup" could point at.
    expect(say('all c: Cleanup | (some d: Cleanup | d in Ran) implies c in Registered')).toBe(
      'For every cleanup C1:\n  when there is a cleanup that has run, code has registered cleanup C1.'
    );
  });

  /**
   * @canon spec-a-rule-over-every-thing-of-a-kind-says-a-noun-in-its-when
   */
  it('says a rule over every thing of a kind with "a" and the noun where its first side first names the thing', () => {
    expect(say('all c: Cleanup | c in Ran implies c in Registered')).toBe('When a cleanup has run, code has registered the cleanup.');
    expect(say('all o: Owner | (dispose[o] and some c: Cleanup | c.on = o) implies o in Disposed')).toBe(
      'When pulse disposes an owner and a cleanup is on the owner, pulse has disposed the owner.'
    );
    // Several variables, each first named in the first side, or in a claim said before "when".
    expect(say('all c: Cleanup, o: Owner | (c in o.~on and o in Disposed) implies c in Ran')).toBe(
      'When a cleanup is on an owner and pulse has disposed the owner, the cleanup has run.'
    );
    expect(say('all c: Cleanup, o: Owner | (c in Registered and o in Disposed and o in Stopped and c in Ran) implies c in o.~on')).toBe(
      ['A cleanup is on an owner when all of these hold:', '  - code has registered the cleanup', '  - pulse has disposed the owner', '  - the dispose of the owner has been stopped', '  - the cleanup has run'].join('\n')
    );
    // One variable that keeps its number keeps the "for every" of the others with it.
    expect(say('all c, d: Cleanup, o: Owner | (c in o.~on and d in o.~on) implies o in Disposed')).toMatch(/^For every /);
  });

  /**
   * @canon spec-a-definition-of-every-thing-of-a-kind-says-a-noun-as-its-subject
   */
  it('says a definition over one parameter with "a" and the noun as its subject', () => {
    const readings = withDefinitions(
      parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run\nquiet: {1} is quiet | {1} is not quiet'),
      'sig Cleanup {} var sig Ran in Cleanup {} pred quiet[c: Cleanup] { c in Ran }'
    );
    expect(verbalizeDefinition('pred quiet[c: Cleanup] { c in Ran }', readings)).toBe('A cleanup is quiet exactly when the cleanup has run.');
  });

  /**
   * @canon spec-a-variable-named-once-keeps-its-for-every
   */
  it('keeps the "for every" of a variable the words name once', () => {
    expect(say('all c: Cleanup | c in Ran implies o in Disposed')).toBe('For every cleanup:\n  when the cleanup has run, pulse has disposed o.');
  });

  /**
   * @canon spec-a-rule-with-an-otherwise-keeps-its-for-every
   */
  it('keeps the "for every" of a rule with an "otherwise"', () => {
    expect(say('all c: Cleanup | c in Ran implies c in Registered else o in Disposed')).toBe(
      'For every cleanup:\n  when the cleanup has run, code has registered the cleanup; otherwise, pulse has disposed o.'
    );
  });

  /**
   * @canon spec-a-rule-whose-first-side-is-bullets-says-its-second-side-first
   */
  it('says the second side of a rule first when its first side is bullets and its second side one plain line', () => {
    const conditions = 'c in Ran and c in Registered and o in Disposed and o in Stopped';
    expect(say(`(${conditions}) implies p in Disposed`)).toBe(
      'Pulse has disposed p when all of these hold:\n  - c has run\n  - code has registered c\n  - pulse has disposed o\n  - the dispose of o has been stopped'
    );
    // The first mention of a thing every one of whose kind the rule is about is in the second side, now said first.
    expect(say('all x: Owner | (x in Disposed and x in Stopped and c in Ran and c in Registered) implies dispose[x]')).toBe(
      'Pulse disposes an owner when all of these hold:\n  - pulse has disposed the owner\n  - the dispose of the owner has been stopped\n  - c has run\n  - code has registered c'
    );
    // A time phrase in the second side, or an "otherwise", keeps the first side first.
    expect(say(`(${conditions}) implies after p in Disposed`).split('\n')[0]).toBe('When all of these hold:');
    expect(say(`(${conditions}) implies p in Disposed else p in Stopped`).split('\n')[0]).toBe('When all of these hold:');
    // So does a rule that "from now on, whenever" has taken.
    expect(say(`always ((${conditions}) implies p in Disposed)`).split('\n')[0]).toBe('From now on, whenever all of these hold:');
  });

  /**
   * @canon spec-a-quantifier-about-its-variable-alone-is-said-with-there-is-and-that
   */
  it('says "there is a … that" for a variable beside only another noun phrase', () => {
    expect(say('some c: Cleanup, o: Owner | o in c.on and o in Disposed')).toBe('There is a cleanup that is on an owner that pulse has disposed.');
  });

  /**
   * @canon spec-a-variable-is-named-the-same-however-the-formula-names-it
   */
  it('names a variable the same however the formula named it', () => {
    const readings = parseReadings('noun Unit: unit\nRan: {1} has run | {1} has not run');
    expect(say('all u: Unit | u in Ran', readings)).toBe(say('all whatever: Unit | whatever in Ran', readings));
  });

  /**
   * @canon spec-some-is-said-with-an-article-chosen-by-the-sound-of-the-noun
   * @canon spec-no-over-several-variables-is-said-as-no-combination
   */
  it('says "some" and "no" with an article, or as a combination of several', () => {
    expect(say('some c: Failing | c in Ran')).toBe('There is a failing cleanup that has run.');
    expect(say('some o: Owner | o in Disposed')).toBe('There is an owner such that pulse has disposed the owner.');
    expect(say('no c: Cleanup, o: Owner | c.on = o')).toBe('No cleanup is on an owner.');
  });

  /**
   * @canon spec-a-negation-is-said-with-the-negative-reading-of-what-it-negates
   */
  it('says a negation with the negative reading of the thing negated', () => {
    expect(say('not c in Ran')).toBe('c has not run.');
    expect(say('c not in Ran')).toBe('c has not run.');
    expect(say('not dispose[o]')).toBe('Pulse does not dispose o.');
    expect(say("no Throwing'")).toBe('Right after, no call is throwing.');
  });

  /**
   * @canon spec-a-union-on-the-left-is-spelled-out
   * @canon spec-a-difference-on-the-right-is-spelled-out
   */
  it('spells out a union on the left and a difference on the right', () => {
    expect(say('c + d in Registered - Ran')).toBe(
      'All of these hold:\n  - code has registered c\n  - c has not run\n  - code has registered d\n  - d has not run'
    );
    expect(say('not (c + d in Ran)')).toBe('At least one of these holds:\n  - c has not run\n  - d has not run');
    expect(say('c + d not in Ran')).toBe('At least one of these holds:\n  - c has not run\n  - d has not run');
    expect(say('not c + d not in Ran')).toBe('All of these hold:\n  - c has run\n  - d has run');
  });

  /**
   * @canon spec-a-disj-quantifier-is-said-with-its-variables-different
   */
  it('says a "disj" quantifier with the condition that its variables are different', () => {
    expect(say('all disj c, d: Cleanup | c in Ran implies d in Ran')).toBe(
      'For every cleanup C1 and every cleanup C2:\n  cleanup C2 has run when all of these hold:\n    - cleanup C1 and cleanup C2 are different\n    - cleanup C1 has run'
    );
    expect(say('all disj c, d: Cleanup | d in Ran')).toBe('For every cleanup C1 and every cleanup C2:\n  when cleanup C1 and cleanup C2 are different, cleanup C2 has run.');
    expect(say('some disj c, d: Cleanup | c in Ran and d in Ran')).toBe('For some cleanup C1 and some cleanup C2:\n  all of these hold:\n    - cleanup C1 and cleanup C2 are different\n    - cleanup C1 has run\n    - cleanup C2 has run');
  });

  /**
   * @canon spec-a-difference-as-the-type-of-a-quantifier-is-said-as-a-condition
   */
  it('says a difference as the type of a quantifier as a condition on the variable', () => {
    expect(say('all c: Cleanup - d | c in Ran')).toBe('When a cleanup and d are different, the cleanup has run.');
    expect(say('all c: Cleanup - Ran | c in Registered')).toBe('When a cleanup has not run, code has registered the cleanup.');
  });

  /**
   * @canon spec-a-set-with-no-noun-as-the-type-of-a-quantifier-is-said-as-a-condition
   */
  it('says a set with no noun as the type of a quantifier as a condition on a variable of the signature that holds it', () => {
    expect(say('all e: Emitting | e in Looped', SETS)).toBe('When an edge is being delivered, the edge is sent back to the edge.');
    expect(say('all e: Emitting | e in Looped implies e in Loose', SETS)).toBe('When an edge is being delivered and is sent back to the edge, the edge is loose.');
    expect(say('some e: Emitting | d in e.next', SETS)).toBe('d follows an edge that is being delivered.');
    expect(say('no e: Emitting | d in e.next', SETS)).toBe('d follows no edge that is being delivered.');
    expect(say('some e: Emitting | e in Looped', SETS)).toBe('There is an edge such that the edge is being delivered and is sent back to the edge.');
    expect(say('all h: Ringing | h in Alarm', SETS)).toBe('When an hour is ringing, the hour rings.');
    expect(() => say('all e: Loose | e in Looped', SETS)).toThrow('no noun for "Loose"');
  });

  /**
   * @canon spec-membership-in-a-navigation-is-said-with-the-reading-of-its-field
   */
  it('says membership in a navigation with the reading of its field', () => {
    expect(say('o in c.on')).toBe('c is on o.');
    expect(say('c in on.o')).toBe('c is on o.');
    expect(say('o not in c.on')).toBe('c is not on o.');
  });

  /**
   * @canon spec-no-or-some-of-a-navigation-is-said-as-a-noun-phrase-of-the-type-of-the-field
   */
  it('says no or some of a navigation as a noun phrase of the type of the field', () => {
    expect(say('no c.on')).toBe('c is on no owner.');
    expect(say('some c.on')).toBe('c is on an owner.');
    expect(say('some on.o')).toBe('A cleanup is on o.');
    expect(say('not no c.on')).toBe('c is on an owner.');
  });

  /**
   * @canon spec-a-transpose-in-a-navigation-is-said-as-the-navigation-the-other-way
   */
  it('says a navigation of a transpose as the navigation the other way', () => {
    expect(say('c in o.(~on)')).toBe('c is on o.');
    expect(say('o in (~on).c')).toBe('c is on o.');
    expect(say('c not in o.(~on)')).toBe('c is not on o.');
    expect(say('no o.(~on)')).toBe('No cleanup is on o.');
    expect(say("c in o.(~on)'")).toBe('At the next moment, c is on o.');
    expect(say("c in o.(~(on'))")).toBe('At the next moment, c is on o.');
  });

  /**
   * @canon spec-a-pair-in-a-transpose-is-said-the-other-way-round
   */
  it('says a pair in a transpose the other way round', () => {
    expect(say('o->c in ~on')).toBe('c is on o.');
    expect(say('d->c in ~(Clock.older)')).toBe('Code registered c before d.');
    expect(say('d->c not in ~(Clock.older)')).toBe('Code did not register c before d.');
  });

  /**
   * @canon spec-a-set-whose-reading-says-its-variable-once-is-said-with-a-noun-phrase-in-its-place
   */
  it('says some or no of a set whose reading says its variable once with a noun phrase of the signature that holds it', () => {
    expect(say('some Emitting', SETS)).toBe('An edge is being delivered.');
    expect(say('no Emitting', SETS)).toBe('No edge is being delivered.');
    expect(say('not some Emitting', SETS)).toBe('No edge is being delivered.');
    expect(say('not no Emitting', SETS)).toBe('An edge is being delivered.');
    expect(say("some Emitting'", SETS)).toBe('At the next moment, an edge is being delivered.');
    expect(say('some Ringing', SETS)).toBe('An hour is ringing.');
    expect(say('some Alarm', SETS)).toBe('An alarm rings.');
    expect(say('some Emitting and some Alarm', SETS)).toBe('An edge is being delivered and an alarm rings.');
    expect(verbalize('some Emitting', SETS, 'markdown')).toBe('An [edge](#term-edge) is being delivered.');
  });

  /**
   * @canon spec-a-set-whose-reading-says-its-variable-twice-is-said-in-full
   */
  it('says some or no of a set whose reading says its variable twice in full', () => {
    expect(say('some Looped', SETS)).toBe('There is an edge such that the edge is sent back to the edge.');
    expect(say('no Looped', SETS)).toBe('There is no edge such that the edge is sent back to the edge.');
  });

  /**
   * @canon spec-a-set-with-no-one-signature-that-holds-it-is-refused
   */
  it('refuses some or no of a set that no one signature holds', () => {
    expect(() => say('some Loose', SETS)).toThrow('no one signature holds "Loose"');
    expect(() => say('no Unknown', SETS)).toThrow('no one signature holds "Unknown"');
  });

  /**
   * @canon spec-a-primed-name-with-no-reading-of-its-own-is-said-at-the-next-moment
   */
  it('says a clause with one primed name as the clause at the next moment', () => {
    expect(say("c in Ran'")).toBe('At the next moment, c has run.');
    expect(say("c not in Ran'")).toBe('At the next moment, c has not run.');
    expect(say("o in c.on'")).toBe('At the next moment, c is on o.');
    expect(say("no c.on'")).toBe('At the next moment, c is on no owner.');
    expect(say("no Throwing'")).toBe('Right after, no call is throwing.');
  });

  /**
   * @canon spec-an-and-or-an-or-below-a-time-phrase-is-a-list
   */
  it('says an and or an or below a time phrase as a list', () => {
    expect(say("c in (Ran + Registered)'")).toBe('At the next moment, at least one of these holds:\n  - c has run\n  - code has registered c');
    expect(say('eventually (c in Ran and c in Registered)')).toBe('Now or later, all of these hold:\n  - c has run\n  - code has registered c');
  });

  /**
   * @canon spec-an-equality-with-a-side-of-unknown-type-is-refused
   */
  it('refuses an equality with a side whose type the vocabulary does not tell', () => {
    const other = withDefinitions(parseReadings(`${read('readings.txt')}\nm/Gone: {1} is gone in m | {1} is not gone in m`), read('vocabulary.als'));
    expect(() => say('m/Gone = Disposed', other)).toThrow('the vocabulary does not tell what kind of thing "m/Gone" holds');
    expect(say('all p: Owner | p.*parent = Disposed')).toContain('For every owner O1 and every owner O2:');
  });

  /**
   * @canon spec-sides-that-alloy-does-not-compare-are-refused
   */
  it('refuses sides that Alloy does not compare', () => {
    expect(() => say('on in Registered')).toThrow('"on" and "Registered" hold tuples of 2 and 1 things, which Alloy does not compare');
    expect(() => say('Ran = c.on')).toThrow('"Ran" and "c.on" hold things of types that share no member');
  });

  /**
   * @canon spec-a-field-of-one-value-equal-to-a-variable-is-said-with-its-reading
   */
  it('says a field of at most one value that equals a variable with the reading of the field', () => {
    expect(say('c.on = o')).toBe('c is on o.');
    expect(say('o = c.on')).toBe('c is on o.');
    expect(say('c.on != o')).toBe('c is not on o.');
  });

  /**
   * @canon spec-a-field-of-many-values-equal-to-a-variable-is-said-member-by-member
   */
  it('says a field of many values that equals a variable member by member', () => {
    const many = withDefinitions(parseReadings('noun Owner: owner\non: {1} is on {2} | {1} is not on {2}'), 'sig Owner {} sig Cleanup { var on: set Owner }');
    // Being on the owner is said with a comma of its own here, so "no other" is not said beside it.
    const comma = withDefinitions(parseReadings('noun Owner: owner\non: {1} is on {2}, as planned | {1} is not on {2}, as planned'), 'sig Owner {} sig Cleanup { var on: set Owner }');
    expect(say('c.on = o', comma)).toMatch(/^For every owner:\n/);
    expect(say('o = c.on', comma)).toMatch(/^For every owner:\n/);
    expect(say("c.on' = o", comma)).toMatch(/^For every owner:\n/);
    const beside = say('(c.on = o and c in Ran) implies c in Registered', withDefinitions(parseReadings('noun Owner: owner\non: {1} is on {2}, as planned | {1} is not on {2}, as planned\nRan: {1} has run | {1} has not run\nRegistered: code has registered {1} | code has not registered {1}'), 'sig Owner {} sig Cleanup { var on: set Owner }'));
    expect(beside).toContain('for every owner:');
    expect(beside).not.toContain('owner O2');
    expect(say('c.on != o', many)).toBe('There is an owner such that exactly one of these holds:\n  - c is on the owner\n  - the owner and o are the same');
  });

  /**
   * @canon spec-two-values-that-are-equal-are-said-member-by-member
   */
  it('says two values that are equal member by member, over the type of the field', () => {
    expect(say('c.on = d.on')).toBe('For every owner:\n  c is on the owner exactly when d is on the owner.');
    expect(say("c.on' = c.on")).toBe('For every owner:\n  c is on the owner at the next moment exactly when c is on the owner now.');
    const beside = say('(c.on = d.on and c in Ran) implies c in Registered');
    expect(beside).toContain('for every owner:');
    expect(beside).not.toContain('owner O2');
    expect(say('c.on != d.on')).toBe('There is an owner such that exactly one of these holds:\n  - c is on the owner\n  - d is on the owner');
  });

  /**
   * @canon spec-a-rule-of-two-clauses-is-said-on-one-line
   */
  it('writes a rule on one line when both sides are one clause', () => {
    expect(say('dispose[o] implies c in Ran')).toBe('When pulse disposes o, c has run.');
  });

  /**
   * @canon spec-a-sentence-starts-with-a-capital-only-where-it-starts-with-its-own-words
   */
  it('starts a sentence with a capital only where the sentence starts with its own words', () => {
    expect(say('c in Ran')).toBe('c has run.');
    expect(say('eventually c in Ran')).toBe('Now or later, c has run.');
  });

  /**
   * @canon spec-eventually-is-said-as-now-or-later
   * @canon spec-after-is-said-as-at-the-next-moment
   * @canon spec-until-is-said-as-two-parts
   */
  it('says the temporal operators', () => {
    expect(say('eventually c in Ran')).toBe('Now or later, c has run.');
    expect(say('after c in Ran')).toBe('At the next moment, c has run.');
    expect(say('(not runNow[c]) until runNow[d]')).toBe(
      ['d runs now or later, and until then, c does not run.'].join('\n')
    );
  });

  /**
   * @canon spec-always-is-said-as-from-now-on
   * @canon spec-before-is-said-as-there-is-a-moment-just-before-and-at-it
   * @canon spec-once-is-said-as-now-or-earlier
   * @canon spec-historically-is-said-as-now-and-at-every-earlier-moment
   */
  it('says always and the past operators of one formula', () => {
    expect(say('always c in Ran')).toBe('From now on, c has run.');
    expect(say('before c in Ran')).toBe('There is a moment just before, and at it, c has run.');
    expect(say('once c in Ran')).toBe('Now or earlier, c has run.');
    expect(say('historically c in Ran')).toBe('Now and at every earlier moment, c has run.');
  });

  /**
   * @canon spec-a-time-phrase-before-words-that-hold-a-time-phrase-sets-them-apart
   */
  it('sets apart below a time phrase the words that hold a time phrase of their own', () => {
    expect(say("always o in Disposed'")).toBe('From now on:\n  at the next moment, pulse has disposed o.');
    expect(say("o in (Disposed')'")).toBe('At the next moment:\n  at the next moment, pulse has disposed o.');
    expect(say('after (c in Ran ; o in Disposed)')).toBe('At the next moment:\n  c has run, and at the next moment, pulse has disposed o.');
    expect(say('eventually (c in Registered until c in Ran)')).toBe(
      ['Now or later:', '  c has run now or later, and until then, code has registered c.'].join('\n')
    );
    expect(say("always (c in Ran and d in Ran')")).toBe('From now on, all of these hold:\n  - c has run\n  - at the next moment, d has run');
    expect(say('always (c in Ran and d in Ran)')).toBe('From now on, all of these hold:\n  - c has run\n  - d has run');
  });

  /**
   * @canon spec-since-is-said-as-two-parts
   * @canon spec-releases-is-said-as-always-or-until
   * @canon spec-triggered-is-said-as-historically-or-since
   * @canon spec-a-sequence-is-said-as-and-at-the-next-moment
   */
  it('says since, releases, triggered and the semicolon', () => {
    expect(say('(not runNow[c]) since runNow[d]')).toBe(
      ['d runs now or earlier, and at every moment after the last such moment, up to and including now, c does not run.'].join('\n')
    );
    expect(say('runNow[d] releases (not runNow[c])')).toBe(
      ['At least one of these holds:', '  - from now on, c does not run', '  - all of these hold:', '      - now or later, the following holds:', '          d runs and c does not run', '      - at every moment from now until the first such moment, not including it, the following holds:', '          c does not run.'].join('\n')
    );
    expect(say('runNow[d] triggered (not runNow[c])')).toBe(
      [
        'At least one of these holds:',
        '  - now and at every earlier moment, c does not run',
        '  - all of these hold:',
        '      - now or earlier, the following holds:',
        '          d runs and c does not run',
        '      - at every moment after the last such moment, up to and including now, the following holds:',
        '          c does not run.'
      ].join('\n')
    );
    expect(say('runNow[c] ; runNow[d]')).toBe('c runs, and at the next moment, d runs.');
  });
});

describe('a predicate with no reading of its own', () => {
  const defined = (vocabulary: string, readings = 'noun Cleanup: cleanup\nRan: {1} has run | {1} has not run\nRegistered: code has registered {1} | code has not registered {1}') =>
    withDefinitions(parseReadings(readings), vocabulary);

  /**
   * @canon spec-a-predicate-with-no-reading-is-said-by-its-body
   */
  it('is said by its body, with the arguments where the parameters were', () => {
    const readings = defined('pred pending[x: Cleanup] { x in Registered and x not in Ran }');
    expect(say('pending[d]', readings)).toBe('Code has registered d and d has not run.');
  });

  /**
   * @canon spec-a-negated-predicate-with-no-reading-is-said-as-untrue
   */
  it('is said as untrue when it is negated, with its body set apart', () => {
    const readings = defined('pred pending[x: Cleanup] { x in Registered and x not in Ran }');
    expect(say('not pending[d]', readings)).toBe('It is not the case that:\n  code has registered d and d has not run.');
    expect(say('not pending[d] and d in Ran', readings)).toBe('All of these hold:\n  - it is not the case that:\n      code has registered d and d has not run\n  - d has run');
  });

  /**
   * @canon spec-a-call-of-a-predicate-gives-its-variables-numbers-that-are-free
   */
  it('gives a quantified variable a numbered name when its name is already in use', () => {
    const readings = defined('pred has_pending { some c: Cleanup | c in Registered and c not in Ran }');
    expect(say('all c: Cleanup | has_pending and c in Ran', readings)).toBe(
      [
        'For every cleanup C1:',
        '  all of these hold:',
        '    - there is a cleanup C2 such that code has registered cleanup C2 and cleanup C2 has not run',
        '    - cleanup C1 has run'
      ].join('\n')
    );
  });

  /**
   * @canon spec-a-variable-of-a-body-never-takes-the-name-of-an-argument
   */
  it('never gives a variable the name of an argument of the call, even when the argument has a name of the same kind', () => {
    const readings = defined('pred registered_other[x: Cleanup] { some c: Cleanup | c in Registered and x in Registered }');
    expect(say('registered_other[cleanup_1]', readings)).toContain('a cleanup C2 such that');
  });

  /**
   * @canon spec-the-alternatives-of-a-list-reuse-a-name-and-keep-it-taken-for-what-follows
   */
  it('lets the alternatives of a list reuse a name, and keeps it taken for what follows', () => {
    const readings = defined('pred p { (some c: Cleanup | c in Registered) or (some c: Cleanup | c in Registered and c in Ran) }');
    expect(say('some c: Cleanup | p and c in Registered', readings)).toContain('- there is a cleanup C2 such that code has registered cleanup C2\n      - there is a cleanup C2 such that');
    expect(say('(some c: Cleanup | c in Registered) or (some c: Cleanup | c in Registered and c in Ran)', readings)).toMatch(
      /^At least one of these holds:\n  - there is a cleanup such that code has registered the cleanup\n  - there is a cleanup such that /
    );
    expect(say('((some c: Cleanup | c in Registered) or (some c: Cleanup | c in Registered and c in Ran)) and (some c: Cleanup | c in Registered)', readings)).toContain('there is a cleanup C2 such that code has registered cleanup C2');
  });

  /**
   * @canon spec-the-statements-of-a-list-each-use-the-same-names
   * @canon spec-conditions-that-hold-together-keep-their-names-apart
   */
  it('lets the statements of a list each use the same names, and keeps joint conditions apart', () => {
    const readings = parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run\nRegistered: code has registered {1} | code has not registered {1}');
    expect(say('(all c: Cleanup | c in Ran) and (all c: Cleanup | c in Registered)', readings)).toBe(
      ['All of these hold:', '  - for every cleanup:', '      the cleanup has run', '  - for every cleanup:', '      code has registered the cleanup.'].join('\n')
    );
    expect(say('(some c: Cleanup | c in Registered) and (some c: Cleanup | c in Registered)', readings)).toContain('there is a cleanup C2 such that code has registered cleanup C2');
  });

  /**
   * @canon spec-some-is-said-with-an-article-chosen-by-the-sound-of-the-noun
   */
  it('says "a unit" and "an owner", by the sound of the word', () => {
    const readings = parseReadings('noun Unit: unit\nnoun Owner: owner\nRan: {1} has run | {1} has not run');
    expect(say('some u: Unit | u in Ran', readings)).toBe('There is a unit that has run.');
    expect(say('some o: Owner | o in Ran', readings)).toBe('There is an owner that has run.');
  });

  /**
   * @canon spec-an-article-the-noun-is-written-with-wins-over-its-sound
   */
  it('takes the article a noun is written with, when the sound of the word is not enough', () => {
    const readings = parseReadings('noun Hour: an hour\nnoun Unit: a unit\nnoun Owner: owner\nRan: {1} has run | {1} has not run');
    expect(say('some h: Hour | h in Ran', readings)).toBe('There is an hour that has run.');
    expect(say('all h: Hour | h in Ran', readings)).toBe('For every hour:\n  the hour has run.');
    expect(say('some o: Owner | o in Ran', readings)).toBe('There is an owner that has run.');
  });

  /**
   * @canon spec-the-reading-of-the-table-wins-over-the-body
   */
  it('prefers the reading the table gives over the body', () => {
    const readings = defined('pred pending[x: Cleanup] { x in Registered }', 'noun Cleanup: cleanup\npending: {1} is waiting | {1} is not waiting');
    expect(say('pending[d]', readings)).toBe('d is waiting.');
  });

  /**
   * @canon spec-a-predicate-whose-body-cannot-be-said-is-refused-with-advice-to-give-it-a-reading
   */
  it('is refused when its body cannot be said, and the error says to give it a reading', () => {
    const readings = defined("pred step[x: Cleanup] { Ran' = Ran + x }");
    expect(() => say('step[d]', readings)).toThrow(/no reading for "step", and its body cannot be said/);
    expect(() => say('step[d]', defined('pred step[x: Cleanup] { x in Ran  x.^on in Registered }'))).toThrow(/no reading for "step"/);
  });

  /**
   * @canon spec-a-predicate-defined-in-terms-of-itself-is-refused
   * @canon spec-a-call-with-the-wrong-number-of-arguments-is-refused
   */
  it('is refused when it is defined in terms of itself, or called with the wrong number of arguments', () => {
    expect(() => say('loop[d]', defined('pred loop[x: Cleanup] { loop[x] }'))).toThrow('defined in terms of itself');
    expect(() => say('pending[d, d]', defined('pred pending[x: Cleanup] { x in Registered }'))).toThrow('takes 1 arguments, not 2');
  });

  /**
   * @canon spec-the-checker-reads-the-predicates-a-vocabulary-declares
   */
  it('reads a vocabulary for its predicates, their parameters and their bodies', () => {
    const definitions = parseDefinitions('sig A {}\npred p[a, b: A, c: A] { a in B  and { x } }\npred q { y in Z }');
    expect([...definitions.keys()]).toEqual(['p', 'q']);
    expect(definitions.get('p')?.params).toEqual(['a', 'b', 'c']);
    expect(definitions.get('q')?.params).toEqual([]);
    expect(definitions.get('p')?.body).toMatchObject({ t: 'and', items: [{ t: 'cmp', op: 'in' }, { t: 'name', name: 'x' }] });
  });
});

describe('a definition', () => {
  const readings = parseReadings(
    ['noun Unit: unit', 'noun Spec: spec', 'Spec: {1} is a spec | {1} is not a spec', 'Sits.rel: {1} sits in {2} | {1} does not sit in {2}', 'orphan: {1} is an orphan | {1} is not an orphan', 'pair: {1} and {2} are a pair | {1} and {2} are not a pair'].join('\n')
  );

  /**
   * @canon spec-a-passage-that-starts-with-pred-is-a-definition
   */
  it('is recognized by its keyword', () => {
    expect(isDefinition('pred orphan[u: Unit] { u in Spec }')).toBe(true);
    expect(isDefinition('all u: Unit | u in Spec')).toBe(false);
  });

  /**
   * @canon spec-a-definition-says-what-it-names-exactly-when-its-body-holds-for-every-parameter
   */
  it('says what it names exactly when its body holds, for every value of its parameters', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] { u in Spec and no v: Unit | u->v in Sits.rel }', readings)).toBe(
      'A unit is an orphan exactly when the unit is a spec that sits in no unit.'
    );
  });

  /**
   * @canon spec-a-definition-that-marks-its-variables-disj-is-said-with-them-different
   */
  it('says a definition with disj variables, and a call of it by its body, with the variables different', () => {
    const vocabulary = 'sig Cleanup {} var sig Ran in Cleanup {} pred pair[disj c, d: Cleanup] { c in Ran } pred both[disj c, d: Cleanup] { c in Ran }';
    const readings = withDefinitions(parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run\npair: {1} pairs with {2} | {1} does not pair with {2}'), vocabulary);
    expect(verbalizeDefinition('pred pair[disj c, d: Cleanup] { c in Ran }', readings)).toBe(
      'For every cleanup C1 and every cleanup C2:\n  cleanup C1 pairs with cleanup C2 exactly when all of these hold:\n    - cleanup C1 and cleanup C2 are different\n    - cleanup C1 has run'
    );
    expect(say('both[a, b]', readings)).toBe('All of these hold:\n  - a and b are different\n  - a has run');
  });

  /**
   * @canon spec-a-definition-with-a-body-of-one-clause-is-said-on-one-line
   */
  it('says a body of one clause on one line', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] { u in Spec }', readings)).toBe('A unit is an orphan exactly when the unit is a spec.');
  });

  /**
   * @canon spec-a-definition-whose-body-is-a-series-sets-it-apart
   */
  it('sets apart a body that is a series, which could end before its last clause', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] { u in Spec ; u in Spec }', readings)).toBe(
      'A unit is an orphan exactly when the following holds:\n  the unit is a spec, and at the next moment, the unit is a spec.'
    );
    expect(verbalizeDefinition('pred orphan[u: Unit] { u in Spec until u in Spec }', readings).split('\n')[0]).toBe('A unit is an orphan exactly when the following holds:');
  });

  /**
   * @canon spec-a-definition-says-each-parameter-with-the-noun-of-its-type
   */
  it('says each parameter of several, with the noun of its type', () => {
    expect(verbalizeDefinition('pred pair[a, b: Unit] { a->b in Sits.rel }', readings)).toBe(
      'For every unit U1 and every unit U2:\n  unit U1 and unit U2 are a pair exactly when unit U1 sits in unit U2.'
    );
  });

  /**
   * @canon spec-a-definition-is-said-in-markdown-the-way-a-formula-is
   */
  it('is said in Markdown the way a formula is', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] { u in Spec or u in Spec }', readings, 'markdown')).toBe(
      'A unit is an orphan exactly when the unit is a spec or is a spec.'
    );
  });

  /**
   * @canon spec-a-definition-of-a-word-with-no-reading-is-refused
   */
  it('needs the words for what it names, and says which are missing', () => {
    expect(() => verbalizeDefinition('pred mystery[u: Unit] { u in Spec }', readings)).toThrow('no reading for "mystery"');
  });

  /**
   * @canon spec-text-that-is-not-a-definition-is-refused
   * @canon spec-a-parameter-with-no-type-is-refused
   */
  it('refuses text that is not a definition, and a parameter with no type', () => {
    expect(() => verbalizeDefinition('u in Spec', readings)).toThrow('a definition is written');
    expect(() => verbalizeDefinition('pred orphan[u] { u in Spec }', readings)).toThrow('expected ":", found "]"');
  });

  /**
   * @canon spec-a-definition-whose-body-is-a-rule-is-said-with-the-rule-set-apart
   */
  it('says a body that is a rule or a "for every" set apart, after "exactly when the following holds"', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] { u in Spec implies u in Spec }', readings)).toBe(
      'A unit is an orphan exactly when the following holds:\n  when the unit is a spec, the unit is a spec.'
    );
    expect(verbalizeDefinition('pred orphan[u: Unit] { all v: Unit | u->v in Sits.rel }', readings)).toBe(
      'For every unit U1:\n  unit U1 is an orphan exactly when the following holds:\n    for every unit U2:\n      unit U1 sits in unit U2.'
    );
  });

  /**
   * @canon spec-a-passage-that-starts-with-fun-is-a-definition
   */
  it('is recognized by the keyword fun too, and by private before either', () => {
    expect(isDefinition('fun home[u: Unit]: Unit { u.(Sits.rel) }')).toBe(true);
    expect(isDefinition('private pred orphan[u: Unit] { u in Spec }')).toBe(true);
  });

  /**
   * @canon spec-private-before-a-definition-changes-nothing-that-is-said
   */
  it('says a private definition as the definition', () => {
    expect(verbalizeDefinition('private pred orphan[u: Unit] { u in Spec }', readings)).toBe('A unit is an orphan exactly when the unit is a spec.');
  });

  /**
   * @canon spec-parameters-in-round-brackets-are-read-as-in-square-ones
   */
  it('reads parameters in round brackets as in square ones', () => {
    expect(verbalizeDefinition('pred orphan(u: Unit) { u in Spec }', readings)).toBe('A unit is an orphan exactly when the unit is a spec.');
    expect(say('settled[d]', withDefinitions(parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run'), 'sig Cleanup {} var sig Ran in Cleanup {} pred settled(x: Cleanup) { x in Ran }'))).toBe('d has run.');
  });

  /**
   * @canon spec-a-comma-before-or-after-the-parameters-is-read-as-none
   */
  it('reads a comma at either end of the parameters as none', () => {
    for (const params of ['[, u: Unit]', '[u: Unit,]']) expect(verbalizeDefinition(`pred orphan${params} { u in Spec }`, readings)).toBe('A unit is an orphan exactly when the unit is a spec.');
  });

  /**
   * @canon spec-a-predicate-of-a-signature-takes-this-as-its-first-parameter
   */
  it('reads a predicate of a signature with this as its first parameter', () => {
    expect(verbalizeDefinition('pred Unit.orphan { this in Spec }', readings)).toBe('A unit is an orphan exactly when the unit is a spec.');
    expect(verbalizeDefinition('pred Unit.pair[v: Unit] { this->v in Sits.rel }', readings)).toBe('For every unit U1 and every unit U2:\n  unit U1 and unit U2 are a pair exactly when unit U1 sits in unit U2.');
    const called = withDefinitions(parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run'), 'sig Cleanup {} var sig Ran in Cleanup {} pred Cleanup.settled { this in Ran }');
    expect(say('d.settled', called)).toBe('d has run.');
    expect(say('settled[d]', called)).toBe('d has run.');
  });

  /**
   * @canon spec-a-body-of-several-formulas-is-said-as-them-holding-together
   */
  it('says a body of several formulas as them holding together', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] {\n  u in Spec\n  no v: Unit | u->v in Sits.rel\n}', readings)).toBe('A unit is an orphan exactly when the unit is a spec that sits in no unit.');
    expect(say('{\n  c in Ran\n  d in Ran\n}')).toBe('c has run and d has run.');
  });

  /**
   * @canon spec-an-empty-body-is-said-as-what-the-definition-names
   */
  it('says a definition with an empty body as what it names', () => {
    expect(verbalizeDefinition('pred orphan[u: Unit] {}', readings)).toBe('For every unit:\n  the unit is an orphan.');
  });

  /**
   * @canon spec-a-parameter-that-can-hold-several-things-or-none-is-refused
   */
  it('refuses a parameter that can hold several things or none', () => {
    expect(() => verbalizeDefinition('pred orphan[u: set Unit] { u in Spec }', readings)).toThrow('the parameter "u" can hold none or several things');
    expect(() => verbalizeDefinition('pred orphan[u: Unit -> Unit] { some u }', readings)).toThrow('the parameter "u" can hold none or several things');
  });

  /**
   * @canon spec-one-before-the-type-of-a-variable-is-said-as-the-type
   */
  it('says one before the type of a parameter as the type', () => {
    expect(verbalizeDefinition('pred orphan[u: one Unit] { u in Spec }', readings)).toBe('A unit is an orphan exactly when the unit is a spec.');
  });

  /**
   * @canon spec-a-function-is-said-as-its-value-holding-a-member-exactly-when-its-body-does
   */
  it('says a function as its value holding a member exactly when its body does', () => {
    const homes = parseReadings(['noun Unit: unit', 'Sits.rel: {1} sits in {2} | {1} does not sit in {2}', 'home: {2} is a home of {1} | {2} is not a home of {1}'].join('\n'));
    expect(verbalizeDefinition('fun home[u: Unit]: Unit { u.(Sits.rel) }', homes)).toBe('For every unit U1 and every unit U2:\n  unit U2 is a home of unit U1 exactly when unit U1 sits in unit U2.');
    expect(verbalizeDefinition('fun home[u: Unit]: set Unit { u.(Sits.rel) }', homes)).toBe('For every unit U1 and every unit U2:\n  unit U2 is a home of unit U1 exactly when unit U1 sits in unit U2.');
  });

  /**
   * @canon spec-a-macro-as-a-definition-is-refused
   */
  it('refuses a macro as a definition', () => {
    expect(isDefinition('let m[x] = x in Spec')).toBe(true);
    expect(() => verbalizeDefinition('let m[x] = x in Spec', readings)).toThrow('a parameter of a macro has no type');
  });
});

describe('the words several clauses share', () => {
  const shared = withDefinitions(
    parseReadings(
      [
        'noun Unit: unit', 'noun Spec: spec', 'noun Bug: bug', 'Cite.rel: {1} cites {2} | {1} does not cite {2}', 'kept: {1} is kept | {1} is not kept',
        'A: {1} is a definition with an alternative A | {1} is not a definition with an alternative A',
        'B: {1} is a definition with an alternative B | {1} is not a definition with an alternative B'
      ].join('\n')
    ),
    'sig Unit {} sig Spec, Bug extends Unit {} sig A, B in Unit {} sig Cite { rel: Unit -> Unit }'
  );

  /**
   * @canon spec-words-said-once-for-several-clauses-hold-no-noun-phrase
   */
  it('are said once only up to their first noun phrase: a subject, "is not" and "is"', () => {
    // Clauses that share more than their subject, "is a definition with", say only the subject once.
    expect(verbalize('all u: Unit | u in A and u in B', shared)).toBe('For every unit:\n  the unit is a definition with an alternative A and is a definition with an alternative B.');
    // Negations of a noun phrase's variable share "is not", and each says its own "a definition with".
    expect(verbalize('all v: Unit | some u: Unit | v->u in Cite.rel and u not in A and u not in B', shared)).toBe(
      'For every unit:\n  the unit cites a unit that is not a definition with an alternative A or a definition with an alternative B.'
    );
    // The kinds of a definition share "is", and each says what else holds of its kind in full.
    expect(verbalizeDefinition('pred kept[u: Unit] { (u in Spec and u in A) or (u in Bug and u in B) }', shared)).toBe(
      'A unit is kept exactly when the unit is one of these:\n  - a spec that is a definition with an alternative A\n  - a bug that is a definition with an alternative B'
    );
  });
});

describe('a definition by cases', () => {
  const readings = withDefinitions(parseReadings(
    [
      'noun Unit: unit', 'noun Issue: issue',
      'Spec: {1} is a spec | {1} is not a spec', 'Bug: {1} is a bug | {1} is not a bug', 'Axiom: {1} is an axiom | {1} is not an axiom',
      'Cite.rel: {1} cites {2} | {1} does not cite {2}', 'Name.rel: {1} names {2} | {1} does not name {2}', 'Known: tracker knows {1} | tracker does not know {1}',
      'Tested: {1} is tested | {1} is not tested',
      'unfounded: {1} is unfounded | {1} is not unfounded', 'hidden: {1} is hidden | {1} is not hidden', 'odd: {1} is odd | {1} is not odd'
    ].join('\n')
  ), 'sig Issue {} sig Unit {} sig Spec, Bug, Axiom extends Unit {} sig Known in Issue {} sig Tested in Unit {} sig Cite, Name { rel: Unit -> univ }');
  const define = (body: string, name = 'unfounded'): string => inside(verbalizeDefinition(`pred ${name}[u: Unit] { ${body} }`, readings));

  /**
   * @canon spec-a-definition-by-cases-is-said-as-a-noun-phrase-for-each-kind
   */
  it('is said as a noun phrase for each kind: "a spec that cites no axiom and cites no spec"', () => {
    expect(define('(u in Spec and (no a: Unit | u->a in Cite.rel) and u not in Bug) or (u in Bug and (no s: Unit | u->s in Cite.rel))')).toBe(
      ['A unit is unfounded exactly when the unit is one of these:', '  - a spec that cites no unit and is not a bug', '  - a bug that cites no unit'].join('\n')
    );
  });

  /**
   * @canon spec-the-alternatives-of-one-kind-are-put-together-with-or
   */
  it('puts the alternatives of one kind together with "or"', () => {
    expect(define('(u in Spec and (no a: Unit | u->a in Cite.rel)) or (u in Spec and u not in Bug) or (u in Bug and (no s: Unit | u->s in Cite.rel))')).toBe(
      ['A unit is unfounded exactly when the unit is one of these:', '  - a spec that cites no unit or is not a bug', '  - a bug that cites no unit'].join('\n')
    );
  });

  /**
   * @canon spec-the-options-of-an-or-inside-a-kind-are-one-coordination
   */
  it('says the options of an "or" inside a kind as one coordination', () => {
    expect(define('(u in Bug and ((no i: Issue | u->i in Name.rel) or (some i: Issue | u->i in Name.rel and i not in Known) or u not in Tested))', 'hidden')).toBe(
      'A unit is hidden exactly when the unit is a bug that names no issue, names an issue that tracker does not know or is not tested.'
    );
  });

  /**
   * @canon spec-a-definition-with-one-kind-is-one-sentence
   */
  it('is one sentence when there is one kind', () => {
    expect(define('u in Spec and (no a: Unit | u->a in Cite.rel)')).toBe('A unit is unfounded exactly when the unit is a spec that cites no unit.');
  });

  /**
   * @canon spec-a-definition-by-cases-is-said-as-it-stands-when-an-alternative-does-not-begin-with-its-kind
   */
  it('is said as it stands when an alternative does not begin with its kind', () => {
    expect(define('(u in Spec and u not in Bug) or u not in Axiom').split('\n')[0]).toBe('A unit is unfounded exactly when at least one of these holds:');
    expect(define('(u in Spec) or (u in Bug and u not in Spec)').split('\n')[0]).toBe('A unit is unfounded exactly when at least one of these holds:');
  });

  /**
   * @canon spec-a-definition-by-cases-is-said-as-it-stands-when-a-run-of-and-would-read-two-ways
   */
  it('is said as it stands when a run of "and" would be read two ways beside another alternative of its kind', () => {
    expect(define('(u in Spec and u not in Bug and u not in Axiom) or (u in Spec and (no a: Unit | u->a in Cite.rel)) or (u in Bug and u not in Spec)').split('\n')[0]).toBe(
      'A unit is unfounded exactly when at least one of these holds:'
    );
  });

  /**
   * @canon spec-a-definition-by-cases-is-said-as-it-stands-when-an-alternative-is-not-about-its-subject
   */
  it('is said as it stands when what an alternative says is not about its subject', () => {
    expect(define('(u in Spec and (some a: Unit | a->u in Cite.rel and a in Spec)) or (u in Bug and u not in Spec)').split('\n')[0]).toBe(
      'unit U1 is unfounded exactly when at least one of these holds:'
    );
  });

  /**
   * @canon spec-a-definition-by-cases-is-said-as-it-stands-when-an-option-of-a-kind-holds-a-comma
   */
  it('is said as it stands when an option of a kind holds a comma and the kind has more than two options', () => {
    const cites = 'some v: Unit | u->v in Cite.rel and v not in Axiom and v not in Spec and v not in Bug';
    expect(define(`(u in Bug and ((${cites}) or u not in Tested or u not in Spec)) or (u in Spec and u not in Tested)`).split('\n')[0]).toBe(
      'unit U1 is unfounded exactly when at least one of these holds:'
    );
  });

  /**
   * @canon bug-a-kind-of-two-options-with-a-comma-is-said-as-one-run
   */
  it.fails('is said as it stands when an option of a kind holds a comma and the kind has two options', () => {
    const cites = 'some v: Unit | u->v in Cite.rel and v not in Axiom and v not in Spec and v not in Bug';
    expect(define(`(u in Bug and ((${cites}) or u not in Tested)) or (u in Spec and u not in Tested)`).split('\n')[0]).toBe(
      'unit U1 is unfounded exactly when at least one of these holds:'
    );
  });

  /**
   * @canon spec-a-definition-by-cases-is-said-as-it-stands-when-two-of-its-kinds-can-share-a-member
   */
  it('is said as it stands when two of its kinds can share a member', () => {
    const body = 'pred unfounded[u: Unit] { (u in Spec and u in Tested) or (u in Bug and u not in Tested) }';
    const kinds = (vocabulary: string): string => verbalizeDefinition(body, withDefinitions(parseReadings(['noun Unit: unit', 'Spec: {1} is a spec | {1} is not a spec', 'Bug: {1} is a bug | {1} is not a bug', 'Tested: {1} is tested | {1} is not tested', 'unfounded: {1} is unfounded | {1} is not unfounded'].join('\n')), vocabulary)).split('\n')[0] as string;
    expect(kinds('sig Unit {} sig Spec, Bug in Unit {} sig Tested in Unit {}')).toBe('A unit is unfounded exactly when at least one of these holds:');
    expect(kinds('sig Unit {} sig Spec, Bug extends Unit {} sig Tested in Unit {}')).toBe('A unit is unfounded exactly when the unit is one of these:');
  });
});

describe('two variables', () => {
  /**
   * @canon spec-two-variables-are-said-to-be-different-or-the-same
   */
  it('are said to be different or the same', () => {
    expect(say('a != b')).toBe('a and b are different.');
    expect(say('not a != b')).toBe('a and b are the same.');
    expect(say('a = b')).toBe('a and b are the same.');
  });
});

describe('a word that names a term', () => {
  const readings = parseReadings(
    ['noun Unit: [unit]', 'noun Owner: an [owner]', 'Ran: {1} has [run] | {1} has not [run]', 'Done: {1} is [done] | {1} is not [done]', 'Told: [checker](#term-checker) tells {1} | [checker](#term-checker) tells no one', 'Alarm: [alarm] rings for {1} | no [alarm] rings for {1}'].join('\n'),
    '#term-x'
  );
  const markdown = (source: string, self?: string): string => verbalize(source, readings, 'markdown', self);

  /**
   * @canon spec-a-word-that-names-a-term-links-to-the-unit-that-holds-its-reading-in-markdown
   */
  it('links to the unit that holds the reading, in the Markdown layout', () => {
    expect(markdown('a in Ran')).toBe('a has [run](#term-x).');
  });

  /**
   * @canon spec-a-word-its-caller-marks-is-a-term-mark-in-markdown
   */
  it('writes a term mark where its caller marks the word, and a link where it does not', () => {
    const marked = (target: string, word: string): boolean => target === '#term-x' && word === 'run';
    expect(verbalize('a in Ran', readings, 'markdown', undefined, marked)).toBe('a has [*run*](#term-x).');
    expect(verbalize('a in Done', readings, 'markdown', undefined, marked)).toBe('a is [done](#term-x).');
    expect(verbalize('a in Ran', readings, 'text', undefined, marked)).toBe('a has run.');
  });

  /**
   * @canon spec-a-word-that-names-a-term-is-plain-in-the-text-layout
   */
  it('is plain in the text layout, which has no links', () => {
    expect(verbalize('a in Ran', readings)).toBe('a has run.');
  });

  /**
   * @canon spec-only-the-first-mention-of-a-term-links
   */
  it('links only the first mention of a term, in the order a reader meets it', () => {
    expect(markdown('a in Ran and b in Ran and c in Done')).toBe(
'a has [run](#term-x), b has run and c is done.'
    );
  });

  /**
   * @canon spec-a-word-never-links-to-the-unit-its-sentence-is-in
   */
  it('is never a link to the unit the sentence is in', () => {
    expect(markdown('a in Ran', '#term-x')).toBe('a has run.');
    expect(markdown('a in Ran and b in Told', '#term-x')).toContain('[checker](#term-checker) tells b');
  });

  /**
   * @canon spec-a-reading-that-points-at-a-unit-links-to-it
   */
  it('links to the unit it points at when it says one', () => {
    expect(markdown('a in Told')).toBe('[Checker](#term-checker) tells a.');
  });

  /**
   * @canon spec-a-link-in-a-table-held-in-another-document-goes-through-its-path
   */
  it('goes through the path of the document that holds a reading, for a link in it to an anchor of that document', () => {
    const other = parseReadings('Told: [checker](#term-checker) tells {1} | [checker](#term-checker) tells no one', 'canon/CANON.md#term-x', 'canon/CANON.md');
    expect(verbalize('a in Told', other, 'markdown')).toBe('[Checker](canon/CANON.md#term-checker) tells a.');
  });

  /**
   * @canon spec-a-reading-that-points-at-a-unit-links-to-it
   */
  it('links to a unit of another document by its whole target, when the reading points at one', () => {
    const other = parseReadings('Told: [checker](../canon/CANON.md#term-checker) tells {1} | [checker](../canon/CANON.md#term-checker) tells no one', '#term-x');
    expect(verbalize('a in Told', other, 'markdown')).toBe('[Checker](../canon/CANON.md#term-checker) tells a.');
  });

  /**
   * @canon spec-the-nouns-of-a-quantifier-link-and-the-article-follows-the-word
   */
  it('links the nouns of a quantifier, and picks the article by the word and not the brackets', () => {
    expect(markdown('some o: Owner | o in Ran')).toBe('There is an [owner](#term-x) that has run.');
    expect(markdown('all u: Unit | u in Done')).toBe('For every [unit](#term-x):\\\nthe unit is done.');
  });

  /**
   * @canon spec-a-sentence-starts-with-a-capital-on-the-word-and-not-on-the-bracket
   */
  it('starts a sentence with a capital on the word and not on the bracket', () => {
    expect(markdown('a in Alarm')).toBe('[Alarm](#term-x) rings for a.');
    expect(verbalize('a in Alarm', readings)).toBe('Alarm rings for a.');
    expect(verbalize('a in Alarm', readings, 'markdown', undefined, () => true)).toBe('[*Alarm*](#term-x) rings for a.');
  });

  /**
   * @canon spec-a-reading-held-by-no-unit-has-plain-words
   */
  it('is only a word where the reading is held by no unit', () => {
    const loose = parseReadings('Ran: {1} has [run] | {1} has not [run]');
    expect(verbalize('a in Ran', loose, 'markdown')).toBe('a has run.');
  });

  /**
   * @canon spec-a-bracket-with-no-partner-is-refused
   */
  it('is refused when a bracket has no partner', () => {
    expect(() => parseReadings('Ran: {1} has [run | {1} has not run')).toThrow('a bracket in the line of readings has no partner');
    expect(() => parseReadings('noun Unit: unit]')).toThrow('has no partner');
  });
});

describe('a quantifier said as a noun phrase', () => {
  const readings = parseReadings(
    [
      'noun Unit: unit', 'noun Test: test', 'noun Bug: bug', 'noun Issue: issue', 'noun Tag: tag',
      'Spec: {1} is a spec | {1} is not a spec', 'Axiom: {1} is an axiom | {1} is not an axiom', 'Fact: {1} is a fact | {1} is not a fact',
      'Sit.rel: {1} sits in {2} | {1} does not sit in {2}', 'Check.rel: {1} checks {2} | {1} does not check {2}',
      'Name.rel: {1} names {2} | {1} does not name {2}', 'Twice.rel: {1} sits in {2} and in {2} | {1} does not sit in {2}',
      'Known: tracker knows {1} | tracker does not know {1}'
    ].join('\n')
  );
  const said = (formula: string): string => inside(verbalize(`all u: Unit | ${formula}`, readings));

  /**
   * @canon spec-a-variable-said-once-takes-the-place-of-its-quantifier-as-a-noun-phrase
   */
  it('takes the place of the variable when the variable is said once: "sits in no unit"', () => {
    expect(said('no v: Unit | u->v in Sit.rel')).toBe('the unit sits in no unit.');
    expect(said('some v: Unit | u->v in Sit.rel')).toBe('the unit sits in a unit.');
  });

  /**
   * @canon spec-a-noun-phrase-can-be-the-subject-of-a-sentence
   */
  it('can be the subject: "a tag names unit U1"', () => {
    expect(said('some p: Tag | p->u in Name.rel')).toBe('a tag names the unit.');
    expect(said('no p: Tag | p->u in Name.rel')).toBe('no tag names the unit.');
  });

  /**
   * @canon spec-what-else-is-true-of-the-variable-is-a-relative-clause
   */
  it('says what else is true of the variable in a relative clause', () => {
    expect(said('some v: Unit | u->v in Sit.rel and v in Spec')).toBe('the unit sits in a unit that is a spec.');
    expect(said('some v: Unit | u->v in Sit.rel and v not in Spec')).toBe('the unit sits in a unit that is not a spec.');
    expect(said('some i: Issue | u->i in Name.rel and i not in Known')).toBe('the unit names an issue that tracker does not know.');
    expect(said('some v: Unit | u->v in Sit.rel and v->u in Sit.rel')).toBe('unit U1 sits in a unit that sits in unit U1.');
  });

  /**
   * @canon spec-several-negations-of-a-variable-are-one-negation
   */
  it('puts several negations in one: "that is not an axiom, a spec or a fact"', () => {
    expect(said('some v: Unit | u->v in Sit.rel and v not in Axiom and v not in Spec and v not in Fact')).toBe(
      'the unit sits in a unit that is not an axiom, a spec or a fact.'
    );
  });

  /**
   * @canon spec-a-variable-that-must-differ-from-another-of-its-kind-is-said-as-another
   */
  it('says "another" for a variable that must not be the other one of its kind', () => {
    expect(said('some v: Unit | v != u and v->u in Sit.rel')).toBe('another unit sits in unit U1.');
    expect(said('some a, b: Unit | a != b and u->a in Name.rel and u->b in Name.rel')).toBe('the unit names a unit and names another unit.');
  });

  /**
   * @canon spec-a-variable-that-must-differ-from-one-value-is-said-as-other-than-it
   */
  it('says "other than" for a variable that must differ from one value, and in full when it must differ from more', () => {
    expect(said('some v: Unit | u->v in Sit.rel and v != w')).toBe('the unit sits in a unit other than w.');
    expect(said('some v: Unit | u->v in Sit.rel and not v = w')).toBe('the unit sits in a unit other than w.');
    expect(said('some v: Unit | u->v in Sit.rel and v != w and v != x')).toBe('there is a unit U2 such that all of these hold:\n    - unit U1 sits in unit U2\n    - unit U2 and w are different\n    - unit U2 and x are different');
  });

  /**
   * @canon spec-variables-of-different-kinds-nest-as-phrases
   */
  it('nests when the variables are of different kinds: "a test checks a bug that sits in unit U1"', () => {
    expect(said('some t: Test, b: Bug | t->b in Check.rel and b->u in Sit.rel')).toBe('a test checks a bug that sits in the unit.');
  });

  /**
   * @canon spec-a-quantifier-with-a-time-phrase-in-one-of-several-conditions-is-said-in-full
   */
  it('is said in full when a time phrase begins one of several conditions', () => {
    expect(verbalize("some o: Owner | o in c.on' and p in o.parent", READINGS)).toBe('There is an owner such that all of these hold:\n  - at the next moment, c is on the owner\n  - p is the parent of the owner');
    expect(verbalize("p in c.on'.parent", READINGS)).toBe('There is an owner such that all of these hold:\n  - at the next moment, c is on the owner\n  - p is the parent of the owner');
    expect(verbalize("some o: Owner | o in c.on'", READINGS)).toBe('At the next moment, c is on an owner.');
  });

  /**
   * @canon spec-a-quantifier-whose-variable-would-be-said-twice-is-said-in-full
   * @canon spec-a-quantifier-with-nothing-to-attach-to-is-said-in-full
   * @canon spec-no-with-another-is-said-in-full
   */
  it('is said in full when it does not fit', () => {
    // no fact for the variable beside another thing, and the variable not the subject of every condition
    expect(said('some v: Unit | v in Known')).toBe('there is a unit U2 such that tracker knows unit U2.');
    // a reading that says the variable twice
    expect(said('some v: Unit | u->v in Twice.rel')).toBe('there is a unit U2 such that unit U1 sits in unit U2 and in unit U2.');
    // "no" with "another" says something else than "another"
    expect(said('no v: Unit | v != u and v->u in Sit.rel')).toBe('there is no unit U2 such that all of these hold:\n    - unit U2 and unit U1 are different\n    - unit U2 sits in unit U1');
  });

  /**
   * @canon spec-a-condition-that-is-not-about-the-variable-is-said-apart
   */
  it('says a condition that is not about the variable beside the quantifier, outside it', () => {
    expect(said('some v: Unit | u->v in Sit.rel and u in Spec')).toBe('the unit sits in a unit and is a spec.');
  });

  /**
   * @canon spec-a-condition-under-no-that-is-not-about-the-variable-is-said-in-full
   */
  it('keeps the quantifier in full under "no" when a condition is not about its variable', () => {
    expect(said('no v: Unit | u->v in Sit.rel and u in Spec')).toBe('there is no unit U2 such that unit U1 sits in unit U2 and is a spec.');
  });
});

describe('a quantifier about its variable alone', () => {
  const readings = parseReadings(
    ['noun Unit: unit', 'Spec: {1} is a spec | {1} is not a spec', 'Axiom: {1} is an axiom | {1} is not an axiom', 'Fact: {1} is a fact | {1} is not a fact', 'Twice.rel: {1} sits in {2} and in {2} | {1} does not sit in {2} and in {2}'].join('\n'),
    '#term-x'
  );
  const said = (formula: string): string => verbalize(formula, readings);

  /**
   * @canon spec-a-quantifier-about-its-variable-alone-is-said-with-there-is-and-that
   */
  it('says "there is" with the noun and a relative clause, and "no" before one condition', () => {
    expect(said('some v: Unit | v in Spec')).toBe('There is a unit that is a spec.');
    expect(said('some v: Unit | v in Spec and v in Axiom')).toBe('There is a unit that is a spec and is an axiom.');
    expect(said('no v: Unit | v in Spec')).toBe('No unit is a spec.');
    expect(said('no v: Unit | v in Spec and v not in Axiom')).toBe('There is no unit that is a spec and is not an axiom.');
  });

  /**
   * @canon spec-many-conditions-about-a-variable-alone-are-bullets-after-there-is-that
   */
  it('says many conditions as bullets after "there is a … that:"', () => {
    expect(said('some v: Unit | v in Spec and v in Axiom and v in Fact and v not in Spec')).toBe('There is a unit that:\n  - is a spec\n  - is an axiom\n  - is a fact\n  - is not a spec');
  });

  /**
   * @canon spec-a-quantifier-with-nothing-to-attach-to-is-said-in-full
   */
  it('says it in full when the conditions under "no" are many, or when "no" would meet "no"', () => {
    expect(said('no v: Unit | v in Spec and v in Axiom and v in Fact and v not in Spec')).toMatch(/^There is no unit such that all of these hold:/);
    expect(said('no v: Unit | no w: Unit | v->w in Twice.rel')).toMatch(/^There is no unit U1 such that /);
  });
});

describe('a set equal to a variable', () => {
  const readings = withDefinitions(
    parseReadings(['noun Cleanup: cleanup', 'noun Owner: owner', 'on: {1} is on {2} | {1} is not on {2}', 'parent: {2} is the parent of {1} | {2} is not the parent of {1}', 'Disposed: pulse has disposed {1} | pulse has not disposed {1}'].join('\n')),
    'sig Owner { parent: lone Owner } sig Cleanup { var on: set Owner } var sig Disposed in Owner {}'
  );
  const say = (formula: string): string => verbalize(formula, readings);
  /**
   * @canon spec-a-set-equal-to-a-variable-is-said-as-the-variable-and-no-other
   */
  it('says the variable in the set, and no other member of its type', () => {
    expect(say('all c: Cleanup, o: Owner | c.on = o')).toBe('For every cleanup and every owner:\n  the cleanup is on the owner and is on no other owner.');
    expect(say("all c: Cleanup, o: Owner | o = c.on'")).toBe('For every cleanup and every owner:\n  at the next moment, the cleanup is on the owner and is on no other owner.');
    expect(say('all o: Owner | Disposed = o')).toBe('For every owner:\n  pulse has disposed the owner and pulse has disposed no other owner.');
  });

  /**
   * @canon spec-a-field-of-many-values-equal-to-a-variable-is-said-member-by-member
   */
  it('says it member by member when being in the set is more than one plain clause', () => {
    expect(say('all c: Cleanup, o: Owner | c.on.parent = o')).toContain('owner O2 and owner O1 are the same');
  });
});

describe('the items of a list said in a sentence', () => {
  const readings = parseReadings(
    ['noun Unit: unit', 'Spec: {1} is a spec | {1} is not a spec', 'Axiom: {1} is an axiom | {1} is not an axiom', 'Fact: {1} is a fact | {1} is not a fact', 'Sit.rel: {1} sits in {2} | {1} does not sit in {2}', 'Alarm: [alarm] rings for {1} | no [alarm] rings for {1}'].join('\n'),
    '#term-x'
  );
  const said = (formula: string): string => inside(verbalize(`all u: Unit | ${formula}`, readings));

  /**
   * @canon spec-three-clauses-or-fewer-are-said-in-a-sentence
   */
  it('are put in a sentence when there are three or fewer, and none is more than a clause', () => {
    expect(said('u in Spec and u in Axiom')).toBe('the unit is a spec and is an axiom.');
    expect(said('u in Spec or u in Axiom or u in Fact')).toBe('the unit is a spec, is an axiom or is a fact.');
  });

  /**
   * @canon spec-a-list-of-more-than-three-clauses-is-bullets
   * @canon spec-a-list-with-a-comma-in-an-item-and-more-than-two-clauses-is-bullets
   */
  it('are a list when there are more, or when one holds a comma and there are more than two', () => {
    expect(said('u in Spec and u in Axiom and u in Fact and u not in Spec').split('\n')[0]).toBe('all of these hold:');
    expect(said('u in Spec and u in Axiom and (some v: Unit | u->v in Sit.rel and v not in Spec and v not in Axiom and v not in Fact)').split('\n')[0]).toBe('all of these hold:');
  });

  /**
   * @canon spec-negative-clauses-that-share-their-words-are-said-once-before-none-of-these
   */
  it('say the words negative clauses share once, before "none of these", with each noun phrase as a bullet', () => {
    const kinds = parseReadings(['noun Unit: unit', 'Spec: {1} is a spec | {1} is not a spec', 'Axiom: {1} is an axiom | {1} is not an axiom', 'Fact: {1} is a fact | {1} is not a fact', 'Term: {1} is a term | {1} is not a term', 'Ran: {1} has run | {1} has not run'].join('\n'));
    const words = (formula: string): string => verbalize(`all u: Unit | ${formula}`, kinds).split('\n').slice(1).join('\n');
    expect(words('u not in Spec and u not in Axiom and u not in Fact and u not in Term')).toBe('  the unit is none of these:\n    - a spec\n    - an axiom\n    - a fact\n    - a term');
    // A clause that says other words, or one that is not negative, keeps the list as it stands.
    expect(words('u not in Spec and u not in Axiom and u not in Fact and u not in Ran').split('\n')[0]).toBe('  all of these hold:');
    expect(words('u not in Spec and u not in Axiom and u not in Fact and u in Term').split('\n')[0]).toBe('  all of these hold:');
    // Readings that share a noun phrase, "is a definition with", share only the subject and the verb before it.
    const nouns = parseReadings(['noun Unit: unit', ...['A', 'B', 'C', 'D'].map(x => `${x}: {1} is a definition with an alternative ${x} | {1} is not a definition with an alternative ${x}`)].join('\n'));
    expect(verbalize('all u: Unit | u not in A and u not in B and u not in C and u not in D', nouns).split('\n').slice(1, 3).join('\n')).toBe(
      '  the unit is none of these:\n    - a definition with an alternative A'
    );
  });

  /**
   * @canon spec-a-list-too-long-for-a-line-is-bullets
   */
  it('are a list when the sentence would run past a line', () => {
    const long = parseReadings(['noun Unit: unit', 'Long: {1} is a unit with a name that is long enough to be a trouble for the line | {1} is not that'].join('\n'));
    expect(verbalize('all u: Unit | u in Long and u in Long and u in Long', long).split('\n')[1]).toBe('  all of these hold:');
  });

  /**
   * @canon spec-a-list-with-a-time-phrase-before-its-last-clause-is-bullets
   */
  it('are a list when a clause before the last begins with a time phrase', () => {
    expect(say("c in Ran' and d in Ran", READINGS)).toBe('All of these hold:\n  - at the next moment, c has run\n  - d has run');
    expect(say("c in Ran' or d in Ran", READINGS)).toBe('At least one of these holds:\n  - at the next moment, c has run\n  - d has run');
    expect(say("d in Ran and c in Ran'", READINGS)).toBe('d has run and at the next moment, c has run.');
  });

  /**
   * @canon spec-a-list-with-a-relative-clause-before-its-last-clause-is-bullets
   */
  it('are a list when a clause before the last holds a relative clause', () => {
    expect(say('(no x: Owner | x in c.on and x in Disposed) and c in Registered')).toBe('All of these hold:\n  - c is on no owner that pulse has disposed\n  - code has registered c');
    expect(said('(some v: Unit | u->v in Sit.rel and v in Spec) and u in Axiom')).toBe('all of these hold:\n    - unit U1 sits in a unit that is a spec\n    - unit U1 is an axiom');
    expect(say('some c.on & Disposed and c in Ran')).toBe('All of these hold:\n  - c is on an owner that pulse has disposed\n  - c has run');
    expect(say('c in Ran and (some x: Owner | x in c.on and x in Disposed)')).toBe('c has run and is on an owner that pulse has disposed.');
  });

  /**
   * @canon spec-a-list-with-a-clause-that-holds-its-own-and-or-or-is-bullets
   */
  it('are a list when a clause holds an "and" or an "or" of its own', () => {
    expect(say('c in Ran and o = p')).toBe('All of these hold:\n  - c has run\n  - o and p are the same');
    expect(say('c in Ran or o != p')).toBe('At least one of these holds:\n  - c has run\n  - o and p are different');
    expect(say('c in Ran and o in Disposed')).toBe('c has run and pulse has disposed o.');
  });

  /**
   * @canon spec-a-list-right-below-a-time-phrase-is-bullets
   */
  it('are a list right below a time phrase, however short', () => {
    expect(say('after (c in Ran and c in Registered)', READINGS)).toBe('At the next moment, all of these hold:\n  - c has run\n  - code has registered c');
  });

  /**
   * @canon spec-an-item-that-is-more-than-a-clause-makes-the-list-bullets
   */
  it('are a list when an item is more than one clause', () => {
    expect(said('u in Spec and (all v: Unit | u->v in Sit.rel) and u in Axiom').split('\n')[0]).toBe('all of these hold:');
  });

  /**
   * @canon spec-a-rule-whose-first-side-begins-with-a-time-phrase-puts-its-then-on-a-line-of-its-own
   */
  it('put the "then" of a rule on a line of its own when the first side begins with a time phrase', () => {
    expect(say("c in Ran' implies d in Ran")).toBe('When the following holds:\n  at the next moment, c has run\nthen d has run.');
    expect(verbalize("c in Ran' implies d in Ran", READINGS, 'markdown')).toBe('When the following holds:\\\nat the next moment, c has run\\\nthen d has run.');
  });

  /**
   * @canon spec-a-first-side-that-holds-a-time-phrase-is-set-apart
   */
  it('set apart the first side of a rule when it holds a time phrase', () => {
    expect(say('(after c in Ran) implies c in Registered')).toBe('When the following holds:\n  at the next moment, c has run\nthen code has registered c.');
    expect(say('(before c in Ran) implies c in Registered')).toBe('When the following holds:\n  there is a moment just before, and at it, c has run\nthen code has registered c.');
    expect(say('(once c in Ran) implies c in Registered')).toBe('When the following holds:\n  now or earlier, c has run\nthen code has registered c.');
    expect(say('(historically c in Ran) implies c in Registered')).toBe('When the following holds:\n  now and at every earlier moment, c has run\nthen code has registered c.');
    expect(say('(c in Ran ; o in Disposed) implies c in Registered')).toBe('When the following holds:\n  c has run, and at the next moment, pulse has disposed o\nthen code has registered c.');
  });

  /**
   * @canon spec-a-side-that-holds-a-comma-is-set-apart-where-no-then-marks-the-second-side
   */
  it('set apart a side of a rule that holds a comma, where no "then" shows where the second side starts', () => {
    expect(say('c in Registered implies (c in Ran ; o in Disposed)')).toBe('When code has registered c\nthen the following holds:\n       c has run, and at the next moment, pulse has disposed o.');
    expect(say('(c in Ran and d in Ran and c in Registered) implies o in Disposed')).toBe('Pulse has disposed o when all of these hold:\n  - c has run\n  - d has run\n  - code has registered c');
    expect(say('(c in Ran and d in Ran and c in Registered) implies always o in Disposed')).toBe(
      'When c has run, d has run and code has registered c, then from now on, pulse has disposed o.'
    );
    expect(say('c in Registered implies always o in Disposed')).toBe('When code has registered c, then from now on, pulse has disposed o.');
  });

  /**
   * @canon spec-a-second-or-last-side-of-a-rule-that-holds-a-series-is-set-apart
   */
  it('set apart the second or the last side of a rule when it is a series after a comma', () => {
    expect(say('c in Registered implies o in Stopped else (c in Ran ; o in Disposed)')).toBe(
      ['When code has registered c', 'then the dispose of o has been stopped', 'otherwise the following holds:', '            c has run, and at the next moment, pulse has disposed o.'].join('\n')
    );
    expect(say('c in Registered implies (c in Ran ; o in Disposed)')).toBe(
      ['When code has registered c', 'then the following holds:', '       c has run, and at the next moment, pulse has disposed o.'].join('\n')
    );
    expect(say('c in Ran implies before c in Registered')).not.toContain('the following holds');
  });

  /**
   * @canon spec-a-second-side-that-holds-a-time-phrase-before-an-otherwise-is-set-apart
   */
  it('set apart the second side of a rule when it holds a time phrase that an "otherwise" follows', () => {
    expect(say('c in Registered implies (after c in Ran) else o in Stopped')).toBe(
      ['When code has registered c', 'then the following holds:', '       at the next moment, c has run', 'otherwise the dispose of o has been stopped.'].join('\n')
    );
    expect(say('(c in Ran and d in Ran and c in Registered and d in Registered) implies (d in Ran ; c in Registered) else o in Disposed')).toBe(
      [
        'When all of these hold:',
        '  - c has run',
        '  - d has run',
        '  - code has registered c',
        '  - code has registered d',
        'then the following holds:',
        '       d has run, and at the next moment, code has registered c',
        'otherwise pulse has disposed o.'
      ].join('\n')
    );
  });

  /**
   * @canon spec-a-rule-that-is-a-side-of-a-rule-is-set-apart
   */
  it('set apart a rule that is a side of another rule', () => {
    expect(say('(c in Ran implies o in Disposed) implies c in Registered')).toBe('When the following holds:\n  when c has run, pulse has disposed o\nthen code has registered c.');
    expect(say('c in Registered implies (c in Ran implies o in Disposed else o in Stopped)')).toBe(
      'When code has registered c\nthen the following holds:\n       when c has run, pulse has disposed o; otherwise, the dispose of o has been stopped.'
    );
    expect(say('(c in Ran implies o in Disposed else o in Stopped) implies c in Registered')).toBe(
      'When the following holds:\n  when c has run, pulse has disposed o; otherwise, the dispose of o has been stopped\nthen code has registered c.'
    );
    expect(say('c in Registered implies o in Stopped else (c in Ran implies o in Disposed)')).toBe(
      'When code has registered c\nthen the dispose of o has been stopped\notherwise the following holds:\n            when c has run, pulse has disposed o.'
    );
  });

  /**
   * @canon spec-a-rule-with-a-list-for-a-side-puts-its-then-on-a-line-of-its-own
   */
  it('put the "then" of a rule on a line of its own when a side is a list, whatever follows it', () => {
    // A second side of one plain line goes first; one with a time phrase keeps its "then".
    const rule = said('(u in Spec and u in Axiom and u in Fact and u not in Spec) implies after u in Axiom');
    expect(rule.split('\n')[0]).toBe('When all of these hold:');
    expect(rule.split('\n').at(-1)?.trim()).toBe('then at the next moment, the unit is an axiom.');
    expect(said('(u in Spec and u in Axiom and u in Fact and u not in Spec) implies eventually u in Axiom').split('\n').at(-1)?.trim()).toBe('then now or later, the unit is an axiom.');
  });

  /**
   * @canon spec-an-and-inside-an-or-is-kept-apart
   */
  it('keep an "and" inside an "or" apart, so that the sentence cannot be read two ways', () => {
    expect(said('(u in Spec and u in Axiom) or u in Fact')).toBe('at least one of these holds:\n    - the unit is a spec and is an axiom\n    - the unit is a fact');
  });

  /**
   * @canon spec-a-subject-is-said-once-when-clauses-begin-with-it
   */
  it('say a subject once, when clauses beside each other begin with it', () => {
    expect(said('u in Spec and (no v: Unit | u->v in Sit.rel)')).toBe('the unit is a spec and sits in no unit.');
  });

  /**
   * @canon spec-a-list-with-a-clause-about-a-pair-of-variables-is-bullets
   */
  it('say a pair of variables as it is, and not as a subject', () => {
    expect(said('all v: Unit | (u != v and u in Spec) implies v in Spec')).toContain('unit U2 is a spec when all of these hold:\n    - unit U1 and unit U2 are different\n    - unit U1 is a spec');
  });

  /**
   * @canon spec-a-rule-keeps-its-then-before-a-time-phrase
   * @canon spec-a-rule-drops-its-then-before-anything-else
   */
  it('keep the "then" of a rule when what follows is a time phrase, and drop it otherwise', () => {
    expect(said('u in Spec implies eventually u in Axiom')).toBe('When a unit is a spec, then now or later, the unit is an axiom.');
    expect(said('u in Spec implies after u in Axiom')).toBe('When a unit is a spec, then at the next moment, the unit is an axiom.');
    expect(said('u in Spec implies once u in Axiom')).toBe('When a unit is a spec, then now or earlier, the unit is an axiom.');
    expect(said('u in Spec implies before u in Axiom')).toBe('When a unit is a spec, then there is a moment just before, and at it, the unit is an axiom.');
    expect(said('u in Spec implies u in Axiom')).toBe('When a unit is a spec, the unit is an axiom.');
  });
});

describe('an expression said through the types of its columns', () => {
  /**
   * @canon spec-a-union-on-the-right-is-said-as-or
   */
  it('says a union on the right as or', () => {
    expect(say('c in Ran + Registered')).toBe('c has run or code has registered c.');
    expect(say('c not in Ran + Registered')).toBe('c has not run and code has not registered c.');
    expect(say('o->p in parent + handler')).toBe('p is the parent of o or is the nearest error handler or boundary above o.');
  });

  /**
   * @canon spec-an-intersection-on-the-right-is-said-as-and
   */
  it('says an intersection on the right as and', () => {
    expect(say('c in Ran & Registered')).toBe('c has run and code has registered c.');
  });

  /**
   * @canon spec-not-in-before-a-difference-is-said-as-the-negation-of-in
   */
  it('says not in before a difference as the negation of in', () => {
    expect(say('c not in Registered - Ran')).toBe('At least one of these holds:\n  - code has not registered c\n  - c has run');
  });

  /**
   * @canon spec-membership-in-a-navigation-of-an-expression-is-said-as-a-pair-in-it
   */
  it('says membership in a navigation of an expression as a pair in it', () => {
    expect(say('o in c.(on + reached)')).toBe('c is on o or the error of c has reached o.');
    expect(say('c in (on + reached).o')).toBe('c is on o or the error of c has reached o.');
  });

  /**
   * @canon spec-a-pair-in-a-product-is-said-as-each-side-in-its-part
   */
  it('says a pair in a product as each side in its part', () => {
    expect(say('c->o in Cleanup -> Owner')).toBe('c is a cleanup and o is an owner.');
  });

  /**
   * @canon spec-membership-in-a-chain-of-navigations-is-said-through-a-member-between
   */
  it('says membership in a chain of navigations through a member between', () => {
    expect(say('p in c.on.parent')).toBe('c is on an owner that p is the parent of.');
  });

  /**
   * @canon spec-membership-in-a-navigation-from-a-signature-is-said-through-a-member-of-it
   */
  it('says membership in a navigation from a signature through a member of it', () => {
    expect(say('o in Cleanup.on')).toBe('A cleanup is on o.');
    expect(say('o not in Cleanup.on')).toBe('No cleanup is on o.');
  });

  /**
   * @canon spec-membership-in-a-signature-with-no-reading-is-said-with-its-noun
   */
  it('says membership in a signature with no reading with its noun', () => {
    expect(say('c in Cleanup')).toBe('c is a cleanup.');
    expect(say('o not in Owner')).toBe('o is not an owner.');
  });

  /**
   * @canon spec-a-primed-expression-is-said-at-the-next-moment
   */
  it('says a primed expression at the next moment', () => {
    expect(say("c in (Ran + Registered)'")).toBe('At the next moment, at least one of these holds:\n  - c has run\n  - code has registered c');
  });

  /**
   * @canon spec-an-expression-of-a-variable-on-the-left-is-said-member-by-member
   */
  it('says an expression of a variable on the left member by member', () => {
    expect(say('c.on in Disposed')).toBe('When c is on an owner, pulse has disposed the owner.');
    expect(say('c.on not in Disposed')).toBe('c is on an owner that pulse has not disposed.');
  });

  /**
   * @canon spec-two-sets-compared-are-said-member-by-member
   */
  it('says two sets compared member by member, primed or not', () => {
    expect(say('Ran in Registered')).toBe('When a cleanup has run, code has registered the cleanup.');
    expect(say('Ran = Registered')).toBe('For every cleanup:\n  the cleanup has run exactly when code has registered the cleanup.');
    expect(say("Ran in Ran'")).toBe('When a cleanup has run, then at the next moment, the cleanup has run.');
    expect(say("all c: Cleanup | Registered' = Registered + c")).toBe(
      ['For every cleanup C1 and every cleanup C2:', '  both or neither of these hold:', '    - at the next moment, code has registered cleanup C2', '    - at least one of these holds:', '        - code has registered cleanup C2', '        - cleanup C2 and cleanup C1 are the same'].join('\n')
    );
    expect(say("on' = on")).toBe('For every cleanup and every owner:\n  the cleanup is on the owner at the next moment exactly when the cleanup is on the owner now.');
  });

  /**
   * @canon spec-two-expressions-that-are-equal-are-said-member-by-member
   */
  it('says two expressions that are equal member by member', () => {
    expect(say('c.on.parent = o')).toBe('For every owner O1:\n  both or neither of these hold:\n    - c is on an owner that owner O1 is the parent of\n    - owner O1 and o are the same');
    expect(say('c.on.parent != o')).toBe('There is an owner O1 such that exactly one of these holds:\n  - c is on an owner that owner O1 is the parent of\n  - owner O1 and o are the same');
  });

  /**
   * @canon spec-some-or-no-of-an-expression-is-said-over-the-types-of-its-columns
   */
  it('says some or no of an expression over the types of its columns', () => {
    expect(say('no Ran & Registered')).toBe('There is no cleanup such that the cleanup has run and code has registered the cleanup.');
    expect(say('some Ran - Registered')).toBe('There is a cleanup such that the cleanup has run and code has not registered the cleanup.');
    expect(say('some c.on & Disposed')).toBe('c is on an owner that pulse has disposed.');
    expect(say('no on')).toBe('No cleanup is on an owner.');
    expect(say('some ~on')).toBe('For some owner and some cleanup:\n  the cleanup is on the owner.');
  });

  /**
   * @canon spec-one-or-lone-of-an-expression-is-said-as-exactly-or-at-most-one
   */
  it('says one or lone of an expression as exactly or at most one', () => {
    expect(say('one Ran')).toBe('There is exactly one cleanup such that the cleanup has run.');
    expect(say('lone c.on')).toBe('There is at most one owner such that c is on the owner.');
  });

  /**
   * @canon spec-an-expression-whose-types-the-vocabulary-does-not-tell-is-refused
   */
  it('refuses an expression whose column types the vocabulary does not tell', () => {
    expect(() => say('some Ran + Disposed')).toThrow('the vocabulary does not tell what kind of thing "Ran + Disposed" holds');
  });

  /**
   * @canon spec-set-or-seq-before-an-expression-is-refused
   */
  it('refuses set or seq before an expression', () => {
    expect(() => say('set Ran')).toThrow('"set" before an expression is not a formula; Alloy reads it only in a declaration');
    expect(() => say('seq Ran')).toThrow('"seq" before an expression is not a formula');
  });
});

describe('calls', () => {
  /**
   * @canon spec-a-call-written-as-a-join-is-said-as-the-call
   */
  it('says a call written as a join as the call', () => {
    expect(say('o.dispose')).toBe('Pulse disposes o.');
    expect(say('not o.dispose')).toBe('Pulse does not dispose o.');
    expect(say('c.runByCall[o]')).toContain('Code disposes o after pulse disposed it, and that call runs c');
  });

  /**
   * @canon spec-a-box-join-of-a-field-is-said-as-the-navigation
   */
  it('says a box join of a field as the navigation', () => {
    expect(say('o in on[c]')).toBe('c is on o.');
    expect(say('no on[c]')).toBe('c is on no owner.');
  });

  /**
   * @canon spec-a-call-with-an-expression-is-said-by-the-body-with-the-expression-in-place
   */
  it('says a call with an expression by the body, with the expression in place', () => {
    const readings = withDefinitions(parseReadings(read('readings.txt')), `${read('vocabulary.als')}\npred settled[x: Cleanup] { x in Registered and x not in Ran }`);
    expect(say('settled[on.o]', readings)).toBe(
      ['All of these hold:', '  - when a cleanup is on o, code has registered the cleanup', '  - a cleanup that has not run is on o'].join('\n')
    );
  });

  const ONE = withDefinitions(
    parseReadings('noun Owner: owner\nnoun Cleanup: cleanup\nholder: {1} belongs to {2} | {1} does not belong to {2}\non: {1} is on {2} | {1} is not on {2}\ndispose: pulse disposes {1} | pulse does not dispose {1}'),
    'sig Owner {} sig Cleanup { holder: Owner, on: lone Owner } pred dispose[o: Owner] { some o }'
  );

  /**
   * @canon spec-a-call-with-one-value-is-said-through-a-member-in-the-place-of-the-argument
   */
  it('says a call with an argument of one value through the member in it', () => {
    expect(say('dispose[c.holder]', ONE)).toBe('c belongs to an owner that pulse disposes.');
    expect(say('not dispose[c.holder]', ONE)).toBe('c belongs to an owner that pulse does not dispose.');
  });

  /**
   * @canon spec-a-call-with-an-argument-of-none-or-several-values-is-refused
   */
  it('refuses a call with an argument of none or several values', () => {
    expect(() => say('dispose[c.on]', ONE)).toThrow('the reading of "dispose" takes one thing, and "c.on" can hold none or several');
  });

  /**
   * @canon spec-a-call-with-an-argument-of-another-type-is-refused
   */
  it('refuses a call with an argument of a type its parameter shares nothing with', () => {
    const typed = withDefinitions(
      parseReadings('noun Owner: owner\nnoun Cleanup: cleanup\nnoun String: text\ngone: {1} is gone | {1} is not gone\nhome: {2} is the home of {1} | {2} is not the home of {1}'),
      'sig Owner {} sig Cleanup { home: one Owner, name: one String } var sig Disposed in Owner {} pred gone[o: Owner] { o in Disposed } pred gone2[o: Owner] { o in Disposed }'
    );
    expect(() => say('gone["a"]', typed)).toThrow('"gone" takes an owner for "o", and "a" is a text');
    expect(() => say('gone2[c.name]', typed)).toThrow('"gone2" takes an owner for "o", and "c.name" is a text');
    expect(say('gone[c.home]', typed)).toBe('An owner that is gone is the home of c.');
  });
});

describe('declarations, and calls of functions and macros', () => {
  /**
   * @canon spec-an-expression-as-the-type-of-a-quantifier-is-said-as-a-condition
   */
  it('says an expression as the type of a quantifier as a condition', () => {
    expect(say('all o: c.on | o in Disposed')).toBe('When c is on an owner, pulse has disposed the owner.');
    expect(say('some o: c.on | o in Disposed')).toBe('c is on an owner that pulse has disposed.');
  });

  /**
   * @canon spec-a-disj-after-the-colon-is-said-as-a-disj-before-the-names
   */
  it('says disj after the colon as disj before the names', () => {
    expect(say('all c, d: disj Cleanup | c in Ran implies d in Ran')).toBe(say('all disj c, d: Cleanup | c in Ran implies d in Ran'));
  });

  /**
   * @canon spec-one-before-the-type-of-a-variable-is-said-as-the-type
   */
  it('says one before the type of a variable as the type', () => {
    expect(say('all c: one Cleanup | c in Ran')).toBe('For every cleanup:\n  the cleanup has run.');
  });

  /**
   * @canon spec-a-variable-that-can-hold-several-things-or-none-is-refused
   */
  it('refuses a variable that can hold several things or none', () => {
    expect(() => say('all c: set Cleanup | c in Ran')).toThrow('"c" can hold none or several things');
    expect(() => say('some c: lone Cleanup | c in Ran')).toThrow('"c" can hold none or several things');
    expect(() => say('some c: some Cleanup | c in Ran')).toThrow('"c" can hold none or several things');
    expect(() => say('all r: Cleanup -> Owner | some r')).toThrow('"r" can hold none or several things');
  });

  /**
   * @canon spec-private-before-a-variable-of-a-quantifier-is-refused
   */
  it('refuses private before a variable of a quantifier', () => {
    expect(() => say('all private c: Cleanup | c in Ran')).toThrow('Alloy does not read "private" before the variable "c"');
  });

  /**
   * @canon spec-a-formula-that-always-holds-is-left-out-of-an-and
   */
  it('leaves a formula that always holds out of an and', () => {
    const readings = withDefinitions(parseReadings(read('readings.txt')), `${read('vocabulary.als')}\npred whatever[x: Cleanup] {}`);
    expect(say('whatever[c] and c in Ran', readings)).toBe('c has run.');
    expect(say('c in Ran and {}')).toBe('c has run.');
    expect(say('c in Ran and c not in none')).toBe('c has run.');
  });

  /**
   * @canon spec-a-formula-that-only-always-holds-is-refused
   */
  it('refuses a formula that only always holds', () => {
    const readings = withDefinitions(parseReadings(read('readings.txt')), `${read('vocabulary.als')}\npred whatever[x: Cleanup] {}`);
    expect(() => say('whatever[c]', readings)).toThrow('it always holds, so it claims nothing');
    expect(() => say('{}')).toThrow('it always holds, so it claims nothing');
  });

  const FUNCTIONS = withDefinitions(
    parseReadings(`${read('readings.txt')}\nhome: {2} is a home of {1} | {2} is not a home of {1}`),
    `${read('vocabulary.als')}\nfun home[c: Cleanup]: Owner { c.on } fun owners[c: Cleanup]: set Owner { c.on + c.reached } let settled[x] = x in Ran let held[x] { x.on }`
  );

  /**
   * @canon spec-a-call-of-a-function-with-a-reading-is-said-with-its-reading
   */
  it('says a call of a function with a reading with its reading', () => {
    expect(say('o in home[c]', FUNCTIONS)).toBe('o is a home of c.');
    expect(say('o not in home[c]', FUNCTIONS)).toBe('o is not a home of c.');
    expect(say('no home[c]', FUNCTIONS)).toBe('No owner is a home of c.');
  });

  /**
   * @canon spec-a-call-of-a-function-with-no-reading-is-said-by-its-body
   */
  it('says a call of a function with no reading by its body', () => {
    expect(say('o in owners[c]', FUNCTIONS)).toBe('c is on o or the error of c has reached o.');
    expect(say('o in c.owners', FUNCTIONS)).toBe('c is on o or the error of c has reached o.');
  });

  /**
   * @canon spec-a-call-of-a-macro-is-said-by-its-body
   */
  it('says a call of a macro by its body', () => {
    expect(say('settled[c]', FUNCTIONS)).toBe('c has run.');
    expect(say('not settled[c]', FUNCTIONS)).toBe('It is not the case that c has run.');
    expect(say('o in held[c]', FUNCTIONS)).toBe('c is on o.');
  });
});

describe('relations and atoms', () => {
  /**
   * @canon spec-an-override-is-said-as-the-pairs-of-its-right-and-the-rest-of-its-left
   */
  it('says an override as the pairs of its right and the rest of its left', () => {
    expect(say('c->o in on ++ reached')).toBe('At least one of these holds:\n  - the error of c has reached o\n  - c is on o and the error of c has reached no owner');
    expect(say('c in Ran ++ Registered')).toBe('c has run or code has registered c.');
  });

  /**
   * @canon spec-a-domain-restriction-is-said-as-the-first-member-in-the-set
   */
  it('says a domain restriction as the first member in the set', () => {
    expect(say('c->o in Failing <: on')).toBe('c is a failing cleanup and is on o.');
  });

  /**
   * @canon spec-a-range-restriction-is-said-as-the-last-member-in-the-set
   */
  it('says a range restriction as the last member in the set', () => {
    expect(say('c->o in on :> Disposed')).toBe('c is on o and pulse has disposed o.');
  });

  /**
   * @canon spec-an-arrow-with-a-multiplicity-is-refused
   */
  it('refuses an arrow with a multiplicity', () => {
    expect(() => say('c->o in Cleanup one -> lone Owner')).toThrow('says how many each side relates');
    expect(() => say('some Cleanup some -> Owner')).toThrow('says how many each side relates');
  });

  /**
   * @canon spec-a-closure-is-said-as-reaching-in-one-or-more-steps
   */
  it('says a closure as reaching in one or more steps', () => {
    expect(say('o->p in ^parent')).toBe('o reaches p in one or more steps, where a step from owner O1 to owner O2 is that owner O2 is the parent of owner O1.');
    expect(say('p not in o.^parent')).toBe('o does not reach p in one or more steps, where a step from owner O1 to owner O2 is that owner O2 is the parent of owner O1.');
  });

  /**
   * @canon spec-a-reflexive-closure-is-said-as-reaching-in-zero-or-more-steps
   */
  it('says a reflexive closure as reaching in zero or more steps', () => {
    expect(say('p in o.*parent')).toBe('o reaches p in zero or more steps, where a step from owner O1 to owner O2 is that owner O2 is the parent of owner O1.');
  });

  /**
   * @canon spec-some-or-no-of-a-reflexive-closure-is-refused
   */
  it('refuses some or no of a reflexive closure', () => {
    expect(() => say('no *parent')).toThrow('holds every member of every type');
  });

  /**
   * @canon spec-none-is-said-as-nothing
   */
  it('says none as nothing', () => {
    for (const formula of ['c.on = none', 'none = c.on', 'c.on in none']) expect(say(formula)).toBe('c is on no owner.');
    expect(say('c.on != none')).toBe('c is on an owner.');
    expect(say('c in Ran + none')).toBe('c has run.');
    expect(say('c in Ran - none')).toBe('c has run.');
  });

  /**
   * @canon spec-a-formula-that-never-holds-is-refused
   */
  it('refuses a formula that never holds', () => {
    expect(() => say('c in none')).toThrow('it never holds, so it claims what cannot be');
    expect(() => say('some none')).toThrow('it never holds, so it claims what cannot be');
    expect(() => say('c in none and d in Ran')).toThrow('it never holds, so it claims what cannot be');
    expect(() => say('no none')).toThrow('it always holds, so it claims nothing');
  });

  /**
   * @canon spec-a-formula-that-never-holds-is-left-out-of-an-or
   */
  it('leaves a formula that never holds out of an or', () => {
    expect(say('c in Ran or c in none')).toBe('c has run.');
    expect(say('c in Ran or some none')).toBe('c has run.');
  });

  /**
   * @canon spec-a-pair-in-iden-is-said-as-the-same
   */
  it('says a pair in iden as the same', () => {
    expect(say('c->d in iden')).toBe('c and d are the same.');
    expect(say('c in iden.d')).toBe('c and d are the same.');
  });

  /**
   * @canon spec-univ-is-said-as-a-signature-of-its-own
   */
  it('says univ as a signature of its own, with the noun the readings give it', () => {
    const things = withDefinitions(parseReadings(`${read('readings.txt')}\nnoun univ: thing`), read('vocabulary.als'));
    expect(say('some x: univ | x in Ran', things)).toBe('There is a thing that has run.');
    expect(say('c in univ', things)).toBe('c is a thing.');
    expect(() => say('some x: univ | x in Ran')).toThrow('no noun for "univ"');
  });

  /**
   * @canon spec-a-set-comprehension-is-said-through-its-variables
   */
  it('says a set comprehension through its variables', () => {
    expect(say('c in { x: Cleanup | x in Ran }')).toBe('c is a cleanup and has run.');
    expect(say('o in { x: Owner }')).toBe('o is an owner.');
  });

  /**
   * @canon spec-disj-of-expressions-is-said-as-no-two-sharing-a-member
   */
  it('says disj as no two sharing a member', () => {
    expect(say('disj[c, d]')).toBe('c and d are different.');
    expect(say('disj[c.on, d.on]')).toBe('c is on no owner that d is on.');
    expect(say('disj[c, d, e]')).toBe('All of these hold:\n  - c and d are different\n  - c and e are different\n  - d and e are different');
  });

  /**
   * @canon spec-a-string-is-said-as-itself-in-quotes
   */
  it('says a string as itself in quotes', () => {
    const named = withDefinitions(parseReadings('noun Cleanup: cleanup\nname: {1} is named {2} | {1} is not named {2}'), 'sig Cleanup { name: one String }');
    expect(say('c.name = "abc"', named)).toBe('c is named "abc".');
  });

  /**
   * @canon spec-a-value-in-a-string-is-said-as-equal-to-it
   */
  it('says a variable in a string as the variable equal to it', () => {
    const named = withDefinitions(parseReadings('noun Cleanup: cleanup\nname: {1} is named {2} | {1} is not named {2}\nRan: {1} has run | {1} has not run'), 'sig Cleanup { name: one String } var sig Ran in Cleanup {}');
    expect(say('c in "a"', named)).toBe('c and "a" are the same.');
    expect(say('c not in "a"', named)).toBe('c and "a" are different.');
    expect(say('not c in "a"', named)).toBe('c and "a" are different.');
    expect(say('"a" in "b"', named)).toBe('"a" and "b" are the same.');
    expect(() => say('Ran in "a"', named)).toThrow('hold things of types that share no member');
  });

  /**
   * @canon spec-a-variable-on-the-right-of-in-is-said-as-equal-to-what-is-in-it
   */
  it('says membership in a variable as equality with it, member by member for an expression of several things', () => {
    const owners = withDefinitions(
      parseReadings('noun Owner: owner\nnoun Cleanup: cleanup\non: {1} is on {2} | {1} is not on {2}\nhome: {2} is the home of {1} | {2} is not the home of {1}'),
      'sig Owner {} sig Cleanup { on: set Owner, home: one Owner }'
    );
    expect(say('all o, p: Owner | o in p', owners)).toBe('For every owner O1 and every owner O2:\n  owner O1 and owner O2 are the same.');
    expect(say('all o, p: Owner | o not in p', owners)).toBe('For every owner O1 and every owner O2:\n  owner O1 and owner O2 are different.');
    expect(say('all p: Owner | c.home in p', owners)).toBe(say('all p: Owner | c.home = p', owners));
    expect(say('all p: Owner | c.on in p', owners)).toBe('For every owner O1 and every owner O2:\n  when c is on owner O2, owner O2 and owner O1 are the same.');
    expect(() => say('c in Mystery', owners)).toThrow('no reading for "Mystery"');
  });

  /**
   * @canon spec-some-or-no-of-a-signature-is-said-over-its-members
   * @canon spec-a-count-of-one-thing-is-a-formula-that-always-or-never-holds
   */
  it('says some or no of a signature over its members, and a count of one thing as what always or never holds', () => {
    const owners = withDefinitions(parseReadings('noun Owner: owner\nRan: {1} has run | {1} has not run'), 'sig Owner {} var sig Ran in Owner {}');
    expect(say('some Owner', owners)).toBe('There is an owner.');
    expect(say('no Owner', owners)).toBe('There is no owner.');
    expect(() => say('all p: Owner | some p', owners)).toThrow('this formula says nothing: it always holds');
    expect(() => say('all p: Owner | no p', owners)).toThrow('this formula says nothing: it never holds');
    expect(say('all p: Owner | some p and p in Ran', owners)).toBe('For every owner:\n  the owner has run.');
  });

  /**
   * @canon spec-a-value-in-a-string-is-said-as-equal-to-it
   * @canon spec-an-expression-is-one-thing-where-its-declarations-make-it-so
   */
  it('says an expression that the declarations make one thing in a string as equal to it', () => {
    const named = withDefinitions(
      parseReadings('noun Cleanup: cleanup\nnoun Owner: owner\nnoun String: text\nname: {1} is named {2} | {1} is not named {2}\nlabel: {1} is labelled {2} | {1} is not labelled {2}\nhome: {2} is the home of {1} | {2} is not the home of {1}'),
      'sig Owner { label: one String } sig Cleanup { name: one String, home: one Owner }'
    );
    expect(say('c.name in "a"', named)).toBe('c is named "a".');
    expect(say('c.name not in "a"', named)).toBe('c is not named "a".');
    expect(say('c.home.label in "a"', named)).toBe(say('c.home.label = "a"', named));
  });

  /**
   * @canon spec-a-value-in-a-string-is-said-as-equal-to-it
   */
  it('says a field of many values in a string member by member, and never as the field equal to it', () => {
    const texts = withDefinitions(
      parseReadings('noun Cleanup: cleanup\nnoun String: text\ntags: {1} is tagged {2} | {1} is not tagged {2}\nalias: {1} has alias {2} | {1} has no alias {2}'),
      'sig Cleanup { name: one String, tags: set String, alias: lone String }'
    );
    const cases: [string, string][] = [
      ['c.tags in "a"', 'When c is tagged a text, the text and "a" are the same.'],
      ['c.alias in "a"', 'When c has alias a text, the text and "a" are the same.'],
      ['c.tags not in "a"', 'c is tagged a text other than "a".'],
      ['c.alias not in "a"', 'c has alias a text other than "a".'],
      ['not c.tags in "a"', 'c is tagged a text other than "a".']
    ];
    for (const [formula, words] of cases) {
      expect(say(formula, texts)).toBe(words);
      expect(say(formula, texts)).not.toContain('that and');
      expect(say(formula, texts)).not.toMatch(/^c\.\w+ and "a" are/);
    }
  });

  /**
   * @canon spec-this-outside-a-definition-of-a-signature-is-refused
   */
  it('refuses this outside a definition of a signature', () => {
    expect(() => say('c = this')).toThrow('Alloy does not read "this" outside a predicate or a function of a signature');
  });

  /**
   * @canon spec-steps-in-a-formula-is-refused
   */
  it('refuses steps in a formula', () => {
    expect(() => say('some steps')).toThrow('Alloy reads "steps" only in a scope');
  });

  /**
   * @canon spec-a-name-of-this-module-is-said-as-the-name
   */
  it('says a name of this module as the name', () => {
    expect(say('c in this/Ran')).toBe('c has run.');
    expect(say('o in c.@on')).toBe('c is on o.');
  });

  /**
   * @canon spec-a-name-of-another-module-is-said-by-its-own-reading
   */
  it('says a name of another module by its own reading', () => {
    const other = withDefinitions(parseReadings(`${read('readings.txt')}\nm/Ran: {1} has run in m | {1} has not run in m`), read('vocabulary.als'));
    expect(say('c in m/Ran', other)).toBe('c has run in m.');
    expect(() => say('c in m/Ran')).toThrow('no reading for "m/Ran"');
  });

  /**
   * @canon spec-a-comment-in-a-formula-is-left-out
   */
  it('leaves a comment out', () => {
    expect(say('c in Ran /* note */ and d in Ran // more')).toBe('c has run and d has run.');
    expect(say('/** about */ c in Ran -- more')).toBe('c has run.');
  });

  /**
   * @canon spec-a-typographic-prime-is-said-as-a-prime
   */
  it('says a typographic prime as a prime', () => {
    for (const prime of ['\u2018', '\u2019']) expect(say(`c in Ran${prime}`)).toBe('At the next moment, c has run.');
  });
});

describe('integers', () => {
  const INTS = withDefinitions(
    parseReadings('noun Owner: owner\nnoun Cleanup: cleanup\non: {1} is on {2} | {1} is not on {2}\nn: {1} counts {2} | {1} does not count {2}\nRan: {1} has run | {1} has not run'),
    'sig Owner {} sig Cleanup { on: set Owner, n: set Int } var sig Ran in Cleanup {}'
  );
  const WRAP = "In integers that wrap around at the analyzer's bit width, ";
  const said = (formula: string): string => verbalize(formula, INTS);

  /**
   * @canon spec-two-numbers-are-compared-with-the-words-of-their-operator
   */
  it('says an integer comparison in integers that wrap, with the words of its operator', () => {
    expect(said('x < y')).toBe(`${WRAP}x is less than y.`);
    expect(said('x > y')).toBe(`${WRAP}x is greater than y.`);
    expect(said('x =< y')).toBe(`${WRAP}x is at most y.`);
    expect(said('x >= y')).toBe(`${WRAP}x is at least y.`);
    expect(said('x !< y')).toBe(`${WRAP}x is not less than y.`);
    expect(said('not x < y')).toBe(`${WRAP}x is not less than y.`);
    expect(said('x !>= y')).toBe(`${WRAP}x is not at least y.`);
    expect(said('x = 2')).toBe(`${WRAP}x is equal to 2.`);
    expect(said('x != 2')).toBe(`${WRAP}x is not equal to 2.`);
    expect(said('x < y and c in Ran')).toBe("All of these hold:\n  - in integers that wrap around at the analyzer's bit width, x is less than y\n  - c has run");
  });

  /**
   * @canon spec-a-count-is-said-as-the-number-of-values
   */
  it('says a count as the number of values', () => {
    expect(said('#c.on > 2')).toBe(`${WRAP}number_1 is greater than 2, where number_1 is the number of values of owner O1 such that c is on owner O1.`);
    expect(said('#on > 2')).toBe(`${WRAP}number_1 is greater than 2, where number_1 is the number of combinations of cleanup C1 and owner O1 such that cleanup C1 is on owner O1.`);
  });

  /**
   * @canon spec-a-part-of-an-integer-comparison-that-is-more-than-a-number-is-named-below-it
   */
  it('names each part that is more than a number, and says it after where', () => {
    expect(said('#c.on != #d.on')).toBe(
      [`${WRAP}number_1 is not equal to number_2, where:`, '  - number_1 is the number of values of owner O1 such that c is on owner O1', '  - number_2 is the number of values of owner O2 such that d is on owner O2'].join('\n')
    );
  });

  /**
   * @canon spec-a-sum-over-a-variable-is-said-as-the-sum-over-every-value
   * @canon spec-a-variable-alone-of-its-noun-is-named-the-noun
   */
  it('says a sum over a variable as the sum over every value', () => {
    expect(said('(sum x: Cleanup | #x.on) > 3')).toBe(
      `${WRAP}number_1 is greater than 3, where number_1 is the sum, over every cleanup, of the number of values of owner O1 such that the cleanup is on owner O1.`
    );
  });

  /**
   * @canon spec-a-set-of-integers-where-a-number-belongs-is-said-as-the-sum-of-its-members
   */
  it('says a set of integers where a number belongs as the sum of its members', () => {
    for (const formula of ['c.n < 3', 'int[c.n] < 3', 'int c.n < 3', 'sum c.n < 3', 'c.n.sum < 3']) {
      expect(said(formula)).toBe(`${WRAP}number_1 is less than 3, where number_1 is the sum of the values of integer I1 such that c counts integer I1.`);
    }
  });

  /**
   * @canon spec-plus-minus-and-mul-are-said-as-plus-minus-and-times
   */
  it('says plus, minus and mul as plus, minus and times', () => {
    expect(said('plus[x, 1] = y')).toBe(`${WRAP}x plus 1 is equal to y.`);
    expect(said('x.minus[1] < 2')).toBe(`${WRAP}x minus 1 is less than 2.`);
    expect(said('mul[x, y] > 0')).toBe(`${WRAP}x times y is greater than 0.`);
    expect(said('plus[#c.on, 1] > 2')).toBe(`${WRAP}number_1 plus 1 is greater than 2, where number_1 is the number of values of owner O1 such that c is on owner O1.`);
  });

  /**
   * @canon spec-a-division-is-said-with-its-rounding-and-its-rule-for-zero
   */
  it('says a division with its rounding and its rule for zero', () => {
    expect(said('div[x, y] = 1')).toBe(`${WRAP}number_1 is equal to 1, where number_1 is x divided by y, rounded toward zero; when y is 0, it is -1, 0 or 1 as x is positive, zero or negative.`);
    expect(said('rem[x, y] = 1')).toBe(`${WRAP}number_1 is equal to 1, where number_1 is the remainder of x divided by y, with the sign of x; when y is 0, it is x.`);
  });

  /**
   * @canon spec-a-number-is-said-as-itself
   */
  it('says a number as itself, in decimal', () => {
    expect(said('x = 0x1F')).toBe(`${WRAP}x is equal to 31.`);
    expect(said('x = 0b101')).toBe(`${WRAP}x is equal to 5.`);
    expect(said('x > -3')).toBe(`${WRAP}x is greater than -3.`);
  });

  /**
   * @canon spec-min-and-max-are-said-as-the-least-and-the-greatest-integer
   */
  it('says min and max as the least and the greatest integer', () => {
    expect(said('x =< max')).toBe(`${WRAP}x is at most the greatest integer.`);
    expect(said('min < x')).toBe(`${WRAP}the least integer is less than x.`);
  });

  /**
   * @canon spec-the-spellings-fun-min-fun-max-and-fun-next-are-said-as-min-max-and-next
   */
  it('says fun/min, fun/max and fun/next as min, max and next', () => {
    expect(said('x =< fun/max')).toBe(said('x =< max'));
    expect(said('fun/min < x')).toBe(said('min < x'));
    expect(said('fun/max = x')).toBe(`${WRAP}the greatest integer is equal to x.`);
    expect(said('y in x.fun/next')).toBe('y is the integer after x without wrapping around.');
    expect(said('x->y in fun/next')).toBe('y is the integer after x without wrapping around.');
  });

  /**
   * @canon spec-a-shift-is-refused
   */
  it('refuses a shift', () => {
    for (const shift of ['<<', '>>', '>>>']) expect(() => said(`(x ${shift} 1) > 0`)).toThrow('shifts by the lowest bits of the amount');
  });

  /**
   * @canon spec-a-set-compared-with-a-number-is-refused
   */
  it('refuses a set compared with a number', () => {
    expect(() => said('c.n = 2')).toThrow('"=" between the set "c.n" and the number "2" compares sets');
  });

  /**
   * @canon spec-a-number-outside-an-integer-comparison-is-refused
   */
  it('refuses a number outside an integer comparison', () => {
    expect(() => said('2 in c.n')).toThrow('"2" is a number outside an integer comparison');
    expect(() => said('some #c.on')).toThrow('is a number outside an integer comparison');
  });

  /**
   * @canon spec-the-next-integer-is-said-as-the-integer-after
   */
  it('says the next integer as the integer after', () => {
    expect(said('x->y in next')).toBe('y is the integer after x without wrapping around.');
    expect(said('y in x.next')).toBe('y is the integer after x without wrapping around.');
    expect(said('x->y not in next')).toBe('y is not the integer after x without wrapping around.');
    expect(said('x.next < 3')).toBe(`${WRAP}number_1 is less than 3, where number_1 is the sum of the values of integer I1 such that integer I1 is the integer after x without wrapping around.`);
  });

  /**
   * @canon spec-int-and-seq-int-have-nouns-of-their-own
   */
  it('says Int and seq/Int with nouns of their own', () => {
    expect(said('some i: Int | i in c.n')).toBe('c counts an integer.');
    expect(said('all i: seq/Int | i in c.n')).toBe('For every sequence index:\n  c counts the sequence index.');
  });
});

describe('connectives, quantifiers and let', () => {
  /**
   * @canon spec-an-equivalence-of-two-clauses-is-said-with-exactly-when
   */
  it('says an equivalence of two clauses with "exactly when"', () => {
    expect(say('c in Ran iff d in Ran')).toBe('c has run exactly when d has run.');
    expect(say('c in Ran <=> d not in Ran')).toBe('c has run exactly when d has not run.');
  });

  /**
   * @canon spec-an-equivalence-of-more-than-clauses-is-said-as-both-or-neither
   */
  it('says an equivalence with a side of more than one clause as both or neither', () => {
    expect(say('(c in Ran and d in Ran) iff c in Registered')).toBe('Both or neither of these hold:\n  - c has run and d has run\n  - code has registered c');
    expect(say('c in Ran iff eventually d in Ran')).toBe('Both or neither of these hold:\n  - c has run\n  - now or later, d has run');
  });

  /**
   * @canon spec-an-equivalence-that-is-a-side-of-a-rule-is-said-as-both-or-neither
   */
  it('says an equivalence that is a side of a rule, a temporal operator or a definition as both or neither', () => {
    expect(say('c in Registered implies (c in Ran iff d in Ran)')).toBe('When code has registered c\nthen both or neither of these hold:\n       - c has run\n       - d has run');
    expect(say('(c in Ran iff d in Ran) until d in Registered')).toContain('at every moment from now until the first such moment, not including it, the following holds:\n      both or neither of these hold:');
    const readings = withDefinitions(parseReadings('noun Cleanup: cleanup\nRan: {1} has run | {1} has not run\nsame: {1} goes with {2} | {1} does not go with {2}'), 'sig Cleanup {}');
    expect(verbalizeDefinition('pred same[c, d: Cleanup] { c in Ran iff d in Ran }', readings)).toBe(
      'For every cleanup C1 and every cleanup C2:\n  cleanup C1 goes with cleanup C2 exactly when both or neither of these hold:\n    - cleanup C1 has run\n    - cleanup C2 has run'
    );
  });

  /**
   * @canon spec-an-equivalence-whose-first-side-begins-with-a-time-phrase-is-said-as-both-or-neither
   */
  it('says an equivalence whose first side begins with a time phrase as both or neither', () => {
    expect(say("c in Ran' iff d in Ran")).toBe('c has run at the next moment exactly when d has run now.');
    expect(say("c in Ran' iff d in Ran and c in Registered")).toBe('Both or neither of these hold:\n  - at the next moment, c has run\n  - d has run and code has registered c');
    expect(say("d in Ran iff c in Ran'")).toBe('d has run exactly when at the next moment, c has run.');
  });

  /**
   * @canon spec-an-equivalence-whose-first-side-holds-a-noun-phrase-is-said-as-both-or-neither
   */
  it('says an equivalence whose first side holds a noun phrase as both or neither', () => {
    expect(say('no c.on iff c in Registered')).toBe('Both or neither of these hold:\n  - c is on no owner\n  - code has registered c');
    expect(say('(some x: Owner | x in c.on and x in Disposed) iff c in Registered')).toBe(
      'Both or neither of these hold:\n  - c is on an owner that pulse has disposed\n  - code has registered c'
    );
    expect(say('c in Registered iff no c.on')).toBe('Code has registered c exactly when c is on no owner.');
  });

  /**
   * @canon spec-an-else-is-said-as-otherwise
   */
  it('says an else as "otherwise"', () => {
    expect(say('c in Ran implies d in Ran else d in Registered')).toBe('When c has run, d has run; otherwise, code has registered d.');
    expect(say('(c in Ran and d in Ran and c in Registered and d in Registered) implies d in Disposed else c in Disposed')).toBe(
      ['When all of these hold:', '  - c has run', '  - d has run', '  - code has registered c', '  - code has registered d', 'then pulse has disposed d', 'otherwise pulse has disposed c.'].join('\n')
    );
  });

  /**
   * @canon spec-one-as-a-quantifier-is-said-as-exactly-one
   */
  it('says "one" as exactly one', () => {
    expect(say('one c: Cleanup | c in Ran')).toBe('There is exactly one cleanup such that the cleanup has run.');
    expect(say('one c: Cleanup, o: Owner | c.on = o')).toBe('There is exactly one combination of cleanup C1 and owner O1 such that cleanup C1 is on owner O1.');
  });

  /**
   * @canon spec-lone-as-a-quantifier-is-said-as-at-most-one
   */
  it('says "lone" as at most one', () => {
    expect(say('lone c: Cleanup | c in Ran')).toBe('There is at most one cleanup such that the cleanup has run.');
    expect(say('lone c: Cleanup, o: Owner | c.on = o')).toBe('There is at most one combination of cleanup C1 and owner O1 such that cleanup C1 is on owner O1.');
  });

  /**
   * @canon spec-a-block-as-the-body-of-a-quantifier-is-said-as-its-formulas-together
   */
  it('says a block as the body of a quantifier as its formulas together', () => {
    expect(say('all c: Cleanup { c in Ran c in Registered }')).toBe('For every cleanup:\n  the cleanup has run and code has registered the cleanup.');
  });

  /**
   * @canon spec-not-before-an-and-is-said-as-at-least-one-negation
   */
  it('says not before an and as at least one negation', () => {
    expect(say('not (c in Ran and d in Ran)')).toBe('c has not run or d has not run.');
  });

  /**
   * @canon spec-not-before-an-or-is-said-as-every-negation
   */
  it('says not before an or as every negation', () => {
    expect(say('not (c in Ran or d in Ran)')).toBe('c has not run and d has not run.');
  });

  /**
   * @canon spec-not-before-a-rule-is-said-as-its-condition-and-the-negation-of-its-consequence
   */
  it('says not before a rule as its condition and the negation of its consequence', () => {
    expect(say('not (c in Ran implies d in Ran)')).toBe('c has run and d has not run.');
  });

  /**
   * @canon spec-not-before-an-equivalence-is-said-as-exactly-one-of-its-sides
   */
  it('says not before an equivalence as exactly one of its sides', () => {
    expect(say('not (c in Ran iff d in Ran)')).toBe('Exactly one of these holds:\n  - c has run\n  - d has run');
  });

  /**
   * @canon spec-not-before-an-else-is-said-as-the-rule-with-each-side-negated
   */
  it('says not before an else as the rule with each side negated', () => {
    expect(say('not (c in Ran implies d in Ran else d in Registered)')).toBe('When c has run, d has not run; otherwise, code has not registered d.');
  });

  /**
   * @canon spec-not-before-some-or-no-is-said-as-the-other
   */
  it('says not before some or no as the other', () => {
    expect(say('not some c: Cleanup | c in Ran')).toBe('No cleanup has run.');
    expect(say('not no c: Cleanup | c in Ran')).toBe('There is a cleanup that has run.');
  });

  /**
   * @canon spec-not-before-all-is-said-as-some-with-the-body-negated
   */
  it('says not before all as some with the body negated', () => {
    expect(say('not all c: Cleanup | c in Ran')).toBe('There is a cleanup that has not run.');
    expect(say('not all c: Cleanup - Ran | c in Registered')).toBe('There is a cleanup such that the cleanup has not run and code has not registered the cleanup.');
  });

  /**
   * @canon spec-not-before-always-or-eventually-is-said-as-the-other-with-the-formula-negated
   */
  it('says not before always or eventually as the other with the formula negated', () => {
    expect(say('not eventually c in Ran')).toBe('From now on, c has not run.');
    expect(say('not always c in Ran')).toBe('Now or later, c has not run.');
  });

  /**
   * @canon spec-not-before-historically-or-once-is-said-as-the-other-with-the-formula-negated
   */
  it('says not before historically or once as the other with the formula negated', () => {
    expect(say('not once c in Ran')).toBe('Now and at every earlier moment, c has not run.');
    expect(say('not historically c in Ran')).toBe('Now or earlier, c has not run.');
  });

  /**
   * @canon spec-not-before-after-is-said-as-after-with-the-formula-negated
   */
  it('says not before after as after with the formula negated', () => {
    expect(say('not after c in Ran')).toBe('At the next moment, c has not run.');
  });

  /**
   * @canon spec-a-not-with-no-formula-to-move-into-is-said-as-it-is-not-the-case-that
   */
  it('says a not with no formula to move into as "it is not the case that", with the formula set apart', () => {
    expect(say('not one c: Cleanup | c in Ran')).toBe('It is not the case that:\n  there is exactly one cleanup such that the cleanup has run.');
    expect(say('not lone c: Cleanup | c in Ran')).toBe('It is not the case that:\n  there is at most one cleanup such that the cleanup has run.');
    expect(say('not before c in Ran')).toBe('It is not the case that:\n  there is a moment just before, and at it, c has run.');
    expect(say('not (runNow[d] releases runNow[c])')).toBe(
      ['It is not the case that:', '  at least one of these holds:', '    - from now on, c runs', '    - all of these hold:', '        - now or later, the following holds:', '            d runs and c runs', '        - at every moment from now until the first such moment, not including it, the following holds:', '            c runs.'].join('\n')
    );
  });

  /**
   * @canon spec-a-let-is-said-with-its-value-in-the-place-of-its-name
   */
  it('says a let with its value in the place of its name', () => {
    expect(say('let x = c | x in Ran')).toBe('c has run.');
    expect(say('let x = c.on | no x')).toBe('c is on no owner.');
    expect(say('let x = c, y = x | y in Ran')).toBe('c has run.');
    expect(say('not let x = c | x in Ran')).toBe('c has not run.');
    expect(say('let x = c | some x: Cleanup | x in Ran')).toBe('There is a cleanup that has run.');
  });

  /**
   * @canon spec-a-let-whose-value-a-quantifier-of-its-body-would-capture-is-refused
   */
  it('refuses a let whose value a quantifier of its body would capture', () => {
    expect(() => say('let x = c | some c: Cleanup | c in x.on')).toThrow('the body of the "let" of "x" declares "c", which its value names');
  });

  /**
   * @canon spec-the-spellings-of-not-in-and-not-equal-are-said-alike
   */
  it('says the spellings of not in and not equal alike', () => {
    for (const formula of ['c !in Ran', 'c ! in Ran', 'c not in Ran']) expect(say(formula)).toBe('c has not run.');
    for (const formula of ['c not = d', 'c ! = d', 'c != d']) expect(say(formula)).toBe('c and d are different.');
  });

  /**
   * @canon spec-a-refusal-is-told-apart-from-a-fault
   */
  it('refuses with a Refusal: for a name with no reading, a construct with no words, text Alloy does not read and a definition', () => {
    expect(() => say('c in Mystery')).toThrow(Refusal);
    expect(() => say('c in Ran << 1')).toThrow(Refusal);
    expect(() => say('c == d')).toThrow(Refusal);
    expect(() => verbalizeDefinition('let m[x] = x in Ran', READINGS)).toThrow(Refusal);
    expect(() => say('some c: Cleanup | c in Mystery')).toThrow(Refusal);
  });

  /**
   * @canon spec-text-that-alloy-does-not-read-is-refused
   */
  it('refuses text that Alloy does not read, such as ==', () => {
    expect(() => say('c == d')).toThrow('cannot read "=" here');
    expect(() => say('all c: Cleanup, | c in Ran')).toThrow('expected a name, found "|"');
    expect(() => say('all , c: Cleanup | c in Ran')).toThrow();
    expect(() => say('all var c: Cleanup | c in Ran')).toThrow('cannot read "all" here');
    expect(() => say('4 / 2 = 2')).toThrow();
    expect(() => say('5 % 2 = 1')).toThrow();
  });
});

describe('lighter words', () => {
  /**
   * @canon spec-a-condition-that-is-a-series-is-said-as-a-list
   */
  it('says a condition that is a series as a list of its items', () => {
    const units = withDefinitions(
      parseReadings('noun Unit: unit\nLogical: {1} holds a formula | {1} holds no formula\nStated: {1} has a statement | {1} has no statement\nSayable: the formula of {1} can be said in words | the formula of {1} cannot be said in words\nUnwritten: the statement of {1} is unwritten | the statement of {1} is not unwritten'),
      'sig Unit {} sig Logical, Stated, Sayable, Unwritten in Unit {}'
    );
    expect(say('all u: Unit | (u in Logical and u not in Stated and u in Sayable) implies u in Unwritten', units)).toBe(
      ['The statement of a unit is unwritten when all of these hold:', '  - the unit holds a formula', '  - the unit has no statement', '  - the formula of the unit can be said in words'].join('\n')
    );
  });

  /**
   * @canon spec-a-comma-of-a-reading-after-then-is-left-on-its-line
   */
  it('leaves a comma of a reading after "then" on its line, and sets apart one of its own', () => {
    const quantifiers = withDefinitions(
      parseReadings('noun Quantifier: quantifier\nAbout: the condition of {1} is about its variable | the condition of {1} is not about its variable\nFull: verbalizer says {1} in full, with "there is" and the numbered name | verbalizer does not say {1} in full'),
      'sig Quantifier {} sig About, Full in Quantifier {}'
    );
    expect(say('all q: Quantifier | q not in About implies q in Full', quantifiers)).toBe(
      'When the condition of a quantifier is not about its variable, verbalizer says the quantifier in full, with "there is" and the numbered name.'
    );
  });

  /**
   * @canon spec-a-clause-at-the-next-moment-equal-to-a-clause-now-is-said-with-exactly-when
   */
  it('says a clause at the next moment that holds exactly when a clause holds now with "exactly when"', () => {
    expect(say("Ran' = Ran")).toBe('For every cleanup:\n  the cleanup has run at the next moment exactly when the cleanup has run now.');
    expect(say("Ran = Ran'")).toBe('For every cleanup:\n  the cleanup has run exactly when at the next moment, the cleanup has run.');
  });

  /**
   * @canon spec-a-for-every-right-inside-a-for-every-is-one-for-every
   */
  it('says a "for every" right inside a "for every" as one', () => {
    expect(say('all c: Cleanup | all o: Owner | c.on = o')).toBe('For every cleanup and every owner:\n  the cleanup is on the owner.');
    expect(say('all c: Cleanup | c in Ran implies (all o: Owner | o in c.on)')).toContain('then for every owner');
  });

  /**
   * @canon spec-some-or-no-of-a-signature-is-said-over-its-members
   */
  it('says some, no, one and lone of a signature as there is one of its noun', () => {
    const owners = withDefinitions(parseReadings('noun Owner: owner'), 'sig Owner {}');
    expect(say('some Owner', owners)).toBe('There is an owner.');
    expect(say('no Owner', owners)).toBe('There is no owner.');
    expect(say('one Owner', owners)).toBe('There is exactly one owner.');
    expect(say('lone Owner', owners)).toBe('There is at most one owner.');
    expect(say('not one Owner', owners)).toBe('It is not the case that there is exactly one owner.');
  });
});

describe('fields that relate more than two things', () => {
  /**
   * @canon spec-a-field-of-pairs-has-the-types-of-its-columns
   */
  it('says a field of pairs through its columns, so a frame condition of it reads', () => {
    expect(say("Clock.older' = Clock.older")).toBe(
      'For every cleanup C1 and every cleanup C2:\n  code registered cleanup C1 before cleanup C2 at the next moment exactly when code registered cleanup C1 before cleanup C2 now.'
    );
    expect(() => say("all c: Cleanup | Clock.older' = Clock.older + (Registered -> c)")).not.toThrow();
  });
});

describe('rare constructs', () => {
  /**
   * @canon spec-membership-in-an-else-of-sets-is-said-through-each-branch
   */
  it('says membership in an else of sets through each branch', () => {
    expect(say('all o, p: Owner | o in (p in Disposed implies Disposed else Stopped)')).toBe(
      'For every owner O1 and every owner O2:\n  when pulse has disposed owner O2, pulse has disposed owner O1; otherwise, the dispose of owner O1 has been stopped.'
    );
  });

  /**
   * @canon spec-an-integer-in-a-number-is-said-as-equal-to-it
   */
  it('says an integer in a number as the integer equal to it', () => {
    const counts = withDefinitions(parseReadings('noun Cleanup: cleanup\nnoun Owner: owner\non: {1} is on {2} | {1} is not on {2}'), 'sig Owner {} sig Cleanup { on: set Owner }');
    expect(say('all y: Int | y in #c.on', counts)).toBe(say('all y: Int | y = #c.on', counts));
    expect(say('all y: Int | y in 3', counts)).toBe(say('all y: Int | y = 3', counts));
  });

  /**
   * @canon spec-all-or-some-over-a-union-of-signatures-is-said-over-each
   */
  it('says all or some over a union of signatures over each signature', () => {
    expect(say('all x: Owner + Cleanup | x in Ran')).toBe(say('(all x: Owner | x in Ran) and (all x: Cleanup | x in Ran)'));
    expect(say('some x: Owner + Cleanup | x in Ran')).toBe(say('(some x: Owner | x in Ran) or (some x: Cleanup | x in Ran)'));
    expect(() => say('one x: Owner + Cleanup | x in Ran')).toThrow();
  });
});

describe('an override with a variable in it', () => {
  /**
   * @canon spec-a-variable-a-quantifier-declares-has-the-type-it-declares
   */
  it('says an override with a pair of variables, as a state is updated', () => {
    const sweep = withDefinitions(parseReadings('noun Owner: owner\nnoun Cleanup: cleanup\non: {1} is on {2} | {1} is not on {2}'), 'sig Owner {} sig Cleanup { var on: set Owner }');
    expect(say("all c: Cleanup, o: Owner | on' = on ++ (c -> o)", sweep)).toMatch(/^For every cleanup C1, every owner O1, every cleanup C2 and every owner O2:\n  both or neither of these hold:\n    - at the next moment, cleanup C2 is on owner O2/);
  });
});

describe('none, a variable as a type, and builtin types', () => {
  const R = withDefinitions(
    parseReadings('noun Owner: owner\nnoun String: text\nDisposed: pulse has disposed {1} | pulse has not disposed {1}\nStopped: the dispose of {1} has been stopped | the dispose of {1} has not been stopped'),
    'sig Owner {} var sig Disposed, Stopped in Owner {}'
  );

  /**
   * @canon spec-none-is-said-as-nothing
   */
  it('takes none on the left of in as what always holds, and its count as 0', () => {
    expect(() => say('none in Disposed', R)).toThrow('this formula says nothing: it always holds');
    expect(say('all o: Owner | none in Disposed and o in Stopped', R)).toBe('For every owner:\n  the dispose of the owner has been stopped.');
    expect(say('#none < 1', R)).toBe("In integers that wrap around at the analyzer's bit width, 0 is less than 1.");
    expect(() => say('all x: none | x in Stopped', R)).toThrow('this formula says nothing: it always holds');
    expect(() => say('some x: none | x in Stopped', R)).toThrow('this formula says nothing: it never holds');
  });

  /**
   * @canon spec-a-quantifier-over-a-variable-is-said-of-the-variable
   */
  it('says a quantifier over a variable of the variable', () => {
    expect(say('all p: Owner | all x: p | x in Stopped', R)).toBe(say('all p: Owner | p in Stopped', R));
    expect(say('all p: Owner | some x: p | x in Stopped', R)).toBe(say('all p: Owner | p in Stopped', R));
    expect(say('all p: Owner | no x: p | x in Stopped', R)).toBe(say('all p: Owner | p not in Stopped', R));
  });

  /**
   * @canon spec-a-value-in-its-own-builtin-type-always-holds
   */
  it('takes a value in its own builtin type as what always holds', () => {
    expect(() => say('"a" in String', R)).toThrow('this formula says nothing: it always holds');
    expect(() => say('all y: Int | y in Int', R)).toThrow('this formula says nothing: it always holds');
    expect(() => say('some min', R)).toThrow('is a number outside an integer comparison');
  });
});

describe('a call with an expression of a variable', () => {
  /**
   * @canon spec-a-call-with-an-expression-is-said-by-the-body-with-the-expression-in-place
   */
  it('knows the variables of the expression in the body it is put in', () => {
    const R = withDefinitions(
      parseReadings('noun Owner: owner\nnoun Cleanup: cleanup\nDisposed: pulse has disposed {1} | pulse has not disposed {1}\non: {1} is on {2} | {1} is not on {2}'),
      'sig Owner {} sig Cleanup { on: set Owner } var sig Disposed in Owner {} pred gone2[o: Owner] { o in Disposed }'
    );
    expect(() => say('all c: Cleanup, p: Owner | gone2[c.(on ++ (Cleanup -> p))]', R)).not.toThrow();
  });
});

describe('what it refuses', () => {
  /**
   * @canon spec-until-is-said-as-two-parts
   */
  it('says until with a side of more than a clause as two parts', () => {
    expect(say('(c in Ran implies d in Ran) until runNow[d]')).toBe(
      ['All of these hold:', '  - now or later, the following holds:', '      d runs', '  - at every moment from now until the first such moment, not including it, the following holds:', '      when c has run, d has run.'].join('\n')
    );
  });

  /**
   * @canon spec-since-is-said-as-two-parts
   */
  it('says since with a side of more than a clause as two parts', () => {
    expect(say('(c in Ran implies d in Ran) since runNow[d]')).toBe(
      ['All of these hold:', '  - now or earlier, the following holds:', '      d runs', '  - at every moment after the last such moment, up to and including now, the following holds:', '      when c has run, d has run.'].join('\n')
    );
  });

  /**
   * @canon spec-a-rule-at-every-later-moment-is-said-from-now-on-whenever
   */
  it('says a rule at every moment from now as from now on, whenever', () => {
    expect(say('always (c in Ran implies d in Ran)')).toBe('From now on, whenever c has run, d has run.');
    expect(say('always (c in Ran implies after d in Ran)')).toBe('From now on, whenever c has run, then at the next moment, d has run.');
    expect(say('c in Registered implies always (c in Ran implies d in Ran)')).toContain('from now on, whenever c has run, d has run');
  });

  /**
   * @canon spec-until-of-two-plain-clauses-is-one-sentence
   * @canon spec-since-of-two-plain-clauses-is-one-sentence
   */
  it('says until and since of two plain clauses as one sentence', () => {
    expect(say('c in Registered until o in Disposed')).toBe('Pulse has disposed o now or later, and until then, code has registered c.');
    expect(say('c in Ran since o in Disposed')).toBe('Pulse has disposed o now or earlier, and at every moment after the last such moment, up to and including now, c has run.');
    expect(say('c in Registered until (c in Ran or o in Disposed)')).toMatch(/^All of these hold:/);
  });

  /**
   * @canon spec-releases-is-said-as-always-or-until
   */
  it('says releases with a side of more than a clause as always, or until', () => {
    expect(say('runNow[d] releases (c in Ran implies d in Ran)')).toBe(
      [
        'At least one of these holds:',
        '  - from now on, whenever c has run, d has run',
        '  - all of these hold:',
        '      - now or later, the following holds:',
        '          all of these hold:',
        '            - d runs',
        '            - when c has run, d has run',
        '      - at every moment from now until the first such moment, not including it, the following holds:',
        '          when c has run, d has run.'
      ].join('\n')
    );
  });

  /**
   * @canon spec-triggered-is-said-as-historically-or-since
   */
  it('says triggered with a side of more than a clause as historically, or since', () => {
    expect(say('runNow[d] triggered (c in Ran implies d in Ran)')).toBe(
      [
        'At least one of these holds:',
        '  - now and at every earlier moment:',
        '      when c has run, d has run',
        '  - all of these hold:',
        '      - now or earlier, the following holds:',
        '          all of these hold:',
        '            - d runs',
        '            - when c has run, d has run',
        '      - at every moment after the last such moment, up to and including now, the following holds:',
        '          when c has run, d has run.'
      ].join('\n')
    );
  });

  /**
   * @canon spec-a-sequence-with-a-side-of-more-than-a-clause-is-said-as-and-at-the-next-moment
   */
  it('says a sequence with a side of more than a clause as and at the next moment', () => {
    expect(say('(c in Ran implies d in Ran) ; runNow[d]')).toBe('All of these hold:\n  - when c has run, d has run\n  - at the next moment, d runs');
  });

  /**
   * @canon spec-a-side-with-a-time-phrase-a-noun-phrase-or-a-where-is-more-than-a-plain-clause
   * @canon spec-until-is-said-as-two-parts
   */
  it('says until as two parts when a side holds a time phrase, a noun phrase, a list, a "where" or a "not" set apart', () => {
    const until = (b: string, a: string): string =>
      ['All of these hold:', '  - now or later, the following holds:', `      ${b}`, '  - at every moment from now until the first such moment, not including it, the following holds:', `      ${a}.`].join('\n');
    expect(say('c in Registered until no c.on')).toBe(until('c is on no owner', 'code has registered c'));
    expect(say('c in Registered until (c in Ran or o in Disposed)')).toBe(until('c has run or pulse has disposed o', 'code has registered c'));
    expect(say('c in Registered until always c in Ran')).toBe(until('from now on, c has run', 'code has registered c'));
    expect(say('(after c in Ran) until c in Registered')).toBe(until('code has registered c', 'at the next moment, c has run'));
    expect(say('(before c in Ran) until c in Registered')).toBe(until('code has registered c', 'there is a moment just before, and at it, c has run'));
    expect(say('c in Registered until (some x: Owner | x in c.on and x in Disposed)')).toBe(until('c is on an owner that pulse has disposed', 'code has registered c'));
    expect(say('c in Registered until (one x: Owner | x in c.on)')).toBe(until('there is exactly one owner such that c is on the owner', 'code has registered c'));
    expect(say('c in Registered until { c in Ran o in Disposed }')).toBe(until('c has run and pulse has disposed o', 'code has registered c'));
    expect(say('c in Registered until not (c in Ran and o in Disposed)')).toBe(until('c has not run or pulse has not disposed o', 'code has registered c'));
    expect(say('#c.on > 1 until c in Registered')).toBe(
      until('code has registered c', "in integers that wrap around at the analyzer's bit width, number_1 is greater than 1, where number_1 is the number of values of owner O1 such that c is on owner O1")
    );
    expect(say('c in Registered until c in Ran')).toBe('c has run now or later, and until then, code has registered c.');
  });

  /**
   * @canon spec-a-side-with-a-time-phrase-a-noun-phrase-or-a-where-is-more-than-a-plain-clause
   * @canon spec-until-is-said-as-two-parts
   */
  it('says until as two parts when a side is a call said by a body of more than a clause', () => {
    const readings = withDefinitions(
      parseReadings('noun Cleanup: cleanup\nnoun Owner: owner\nRan: {1} has run | {1} has not run\nRegistered: code has registered {1} | code has not registered {1}\nDisposed: pulse has disposed {1} | pulse has not disposed {1}\nStopped: the dispose of {1} has been stopped | the dispose of {1} has not been stopped'),
      'sig Owner {} sig Cleanup {} var sig Ran, Registered in Cleanup {} var sig Disposed, Stopped in Owner {} pred gone[o: Owner] { o in Disposed } pred gone2[o: Owner] { o in Disposed and o not in Stopped }'
    );
    expect(say('c in Registered until gone2[o]', readings)).toBe(
      ['All of these hold:', '  - now or later, the following holds:', '      pulse has disposed o and the dispose of o has not been stopped', '  - at every moment from now until the first such moment, not including it, the following holds:', '      code has registered c.'].join('\n')
    );
    expect(say('c in Registered until gone[o]', readings)).toBe(
      ['Pulse has disposed o now or later, and until then, code has registered c.'].join('\n')
    );
  });

  /**
   * @canon spec-a-side-with-a-time-phrase-a-noun-phrase-or-a-where-is-more-than-a-plain-clause
   * @canon spec-since-is-said-as-two-parts
   */
  it('says since as two parts when a side holds a noun phrase', () => {
    expect(say('c in Registered since no c.on')).toBe(
      ['All of these hold:', '  - now or earlier, the following holds:', '      c is on no owner', '  - at every moment after the last such moment, up to and including now, the following holds:', '      code has registered c.'].join('\n')
    );
  });

  /**
   * @canon spec-a-side-with-a-time-phrase-a-noun-phrase-or-a-where-is-more-than-a-plain-clause
   * @canon spec-releases-is-said-as-always-or-until
   */
  it('says releases as always, or until, when a side holds a noun phrase', () => {
    expect(say('no c.on releases c in Registered')).toBe(
      ['At least one of these holds:', '  - from now on, code has registered c', '  - all of these hold:', '      - now or later, the following holds:', '          c is on no owner and code has registered c', '      - at every moment from now until the first such moment, not including it, the following holds:', '          code has registered c.'].join('\n')
    );
  });

  /**
   * @canon spec-a-side-with-a-time-phrase-a-noun-phrase-or-a-where-is-more-than-a-plain-clause
   * @canon spec-triggered-is-said-as-historically-or-since
   */
  it('says triggered as historically, or since, when a side holds a time phrase', () => {
    expect(say('(after c in Ran) triggered c in Registered')).toBe(
      [
        'At least one of these holds:',
        '  - now and at every earlier moment, code has registered c',
        '  - all of these hold:',
        '      - now or earlier, the following holds:',
        '          all of these hold:',
        '            - at the next moment, c has run',
        '            - code has registered c',
        '      - at every moment after the last such moment, up to and including now, the following holds:',
        '          code has registered c.'
      ].join('\n')
    );
  });

  /**
   * @canon spec-a-side-with-a-time-phrase-a-noun-phrase-or-a-where-is-more-than-a-plain-clause
   * @canon spec-a-sequence-with-a-side-of-more-than-a-clause-is-said-as-and-at-the-next-moment
   */
  it('says a sequence as and at the next moment when a side holds a time phrase or a noun phrase', () => {
    expect(say('c in Registered ; no c.on')).toBe('All of these hold:\n  - code has registered c\n  - at the next moment, c is on no owner');
    expect(say('(after c in Ran) ; c in Registered')).toBe('All of these hold:\n  - at the next moment, c has run\n  - at the next moment, code has registered c');
    expect(say('c in Ran ; d in Ran ; c in Registered')).toBe('All of these hold:\n  - c has run\n  - at the next moment:\n      d has run, and at the next moment, code has registered c.');
  });

  /**
   * @canon spec-a-name-with-no-reading-is-refused-and-named
   */
  it('says which name has no reading', () => {
    expect(() => say('frobnicate[o]')).toThrow('no reading for "frobnicate"');
    expect(() => say('pred/totalOrder[Owner, o, p]')).toThrow('no reading for "pred/totalOrder"');
  });

  /**
   * @canon spec-a-reading-with-no-negative-form-is-refused-and-named
   */
  it('says which reading has no negative form', () => {
    const readings = parseReadings('Ran: {1} has run');
    expect(() => say('c not in Ran', readings)).toThrow('no negative reading for "Ran"');
  });

  /**
   * @canon spec-a-type-with-no-noun-is-refused-and-named
   */
  it('says which noun is missing', () => {
    expect(() => say('all x: Mystery | x in Ran')).toThrow('no noun for "Mystery"');
  });

  /**
   * @canon spec-a-reading-that-uses-a-slot-the-formula-does-not-give-is-refused
   */
  it('says when a reading uses a variable the formula does not give', () => {
    const readings = parseReadings('on: {1} is on {3}');
    expect(() => say('c->o in on', readings)).toThrow('uses {3}');
  });

  /**
   * @canon spec-a-reading-that-leaves-out-a-slot-the-formula-gives-is-refused
   */
  it('refuses a reading that leaves out a place the formula fills', () => {
    expect(() => say('dispose[c, d]')).toThrow('the reading of "dispose" leaves out {2}');
    expect(() => say('c->d in Ran')).toThrow('the reading of "Ran" leaves out {2}');
    expect(() => verbalizeDefinition('pred dispose[c, d: Cleanup] { c in Ran }', READINGS)).toThrow('the reading of "dispose" leaves out {2}');
  });

  /**
   * @canon spec-a-binary-temporal-operator-inside-a-side-of-another-is-refused
   */
  it('refuses a binary temporal operator inside a side of another, but reads a chain of ";"', () => {
    expect(() => say('c in Ran until (d in Ran until c in Registered)')).toThrow('reads in more than one way');
    expect(() => say('(c in Ran since d in Ran) until c in Registered')).toThrow('reads in more than one way');
    expect(() => say('(c in Ran until d in Ran) ; c in Registered')).toThrow('reads in more than one way');
    expect(say('c in Ran ; d in Ran ; c in Registered')).toBe('All of these hold:\n  - c has run\n  - at the next moment:\n      d has run, and at the next moment, code has registered c.');
  });

  /**
   * @canon spec-a-primed-relation-of-a-variable-signature-is-refused
   */
  it('refuses a prime on a relation of a var sig, and says one of a sig that does not change', () => {
    const queue = withDefinitions(parseReadings('Queue.older: code queued {1} before {2} | code did not queue {1} before {2}'), 'sig Cleanup {} var sig Queue { older: Cleanup -> Cleanup }');
    expect(() => say("c->d in Queue.older'", queue)).toThrow('"Queue" is a var sig');
    expect(() => say("c->d in (Queue.older)'", queue)).toThrow('"Queue" is a var sig');
    expect(say("c->d in Clock.older'")).toBe('At the next moment, code registered c before d.');
  });

  /**
   * @canon spec-a-construct-the-words-do-not-cover-is-refused
   */
  it('refuses a construct it has no words for, rather than leaving it out', () => {
    expect(() => say('some ^(on + ~on)')).toThrow('the vocabulary does not tell what kind of thing');
  });

  /**
   * @canon spec-a-construct-the-words-do-not-cover-is-refused
   */
  it('refuses a membership it has nothing to spell out in, rather than spelling it out without end', () => {
    expect(() => say('c in iden')).toThrow('no reading for "iden"');
    expect(() => say('c in 1')).toThrow('the right of "in" must be a name, not a');
    expect(() => say('c in #Ran')).toThrow('the right of "in" must be a name, not a');
    expect(() => say('c in { x: Cleanup, y: Owner | x in Ran }')).toThrow('the right of "in" must be a name, not a');
  });

  /**
   * @canon spec-a-line-of-readings-that-cannot-be-read-is-refused
   */
  it('refuses a line of readings it cannot read', () => {
    expect(() => parseReadings('this is not a reading')).toThrow('cannot read the line of readings');
  });
});

describe('the names of the variables', () => {
  const named = parseReadings(['noun Unit: [unit]', 'noun Use: use', 'noun Listing: listing frontmatter', 'Cite.rel: {1} cites {2} | {1} does not cite {2}', 'On.rel: {1} is on {2} | {1} is not on {2}'].join('\n'), '#term-unit');

  /**
   * @canon spec-a-variable-is-named-after-its-noun-and-its-number
   */
  it('names a variable by the first letter of its noun and its number, after its noun wherever the words name it', () => {
    expect(verbalize('all u, v: Unit | u->v in Cite.rel', named, 'markdown')).toBe('For every [unit](#term-unit) U1 and every unit U2:\\\nunit U1 cites unit U2.');
  });

  /**
   * @canon spec-nouns-with-the-same-letters-take-more-letters-until-they-differ
   */
  it('takes more letters of two nouns that begin alike, and the first letter of each word of a noun of several words', () => {
    expect(verbalize('all u, v: Unit, s, t: Use | u->s in On.rel and v->t in On.rel', named)).toContain('every unit Un1, every unit Un2, every use Us1 and every use Us2');
    expect(verbalize('all l, m: Listing | l->m in Cite.rel', named)).toBe('For every listing frontmatter LF1 and every listing frontmatter LF2:\n  listing frontmatter LF1 cites listing frontmatter LF2.');
  });
});

describe('the lines of the Markdown layout', () => {
  const named = parseReadings(['noun Unit: [unit]', 'Ran: {1} has run | {1} has not run'].join('\n'), '#term-unit');

  /**
   * @canon spec-a-line-that-opens-a-part-ends-in-a-line-break-in-markdown
   */
  it('ends a line that opens a part with a line break, and opens a list right under its line', () => {
    expect(verbalize('all u: Unit | u in Ran', named, 'markdown')).toBe('For every [unit](#term-unit):\\\nthe unit has run.');
    const listed = verbalize('all c, d: Cleanup | (c in Ran and c in Registered and d in Ran) implies d in Disposed', READINGS, 'markdown');
    expect(listed).toBe('For every cleanup C1 and every cleanup C2:\\\npulse has disposed cleanup C2 when all of these hold:\n- cleanup C1 has run\n- code has registered cleanup C1\n- cleanup C2 has run');
  });

  /**
   * @canon spec-a-line-that-opens-a-part-ends-in-a-line-break-in-markdown
   */
  it('keeps a blank line after a list, where a line break cannot end it', () => {
    const doc = { kind: 'rule' as const, lead: RULE.when, when: { kind: 'list' as const, intro: 'all of these hold', items: ['a holds', 'b holds'] }, then: 'c holds' };
    expect(markdownLines(doc)).toEqual(['when all of these hold:', '- a holds', '- b holds', '', 'then c holds']);
  });
});

