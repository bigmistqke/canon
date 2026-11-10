/**
 * The parser: the words of the printer back to the sentence IR. Each construct the printer says has one form, so the
 * words are a controlled language, and the parser reads them by the same rules a reader holds. It returns every reading
 * it finds. One reading, meaning what the printed IR means, proves the printer said it without loss; two that mean
 * different things show that the words can be read two ways.
 *
 * It reads the text layout. A statement is first read back into the layout the printer made of it: lists, blocks and
 * rules. Then each part is read as a sentence.
 */
import { longNames } from './names.ts';
import type { Readings } from '../readings.ts';
import { unbracketed } from '../readings.ts';
import { BINARY, COMPARED, INTRO, MOMENT, PREPOSITIONS, RULE, WRAP } from './constructs.ts';
import type { Clause, Compared, Moment, NounPhrase, Num, Sentence, Term, Var } from './ir.ts';
import { type Doc, readLayout } from './layout.ts';
import { Vocabulary } from './vocabulary.ts';
import { mapTerms } from './walk.ts';

/** Each time phrase with the operator it says. */
const MOMENTS = Object.entries(MOMENT) as [Moment, string][];

/** What the names of a statement stand for, as a reader meets them. */
type Scope = ReadonlyMap<string, Term>;

/** Every way to split words at a separator, as a reader could. */
function splits(words: string, separator: string): [string, string][] {
  const out: [string, string][] = [];
  for (let at = words.indexOf(separator); at !== -1; at = words.indexOf(separator, at + 1)) out.push([words.slice(0, at), words.slice(at + separator.length)]);
  return out;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words of each operator of a comparison of numbers, the longest first, so that "is not less than" is not read as "less than". */
const OPERATORS = (Object.entries(COMPARED) as [Compared, string][]).map(([op, words]): [string, Compared] => [words, op]).sort((x, y) => y[0].length - x[0].length);

/** The numbers the words name after "where": number_1, number_2, each with every reading of its words. */
type Defs = ReadonlyMap<string, Num[]>;

/**
 * "another" or "no other" while the words are read: a noun phrase whose other thing is what the clause before says in
 * the same place, or one its own clause names before it, and otherwise `kin`, the thing of its kind a quantifier
 * introduced last.
 */
interface Another extends NounPhrase {
  another: { kin?: Term };
}

const isAnother = (x: Term): x is Another => x.t === 'np' && 'another' in x;

/**
 * A reading with each "another" or "no other" settled: one that differs from nothing differs from its `kin`, and
 * undefined where it has none, since then nothing before it is of its kind.
 */
function settled(s: Sentence): Sentence | undefined {
  let lost = false;
  const out = mapTerms(s, x => {
    if (!isAnother(x)) return x;
    const { another, ...np } = x;
    const other = np.other ?? another.kin;
    if (other === undefined) lost = true;
    return other === undefined ? np : { ...np, other };
  });
  return lost ? undefined : out;
}

export class Parser {
  private readonly readings: Readings;
  private readonly vocabulary: Vocabulary;
  /** The type of each noun, by its words. */
  private readonly types = new Map<string, string>();
  /** Each reading's words as a pattern with a group for each slot. */
  private readonly templates: { key: string; negative: boolean; pattern: RegExp; slots: number[] }[] = [];
  private ids = 0;
  /** The names the formula leaves free, which the words say as they are. */
  private readonly free: ReadonlySet<string>;

  constructor(readings: Readings, free: Iterable<string> = []) {
    this.readings = readings;
    this.vocabulary = new Vocabulary(readings);
    this.free = new Set(free);
    for (const [type, words] of readings.nouns) this.types.set(unbracketed(words).trim(), type);
    for (const [key, reading] of readings.atoms)
      for (const [negative, words] of [[false, reading.positive], [true, reading.negative]] as [boolean, string | undefined][]) {
        if (words === undefined) continue;
        const plain = unbracketed(words);
        const slots = [...plain.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1]));
        const pattern = new RegExp(`^${plain.split(/\{\d+\}/).map(escape).join('(.+?)')}$`);
        this.templates.push({ key, negative, pattern, slots });
      }
  }

  /** Every IR the words of a statement can be read as. */
  statement(text: string): Sentence[] {
    // "another" or "no other" with nothing before it of its kind has no reading.
    return readLayout(text)
      .flatMap(doc => this.doc(doc, new Map()))
      .flatMap(s => settled(s) ?? []);
  }

  private fresh(type: string): Var {
    return { id: `p${++this.ids}`, type };
  }

  // ---- names and terms ----

  /** The variables an intro names, "cleanup_1", "every owner_2", "the unit": each with its type, new in scope. */
  private named(name: string): { name: string; v: Var } | undefined {
    const stem = name.replace(/_\d+$/, '').replace(/_/g, ' ');
    const type = this.types.get(stem);
    // "expected failure" is named expected_failure, as "the expected failure" is looked up.
    return type === undefined ? undefined : { name: name.replace(/ /g, '_'), v: this.fresh(type) };
  }

  /** What a term says: a variable in scope, "the noun" of one, a string, a free name, or a noun phrase. */
  private terms(words: string, scope: Scope): Term[] {
    const out: Term[] = [];
    const inScope = scope.get(words) ?? (words.startsWith('the ') ? scope.get(words.slice(4).replace(/ /g, '_')) : undefined);
    if (inScope !== undefined) out.push(inScope);
    if (/^"[^"]*"$/.test(words)) out.push({ t: 'string', value: words.slice(1, -1) });
    // A free variable: a name of the formula, which no quantifier of the words introduced.
    if (this.free.has(words) && !scope.has(words)) out.push({ t: 'free', name: words });
    out.push(...this.phrases(words, scope));
    return out;
  }

  /** A noun phrase: "a unit", "no owner that pulse has disposed", "another unit", "a text other than "a"". */
  private phrases(words: string, scope: Scope): NounPhrase[] {
    const out: NounPhrase[] = [];
    const m = /^(no other|another|an|a|no) (.+)$/.exec(words);
    if (m === null) return out;
    const [, det, rest] = m as unknown as [string, string, string];
    for (const [noun, type] of this.types) {
      if (rest !== noun && !rest.startsWith(`${noun} `)) continue;
      const after = rest.slice(noun.length).trim();
      const v = this.fresh(type);
      const others: (Term | undefined)[] = [undefined];
      let relativeWords = after;
      const other = /^other than (.+?)(?: (that .+))?$/.exec(after);
      if (other !== null) {
        others.splice(0, 1, ...this.terms(other[1] as string, scope));
        relativeWords = other[2] ?? '';
      }
      const which = new RegExp(`^(${PREPOSITIONS.join('|')}) which (.+)$`).exec(relativeWords);
      const relatives: (Sentence | undefined)[] =
        relativeWords === '' ? [undefined] : relativeWords.startsWith('that ') ? this.relative(relativeWords.slice(5), v, scope) : which !== null ? this.afterWhich(which[2] as string, which[1] as string, v, scope) : [];
      for (const otherTerm of others)
        for (const relative of relatives) {
          const np: NounPhrase = { t: 'np', det: det === 'no' || det === 'no other' ? 'no' : 'a', v };
          if (relative !== undefined) np.relative = relative;
          // "another unit" and "no other owner" differ from a thing of their kind the sentence already names: the pass gives
          // them the variable they differ from, which a reader finds as the one thing of the kind in play.
          if (det === 'another' || det === 'no other') {
            // It differs from the thing of its kind the words named last: in its clause, in the clause before, or where a
            // quantifier introduced it.
            const kin = [...scope.values()].filter(term => term.t === 'var' && term.v.type === type).at(-1);
            const another: Another = { ...np, another: kin === undefined ? {} : { kin } };
            out.push(another);
            continue;
          }
          if (otherTerm !== undefined) np.other = otherTerm;
          out.push(np);
        }
    }
    return out;
  }

  /** The words after "that": conditions with the variable as their subject, joined by "and", or one with it at its end. */
  private relative(words: string, v: Var, scope: Scope): Sentence[] {
    const hole = '\u0003';
    const inner = new Map([...scope, [hole, { t: 'var', v } as Term]]);
    const out: Sentence[] = [];
    // "that is not a spec, an axiom or a fact": one negation over each kind.
    const negations = /^is not (.+)$/.exec(words);
    const subjects: string[][] = [];
    for (const parts of this.series(words, 'and')) subjects.push(parts.map(part => `${hole} ${part}`));
    if (negations !== null) for (const parts of this.series(negations[1] as string, 'or')) subjects.push(parts.map(part => `${hole} is not ${part}`));
    for (const parts of subjects) {
      let all: Sentence[][] = [[]];
      for (const part of parts) all = all.flatMap(done => this.clauses(part, inner).map(c => [...done, c]));
      for (const said of all) out.push(said.length === 1 ? (said[0] as Sentence) : { t: 'and', items: said });
    }
    // "an issue that tracker does not know": the variable at the end.
    out.push(...this.clauses(`${words} ${hole}`, inner));
    // "an issue that the tracker knows and has not closed": each with the variable at its end, and the subject of the first.
    for (const parts of this.series(words, 'and')) {
      if (parts.length < 2) continue;
      const first = (parts[0] as string).split(' ');
      for (let n = 1; n < first.length; n++) {
        const subject = first.slice(0, n).join(' ');
        let all: Sentence[][] = [[]];
        for (const [i, part] of parts.entries()) all = all.flatMap(done => this.clauses(`${i === 0 ? part : `${subject} ${part}`} ${hole}`, inner).map(c => [...done, c]));
        for (const said of all) out.push({ t: 'and', items: said });
      }
    }
    return out;
  }

  /** The words after a preposition and "which": a condition with the variable after that preposition, at its end. */
  private afterWhich(words: string, preposition: string, v: Var, scope: Scope): Sentence[] {
    const hole = '\u0003';
    return this.clauses(`${words} ${preposition} ${hole}`, new Map([...scope, [hole, { t: 'var', v } as Term]]));
  }

  /** Every way to read words as a series of two or three parts, "a, b and c" or "a and b". */
  private series(words: string, word: 'and' | 'or'): string[][] {
    const out: string[][] = [[words]];
    for (const [a, b] of splits(words, ` ${word} `)) {
      out.push([a, b]);
      for (const [x, y] of splits(a, ', ')) out.push([x, y, b]);
    }
    return out;
  }

  /** A clause: a reading with a term in each slot, or one of the printer's own. */
  clauses(words: string, scope: Scope, elided = false): Clause[] {
    const out: Clause[] = [];
    for (const template of this.templates) {
      const m = template.pattern.exec(words);
      if (m === null) continue;
      // Each slot, as the order of the reading's slots puts it.
      const filled = new Map<number, string>();
      template.slots.forEach((slot, i) => filled.set(slot, m[i + 1] as string));
      const arity = Math.max(0, ...template.slots);
      let all: Term[][] = [[]];
      for (let slot = 1; slot <= arity; slot++) all = all.flatMap(done => this.terms(filled.get(slot) as string, scope).map(term => [...done, term]));
      const form = arity === 0 ? 'some' : this.vocabulary.form(template.key);
      // A reader takes words two readings share as the one whose things are of the kinds the words name.
      const columns = this.vocabulary.slotTypes(template.key);
      all = all.filter(args => columns === undefined || args.every((arg, i) => this.vocabulary.fits(this.typeOfTerm(arg), columns[i])));
      for (const args of all) {
        // "another unit" in a clause that names a unit before it differs from that unit.
        const resolved = args.map((arg, k) => {
          if (!isAnother(arg)) return arg;
          // A subject the words leave out is not named before it.
          const before = (elided ? args.slice(1, k) : args.slice(0, k)).reverse().find(b => b.t === 'var' && b.v.type === arg.v.type);
          return before === undefined ? arg : { ...arg, other: before };
        });
        out.push({ t: 'reading', key: template.key, form, args: resolved, negative: template.negative });
      }
    }
    const same = /^(.+) and (.+) are (the same|different)$/.exec(words);
    if (same !== null)
      for (const l of this.terms(same[1] as string, scope)) for (const r of this.terms(same[2] as string, scope)) out.push({ t: 'same', l, r, negative: same[3] === 'different' });
    const isA = /^(.+) is (not )?(?:an?) (.+)$/.exec(words);
    if (isA !== null) {
      const type = this.types.get(isA[3] as string);
      if (type !== undefined && !this.readings.atoms.has(type)) for (const x of this.terms(isA[1] as string, scope)) out.push({ t: 'isA', x, type, negative: isA[2] !== undefined });
    }
    const next = /^(.+) is (not )?the integer after (.+) without wrapping around$/.exec(words);
    if (next !== null) for (const y of this.terms(next[1] as string, scope)) for (const x of this.terms(next[3] as string, scope)) out.push({ t: 'next', x, y, negative: next[2] !== undefined });
    // "owner_1 reaches owner_2 in one or more steps, where a step from owner_3 to owner_4 is that owner_4 is the parent of owner_3".
    const reach = /^(.+?) (reaches|does not reach) (.+?) in (one|zero) or more steps, where a step from (\S+) to (\S+) is that (.+)$/.exec(words);
    if (reach !== null) {
      const [p, q] = [this.named(reach[5] as string), this.named(reach[6] as string)];
      if (p !== undefined && q !== undefined) {
        const inner = new Map([...scope, [p.name, { t: 'var', v: p.v } as Term], [q.name, { t: 'var', v: q.v } as Term]]);
        for (const from of this.terms(reach[1] as string, scope))
          for (const to of this.terms(reach[3] as string, scope))
            for (const step of this.sentence(reach[7] as string, inner))
              out.push({ t: 'reach', from, to, reflexive: reach[4] === 'zero', p: p.v, q: q.v, step, relation: { t: 'name', name: 'step' }, negative: reach[2] !== 'reaches' });
      }
    }
    out.push(...this.compare(words, scope, new Map()));
    return out;
  }

  /** "in integers that wrap around at the analyzer's bit width, a is less than b", with the numbers named after "where". */
  private compare(words: string, scope: Scope, defs: Defs): Clause[] {
    if (!words.startsWith(WRAP)) return [];
    const out: Clause[] = [];
    const rest = words.slice(WRAP.length);
    for (const [phrase, op] of OPERATORS)
      for (const [a, b] of splits(rest, ` ${phrase} `)) {
        // A shorter phrase inside a longer one, "less than" in "not less than", is the longer one's.
        if (OPERATORS.some(([longer]) => longer !== phrase && longer.endsWith(phrase) && a.endsWith(` ${longer.slice(0, -phrase.length).trim()}`))) continue;
        for (const l of this.numbers(a, scope, defs)) for (const r of this.numbers(b, scope, defs)) out.push({ t: 'compare', op, l, r });
      }
    return out;
  }

  /** The readings of the words of a number. */
  private numbers(words: string, scope: Scope, defs: Defs): Num[] {
    const out: Num[] = [];
    if (/^-?\d+$/.test(words)) out.push({ t: 'literal', value: Number(words) });
    if (words === 'the least integer') out.push({ t: 'least' });
    if (words === 'the greatest integer') out.push({ t: 'greatest' });
    out.push(...(defs.get(words) ?? []));
    for (const x of this.terms(words, scope)) if (x.t !== 'np') out.push({ t: 'term', x });
    for (const [word, op] of [['plus', 'plus'], ['minus', 'minus'], ['times', 'times']] as const)
      for (const [a, b] of splits(words, ` ${word} `)) for (const l of this.numbers(a, scope, defs)) for (const r of this.numbers(b, scope, defs)) out.push({ t: 'arith', op, l, r });
    out.push(...this.defined(words, scope, defs, undefined));
    return out;
  }

  /** What a number named after "where" is: a count, a sum, a division or a remainder; `body` is its condition set apart. */
  private defined(words: string, scope: Scope, defs: Defs, body: Doc | undefined): Num[] {
    const out: Num[] = [];
    const conditions = (cond: string | undefined, inner: Scope): Sentence[] => (body !== undefined ? this.doc(body, inner) : cond === undefined ? [] : this.sentence(cond, inner));
    const values = /^the number of (?:values of (\S+)|combinations of (.+?)) such that(?: (.+))?$/.exec(words);
    if (values !== null) {
      const vars = this.introduced(values[1] !== undefined ? [values[1]] : (values[2] as string).split(' and '));
      if (vars !== undefined) {
        const inner = new Map([...scope, ...vars.map(({ name, v }): [string, Term] => [name, { t: 'var', v }])]);
        for (const cond of conditions(values[3], inner)) out.push({ t: 'count', vars: vars.map(x => x.v), cond });
      }
    }
    const sum = /^the sum of the values of (\S+) such that(?: (.+))?$/.exec(words);
    if (sum !== null) {
      const v = this.named(sum[1] as string);
      if (v !== undefined) for (const cond of conditions(sum[2], new Map([...scope, [v.name, { t: 'var', v: v.v } as Term]]))) out.push({ t: 'sumOf', v: v.v, cond });
    }
    const over = /^the sum, over every (.+?), of (.+)$/.exec(words);
    if (over !== null) {
      const vars = this.introduced((over[1] as string).split(' and every '));
      if (vars !== undefined) {
        const inner = new Map([...scope, ...vars.map(({ name, v }): [string, Term] => [name, { t: 'var', v }])]);
        for (const n of this.numbers(over[2] as string, inner, defs)) out.push({ t: 'sumOver', vars: vars.map(x => x.v), body: n });
      }
    }
    const div = /^(.+) divided by (.+), rounded toward zero; when (.+) is 0, it is -1, 0 or 1 as (.+) is positive, zero or negative$/.exec(words);
    if (div !== null && div[2] === div[3] && div[1] === div[4]) for (const l of this.numbers(div[1] as string, scope, defs)) for (const r of this.numbers(div[2] as string, scope, defs)) out.push({ t: 'arith', op: 'div', l, r });
    const rem = /^the remainder of (.+) divided by (.+), with the sign of (.+); when (.+) is 0, it is (.+)$/.exec(words);
    if (rem !== null && rem[1] === rem[3] && rem[2] === rem[4]) for (const l of this.numbers(rem[1] as string, scope, defs)) for (const r of this.numbers(rem[2] as string, scope, defs)) out.push({ t: 'arith', op: 'rem', l, r });
    return out;
  }

  /**
   * One kind of a definition by kinds: "unit_1 is a spec that cites no unit and is not a bug" is the kind, said by a
   * clause, and what else holds of the subject; "… that cites no unit or is not a bug" is one of several options.
   */
  private kinds(words: string, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    for (const [kind, rest] of splits(words, ' that ')) {
      const subject = /^(.+?) is (an? .+)$/.exec(kind);
      if (subject === null) continue;
      for (const guard of this.clauses(kind, scope))
        for (const word of ['and', 'or'] as const)
          for (const parts of this.series(rest, word)) {
            let all: Sentence[][] = [[]];
            for (const part of parts) all = all.flatMap(done => this.clauses(`${subject[1] as string} ${part}`, scope).map(c => [...done, c as Sentence]));
            for (const said of all) {
              const others: Sentence[] = word === 'or' && said.length > 1 ? [{ t: 'or', items: said }] : said;
              if (word === 'or' && said.length === 1) continue;
              out.push({ t: 'and', items: [guard, ...others] });
            }
          }
    }
    return out;
  }

  /** The numbers a "where" names: "number_1 is …", each a line or a block. */
  private where(items: Doc[], scope: Scope): Defs[] {
    let all: Map<string, Num[]>[] = [new Map()];
    for (const item of items) {
      const [line, body] = typeof item === 'string' ? [item, undefined] : item.kind === 'block' ? [item.intro, item.body] : [undefined, undefined];
      const m = line === undefined ? null : /^(number_\d+) is (.+)$/.exec(line);
      if (m === null) return [];
      all = all.map(defs => new Map([...defs, [m[1] as string, this.defined(m[2] as string, scope, defs, body).concat(body === undefined ? this.numbers(m[2] as string, scope, defs) : [])]]));
    }
    return all;
  }

  private typeOfTerm(term: Term): string | undefined {
    return term.t === 'var' || term.t === 'np' ? term.v.type : term.t === 'string' ? 'String' : undefined;
  }

  // ---- sentences ----

  /** A line: a rule, a time phrase over words, an equivalence, a quantifier, a series of clauses, or a clause. */
  sentence(words: string, scope: Scope): Sentence[] {
    const out: Sentence[] = [...this.clauses(words, scope)];
    // A comparison with one number named after "where".
    for (const [head, def] of splits(words, ', where ')) for (const defs of this.where([def], scope)) out.push(...this.compare(head, scope, defs));
    // "when a, b" and "when a, then b", with "; otherwise, c".
    for (const lead of [RULE.when, RULE.whenever]) {
      if (!words.startsWith(`${lead} `)) continue;
      const body = words.slice(lead.length + 1);
      const otherwiseMark = `; ${RULE.otherwise}, `;
      const [main, otherwiseWords] = body.includes(otherwiseMark) ? (splits(body, otherwiseMark).at(-1) as [string, string]) : [body, undefined];
      for (const [when, rest] of splits(main, ', ')) {
        const then = rest.startsWith(`${RULE.then} `) ? rest.slice(RULE.then.length + 1) : rest;
        // "when a bug …, … the bug": the rule over every bug.
        if (lead === RULE.when && otherwiseWords === undefined) out.push(...this.everyLine(when, then, scope));
        for (const w of this.sentence(when, scope))
          for (const t of this.sentence(then, scope)) {
            const rules: Sentence[] =
              otherwiseWords === undefined ? [{ t: 'rule', when: w, then: t }] : this.sentence(otherwiseWords, scope).map(o => ({ t: 'rule', when: w, then: t, otherwise: o }) as Sentence);
            for (const rule of rules) out.push(lead === RULE.when ? rule : { t: 'moment', op: 'always', body: rule });
          }
      }
    }
    for (const [op, phrase] of MOMENTS) if (words.startsWith(`${phrase}, `)) for (const body of this.sentence(words.slice(phrase.length + 2), scope)) out.push({ t: 'moment', op, body });
    // "b now or later, and until then, a"; "b now or earlier, and at every moment after the last such moment, up to and including now, a".
    for (const op of ['until', 'since'] as const)
      for (const [b, a] of splits(words, BINARY[op].joint)) for (const bs of this.sentence(b, scope)) for (const as of this.sentence(a, scope)) out.push({ t: op, a: as, b: bs });
    for (const [l, r] of splits(words, ' exactly when ')) {
      const next = /^(.+) at the next moment$/.exec(l);
      const now = /^(.+) now$/.exec(r);
      for (const ls of this.sentence(l, scope)) for (const rs of this.sentence(r, scope)) out.push({ t: 'iff', l: ls, r: rs });
      if (next !== null) for (const ls of this.sentence(next[1] as string, scope)) for (const rs of this.sentence(now?.[1] ?? r, scope)) out.push({ t: 'iff', l: { t: 'moment', op: 'after', body: ls }, r: rs });
    }
    if (words.startsWith(`${INTRO.untrue} `)) for (const body of this.sentence(words.slice(INTRO.untrue.length + 1), scope)) out.push({ t: 'not', body });
    // "a unit is unfounded exactly when the unit …": the definition for every unit.
    if (words.includes(' exactly when '))
      for (const every of this.every([words], [], scope, true))
        for (const body of this.sentence(every.docs[0] as string, every.inner)) if (body.t === 'iff') out.push({ t: 'quant', q: 'all', vars: [every.v], body });
    // A definition by kinds with one kind: "unit_1 is unfounded exactly when unit_1 is a spec that cites no unit".
    for (const [head, kind] of splits(words, ' exactly when ')) for (const heads of this.clauses(head, scope)) for (const body of this.kinds(kind, scope)) out.push({ t: 'iff', l: heads, r: body });
    out.push(...this.quantifier(words, scope));
    // "a, and at the next moment, b".
    for (const [a, b] of splits(words, ', and ')) if (b.startsWith(`${MOMENT.after}, `)) for (const as of this.sentence(a, scope)) for (const bs of this.sentence(b, scope)) out.push({ t: 'and', items: [as, bs] });
    out.push(...this.coordination(words, scope));
    return out;
  }

  /** "a, b and c" and "a or b": clauses, each said in full or without the subject it shares with the one before. */
  private coordination(words: string, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    for (const word of ['and', 'or'] as const)
      for (const parts of this.series(words, word).filter(p => p.length > 1)) {
        let all: Sentence[][] = [[]];
        for (const [i, part] of parts.entries()) {
          all = all.flatMap(done => {
            const said: Sentence[] = this.clauses(part, scope).filter(c => this.clauseLike(c));
            // A time phrase covers the rest of its sentence: only the last clause of a series can begin with one.
            const timed = i === parts.length - 1 && i > 0 && part.startsWith(`${MOMENT.after}, `);
            if (timed) said.push(...this.clauses(part.slice(`${MOMENT.after}, `.length), scope).map(c => ({ t: 'moment', op: 'after', body: c }) as Sentence));
            // Without its subject: the subject of the clause before it.
            const before = done[i - 1];
            const subject = before === undefined ? undefined : this.subjectWords(parts[i - 1] as string, scope);
            if (subject !== undefined) said.push(...this.clauses(`${subject} ${part}`, scope, true));
            return said.map(s => [...done, s]);
          });
        }
        for (const items of all) {
          // "the cleanup is on owner_1 and is on no other owner": the other is what the clause before says in that place.
          // "unit_1 names a unit and names another unit": the pair of two things of one kind that differ.
          if (word === 'and' && items.length === 2) {
            const [first, second] = items as [Sentence, Sentence];
            if (first.t === 'reading' && second.t === 'reading') {
              const k = second.args.findIndex(arg => isAnother(arg) && arg.det === 'a');
              const one = first.args[k];
              if (k !== -1 && one?.t === 'np' && one.det === 'a' && one.v.type === (second.args[k] as NounPhrase).v.type) {
                const another = { ...(second.args[k] as NounPhrase), other: { t: 'var', v: one.v } as Term };
                out.push({ t: 'pair', a: one.v, b: another.v, first, second: { ...second, args: second.args.map((arg, i) => (i === k ? another : arg)) } });
                continue;
              }
            }
          }
          const fixed = items.map((item, i) => {
            if (item.t !== 'reading' || i === 0) return item;
            const before = items[i - 1] as Sentence;
            if (before.t !== 'reading' || before.key !== item.key) return item;
            // "no other" differs from what the clause before says in its place, where that is a thing and not a phrase.
            const args = item.args.map((arg, k) => (isAnother(arg) && arg.other === undefined && (before.args[k] as Term).t !== 'np' ? { ...arg, other: before.args[k] as Term } : arg));
            return { ...item, args };
          });
          out.push({ t: word, items: fixed });
        }
      }
    return out;
  }

  private clauseLike(s: Sentence): boolean {
    return s.t === 'reading' || s.t === 'same' || s.t === 'isA' || s.t === 'next';
  }

  /** The words of the subject a clause begins with: what fills the first slot of its reading, where its words begin with that slot. */
  private subjectWords(words: string, scope: Scope): string | undefined {
    for (const template of this.templates) {
      const m = template.pattern.exec(words);
      if (m === null || !template.pattern.source.startsWith('^(.+?)')) continue;
      if (this.terms(m[1] as string, scope).length > 0) return m[1] as string;
    }
    return /^(.+?) (?:is|are) /.exec(words)?.[1];
  }

  /** "there is a unit_1 such that …", "there is no combination of …", "there is a unit that …", "no unit …", "for some …". */
  private quantifier(words: string, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    const heads: [RegExp, 'some' | 'no' | 'one' | 'lone'][] = [
      [/^there (?:is an?|are) (.+?) such that (.+)$/, 'some'],
      [/^there is no (?:combination of )?(.+?) such that (.+)$/, 'no'],
      [/^there is exactly one (?:combination of )?(.+?) such that (.+)$/, 'one'],
      [/^there is at most one (?:combination of )?(.+?) such that (.+)$/, 'lone']
    ];
    for (const [pattern, q] of heads) {
      const m = pattern.exec(words);
      if (m === null) continue;
      const vars = this.introduced((m[1] as string).split(' and '));
      if (vars === undefined) continue;
      const inner = new Map([...scope, ...vars.map(({ name, v }): [string, Term] => [name, { t: 'var', v }])]);
      for (const body of this.sentence(m[2] as string, inner)) out.push({ t: 'quant', q, vars: vars.map(x => x.v), body });
    }
    // "there is an owner", "there is no owner": the noun alone.
    const bare = /^there is (an?|no|exactly one|at most one) (.+)$/.exec(words);
    if (bare !== null) {
      const type = this.types.get(bare[2] as string);
      const q = { a: 'some', an: 'some', no: 'no', 'exactly one': 'one', 'at most one': 'lone' }[bare[1] as string] as 'some';
      if (type !== undefined) out.push({ t: 'quant', q, vars: [this.fresh(type)], body: { t: 'and', items: [] } });
    }
    // "there is a unit that is a spec", "there is no unit that …", "no unit is a spec".
    const subject = /^there is (an?|no) (.+?) that (.+)$/.exec(words) ?? /^(no) (.+?) (.+)$/.exec(words);
    if (subject !== null) {
      const type = this.types.get(subject[2] as string);
      if (type !== undefined) {
        const v = this.fresh(type);
        const q = subject[1] === 'no' ? 'no' : 'some';
        const rest = subject[3] as string;
        for (const body of this.relative(rest, v, scope)) out.push({ t: 'quant', q, vars: [v], body });
      }
    }
    return out;
  }

  /**
   * "A bug" in the first of `first`, the words of the first side of a rule or the opening of a definition, where the
   * words say "the bug" after it: each reading of it as every bug, with that "a bug" said "the bug", and the bug in
   * scope by its noun. `opening` asks for "a bug" at the start of the words, as the subject of a definition.
   */
  private every(first: Doc[], after: Doc[], scope: Scope, opening = false): { docs: Doc[]; inner: Scope; v: Var }[] {
    const out: { docs: Doc[]; inner: Scope; v: Var }[] = [];
    for (const [noun, type] of this.types) {
      const key = noun.replace(/ /g, '_');
      if (scope.has(key)) continue;
      const a = new RegExp(`${opening ? '^' : '(?<=^|[ (])'}an? ${escape(noun)}(?=$|[ ,])`);
      const the = new RegExp(`(?<=^|[ (])the ${escape(noun)}(?=$|[ ,.])`, 'g');
      const replaced = replaceFirst(first, a, `the ${noun}`);
      if (replaced === undefined) continue;
      const said = (docs: Doc[]): number => docs.flatMap(texts).reduce((n, text) => n + (text.match(the)?.length ?? 0), 0);
      // The "the bug" the replacement made is one; the words must say it again.
      if (said(replaced) + said(after) < 2) continue;
      const v = this.fresh(type);
      out.push({ docs: replaced, inner: new Map([...scope, [key, { t: 'var', v } as Term]]), v });
    }
    return out;
  }

  /** The variables a quantifier introduces, by the names the words give them. */
  private introduced(names: string[]): { name: string; v: Var }[] | undefined {
    const out = names.map(name => this.named(name.replace(/^(?:every|some) /, '').trim()));
    return out.some(x => x === undefined) ? undefined : (out as { name: string; v: Var }[]);
  }

  /** The words of a rule on one line, "when a bug …, … the bug", read for every bug, and so for each such noun of its first side. */
  private everyLine(when: string, then: string, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    for (const every of this.every([when], [then], scope)) {
      const inner = every.docs[0] as string;
      const bodies: Sentence[] = [];
      for (const w of this.sentence(inner, every.inner)) for (const t of this.sentence(then, every.inner)) bodies.push({ t: 'rule', when: w, then: t });
      bodies.push(...this.everyLine(inner, then, every.inner));
      for (const body of bodies) out.push({ t: 'quant', q: 'all', vars: [every.v], body });
    }
    return out;
  }

  /**
   * A rule "when …, …" with "a cleanup" in its first side, where "the cleanup" follows, read for every cleanup. What
   * is left may say "an owner" the same way, read for every owner inside: "when a run asks for a command, …".
   */
  private everyRule(doc: Extract<Doc, { kind: 'rule' }>, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    for (const every of this.every([doc.when], [doc.then], scope)) {
      const inner = { ...doc, when: every.docs[0] as Doc };
      const bodies: Sentence[] = [];
      for (const when of this.doc(inner.when, every.inner)) for (const then of this.doc(inner.then, every.inner)) bodies.push({ t: 'rule', when, then });
      bodies.push(...this.everyRule(inner, every.inner));
      for (const body of bodies) out.push({ t: 'quant', q: 'all', vars: [every.v], body });
    }
    return out;
  }

  /**
   * "pulse has disposed p when all of these hold:": a rule said with its second side first, and "a cleanup" in that
   * side, where "the cleanup" follows, read for every cleanup; and so on for each such noun the claim says.
   */
  private claimRule(claim: string, rest: string, doc: Extract<Doc, { kind: 'list' }>, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    for (const when of this.intro(rest, doc, scope)) for (const then of this.sentence(claim, scope)) out.push({ t: 'rule', when, then });
    for (const every of this.every([claim], [{ ...doc, intro: rest }], scope))
      for (const body of this.claimRule(every.docs[0] as string, rest, doc, every.inner)) out.push({ t: 'quant', q: 'all', vars: [every.v], body });
    return out;
  }

  // ---- the layout ----

  private doc(doc: Doc, scope: Scope): Sentence[] {
    if (typeof doc === 'string') return this.sentence(doc, scope);
    if (doc.kind === 'rule') {
      const out: Sentence[] = [];
      if (doc.lead === RULE.when && doc.otherwise === undefined) out.push(...this.everyRule(doc, scope));
      for (const when of this.doc(doc.when, scope))
        for (const then of this.doc(doc.then, scope)) {
          const rules: Sentence[] = doc.otherwise === undefined ? [{ t: 'rule', when, then }] : this.doc(doc.otherwise, scope).map(o => ({ t: 'rule', when, then, otherwise: o }) as Sentence);
          for (const rule of rules) out.push(doc.lead === RULE.when ? rule : { t: 'moment', op: 'always', body: rule });
        }
      return out;
    }
    return this.intro(doc.intro, doc, scope);
  }

  /** The intro of a list or a block, with what it opens. */
  private intro(intro: string, doc: Exclude<Doc, string | { kind: 'rule' }>, scope: Scope): Sentence[] {
    const out: Sentence[] = [];
    // "pulse has disposed p when all of these hold:": a rule said with its second side first, and "a cleanup" in that
    // side, where "the cleanup" follows, for every cleanup.
    if (doc.kind === 'list')
      for (const [claim, rest] of splits(intro, ` ${RULE.when} `)) out.push(...this.claimRule(claim, rest, doc, scope));
    // "a unit is unfounded exactly when at least one of these holds:", for every unit.
    if (intro.includes(' exactly when '))
      for (const every of this.every([intro], [doc.kind === 'list' ? { ...doc, intro: '' } : doc.body], scope, true))
        for (const body of this.intro(every.docs[0] as string, doc, every.inner)) if (body.t === 'iff') out.push({ t: 'quant', q: 'all', vars: [every.v], body });
    const items = (inner: Scope): Sentence[][] => {
      if (doc.kind !== 'list') return this.doc(doc.body, inner).map(s => [s]);
      let all: Sentence[][] = [[]];
      for (const item of doc.items) all = all.flatMap(done => this.doc(item, inner).map(s => [...done, s]));
      return all;
    };
    const one = (inner: Scope): Sentence[] => items(inner).flatMap(list => (list.length === 1 ? [list[0] as Sentence] : []));
    if (doc.kind === 'list') {
      const lists: [string, (xs: Sentence[]) => Sentence | undefined][] = [
        [INTRO.all, xs => ({ t: 'and', items: xs })],
        [INTRO.any, xs => ({ t: 'or', items: xs })],
        [INTRO.both, xs => (xs.length === 2 ? { t: 'iff', l: xs[0] as Sentence, r: xs[1] as Sentence } : undefined)],
        [INTRO.exactlyOne, xs => (xs.length === 2 ? { t: 'not', body: { t: 'iff', l: xs[0] as Sentence, r: xs[1] as Sentence } } : undefined)]
      ];
      // "definition_1 is a definition with none of these:": each item, after the shared words, is a clause the subject is not.
      if (intro.endsWith(` ${INTRO.noneOf}`)) {
        const head = intro.slice(0, -INTRO.noneOf.length - 1);
        let all: Sentence[][] = [[]];
        for (const item of doc.items) {
          const said = typeof item === 'string' ? this.clauses(`${head} ${item}`, scope).flatMap(c => (c.t === 'reading' && !c.negative ? [{ ...c, negative: true }] : [])) : [];
          all = all.flatMap(done => said.map(c => [...done, c]));
        }
        for (const xs of all) if (xs.length > 1) out.push({ t: 'and', items: xs });
      }
      for (const [words, make] of lists) if (intro === words) for (const xs of items(scope)) {
        const made = make(xs);
        if (made !== undefined) out.push(made);
      }
      // `until` and `since` with their sides set apart, each below the words that place it in time.
      const [first, second] = doc.items;
      for (const op of ['until', 'since'] as const) {
        const { first: b, second: a } = BINARY[op];
        if (intro === INTRO.all && doc.items.length === 2 && typeof first === 'object' && first.kind === 'block' && first.intro === b && typeof second === 'object' && second.kind === 'block' && second.intro === a)
          for (const bs of this.doc(first.body, scope)) for (const as of this.doc(second.body, scope)) out.push({ t: op, a: as, b: bs });
      }
    }
    if (doc.kind === 'block') {
      if (intro === INTRO.apart || intro === INTRO.untrue) for (const body of one(scope)) out.push(intro === INTRO.apart ? body : { t: 'not', body });
      for (const [op, phrase] of MOMENTS) if (intro === phrase) for (const body of one(scope)) out.push({ t: 'moment', op, body });
    }
    // A definition: what it names "exactly when" a list, a block, or the kinds the subject is one of.
    for (const [head, rest] of splits(intro, ' exactly when ')) {
      const heads = this.clauses(head, scope);
      if (heads.length === 0) continue;
      const of = new RegExp(`^(.+) is ${INTRO.oneOf}$`).exec(rest);
      const bodies: Sentence[] = [];
      if (of !== null && doc.kind === 'list') {
        let all: Sentence[][] = [[]];
        for (const item of doc.items) all = all.flatMap(done => (typeof item === 'string' ? this.kinds(`${of[1] as string} is ${item}`, scope) : []).map(k => [...done, k]));
        for (const xs of all) bodies.push(xs.length === 1 ? (xs[0] as Sentence) : { t: 'or', items: xs });
      } else bodies.push(...this.intro(rest, doc, scope));
      for (const l of heads) for (const r of bodies) out.push({ t: 'iff', l, r });
    }
    // A comparison with the numbers it names below "where:".
    if (doc.kind === 'list' && intro.endsWith(', where')) for (const defs of this.where(doc.items, scope)) out.push(...this.compare(intro.slice(0, -', where'.length), scope, defs));
    // An intro after a time phrase: "from now on, for every cleanup:".
    for (const [op, phrase] of MOMENTS) if (intro.startsWith(`${phrase}, `)) for (const body of this.intro(intro.slice(phrase.length + 2), doc, scope)) out.push({ t: 'moment', op, body });
    if (intro.startsWith(`${INTRO.untrue} `)) for (const body of this.intro(intro.slice(INTRO.untrue.length + 1), doc, scope)) out.push({ t: 'not', body });
    // "for every cleanup_1, every owner_1 and every owner_2:" and "for some …".
    const forAll = /^for (every|some) (.+)$/.exec(intro);
    if (forAll !== null) {
      const names = (forAll[2] as string).split(/, | and /);
      const vars = this.introduced(names);
      if (vars !== undefined) {
        const inner = new Map([...scope, ...vars.map(({ name, v }): [string, Term] => [name, { t: 'var', v }])]);
        for (const body of one(inner)) out.push({ t: 'quant', q: forAll[1] === 'every' ? 'all' : 'some', vars: vars.map(x => x.v), body });
      }
    }
    // "there is a cleanup_1 such that all of these hold:", "there is a unit that:".
    const head = /^(there (?:is an?|are|is no|is no combination of|is exactly one|is at most one|is exactly one combination of|is at most one combination of) .+? such that)(?: (.+))?$/.exec(intro);
    if (head !== null) {
      const words = head[1] as string;
      const q: 'some' | 'no' | 'one' | 'lone' = /is no /.test(words) ? 'no' : /exactly one/.test(words) ? 'one' : /at most one/.test(words) ? 'lone' : 'some';
      const names = words.replace(/^there (?:is an?|are|is no|is exactly one|is at most one) (?:combination of )?/, '').replace(/ such that$/, '');
      const vars = this.introduced(names.split(' and '));
      if (vars !== undefined) {
        const inner = new Map([...scope, ...vars.map(({ name, v }): [string, Term] => [name, { t: 'var', v }])]);
        const bodies = head[2] === undefined ? one(inner) : this.intro(head[2], doc, inner);
        for (const body of bodies) out.push({ t: 'quant', q, vars: vars.map(x => x.v), body });
      }
    }
    const subjectList = /^there is an? (.+) that$/.exec(intro);
    if (subjectList !== null && doc.kind === 'list') {
      const type = this.types.get(subjectList[1] as string);
      if (type !== undefined) {
        const v = this.fresh(type);
        const hole = '\u0003';
        const inner = new Map([...scope, [hole, { t: 'var', v } as Term]]);
        let all: Sentence[][] = [[]];
        for (const item of doc.items) all = all.flatMap(done => (typeof item === 'string' ? this.clauses(`${hole} ${item}`, inner) : []).map(c => [...done, c as Sentence]));
        for (const xs of all) out.push({ t: 'quant', q: 'some', vars: [v], body: { t: 'and', items: xs } });
      }
    }
    return out;
  }
}

/** Each line of words a doc holds, in the order a reader meets them. */
function texts(doc: Doc): string[] {
  if (typeof doc === 'string') return [doc];
  if (doc.kind === 'list') return [doc.intro, ...doc.items.flatMap(texts)];
  if (doc.kind === 'block') return [doc.intro, ...texts(doc.body)];
  return [...texts(doc.when), ...texts(doc.then), ...(doc.otherwise === undefined ? [] : texts(doc.otherwise))];
}

/** The docs with the first words that match `pattern`, in the order a reader meets them, said as `to`; undefined where none match. */
function replaceFirst(docs: Doc[], pattern: RegExp, to: string): Doc[] | undefined {
  // The parts with the first that `one` changes changed; undefined where it changes none.
  const parts = (ds: Doc[]): Doc[] | undefined => {
    for (const [i, d] of ds.entries()) {
      const done = one(d);
      if (done !== undefined) return ds.map((x, k) => (k === i ? done : x));
    }
    return undefined;
  };
  const one = (doc: Doc): Doc | undefined => {
    if (typeof doc === 'string') return pattern.test(doc) ? doc.replace(pattern, to) : undefined;
    if (doc.kind === 'list') {
      const done = parts([doc.intro, ...doc.items]);
      return done === undefined ? undefined : { ...doc, intro: done[0] as string, items: done.slice(1) };
    }
    if (doc.kind === 'block') {
      const done = parts([doc.intro, doc.body]);
      return done === undefined ? undefined : { ...doc, intro: done[0] as string, body: done[1] as Doc };
    }
    const done = parts(doc.otherwise === undefined ? [doc.when, doc.then] : [doc.when, doc.then, doc.otherwise]);
    return done === undefined ? undefined : { ...doc, when: done[0] as Doc, then: done[1] as Doc, ...(doc.otherwise === undefined ? {} : { otherwise: done[2] as Doc }) };
  };
  return parts(docs);
}

/** The IR with nested lists of one kind made one, as the printer says them. */
function flat(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(flat);
  if (node === null || typeof node !== 'object') return node;
  const o = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, flat(v)])) as Record<string, unknown>;
  // "for every run: for every command: …" says what "for every run and every command: …" says, in whichever order the
  // words named them: one "for every", its variables in an order of their types alone.
  if (o.t === 'quant' && o.q === 'all' && Array.isArray(o.vars)) {
    const body = o.body as Record<string, unknown>;
    if (body.t === 'quant' && body.q === 'all' && Array.isArray(body.vars)) {
      o.vars = [...(o.vars as unknown[]), ...(body.vars as unknown[])];
      o.body = body.body;
    }
    const type = (v: unknown): string => JSON.stringify((v as Record<string, unknown>).type);
    o.vars = [...(o.vars as unknown[])].sort((a, b) => (type(a) < type(b) ? -1 : type(a) > type(b) ? 1 : 0));
  }
  if ((o.t === 'and' || o.t === 'or') && Array.isArray(o.items)) o.items = (o.items as Record<string, unknown>[]).flatMap(i => (i.t === o.t ? (i.items as unknown[]) : [i]));
  // "a spec that cites no axiom or cites no fact" says a kind and options of it, which the IR may hold as one alternative
  // of the kind with an "or" inside, or as an alternative for each option: the same, made one shape.
  if (o.t === 'or' && Array.isArray(o.items))
    o.items = (o.items as Record<string, unknown>[]).flatMap(i => {
      const items = i.items as Record<string, unknown>[] | undefined;
      const last = items?.at(-1);
      return i.t === 'and' && items !== undefined && items.length === 2 && last?.t === 'or' ? (last.items as unknown[]).map(x => ({ t: 'and', items: [items[0], x] })) : [i];
    });
  return o;
}

/** A meaning with its variables named in the order they appear, and no brackets around a single membership. */
export function canonical(meaning: string): string {
  const seen = new Map<string, string>();
  return meaning.replace(/\((v_\w+(?:->v_\w+)? (?:in|not in) [^()]+?)\)/g, '$1').replace(/\bv_\w+/g, v => {
    if (!seen.has(v)) seen.set(v, `x${seen.size}`);
    return seen.get(v) as string;
  });
}

/** What the words of a statement mean, read back by the reading rules: one canonical meaning for each reading. */
export function readBack(words: string, readings: Readings, free: Iterable<string> = [], meaning: (s: Sentence) => string): string[] {
  // The short names, `U1`, are read as the long ones the printer gave first, `unit_1`.
  const nouns = [...readings.nouns.values()].map(noun => unbracketed(noun).replace(/^an? /, '').trim());
  return [...new Set(new Parser(readings, free).statement(longNames(words, nouns)).map(s => canonical(meaning(flat(s) as Sentence))))];
}

/** The canonical meaning of an IR, as `readBack` gives it. */
export function meant(s: Sentence, meaning: (s: Sentence) => string): string {
  return canonical(meaning(flat(s) as Sentence));
}

/**
 * What the words of a formula or a definition mean, read back, against what the IR the verbalizer said means: each a
 * canonical meaning, so that they can be compared as text.
 */
export interface ReadBack {
  words: string;
  meanings: string[];
  meant: string;
}
