/**
 * The fixed words of the printer: what it says for each construct that is not a reading of the table. The printer says
 * them, the parser reads them back, and the guards look for them, all from here, so a change of words is made once.
 */
import type { Compared, Moment } from './ir.ts';

/** The intros of the lists and blocks the printer sets apart, without their colon. */
export const INTRO = {
  all: 'all of these hold',
  any: 'at least one of these holds',
  both: 'both or neither of these hold',
  exactlyOne: 'exactly one of these holds',
  untrue: 'it is not the case that',
  apart: 'the following holds',
  /** After "is", before the kinds of a definition said kind by kind: "unit_1 is one of these". */
  oneOf: 'one of these',
  /** After the subject and the verb a list of negative clauses share: "the definition has none of these". */
  noneOf: 'none of these'
} as const;

/** The time phrase of each temporal operator of one formula. */
export const MOMENT: Record<Moment, string> = {
  always: 'from now on',
  eventually: 'now or later',
  after: 'at the next moment',
  before: 'there is a moment just before, and at it',
  once: 'now or earlier',
  historically: 'now and at every earlier moment'
};

/** `until` and `since`: the words that join their two plain clauses in one sentence, and the intros that set their sides apart. */
export const BINARY = {
  until: {
    joint: ' now or later, and until then, ',
    first: 'now or later, the following holds',
    second: 'at every moment from now until the first such moment, not including it, the following holds'
  },
  since: {
    joint: ' now or earlier, and at every moment after the last such moment, up to and including now, ',
    first: 'now or earlier, the following holds',
    second: 'at every moment after the last such moment, up to and including now, the following holds'
  }
} as const;

/** The words that open the sides of a rule. */
export const RULE = { when: 'when', whenever: 'from now on, whenever', then: 'then', otherwise: 'otherwise' } as const;

/** What a comparison of integers is said in. */
export const WRAP = "in integers that wrap around at the analyzer's bit width, ";

/** The words of each operator of a comparison of numbers. */
export const COMPARED: Record<Compared, string> = {
  '<': 'is less than',
  '>': 'is greater than',
  '=<': 'is at most',
  '>=': 'is at least',
  '=': 'is equal to',
  '!<': 'is not less than',
  '!>': 'is not greater than',
  '!=<': 'is not at most',
  '!>=': 'is not at least',
  '!=': 'is not equal to'
};

/** Every phrase that places words in time, as a pattern of their start: the time phrases, the sides of `until` and `since`, and the wrap of integers. */
export const TIME_PHRASES: string[] = [...Object.values(MOMENT), BINARY.until.second, BINARY.since.second, 'now or at', 'now and at', 'at every', 'right after', 'up to and including', 'back to and including', WRAP.trim().replace(/,$/, '')];

/** The prepositions a relative clause may put before "which": "a unit for which the checker reports no finding". */
export const PREPOSITIONS = ['about', 'after', 'before', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'over', 'to', 'with'];
