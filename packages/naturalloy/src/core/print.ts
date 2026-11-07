/**
 * The printer: the sentence IR as words. Each construct has one way it is said, and a hint a pass left on a node picks
 * between the ways that construct allows. With no hints, every construct is laid out in full: each list as bullets,
 * each rule on lines of its own, each time phrase above what it covers. That is the literal reading, `-O0`.
 *
 * The printer names the variables: each by the noun of its type and the next number free for that noun, in the order
 * a reader meets them. The items of a list that stand on their own may each use the same names.
 */
import { shortNames } from './names.ts';
import { type Readings, LINK, mark, markTerms, Refusal, resolveLinks, unbracketed, type Marked } from '../readings.ts';
import type { Clause, Num, Sentence, Term, Var } from './ir.ts';
import type { PrintOptions } from './pass.ts';

import { BINARY, COMPARED, INTRO, MOMENT, RULE, WRAP } from './constructs.ts';
import { type Doc, type Every, isList, lines, markdownLines } from './layout.ts';
import { articleFor, Vocabulary } from './vocabulary.ts';
import { freeNames, holdsPhrase } from './walk.ts';
import { coordinate, fixed, holdsComma, holdsOwnComma, holdsTime, marked, own, series, shareSubject, timed, unmarked, VARIABLE } from './words.ts';

export type { Doc };

export class Printer {
  /** The names taken so far in the whole rendering. */
  private readonly used = new Set<string>();
  /** The name each variable was given where it was introduced. */
  private readonly names = new Map<string, string>();
  /** The words of the first side of each rule said so far. */
  private readonly whens = new Map<Sentence, Doc>();

  private readonly readings: Readings;
  /** Whether a variable said before it is introduced is named where it is said: for measuring a part on its own. */
  private readonly lenient: boolean;

  constructor(readings: Readings, lenient = false) {
    this.readings = readings;
    this.lenient = lenient;
  }

  // ---- names ----

  private nounOf(type: string): string {
    const written = this.readings.nouns.get(type);
    if (written === undefined) throw new Refusal(`no noun for "${type}"`);
    return written;
  }

  private article(type: string): string {
    const written = this.readings.articles.get(type);
    return written === undefined ? articleFor(unbracketed(this.nounOf(type)).trim()) : marked(`${written} `, false);
  }

  /** The noun of a type, with its words in brackets marked as links. */
  private noun(type: string): string {
    return marked(mark(this.nounOf(type), this.readings.nounTargets.get(type)), false);
  }

  /** A new name for a variable where it is introduced, linked to the term of its type: unit_1, then unit_2. */
  private introduce(v: Var): string {
    const base = unbracketed(this.nounOf(v.type)).trim().replace(/\s+/g, '_');
    let n = 1;
    while (this.used.has(`${base}_${n}`)) n++;
    const name = `${base}_${n}`;
    this.used.add(name);
    this.names.set(v.id, name);
    const target = this.readings.nounTargets.get(v.type);
    return target === undefined ? name : `${LINK}${target}${LINK}${name}${LINK}`;
  }

  private nameOf(v: Var): string {
    const name = this.names.get(v.id) ?? (this.lenient ? (this.introduce(v), this.names.get(v.id)) : undefined);
    if (name === undefined) throw new Error(`naturalloy printed the variable ${v.id} before it introduced it`);
    return name;
  }

  /** Items that each stand on their own, said with the names free before them, and with every name any of them took kept taken after. */
  private independent<T>(items: T[], say: (item: T) => Doc): Doc[] {
    const before = [...this.used];
    const introduced = new Set<string>();
    const docs = items.map(item => {
      this.used.clear();
      for (const name of before) this.used.add(name);
      const doc = say(item);
      for (const name of this.used) introduced.add(name);
      return doc;
    });
    this.used.clear();
    for (const name of [...before, ...introduced]) this.used.add(name);
    return docs;
  }

  /**
   * The items of an "all of these hold". A "for every" among them is a statement of its own, which may use the names
   * the others use; the rest are joint conditions, whose variables must not read as one.
   */
  private together(items: Sentence[]): Doc[] {
    const before = [...this.used];
    const all = new Set(before);
    let joint = new Set(before);
    const docs = items.map(item => {
      const own = item.t === 'quant' && item.q === 'all';
      this.used.clear();
      for (const name of own ? before : joint) this.used.add(name);
      const doc = this.sentence(item);
      for (const name of this.used) all.add(name);
      if (!own) joint = new Set(this.used);
      return doc;
    });
    this.used.clear();
    for (const name of all) this.used.add(name);
    return docs;
  }

  // ---- clauses ----

  private term(x: Term): string {
    switch (x.t) {
      case 'var':
        return `${VARIABLE}${this.nameOf(x.v)}${VARIABLE}`;
      case 'free':
        return `${VARIABLE}${x.name}${VARIABLE}`;
      case 'string':
        return `${VARIABLE}${JSON.stringify(x.value)}${VARIABLE}`;
      case 'np':
        return this.phrase(x);
    }
  }

  /** A noun phrase: "no owner", "an issue that tracker does not know", "another unit", "a text other than "a"". */
  private phrase(np: Extract<Term, { t: 'np' }>): string {
    const noun = this.noun(np.v.type);
    const hole = `${VARIABLE}\u0003${VARIABLE}`;
    let suffix = '';
    if (np.relative !== undefined) {
      // The conditions are said with a hole in the place of the variable, which the relative clause then leaves out.
      const before = this.names.get(np.v.id);
      this.names.set(np.v.id, '\u0003');
      const parts = (np.relative.t === 'and' ? np.relative.items : [np.relative]).map(part => this.sentence(part) as string);
      if (before === undefined) this.names.delete(np.v.id);
      else this.names.set(np.v.id, before);
      if (parts.every(part => part.startsWith(hole))) {
        const rests = parts.map(part => part.slice(hole.length).trim());
        const negations = rests.every(rest => rest.startsWith('is not '));
        suffix = own` that ${negations ? 'is not ' : ''}${coordinate(negations ? rests.map(rest => rest.slice('is not '.length)) : rests, negations ? 'or' : 'and')}`;
      } else suffix = own` that ${(parts[0] as string).slice(0, -hole.length).trim()}`;
    }
    if (np.det === 'no') return own`no ${np.other === undefined ? '' : 'other '}${noun}${suffix}`;
    if (np.other === undefined) return `${this.article(np.v.type)}${noun}${suffix}`;
    if (np.other.t === 'var' && np.other.v.type === np.v.type) return own`another ${noun}${suffix}`;
    return own`${this.article(np.v.type)}${noun} other than ${this.term(np.other)}${suffix}`;
  }

  /** A reading with a term in each slot. */
  private say(key: string, slots: string[], negative: boolean): string {
    const reading = this.readings.atoms.get(key);
    if (!reading) throw new Refusal(`no reading for "${key}"`);
    const words = negative ? reading.negative : reading.positive;
    if (words === undefined) throw new Refusal(`no negative reading for "${key}"`);
    return this.filled(words, reading.target, slots);
  }

  /** Words of a reading, or a part of them, with their links marked and a term in each slot. */
  private filled(words: string, target: string | undefined, slots: string[]): string {
    return marked(mark(words, target), false).replace(/\{(\d+)\}/g, (_, n: string) => slots[Number(n) - 1] as string);
  }

  /** Negative clauses that share their words, said once before "none of these", with each clause's noun phrase below it. */
  private noneOf(items: Sentence[]): Doc {
    const clauses = items as Extract<Clause, { t: 'reading' }>[];
    const shared = new Vocabulary(this.readings).shared(clauses.map(c => c.key));
    if (shared === undefined) throw new Error('naturalloy said "none of these" over clauses that share no words');
    const said = clauses.map(c => ({ target: this.readings.atoms.get(c.key)?.target, slots: c.args.map(a => this.term(a)) }));
    const first = said[0] as { target: string | undefined; slots: string[] };
    return {
      kind: 'list',
      intro: `${this.filled(shared.head, first.target, first.slots)} ${fixed(INTRO.noneOf)}`,
      items: shared.rests.map((rest, i) => this.filled(rest, said[i]?.target, said[i]?.slots ?? []))
    };
  }

  private clause(c: Clause): Doc {
    switch (c.t) {
      case 'reading':
        return this.say(c.key, c.args.map(a => this.term(a)), c.negative);
      case 'same':
        return own`${this.term(c.l)} and ${this.term(c.r)} are ${c.negative ? 'different' : 'the same'}`;
      case 'isA':
        return `${this.term(c.x)} is ${c.negative ? 'not ' : ''}${this.article(c.type)}${this.noun(c.type)}`;
      case 'reach': {
        const [from, to] = [this.term(c.from), this.term(c.to)];
        const [p, q] = [this.introduce(c.p), this.introduce(c.q)];
        const step = this.sentence(c.step);
        if (typeof step !== 'string') throw new Refusal('a step of a closure is more than one clause');
        return own`${from} ${c.negative ? 'does not reach' : 'reaches'} ${to} in ${c.reflexive ? 'zero' : 'one'} or more steps, where a step from ${p} to ${q} is that ${step}`;
      }
      case 'next':
        return `${this.term(c.y)} is ${c.negative ? 'not ' : ''}the integer after ${this.term(c.x)} without wrapping around`;
      case 'compare': {
        const defs: Doc[] = [];
        const [a, b] = [this.number(c.l, defs).words, this.number(c.r, defs).words];
        const main = own`${fixed(WRAP)}${a} ${fixed(COMPARED[c.op])} ${b}`;
        if (defs.length === 0) return main;
        if (defs.length === 1 && typeof defs[0] === 'string') return own`${main}, where ${defs[0]}`;
        return { kind: 'list', intro: own`${main}, where`, items: defs };
      }
    }
  }

  /** A new name for a number the words define after "where": number_1, number_2. */
  private numberName(): string {
    let n = 1;
    while (this.used.has(`number_${n}`)) n++;
    this.used.add(`number_${n}`);
    return `number_${n}`;
  }

  /**
   * The words of a number. A count, a sum or a division is named, and its words go to `defs`, said after "where".
   * Inside a sum, `defs` is undefined: a part there names the variable of the sum, so it is said in place.
   */
  private number(n: Num, defs: Doc[] | undefined): { words: string; open: boolean } {
    const named = (words: string, open: boolean, body?: Doc): { words: string; open: boolean } => {
      if (defs === undefined) {
        if (body !== undefined) throw new Refusal('what a count or a sum takes in is more than a sentence');
        return { words, open };
      }
      const name = this.numberName();
      defs.push(body === undefined ? own`${name} is ${words}` : { kind: 'block', intro: own`${name} is ${words}`, body });
      return { words: name, open: false };
    };
    const closed = (part: { words: string; open: boolean }): string => {
      if (part.open) throw new Refusal('a count or a sum stands before other words, which would read two ways');
      return part.words;
    };

    switch (n.t) {
      case 'literal':
        return { words: String(n.value), open: false };
      case 'least':
        return { words: 'the least integer', open: false };
      case 'greatest':
        return { words: 'the greatest integer', open: false };
      case 'term':
        return { words: this.term(n.x), open: false };
      case 'count': {
        const shown = n.vars.map(v => this.introduce(v));
        const of = shown.length === 1 ? own`the number of values of ${shown[0] as string}` : own`the number of combinations of ${shown.join(own` and `)}`;
        const cond = this.sentence(n.cond);
        return typeof cond === 'string' ? named(own`${of} such that ${cond}`, true) : named(own`${of} such that`, true, cond);
      }
      case 'sumOf': {
        const shown = this.introduce(n.v);
        const cond = this.sentence(n.cond);
        return typeof cond === 'string' ? named(own`the sum of the values of ${shown} such that ${cond}`, true) : named(own`the sum of the values of ${shown} such that`, true, cond);
      }
      case 'sumOver': {
        const shown = n.vars.map(v => this.introduce(v));
        const body = this.number(n.body, undefined);
        return named(own`the sum, over every ${shown.join(own` and every `)}, of ${body.words}`, true);
      }
      case 'arith': {
        const x = closed(this.number(n.l, defs));
        const y = this.number(n.r, defs);
        if (n.op === 'plus' || n.op === 'minus' || n.op === 'times') return { words: own`${x} ${n.op} ${y.words}`, open: y.open };
        const z = closed(y);
        if (n.op === 'div') return named(own`${x} divided by ${z}, rounded toward zero; when ${z} is 0, it is -1, 0 or 1 as ${x} is positive, zero or negative`, false);
        return named(own`the remainder of ${x} divided by ${z}, with the sign of ${x}; when ${z} is 0, it is ${x}`, false);
      }
    }
  }

  // ---- sentences ----

  /** A part set apart below the words that place it. */
  private apart(intro: string, body: Doc): Doc {
    return { kind: 'block', intro, body };
  }

  /** The items of a list with the given intro, or the doc itself: a list inside a list of the same kind says nothing more. */
  private spliced(doc: Doc, intro: string): Doc[] {
    return isList(doc) && doc.intro === intro ? doc.items : [doc];
  }

  /** The words for a whole statement: the names of its free variables are taken before any other is given. */
  statement(s: Sentence): Doc {
    for (const name of freeNames(s)) this.used.add(name);
    return this.sentence(s);
  }

  sentence(s: Sentence): Doc {
    switch (s.t) {
      case 'reading':
      case 'same':
      case 'isA':
      case 'reach':
      case 'next':
      case 'compare':
        return this.clause(s);
      case 'and':
      case 'or': {
        if (s.t === 'and' && s.form === 'none-of') return this.noneOf(s.items);
        const docs = s.t === 'and' ? this.together(s.items) : this.independent(s.items, i => this.sentence(i));
        // A sequence of two plain clauses: "a, and at the next moment, b".
        if (s.form === 'sequence-sentence') return own`${docs[0] as string}, and ${docs[1] as string}`;
        if (s.form === 'sentence') return coordinate(shareSubject(docs as string[]), s.t);
        const intro = fixed(s.t === 'and' ? INTRO.all : INTRO.any);
        return { kind: 'list', intro, items: docs.flatMap(d => this.spliced(d, intro)) };
      }
      case 'not': {
        if (s.form === 'exactly-one' && s.body.t === 'iff') return { kind: 'list', intro: fixed(INTRO.exactlyOne), items: [this.sentence(s.body.l), this.sentence(s.body.r)] };
        const body = this.sentence(s.body);
        // One plain clause, or "there is exactly one owner", shows where the negation ends: it is said on the line.
        const simple = (x: Sentence): boolean =>
          ((x.t === 'reading' || x.t === 'same' || x.t === 'isA' || x.t === 'next') && !holdsPhrase(x)) ||
          (x.t === 'quant' && x.body.t === 'and' && x.body.items.length === 0);
        if (typeof body === 'string' && simple(s.body)) return own`${fixed(INTRO.untrue)} ${body}`;
        if (s.form === 'untrue' && isList(body)) return { ...body, intro: own`${fixed(INTRO.untrue)} ${body.intro}` };
        return this.apart(fixed(INTRO.untrue), body);
      }
      case 'rule':
        return this.rule(s);
      case 'iff': {
        if (s.form === 'next-and-now') {
          // Each side's time phrase at its own end: "a at the next moment exactly when b now".
          // Whether two values are the same does not change from one moment to the next: that side needs no "now".
          const at = (x: Sentence): string => (x.t === 'moment' ? own`${this.sentence(x.body) as string} at the next moment` : x.t === 'same' ? (this.sentence(x) as string) : own`${this.sentence(x) as string} now`);
          return own`${at(s.l)} exactly when ${at(s.r)}`;
        }
        const [l, r] = [this.sentence(s.l), this.sentence(s.r)];
        return s.form === 'exactly-when' ? own`${l as string} exactly when ${r as string}` : { kind: 'list', intro: fixed(INTRO.both), items: [l, r] };
      }
      case 'quant':
        return this.quantified(s);
      case 'moment': {
        // "from now on, whenever a, b": the rule's own "when" takes the time phrase.
        if (s.form === 'whenever' && s.body.t === 'rule') {
          const rule = this.rule(s.body);
          if (typeof rule === 'string') return own`${fixed(RULE.whenever)} ${rule.slice(`${RULE.when} `.length)}`;
          if (rule.kind === 'rule') return { ...rule, lead: RULE.whenever };
        }
        const body = this.sentence(s.body);
        if (s.form !== 'front') return this.apart(fixed(MOMENT[s.op]), body);
        // In front of the words it covers: "at the next moment, c has run", or of the line that opens them.
        if (typeof body === 'string') return own`${fixed(MOMENT[s.op])}, ${body}`;
        if (body.kind === 'rule') throw new Error('naturalloy put a time phrase in front of a rule');
        return { ...body, intro: own`${fixed(MOMENT[s.op])}, ${body.intro}` };
      }
      case 'until':
      case 'since': {
        const words = BINARY[s.t];
        if (s.form === 'sentence') return `${this.sentence(s.b) as string}${fixed(words.joint)}${this.sentence(s.a) as string}`;
        return { kind: 'list', intro: fixed(INTRO.all), items: [this.apart(fixed(words.first), this.sentence(s.b)), this.apart(fixed(words.second), this.sentence(s.a))] };
      }
      case 'pair':
        return shareSubject([this.sentence(s.first) as string, this.sentence(s.second) as string]).join(own` and `);
      case 'define':
        return this.defined(s);
    }
  }

  /**
   * A rule: "when" its first side, its second side, "otherwise" a third. A side whose end the words cannot mark is set
   * apart below "the following holds": a side that is a rule, a first side that holds a time phrase, a second side that
   * holds a comma of its own where no "then" shows where it starts, a side that is a series after a comma, and a second
   * side that holds a time phrase an "otherwise" follows. A first side that is a series with a comma is its items.
   */
  private rule(s: Extract<Sentence, { t: 'rule' }>): Doc {
    const apart = (doc: Doc): Doc => this.apart(fixed(INTRO.apart), doc);
    const side = (x: Sentence): Doc => {
      const doc = this.sentence(x);
      return x.t === 'rule' || (typeof doc !== 'string' && doc.kind === 'rule') ? apart(doc) : doc;
    };
    let when = side(s.when);
    let then = side(s.then);
    // Second side first: "pulse has disposed p when all of these hold:", then the bullets of the first side.
    if (s.form === 'claim-first' && (s.when.t === 'and' || s.when.t === 'or') && s.when.form === 'sentence') when = this.sentence({ ...s.when, form: 'list' });
    if (s.form === 'claim-first' && isList(when) && typeof then === 'string') {
      this.whens.set(s, when);
      return { ...when, intro: own`${then} ${RULE.when} ${when.intro}` };
    }
    const third = s.otherwise === undefined ? undefined : side(s.otherwise);
    this.whens.set(s, when);
    // On one line: "when a, b", with "then" before a second side that begins with a time phrase.
    if (s.form === 'line') return own`${RULE.when} ${when as string}, ${timed(then as string) ? `${RULE.then} ` : ''}${then as string}${third === undefined ? '' : own`; ${RULE.otherwise}, ${third as string}`}`;
    // A time phrase in the first side would reach over the second.
    if (typeof when === 'string' && holdsTime(when)) when = apart(when);
    // A comma in either side with no "then" between them would read as where the second side starts.
    if (typeof when === 'string' && typeof then === 'string' && (third === undefined || typeof third === 'string') && !timed(then)) {
      if (holdsOwnComma(then)) then = apart(then);
      else if (holdsComma(when)) when = (s.when.t === 'and' || s.when.t === 'or') && s.when.form === 'sentence' ? this.sentence({ ...s.when, form: 'list' }) : apart(when);
    }
    // A time phrase in the second side would reach over the "otherwise".
    if (typeof then === 'string' && third !== undefined && holdsTime(then)) then = apart(then);
    // A series in the second or the last side, "a, and at the next moment, b", could end before its last clause.
    const inSeries = (doc: Doc | undefined): boolean => typeof doc === 'string' && series(doc);
    if (inSeries(then)) then = apart(then);
    const otherwise = inSeries(third) ? apart(third as Doc) : third;
    return otherwise === undefined ? { kind: 'rule', lead: RULE.when, when, then } : { kind: 'rule', lead: RULE.when, when, then, otherwise };
  }

  private quantified(s: Extract<Sentence, { t: 'quant' }>): Doc {
    const shown = s.vars.map(v => this.introduce(v));
    const empty = s.body.t === 'and' && s.body.items.length === 0;
    if (s.q === 'all') {
      if (empty) throw new Refusal('this formula says nothing: it always holds, so it claims nothing');
      const intro = own`for ${coordinate(shown.map(name => `every ${name}`), 'and')}`;
      const body = this.sentence(s.body);
      // A rule with no "otherwise" whose first side names the variable, which the words name again after it.
      if (s.vars.length === 1 && s.body.t === 'rule' && s.body.otherwise === undefined) {
        const when = this.whens.get(s.body);
        const every = this.every(intro, s.vars[0] as Var, shown[0] as string);
        if (when !== undefined && mentions(when, every.name) > 0 && mentions(body, every.name) > 1) return { kind: 'block', intro, body, every };
      }
      return this.apart(intro, body);
    }
    // Some of several things reads as "for some", the way all reads as "for every": the things, then what holds of them.
    if (s.q === 'some' && s.vars.length > 1 && !empty) return this.apart(own`for ${coordinate(shown.map(name => `some ${name}`), 'and')}`, this.sentence(s.body));
    const one = s.vars.length === 1;
    const count = fixed({ some: '', no: 'no ', one: 'exactly one ', lone: 'at most one ' }[s.q]);
    const article = s.q === 'some' ? (one ? this.article((s.vars[0] as Var).type) : '') : count;
    const combination = !one && s.q !== 'some' ? 'combination of ' : '';
    const head = own`there ${s.q === 'some' && !one ? 'are' : 'is'} ${article}${combination}${shown.join(own` and `)}`;
    if (empty) {
      if (!one) throw new Error('naturalloy has no words for several things with no condition');
      // "there is an owner": the noun alone, in place of the name, where nothing more is said of it.
      return own`there is ${s.q === 'some' ? this.article((s.vars[0] as Var).type) : count}${this.noun((s.vars[0] as Var).type)}`;
    }
    // "there is a unit that is a spec", "no unit is a spec", or bullets after "there is a unit that:": the conditions
    // said without their subject, the variable, which the noun names.
    if ((s.form === 'there-is-that' || s.form === 'there-is-that-list') && one) {
      const v = s.vars[0] as Var;
      const noun = this.noun(v.type);
      const hole = `${VARIABLE}\u0003${VARIABLE}`;
      this.names.set(v.id, '\u0003');
      const rests = (s.body.t === 'and' ? s.body.items : [s.body]).map(part => (this.sentence(part) as string).slice(hole.length).trim());
      this.names.delete(v.id);
      if (s.form === 'there-is-that-list') return { kind: 'list', intro: own`there is ${this.article(v.type)}${noun} that`, items: rests };
      if (s.q === 'no' && rests.length === 1) return own`no ${noun} ${rests[0] as string}`;
      return own`there is ${s.q === 'no' ? fixed('no ') : this.article(v.type)}${noun} that ${coordinate(rests, 'and')}`;
    }
    const body = this.sentence(s.body);
    if (typeof body === 'string') return own`${head} such that ${body}`;
    if (isList(body)) return { ...body, intro: own`${head} such that ${body.intro}` };
    return this.apart(own`${head} such that`, body);
  }

  /**
   * A definition by kinds: each alternative's kind as a noun phrase, and what else holds of the parameter as its
   * relative clause. Undefined where the words of an alternative do not fit, and the definition is said as it stands.
   */
  private byKinds(head: string, v: Var, body: Sentence): Doc | undefined {
    const subject = `${VARIABLE}${this.nameOf(v)}${VARIABLE}`;
    const predicate = (c: Sentence): string | undefined => {
      const said = this.sentence(c);
      if (typeof said !== 'string' || !said.startsWith(`${subject} `)) return undefined;
      const rest = said.slice(subject.length + 1);
      return /^(?:and|or)\b/.test(unmarked(rest)) ? undefined : rest;
    };
    const groups = new Map<string, { how: 'and' | 'or'; says: string[] }[]>();
    for (const alternative of body.t === 'or' ? body.items : [body]) {
      if (alternative.t !== 'and') return undefined;
      const [guard, ...rest] = alternative.items as [Sentence, ...Sentence[]];
      const kind = predicate(guard)?.match(/^is (an? .*)$/)?.[1];
      if (kind === undefined) return undefined;
      const options = rest.length === 1 && (rest[0] as Sentence).t === 'or' ? (rest[0] as Extract<Sentence, { t: 'or' }>).items : undefined;
      const says = (options ?? rest).map(predicate);
      if (says.some(x => x === undefined)) return undefined;
      groups.set(kind, [...(groups.get(kind) ?? []), { how: options === undefined ? 'and' : 'or', says: says as string[] }]);
    }
    const cases: string[] = [];
    for (const [kind, alternatives] of groups) {
      // Several alternatives of one kind are "or"; one that is itself a run of "and" would be read two ways beside another.
      if (alternatives.length > 1 && alternatives.some(a => a.how === 'and' && a.says.length > 1)) return undefined;
      const says = alternatives.length === 1 ? (alternatives[0] as { how: 'and' | 'or'; says: string[] }) : { how: 'or' as const, says: alternatives.flatMap(a => a.says) };
      if (says.says.some(x => x.includes(',')) && says.says.length > 2) return undefined;
      cases.push(own`${kind} that ${coordinate(says.says, says.how)}`);
    }
    if (cases.length === 1) return own`${head} exactly when ${subject} is ${cases[0] as string}`;
    return { kind: 'list', intro: own`${head} exactly when ${subject} is ${fixed(INTRO.oneOf)}`, items: cases };
  }

  private defined(s: Extract<Sentence, { t: 'define' }>): Doc {
    const shown = s.params.map(v => this.introduce(v));
    const head = this.clause(s.head) as string;
    const empty = s.body.t === 'and' && s.body.items.length === 0;
    const kinds = s.form === 'by-kinds' ? this.byKinds(head, s.params[0] as Var, s.body) : undefined;
    let sentence: Doc;
    if (kinds !== undefined) sentence = kinds;
    else if (empty) sentence = head;
    else {
      const body = s.body.t === 'iff' ? ({ kind: 'list', intro: fixed(INTRO.both), items: [this.sentence(s.body.l), this.sentence(s.body.r)] } as Doc) : this.sentence(s.body);
      // A body that is a rule, a "for every" or a series is set apart: after "exactly when", its own words would run on,
      // and a series could end before its last clause and leave that clause outside the definition.
      if (s.body.t === 'rule' || (s.body.t === 'quant' && s.body.q === 'all') || (typeof body === 'string' && series(body))) sentence = this.apart(own`${head} exactly when ${fixed(INTRO.apart)}`, body);
      else if (typeof body === 'string') sentence = own`${head} exactly when ${body}`;
      else if (isList(body)) sentence = { ...body, intro: own`${head} exactly when ${body.intro}` };
      else sentence = this.apart(own`${head} exactly when ${fixed(INTRO.apart)}`, body);
    }
    if (shown.length === 0) return sentence;
    const intro = own`for ${coordinate(shown.map(name => `every ${name}`), 'and')}`;
    // A definition whose words open with its one parameter, which they name again after it.
    if (shown.length === 1) {
      const every = this.every(intro, s.params[0] as Var, shown[0] as string);
      const opening = typeof sentence === 'string' ? sentence : sentence.kind === 'rule' ? '' : sentence.intro;
      if (opening.startsWith(`${VARIABLE}${every.name}${VARIABLE} `) && mentions(sentence, every.name) > 1) return { kind: 'block', intro, body: sentence, every };
    }
    return this.apart(intro, sentence);
  }

  /** The "for every" with the given intro over `v`, which `shown` names, as the words could leave it out. */
  private every(intro: string, v: Var, shown: string): Every {
    return { intro, name: this.nameOf(v), said: `${this.article(v.type)}${shown}` };
  }
}

/** How many times the words name a variable. */
function mentions(doc: Doc, name: string): number {
  const said = `${VARIABLE}${name}${VARIABLE}`;
  if (typeof doc === 'string') return doc.split(said).length - 1;
  if (doc.kind === 'list') return mentions(doc.intro, name) + doc.items.reduce((n, item) => n + mentions(item, name), 0);
  if (doc.kind === 'block') return mentions(doc.intro, name) + mentions(doc.body, name);
  return mentions(doc.when, name) + mentions(doc.then, name) + (doc.otherwise === undefined ? 0 : mentions(doc.otherwise, name));
}

/** The doc with the first place `from` is said, in the order a reader meets it, said as `to`; undefined where it is not said. */
function first(doc: Doc, from: string, to: string): Doc | undefined {
  if (typeof doc === 'string') return doc.includes(from) ? doc.replace(from, () => to) : undefined;
  const parts = (ds: Doc[]): Doc[] | undefined => {
    for (const [i, d] of ds.entries()) {
      const done = first(d, from, to);
      if (done !== undefined) return ds.map((x, k) => (k === i ? done : x));
    }
    return undefined;
  };
  if (doc.kind === 'list') {
    const [intro, ...items] = parts([doc.intro, ...doc.items]) ?? [];
    return intro === undefined ? undefined : { ...doc, intro: intro as string, items };
  }
  if (doc.kind === 'block') {
    const [intro, body] = parts([doc.intro, doc.body]) ?? [];
    return intro === undefined ? undefined : { ...doc, intro: intro as string, body: body as Doc };
  }
  const done = parts(doc.otherwise === undefined ? [doc.when, doc.then] : [doc.when, doc.then, doc.otherwise]);
  return done === undefined ? undefined : { ...doc, when: done[0] as Doc, then: done[1] as Doc, ...(doc.otherwise === undefined ? {} : { otherwise: done[2] as Doc }) };
}

/** The doc with each "for every" over a variable in `lone` left out, and the variable named "a" and its noun where the words first name it. */
function withoutEvery(doc: Doc, lone: ReadonlySet<string>): Doc {
  if (typeof doc === 'string') return doc;
  if (doc.kind === 'list') return { ...doc, items: doc.items.map(item => withoutEvery(item, lone)) };
  if (doc.kind === 'rule') return { ...doc, when: withoutEvery(doc.when, lone), then: withoutEvery(doc.then, lone), ...(doc.otherwise === undefined ? {} : { otherwise: withoutEvery(doc.otherwise, lone) }) };
  const body = withoutEvery(doc.body, lone);
  // Only the "for every" as the printer made it: an intro another part has put words before is not one.
  if (doc.every !== undefined && doc.every.intro === doc.intro && lone.has(doc.every.name)) return first(body, `${VARIABLE}${doc.every.name}${VARIABLE}`, doc.every.said) ?? { ...doc, body };
  return { ...doc, body };
}

/** A doc as text: laid out, with a capital where the sentence starts with its own words and a period where it ends. */
export function finish(doc: Doc, layout: 'text' | 'markdown', self: string | undefined, options: PrintOptions = { dropLoneNumbers: false, aNounForEvery: false }, marked?: Marked): string {
  const said = (d: Doc): string => {
    const raw = layout === 'markdown' ? markdownLines(d) : lines(d);
    const out = unmarked(resolveLinks(raw.join('\n'), layout === 'markdown', self)).split('\n');
    if (!(out[0] as string).startsWith(VARIABLE)) out[0] = (out[0] as string).replace(/^(\[?)(.)/, (_, bracket: string, c: string) => bracket + c.toUpperCase());
    const last = out.length - 1;
    if (!/(:|^\s*- .*)$/.test(out[last] as string)) out[last] = `${out[last]}.`;
    return out.join('\n').replaceAll(VARIABLE, '');
  };
  const marking = (text: string): string => (marked === undefined || layout !== 'markdown' ? text : markTerms(text, marked));
  let text = said(doc);
  if (options.dropLoneNumbers) {
    // Whether a variable is named the noun alone shows only in the whole of the words, so they are said again without the "for every" it can leave out.
    if (options.aNounForEvery) {
      const without = withoutEvery(doc, new Set(lone(text).keys()));
      if (without !== doc) text = said(without);
    }
    text = unnumbered(text);
  }
  return marking(options.shortNames === true ? shortNames(text) : text);
}

/**
 * Each variable of the words that is the only one of its noun, where the noun says nothing else in them, with its noun.
 * A number of the words' own, `number_1`, is never one.
 */
function lone(text: string): Map<string, string> {
  const name = /\b([a-z][a-z_]*?)_(\d+)\b/g;
  const byNoun = new Map<string, Set<string>>();
  for (const [whole, stem] of text.matchAll(name)) if (stem !== 'number') byNoun.set(stem as string, (byNoun.get(stem as string) ?? new Set()).add(whole));
  // A link's target, such as (#term-unit), is not a word the reader sees.
  const elsewhere = text.replace(/\]\([^)]*\)/g, ']').replace(name, ' ');
  const out = new Map<string, string>();
  for (const [stem, names] of byNoun) {
    const noun = stem.replace(/_/g, ' ');
    if (names.size !== 1 || new RegExp(`\\b${noun}(?:s|es)?\\b`, 'i').test(elsewhere)) continue;
    const variable = [...names][0] as string;
    // Only a variable that a quantifier introduces, "every unit_1" or "a unit_1": one that "values of" or "a step from"
    // introduces stands for each of many, which "the unit" would say as one.
    const first = text.indexOf(variable);
    if (!/\b(?:every|[Aa]n?|no|exactly one|at most one|some) \[?$/.test(text.slice(0, first))) continue;
    out.set(variable, noun);
  }
  return out;
}

/**
 * The words with the number left off a variable that is the only one of its noun, where the noun says nothing else in
 * them: "for every unit: when the unit is circular". Where the noun appears elsewhere, "the unit" could mean that, so the
 * number stays; so does a number of the words' own, `number_1`.
 */
function unnumbered(text: string): string {
  let out = text;
  for (const [variable, noun] of lone(text)) {
    const counted = '(\\b(?:every|[Aa]n?|no|exactly one|at most one|some) )';
    out = out
      .replace(new RegExp(`${counted}\\[${variable}\\]`, 'g'), `$1[${noun}]`)
      .replace(new RegExp(`\\[${variable}\\]`, 'g'), `the [${noun}]`)
      .replace(new RegExp(`${counted}${variable}\\b`, 'g'), `$1${noun}`)
      .replace(new RegExp(`\\b${variable}\\b`, 'g'), `the ${noun}`);
  }
  return out.replace(/^(> )?the /, (_, quote: string | undefined) => `${quote ?? ''}The `);
}


