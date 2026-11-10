/**
 * The sentence IR: what the words of a formula say, as structure and not as text. Every node has a meaning in Alloy,
 * which `meaning` writes out, so that a pass that changes the IR can be asked of the analyzer: the IR before and after
 * it must hold in the same worlds. The words a node is printed with are the printer's, and only the printer's choices
 * are left to readers.
 *
 * A node may carry hints for the printer, such as `inline`. A hint changes how a node is laid out and never what it
 * means, so `meaning` ignores it.
 */
import { type Node, parseFormula } from '@bigmistqke/parse-alloy';

/** A variable the words introduce. Its name is the printer's: the noun of its type and a number, or the noun alone. */
export interface Var {
  /** Unique within one rendering; never shown. */
  id: string;
  /** The signature it ranges over, which has a noun. */
  type: string;
}

/** One thing a clause is about. */
export type Term =
  | { t: 'var'; v: Var }
  /** A variable the formula leaves free, said by the name the formula gives it. */
  | { t: 'free'; name: string }
  | { t: 'string'; value: string }
  /**
   * A noun phrase: a quantifier said in the place of its variable, "a unit", "no unit that is a spec", "another unit".
   * It takes the narrowest scope there is: the clause it stands in, inside the noun phrases before it in that clause.
   */
  | NounPhrase;

export interface NounPhrase {
  t: 'np';
  det: 'a' | 'no' | 'every';
  v: Var;
  /** What else holds of the variable: "that is a spec". */
  relative?: Sentence;
  /** A variable or a string the variable differs from: "another unit", "a text other than "a"". */
  other?: Term;
}

/** How a reading's words relate to the formula: `x in S`, `x->y in r`, `p[x, y]`, `y in f[x]`, or `some S` for a reading with no slot. */
export type Form = 'in' | 'call' | 'fun' | 'some';

/** A clause: one fact, said by a reading or by words of the printer's own. */
export type Clause =
  /** A reading of the table, with a term in each slot. `key` is the name it is read under: `Ran`, `on`, `Clock.older`, `Ran'`. */
  | { t: 'reading'; key: string; form: Form; args: Term[]; negative: boolean }
  /** "x and y are the same", "are different". */
  | { t: 'same'; l: Term; r: Term; negative: boolean }
  /** "x is a cleanup", for a signature with a noun and no reading. */
  | { t: 'isA'; x: Term; type: string; negative: boolean }
  /** "x reaches y in one or more steps", where a step from `p` to `q` is `step`. `relation` is the expression closed over. */
  | { t: 'reach'; from: Term; to: Term; reflexive: boolean; p: Var; q: Var; step: Sentence; relation: Node; negative: boolean }
  /** "y is the integer after x without wrapping around". */
  | { t: 'next'; x: Term; y: Term; negative: boolean }
  /** A comparison of numbers in integers that wrap. */
  | { t: 'compare'; op: Compared; l: Num; r: Num };

/** A number, as the words say it. */
export type Num =
  | { t: 'literal'; value: number }
  | { t: 'term'; x: Term }
  | { t: 'least' }
  | { t: 'greatest' }
  /** "the number of values of v such that cond", or of combinations. */
  | { t: 'count'; vars: Var[]; cond: Sentence }
  /** "the sum of the values of v such that cond": the members of a set of integers. */
  | { t: 'sumOf'; v: Var; cond: Sentence }
  /** "the sum, over every v, of body". */
  | { t: 'sumOver'; vars: Var[]; body: Num }
  | { t: 'arith'; op: 'plus' | 'minus' | 'times' | 'div' | 'rem'; l: Num; r: Num };

/** The operators of a comparison of numbers, each said with words of its own: `!<` is "is not less than". */
export type Compared = '<' | '>' | '=<' | '>=' | '=' | '!=' | '!<' | '!>' | '!=<' | '!>=';

export type Quantifier = 'all' | 'some' | 'no' | 'one' | 'lone';
export type Moment = 'always' | 'eventually' | 'after' | 'before' | 'once' | 'historically';

/**
 * A statement made of clauses. A node's `form` says how the printer says it, where a construct has more than one way;
 * with no form, the printer says it in full. Lowering sets a form where the formula already decides it, and the passes
 * set the rest. A form changes the words and never the meaning, so `meaning` ignores it.
 */
export type Sentence =
  | Clause
  /** As bullets, as one sentence, or for `a ; b`: bullets until both are plain clauses, then "a, and at the next moment, b". */
  | { t: 'and'; items: Sentence[]; form?: 'list' | 'sentence' | 'sequence' | 'sequence-sentence' | 'none-of'; /** Conditions of a noun phrase that share the first this many words of their readings, said once: "that the tracker knows and has not closed". */ subject?: number }
  | { t: 'or'; items: Sentence[]; form?: 'list' | 'sentence' }
  /**
   * Whole below "it is not the case that", where no formula takes the negation in; as untrue, for a predicate said by
   * its body; or for `not (a iff b)`, as exactly one of the two holding.
   */
  | { t: 'not'; body: Sentence; form?: 'whole' | 'untrue' | 'exactly-one' }
  /** On one line; or with its second side first, then "when" and the bullets of its first side. */
  | { t: 'rule'; when: Sentence; then: Sentence; otherwise?: Sentence; form?: 'line' | 'claim-first' }
  | { t: 'iff'; l: Sentence; r: Sentence; form?: 'exactly-when' | 'next-and-now' }
  /**
   * "there is a unit that is a spec", or with its conditions as bullets after "that:". `origin` marks `some S` or `no S`
   * of a set whose reading takes the member, which a noun phrase may say alone: "an edge is being delivered".
   */
  | { t: 'quant'; q: Quantifier; vars: Var[]; body: Sentence; origin?: 'set'; form?: 'there-is-that' | 'there-is-that-list' }
  /** In front of the words it covers; and for `always` over a rule, as "from now on, whenever" its condition. */
  | { t: 'moment'; op: Moment; body: Sentence; form?: 'front' | 'whenever' }
  | { t: 'until' | 'since'; a: Sentence; b: Sentence; form?: 'sentence' }
  /**
   * Two things of one kind, each said as a noun phrase in a clause of its own: "unit_1 names a unit and names another
   * unit". It means that there are two different things of the kind, the first of which the first clause says, and the
   * second the second.
   */
  | { t: 'pair'; a: Var; b: Var; first: Clause; second: Clause }
  /** What a definition names, exactly when its body holds, for every value of its parameters; or said kind by kind. */
  | { t: 'define'; head: Clause; params: Var[]; body: Sentence; form?: 'by-kinds' };

/** The Alloy a node means, as text. */
export function meaning(s: Sentence): string {
  return new Meaning().sentence(s);
}

/** Whether a formula of the IR parses as Alloy: a fault of naturalloy, never of the formula, when it does not. */
export function parses(s: Sentence): Node {
  return parseFormula(meaning(s));
}

/** A quantifier a noun phrase puts around the clause it stands in. */
type Wrap = (inner: string) => string;
/** The variable a clause says flat, and the conditions of its noun phrase, said beside the clause. */
interface Flat {
  v: Var;
  conditions: string[];
}

class Meaning {
  /** The Alloy name of each variable: its id, with only the characters a name takes. */
  private name(v: Var): string {
    return `v_${v.id.replace(/[^\w]/g, '_')}`;
  }

  private decl(vars: Var[]): string {
    return vars.map(v => `${this.name(v)}: ${v.type}`).join(', ');
  }

  /**
   * A term in its place, and the quantifiers its noun phrase puts around the clause, outermost first. The noun phrase of
   * the variable `flat` names, said flat, is the variable itself, with its conditions beside the clause.
   */
  private term(x: Term, around: Wrap[], flat?: Flat): string {
    if (flat !== undefined && x.t === 'np' && x.v.id === flat.v.id) {
      if (x.relative !== undefined) flat.conditions.push(`(${this.sentence(x.relative)})`);
      return this.name(x.v);
    }
    switch (x.t) {
      case 'var':
        return this.name(x.v);
      case 'free':
        return x.name;
      case 'string':
        return JSON.stringify(x.value);
      case 'np': {
        const name = this.name(x.v);
        const conditions = [
          ...(x.other === undefined ? [] : [`${name} != ${this.term(x.other, around, flat)}`]),
          ...(x.relative === undefined ? [] : [`(${this.sentence(x.relative)})`])
        ];
        around.push(inner => {
          const body = conditions.length === 0 ? inner : [...conditions, `(${inner})`].join(' and ');
          // "every pass that …": the clause holds of each thing its conditions hold of.
          if (x.det === 'every') return conditions.length === 0 ? `(all ${name}: ${x.v.type} | ${inner})` : `(all ${name}: ${x.v.type} | (${conditions.join(' and ')}) implies (${inner}))`;
          return x.det === 'no' ? `(no ${name}: ${x.v.type} | ${body})` : `(some ${name}: ${x.v.type} | ${body})`;
        });
        return name;
      }
    }
  }

  /** A clause whose noun phrase of the variable `v` is said as the variable itself, with its conditions beside it. */
  private flat(c: Clause, v: Var): string {
    const flat: Flat = { v, conditions: [] };
    const around: Wrap[] = [];
    const core = this.core(c, around, flat);
    return [...flat.conditions, `(${around.reduceRight((inner, wrap) => wrap(inner), core)})`].join(' and ');
  }

  /** A clause with its noun phrases' quantifiers around it, the first phrase outermost. */
  private clause(c: Clause): string {
    const around: Wrap[] = [];
    const core = this.core(c, around);
    return around.reduceRight((inner, wrap) => wrap(inner), core);
  }

  private core(c: Clause, around: Wrap[], flat?: Flat): string {
    const not = (negative: boolean, f: string): string => (negative ? `not (${f})` : f);
    switch (c.t) {
      case 'reading': {
        const args = c.args.map(a => this.term(a, around, flat));
        const key = c.key;
        switch (c.form) {
          case 'in':
            return not(c.negative, `${args.join('->')} in ${key}`);
          case 'call':
            return not(c.negative, `${key}[${args.join(', ')}]`);
          case 'fun':
            return not(c.negative, `${args[args.length - 1]} in ${key}[${args.slice(0, -1).join(', ')}]`);
          case 'some':
            return not(c.negative, `some ${key}`);
        }
        break;
      }
      case 'same':
        return `${this.term(c.l, around, flat)} ${c.negative ? '!=' : '='} ${this.term(c.r, around, flat)}`;
      case 'isA':
        return `${this.term(c.x, around, flat)} ${c.negative ? 'not in' : 'in'} ${c.type}`;
      case 'reach': {
        const [from, to] = [this.term(c.from, around, flat), this.term(c.to, around, flat)];
        return not(c.negative, `${from}->${to} in ${c.reflexive ? '*' : '^'}{${this.decl([c.p, c.q])} | ${this.sentence(c.step)}}`);
      }
      case 'next':
        return not(c.negative, `${this.term(c.x, around, flat)}->${this.term(c.y, around, flat)} in next`);
      case 'compare':
        return `${this.num(c.l, flat)} ${c.op} ${this.num(c.r, flat)}`;
    }
  }

  private num(n: Num, flat?: Flat): string {
    switch (n.t) {
      case 'literal':
        return String(n.value);
      case 'term':
        return this.term(n.x, [], flat);
      case 'least':
        return 'min';
      case 'greatest':
        return 'max';
      case 'count':
        return `#{${this.decl(n.vars)} | ${this.sentence(n.cond)}}`;
      case 'sumOf':
        return `(sum s_: {${this.decl([n.v])} | ${this.sentence(n.cond)}} | s_)`;
      case 'sumOver':
        return `(sum ${this.decl(n.vars)} | ${this.num(n.body, flat)})`;
      case 'arith': {
        const op = { plus: 'plus', minus: 'minus', times: 'mul', div: 'div', rem: 'rem' }[n.op];
        return `${op}[${this.num(n.l, flat)}, ${this.num(n.r, flat)}]`;
      }
    }
  }

  sentence(s: Sentence): string {
    switch (s.t) {
      case 'reading':
      case 'same':
      case 'isA':
      case 'reach':
      case 'next':
      case 'compare':
        return this.clause(s);
      // No item holds always, and no alternative never does.
      case 'and':
        return s.items.length === 0 ? 'no none' : s.items.map(i => `(${this.sentence(i)})`).join(' and ');
      case 'or':
        return s.items.length === 0 ? 'some none' : s.items.map(i => `(${this.sentence(i)})`).join(' or ');
      case 'not':
        return `not (${this.sentence(s.body)})`;
      case 'rule': {
        const rule = `(${this.sentence(s.when)}) implies (${this.sentence(s.then)})`;
        return s.otherwise === undefined ? rule : `${rule} else (${this.sentence(s.otherwise)})`;
      }
      case 'iff':
        return `(${this.sentence(s.l)}) iff (${this.sentence(s.r)})`;
      case 'quant':
        return `(${s.q} ${this.decl(s.vars)} | ${this.sentence(s.body)})`;
      case 'moment':
        return `${s.op} (${this.sentence(s.body)})`;
      case 'until':
      case 'since':
        return `(${this.sentence(s.a)}) ${s.t} (${this.sentence(s.b)})`;
      case 'pair':
        return `(some ${this.decl([s.a, s.b])} | ${this.name(s.a)} != ${this.name(s.b)} and (${this.flat(s.first, s.a)}) and (${this.flat(s.second, s.b)}))`;
      case 'define': {
        const claim = `(${this.clause(s.head)}) iff (${this.sentence(s.body)})`;
        return s.params.length === 0 ? claim : `(all ${this.decl(s.params)} | ${claim})`;
      }
    }
  }
}
