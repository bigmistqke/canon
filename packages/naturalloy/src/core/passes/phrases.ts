/**
 * A "there is" or "there is no" over one variable that is said once, as a noun phrase in the place of that variable:
 * "spec_1 cites no axiom" and not "there is no axiom_1 such that spec_1 cites axiom_1". The other conditions on the
 * variable become a relative clause, "an issue that tracker does not know", and a difference from another variable of
 * its kind becomes "another unit". A quantifier of several variables is one inside the other: "a test checks a bug
 * that sits in unit_1".
 */
import type { Clause, NounPhrase, Sentence, Term, Var } from '../ir.ts';
import { type Context, everywhere, type Pass } from '../pass.ts';
import { Vocabulary } from '../vocabulary.ts';
import { mentions } from '../walk.ts';
import { seen, timed } from '../words.ts';

/** The terms of a clause, in the order of its slots. */
export function termsOf(c: Clause): Term[] {
  switch (c.t) {
    case 'reading':
      return c.args;
    case 'same':
      return [c.l, c.r];
    case 'isA':
      return [c.x];
    case 'next':
      return [c.x, c.y];
    default:
      return [];
  }
}

const isVar = (term: Term, v: Var): boolean => term.t === 'var' && term.v.id === v.id;

/** The words of a reading of a clause, with its slots: where in them the variable's slot stands. */
function template(c: Clause, context: Context): string | undefined {
  switch (c.t) {
    case 'reading': {
      const reading = context.readings.atoms.get(c.key);
      return reading === undefined ? undefined : c.negative ? reading.negative : reading.positive;
    }
    case 'same':
      return '{1} and {2} are the same';
    case 'isA':
      return '{1} is a kind';
    case 'next':
      return '{2} is the integer after {1} without wrapping around';
    default:
      return undefined;
  }
}

/** The words that may open the rest of a clause after its subject: the verbs the readings know, and those of English that every clause may use. */
export function verbWord(word: string, readings: Context['readings']): boolean {
  const plain = word.replace(/^\[|\].*$/g, '');
  if (['is', 'are', 'was', 'were', 'has', 'have', 'had', 'does', 'do', 'did', 'can', 'cannot'].includes(plain)) return true;
  return readings.verbs.has(plain) || [...readings.verbs.values()].some(forms => forms.infinitive === plain);
}

/**
 * How many words of their readings clauses with the variable at their end share before the rest of each, which opens
 * with a verb: 2 for "the tracker knows" and "the tracker has not closed". The other things a clause names count as
 * words, so that "the bug names" and "the issue names" share none. Undefined where they share no subject.
 */
export function sharedSubject(clauses: Clause[], v: Var, context: Context): number | undefined {
  const words: string[][] = [];
  for (const c of clauses) {
    const t = c.t === 'reading' ? template(c, context)?.trim() : undefined;
    if (t === undefined) return undefined;
    const at = termsOf(c).findIndex(term => isVar(term, v)) + 1;
    if (!t.endsWith(`{${at}}`)) return undefined;
    const filled = t.slice(0, -`{${at}}`.length).replace(/\{(\d+)\}/g, (_, n: string) => `{${JSON.stringify(termsOf(c)[Number(n) - 1])}}`);
    words.push(filled.trim().split(/\s+/));
  }
  let shared = 0;
  while (words.every(w => w[shared] !== undefined && w[shared] === (words[0] as string[])[shared])) shared++;
  for (let n = shared; n > 0; n--) if (words.every(w => w.length > n && verbWord(w[n] as string, context.readings))) return n;
  return undefined;
}

/** Where the variable stands in a clause that says it once: at its start, at its end, or inside. Undefined where the clause does not say it once. */
function place(c: Clause, v: Var, context: Context): 'start' | 'end' | 'inside' | undefined {
  const terms = termsOf(c);
  const at = terms.findIndex(term => isVar(term, v));
  if (at === -1 || terms.filter(term => isVar(term, v)).length !== 1 || terms.some(term => term.t === 'np' && mentions(term, v))) return undefined;
  const words = template(c, context)?.trim();
  if (words === undefined || words.split(`{${at + 1}}`).length !== 2) return undefined;
  return words.startsWith(`{${at + 1}}`) ? 'start' : words.endsWith(`{${at + 1}}`) ? 'end' : 'inside';
}

/** A clause that can carry the noun phrase: a reading, a comparison of two values or a kind, with no noun phrase that speaks of the variable. */
function clause(s: Sentence): s is Clause {
  return s.t === 'reading' || s.t === 'same' || s.t === 'isA' || s.t === 'next';
}

/** What a condition says the variable differs from, when that is all it says. */
function differsFrom(s: Sentence, v: Var): Term | undefined {
  if (s.t !== 'same' || !s.negative) return undefined;
  if (isVar(s.l, v) && (s.r.t === 'var' || s.r.t === 'free' || s.r.t === 'string')) return s.r;
  if (isVar(s.r, v) && (s.l.t === 'var' || s.l.t === 'free' || s.l.t === 'string')) return s.l;
  return undefined;
}

/** The clause with the noun phrase in the place of the variable. */
function put(c: Clause, v: Var, np: NounPhrase): Clause {
  const put_ = (term: Term): Term => (isVar(term, v) ? np : term);
  switch (c.t) {
    case 'reading':
      return { ...c, args: c.args.map(put_) };
    case 'same':
      return { ...c, l: put_(c.l), r: put_(c.r) };
    case 'isA':
      return { ...c, x: put_(c.x) };
    case 'next':
      return { ...c, x: put_(c.x), y: put_(c.y) };
    default:
      return c;
  }
}

/** A condition that can carry the noun phrase: a clause, or a clause at the next moment. */
interface Part {
  clause: Clause;
  next: boolean;
}

function part(s: Sentence): Part | undefined {
  if (clause(s)) return { clause: s, next: false };
  if (s.t === 'moment' && s.op === 'after' && clause(s.body)) return { clause: s.body, next: true };
  return undefined;
}

/**
 * The variables, free names and strings a clause names besides `v`, inside its noun phrases too. The variable of a noun
 * phrase is no such thing: beside only "an owner that pulse has disposed", "a cleanup is on" it reads as every cleanup.
 */
function others(c: Clause, v: Var): number {
  const found = new Set<string>();
  const phrased = new Set<string>();
  const bound = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(bound);
    else if (n !== null && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.t === 'np') phrased.add((o.v as Var).id);
      Object.values(o).forEach(bound);
    }
  };
  bound(c);
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n !== null && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.t === 'var' && (o.v as Var).id !== v.id && !phrased.has((o.v as Var).id)) found.add(`var ${(o.v as Var).id}`);
      else if (o.t === 'free') found.add(`free ${o.name as string}`);
      else if (o.t === 'string') found.add(`string ${o.value as string}`);
      for (const [key, value] of Object.entries(o)) if (key !== 'v') walk(value);
    }
  };
  walk(c);
  return found.size;
}

/** The quantifier said as a clause with a noun phrase, or undefined where it does not fit. */
export function absorbed(q: 'some' | 'no', v: Var, body: Sentence, context: Context, ofSet = false): Sentence | undefined {
  if (!context.readings.nouns.has(v.type)) return undefined;
  const conditions = body.t === 'and' ? body.items : [body];
  let other: Term | undefined;
  const rest: Sentence[] = [];
  for (const condition of conditions) {
    const differs = other === undefined ? differsFrom(condition, v) : undefined;
    if (differs !== undefined) other = differs;
    else rest.push(condition);
  }
  // "no other" hints that the variable is in the set, which the logic does not say.
  if (rest.length === 0 || (other !== undefined && q === 'no')) return undefined;
  const parts = rest.map(part);
  if (parts.some(p => p === undefined)) return undefined;
  const ps = parts as Part[];
  const places = ps.map(p => place(p.clause, v, context));
  if (places.some(p => p === undefined)) return undefined;
  // A time phrase in the phrase would cover the other conditions too.
  if (ps.length > 1 && ps.some(p => p.next)) return undefined;
  // The main clause puts the variable beside a variable, a string or a name, at its end where it can: "test_1 carries
  // a tag". Beside only another noun phrase, "a cleanup is on an owner" would read as said of every cleanup. `some S`
  // of a set is said of its member alone: "an edge is being delivered", "pulse has disposed no owner".
  const fits = (i: number): boolean => others((ps[i] as Part).clause, v) >= 1 || (ofSet && ps.length === 1);
  let main = ps.findIndex((_, i) => fits(i) && places[i] === 'end');
  if (main === -1) main = ps.findIndex((_, i) => fits(i) && places[i] === 'start');
  if (main === -1 && ofSet && ps.length === 1 && places[0] === 'inside') main = 0;
  if (main === -1) return undefined;
  const relative = ps.filter((_, i) => i !== main);
  // The others say more of the variable: each as its subject, or one with it at its end, "an issue that tracker does not know".
  let subject: number | undefined;
  if (relative.length > 0) {
    const asSubject = relative.every(p => places[ps.indexOf(p)] === 'start');
    const asObject = relative.length === 1 && places[ps.indexOf(relative[0] as Part)] === 'end';
    // Several with it at their end, "an issue that the tracker knows and has not closed": they must share their subject.
    if (!asSubject && !asObject) {
      subject = relative.every(p => places[ps.indexOf(p)] === 'end') ? sharedSubject(relative.map(p => p.clause), v, context) : undefined;
      if (subject === undefined) return undefined;
    }
    // "x and y are different" has the variable in a subject of two, which a relative clause cannot take.
    if (relative.some(p => p.clause.t === 'same')) return undefined;
  }
  const np: NounPhrase = {
    t: 'np',
    det: q === 'no' ? 'no' : 'a',
    v,
    ...(relative.length === 0 ? {} : { relative: relative.length === 1 ? (relative[0] as Part).clause : { t: 'and', items: relative.map(p => p.clause), ...(subject === undefined ? {} : { subject }) } }),
    ...(other === undefined ? {} : { other })
  };
  const chosen = ps[main] as Part;
  const said = put(chosen.clause, v, np);
  return chosen.next ? { t: 'moment', op: 'after', body: said, form: 'front' } : said;
}

/**
 * The conditions of a thing said as a relative clause of it: each with it as its subject, one with it at its end, or
 * several with it at their end that share their subject. Undefined where they make no relative clause.
 */
function relativeOf(conditions: Sentence[], v: Var, context: Context): Sentence | undefined {
  if (conditions.length === 0 || !conditions.every(c => clause(c) && c.t !== 'same')) return undefined;
  const places = (conditions as Clause[]).map(c => place(c, v, context));
  if (places.some(p => p === undefined)) return undefined;
  if (conditions.length === 1) return places[0] === 'inside' ? undefined : (conditions[0] as Sentence);
  if (places.every(p => p === 'start')) return { t: 'and', items: conditions };
  const subject = places.every(p => p === 'end') ? sharedSubject(conditions as Clause[], v, context) : undefined;
  return subject === undefined ? undefined : { t: 'and', items: conditions, subject };
}

/**
 * A "for every" over several things, whose rule has no "otherwise" and no other quantifier, its first side conditions
 * that each name one thing, at least one for each, and its second side one clause that names each thing once: that
 * clause, with each thing as "every" and its noun and its conditions as a relative clause.
 */
export const everyPhrases = everywhere('every-phrases', 'spec-each-thing-of-a-rule-over-several-is-said-as-every-and-its-conditions', (s, context) => {
  if (s.t !== 'quant' || s.q !== 'all' || s.vars.length < 2 || s.body.t !== 'rule' || s.body.otherwise !== undefined) return undefined;
  const { when, then } = s.body;
  if (!clause(then) || termsOf(then).some(term => term.t === 'np')) return undefined;
  const conditions = when.t === 'and' ? when.items : [when];
  let said: Clause = then;
  for (const v of s.vars) {
    if (!context.readings.nouns.has(v.type) || termsOf(then).filter(term => isVar(term, v)).length !== 1) return undefined;
    const own = conditions.filter(c => names(c, v));
    // Each condition names one thing of the "for every" alone.
    if (own.some(c => s.vars.some(other => other !== v && names(c, other)))) return undefined;
    const relative = relativeOf(own, v, context);
    if (relative === undefined) return undefined;
    said = put(said, v, { t: 'np', det: 'every', v, relative });
  }
  // Every condition belongs to a thing, and none is a quantifier of its own.
  if (!conditions.every(c => s.vars.some(v => names(c, v)))) return undefined;
  return said;
});

/** Whether a part of the IR names the variable. */
function names(n: unknown, v: Var): boolean {
  if (Array.isArray(n)) return n.some(x => names(x, v));
  if (n === null || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  if ((o.t === 'var' || o.t === 'np') && (o.v as Var | undefined)?.id === v.id) return true;
  return Object.values(o).some(x => names(x, v));
}

/**
 * A "some" over several things with each thing that only some of its clauses name said inside those clauses, as a
 * "some" of its own, where they say a noun phrase of it: `some x, v | r and g` is `some x | r and (some v | g)` when
 * `r` does not name `v`. The later things go first, as the noun phrases say them innermost, and the clause that holds
 * the noun phrase goes after the others.
 */
export const someInside = everywhere('some-inside', 'spec-a-thing-of-a-some-is-said-inside-the-clauses-that-name-it', (s, context) => {
  if (s.t !== 'quant' || s.q !== 'some' || s.vars.length < 2 || s.form !== undefined || s.origin !== undefined) return undefined;
  // A "some" that the pass of noun phrases says whole, each thing inside the next, is left to it.
  if (phrased(s, context)) return undefined;
  let vars = [...s.vars];
  let items = s.body.t === 'and' ? [...s.body.items] : [s.body];
  let changed = false;
  for (let moved = true; moved && vars.length > 1; ) {
    moved = false;
    for (const v of [...vars].reverse()) {
      const named = items.filter(item => names(item, v));
      // A thing goes inside only where the words say more of it than the clause that names it beside another.
      if (named.length < 2 || named.length === items.length) continue;
      // "another owner" differs from the owner named last before it, which moving the thing would change.
      if (named.some(item => differsFrom(item, v) !== undefined)) continue;
      const body: Sentence = named.length === 1 ? (named[0] as Sentence) : { t: 'and', items: named };
      if (absorbed('some', v, body, context) === undefined) continue;
      // The clause that holds the noun phrase goes last: a clause after it could be read as part of its relative clause.
      const inner: Sentence = { t: 'quant', q: 'some', vars: [v], body };
      items = [...items.filter(item => !named.includes(item)), inner];
      vars = vars.filter(x => x !== v);
      changed = moved = true;
      break;
    }
  }
  if (!changed) return undefined;
  return { ...s, vars, body: items.length === 1 ? (items[0] as Sentence) : { t: 'and', items } };
});

/** The quantifier said as noun phrases, each variable inside the next, or undefined where one does not fit. */
function asPhrases(s: Extract<Sentence, { t: 'quant' }>, context: Context): Sentence | undefined {
  // Variables of different kinds are said one inside the other: the last innermost, under "some", then the first.
  const [first, ...later] = s.vars as [Var, ...Var[]];
  let body: Sentence = s.body;
  for (const v of [...later].reverse()) {
    const inner = absorbed('some', v, body, context, s.origin === 'set');
    if (inner === undefined) return undefined;
    body = inner;
  }
  return absorbed(s.q as 'some' | 'no', first, body, context, s.origin === 'set');
}

/** Whether the pass of noun phrases says the quantifier whole. */
function phrased(s: Extract<Sentence, { t: 'quant' }>, context: Context): boolean {
  return asPhrases(s, context) !== undefined;
}

export const nounPhrases: Pass = {
  ...everywhere('noun-phrases', 'spec-a-variable-said-once-takes-the-place-of-its-quantifier-as-a-noun-phrase', (s, context) => {
  // A quantifier an earlier pass has given a form keeps it.
  if (s.t !== 'quant' || (s.q !== 'some' && s.q !== 'no') || s.form !== undefined) return undefined;
  return asPhrases(s, context);
}),
  evidence: {
    rejected: ['"another" where the formula has no "!=".', 'a noun phrase hanging only from another noun phrase, "a cleanup is on an owner": it reads as said of every cleanup.']
  }
};

/** The kind an alternative of a definition begins with: the set of its first clause's reading, or the signature of its "is a". */
function kindOf(alternative: Sentence): string | undefined {
  const guard = alternative.t === 'and' ? alternative.items[0] : undefined;
  return guard?.t === 'isA' ? guard.type : guard?.t === 'reading' ? guard.key : undefined;
}

/**
 * A definition by kinds: its body is an "or" of alternatives, or one, that each begin by saying what kind of thing the
 * parameter is, and go on with clauses about it. The printer says each kind as a noun phrase: "unit_1 is unfounded
 * exactly when unit_1 is one of these: a spec that cites no axiom and cites no spec; a bug that cites no fact".
 */
export const definitionByKinds = everywhere('definition-by-kinds', 'spec-a-definition-by-cases-is-said-as-a-noun-phrase-for-each-kind', (s, context) => {
  if (s.t !== 'define' || s.form !== undefined || s.params.length !== 1) return undefined;
  const v = s.params[0] as Var;
  const about = (c: Sentence): boolean => clause(c) && place(c, v, context) === 'start' && c.t !== 'same';
  const fits = (alternative: Sentence): boolean => {
    if (alternative.t !== 'and' || alternative.items.length < 2) return false;
    const [guard, ...rest] = alternative.items as [Sentence, ...Sentence[]];
    // The kind is what the first clause says the parameter is: "unit_1 is a spec".
    if (!about(guard) || !/^\S+ is an? /.test(seen(context.words(guard) ?? ''))) return false;
    if (rest.length === 1 && (rest[0] as Sentence).t === 'or') return ((rest[0] as Extract<Sentence, { t: 'or' }>).items).every(about);
    return rest.every(about);
  };
  const alternatives = s.body.t === 'or' ? s.body.items : [s.body];
  if (!alternatives.every(fits)) return undefined;
  // A reader may take "is one of these" as exactly one. Over kinds that share no member, that is what it says.
  const kinds = [...new Set(alternatives.map(kindOf))];
  const vocabulary = new Vocabulary(context.readings);
  if (kinds.some(k => k === undefined) || kinds.some((a, i) => kinds.slice(i + 1).some(b => vocabulary.overlap(a as string, b as string)))) return undefined;
  return { ...s, form: 'by-kinds' };
});

/**
 * Two things of one kind that must differ, each with conditions of its own: "unit_1 names a unit and names another
 * unit", and not "there are unit_2 and unit_3 such that unit_2 and unit_3 are different, unit_1 names unit_2 and unit_1
 * names unit_3".
 */
export const anotherOfAKind = everywhere('another-of-a-kind', 'spec-a-variable-that-must-differ-from-another-of-its-kind-is-said-as-another', (s, context) => {
  if (s.t !== 'quant' || s.q !== 'some' || s.vars.length !== 2) return undefined;
  const [a, b] = s.vars as [Var, Var];
  if (a.type !== b.type || s.body.t !== 'and') return undefined;
  const parts = s.body.items;
  const differ = parts.findIndex(p => p.t === 'same' && p.negative && ((isVar(p.l, a) && isVar(p.r, b)) || (isVar(p.l, b) && isVar(p.r, a))));
  if (differ === -1) return undefined;
  const rest = parts.filter((_, i) => i !== differ);
  const ofA = rest.filter(p => mentions(p, a) && !mentions(p, b));
  const ofB = rest.filter(p => mentions(p, b) && !mentions(p, a));
  if (ofA.length === 0 || ofB.length === 0 || ofA.length + ofB.length !== rest.length) return undefined;
  const all = (items: Sentence[]): Sentence => (items.length === 1 ? (items[0] as Sentence) : { t: 'and', items });
  const [first, second] = [absorbed('some', a, all(ofA), context), absorbed('some', b, all(ofB), context)];
  if (first === undefined || second === undefined || !clause(first) || !clause(second)) return undefined;
  // The second is "another": its noun phrase differs from the first.
  if (second.t !== 'reading') return undefined;
  const args = second.args.map(arg => (arg.t === 'np' && arg.v.id === b.id ? { ...arg, other: { t: 'var', v: a } as Term } : arg));
  return { t: 'pair', a, b, first, second: { ...second, args } };
});
