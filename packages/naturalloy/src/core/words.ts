/**
 * What the words of a part show a reader, for a pass that weighs whether a part can stand in a sentence beside others:
 * a time phrase covers what follows it, a relative clause runs over what follows it, a comma can read as where a
 * sentence turns, and an "and" or an "or" as where it joins. The printer marks each of these where it makes the words,
 * in its own words and in the words of a reading; the marks are invisible, as the marks of variables and links are, and
 * `finish` takes them out. The guards ask whether a mark is there, not what the English says.
 */
import { LINK, LINK_MARK, plain, type Readings } from '../readings.ts';
import { MOMENT, TIME_PHRASES } from './constructs.ts';

/** Marks a variable in the words, so that a sentence is never started with a capital in place of the variable's own letter. */
export const VARIABLE = '\u0001';

/** The marks of what words hold: a time phrase, a comma of the printer's own, a relative clause, an "and" or "or", a series, a "no". */
export const MARK = { time: '\u0010', comma: '\u0011', relative: '\u0012', join: '\u0013', series: '\u0014', no: '\u0015' } as const;
const MARKS = new RegExp(`[${Object.values(MARK).join('')}]`, 'g');

/** The words without the marks of what they hold. */
export const unmarked = (words: string): string => words.replace(MARKS, '');

/** The words as a reader sees them, without the marks of variables, links and what they hold. */
export const seen = (words: string): string => unmarked(plain(words)).replaceAll(VARIABLE, '');

/** Whether words begin with a time phrase. */
export const timed = (words: string): boolean => plain(words).replaceAll(VARIABLE, '').startsWith(MARK.time);
/** Whether words hold a time phrase anywhere. */
export const holdsTime = (words: string): boolean => words.includes(MARK.time);
/** Whether words hold a relative clause or a "where", which would run over words that follow them. */
export const holdsRelative = (words: string): boolean => words.includes(MARK.relative);
/** Whether words hold a comma of their own, outside the words of their readings: a comma inside a reading is the author's. */
export const holdsOwnComma = (words: string): boolean => words.includes(MARK.comma);
/** Whether words hold a comma, their own or a reading's. */
export const holdsComma = (words: string): boolean => words.includes(',');
/** Whether words join parts with "and" or "or". */
export const joins = (words: string): boolean => words.includes(MARK.join);
/** Whether words are a series after a comma, "a, and at the next moment, b", which could end before its last clause. */
export const series = (words: string): boolean => words.includes(MARK.series);
/** Whether words say "no". */
export const saysNo = (words: string): boolean => words.includes(MARK.no);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TIME = new RegExp(`\\b(?:${TIME_PHRASES.map(escape).join('|')})\\b`, 'g');
/** A series after a comma, but not the comma and "and" of "there is a moment just before, and at it". */
const SERIES = new RegExp(`(?<!${escape(MOMENT.before.slice(0, MOMENT.before.indexOf(',')))}), (?:and|or) `, 'g');

/**
 * Words with the marks of what they hold. `own` says whether their commas are the printer's: in the printer's fixed
 * words they are, and in the words of a reading they are the author's. The targets of links are not words.
 */
export function marked(words: string, own: boolean): string {
  const targets: string[] = [];
  const hidden = words.replace(LINK_MARK, (_, target: string, word: string) => `${LINK}${targets.push(target) - 1}${LINK}${word}${LINK}`);
  const out = hidden
    .replace(TIME, phrase => `${MARK.time}${phrase}`)
    .replace(SERIES, series => `${MARK.series}${series}`)
    .replace(/\b(?:and|or)\b/g, word => `${MARK.join}${word}`)
    .replace(/\b(?:that|where)\b/g, word => `${MARK.relative}${word}`)
    .replace(/\bno\b/g, word => `${MARK.no}${word}`)
    .replaceAll(',', own ? `${MARK.comma},` : ',');
  return out.replace(LINK_MARK, (_, i: string, word: string) => `${LINK}${targets[Number(i)] as string}${LINK}${word}${LINK}`);
}

/** Fixed words of the printer, marked: a construct's words from the table. */
export const fixed = (words: string): string => marked(words, true);

/** The printer's own words, marked: its fixed words in a template, around words already said and marked. */
export function own(fixed: TemplateStringsArray, ...said: string[]): string {
  return fixed.reduce((out, words, i) => `${out}${marked(words, true)}${i < said.length ? (said[i] as string) : ''}`, '');
}

/** The most that is said in a sentence, and not in a list, and how long it may be. */
export const INLINE_ITEMS = 3;
export const INLINE_LENGTH = 110;

/**
 * A clause that begins with the variable the clause before it begins with says it once: "test_1 is an expected failure,
 * checks no bug and checks no exception". Not when the variable is the first of a pair, as in "unit_1 and unit_2 are
 * different", nor after a clause with a relative clause, which the one without its subject would read as more of.
 */
export function shareSubject(clauses: string[]): string[] {
  const subjectOf = (clause: string): string | undefined => /^\u0001[^\u0001]*\u0001/.exec(clause)?.[0];
  return clauses.map((clause, i) => {
    const subject = subjectOf(clause);
    const before = clauses[i - 1];
    if (i === 0 || subject === undefined || before === undefined || subjectOf(before) !== subject || holdsRelative(before)) return clause;
    const rest = clause.slice(subject.length + 1);
    const pairLike = (c: string): boolean => /^(?:and|or)\b/.test(unmarked(c.slice(subject.length + 1)));
    return pairLike(clause) || pairLike(before) ? clause : rest;
  });
}

/** "a, b and c". */
export function coordinate(words: string[], word: 'and' | 'or'): string {
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(own`, `)}${marked(` ${word} `, true)}${words[words.length - 1]}`;
}

/** The words that may open the rest of a clause after its subject: the verbs the readings know, and those of English that every clause may use. */
export function verbWord(word: string, readings: Readings): boolean {
  const plain = word.replace(/^\[|\].*$/g, '');
  if (['is', 'are', 'was', 'were', 'has', 'have', 'had', 'does', 'do', 'did', 'can', 'cannot'].includes(plain)) return true;
  return readings.verbs.has(plain) || [...readings.verbs.values()].some(forms => forms.infinitive === plain);
}
