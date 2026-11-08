/**
 * A pass: one named change to how a statement is said, made wherever it applies. A pass of the IR changes the IR and
 * never what it means: for every statement it touches, the analyzer can be asked whether the IR before and after it
 * hold in the same worlds. A pass of the printer sets an option of the printer, which changes words and never the IR.
 * Each pass names the spec in naturalloy's canon that states it.
 *
 * The pipeline runs the passes in order, each over the IR the one before left. With every pass off, the printer says
 * the IR as lowered: the literal reading, `-O0`.
 */
import type { Readings } from '../readings.ts';
import type { Num, Sentence } from './ir.ts';

/** What the printer can be asked to do beyond laying out the IR. */
export interface PrintOptions {
  /** Leave the number off a variable that is the only one of its noun, where the noun says nothing else: "the unit". */
  dropLoneNumbers: boolean;
  /** Leave out a "for every" over a variable named "the" and its noun, and name it "a" and its noun where the words first do. */
  aNounForEvery: boolean;
  /** Name a variable by the letters of its noun and its number, `U1`, with its noun before the name where the words first name it. */
  shortNames?: boolean;
}

/** What a pass of the IR may consult. */
export interface Context {
  readings: Readings;
  /** The words of a part of the IR as one line, as the printer would say it with the passes so far; undefined where they are more than a line. */
  words(s: Sentence): string | undefined;
  /** The opening line of a part the printer lays out as a list or a block, and whether it is a rule; undefined for one line. */
  opening(s: Sentence): { intro: string } | { rule: true } | undefined;
}

/** What a pass rests on, beyond the analyzer: how readers took its words, and the words tried before them. */
export interface Evidence {
  /** How readers took the words: the judges and the probes, in a sentence each. */
  readers?: string[];
  /** Words tried for the same thing and left, each with why. */
  rejected?: string[];
}

export type Pass = (
  | {
      /** A short name, which `WORDINGS.md`, the dumps and a switch use: `there-is-a-that`. */
      name: string;
      /** The @spec of the canon that states what the pass does. */
      spec: string;
      /** The IR with the change made wherever it applies, or the same object where it applies nowhere. */
      run(s: Sentence, context: Context): Sentence;
    }
  | { name: string; spec: string; print: Partial<PrintOptions> }
) & { evidence?: Evidence };

/** What a run of the pipeline saw: the IR after each pass of the IR, by its name. */
export type Trace = { pass: string; after: Sentence }[];

/** The passes in order, over the lowered IR, leaving out those `off` names: the IR, and the options for the printer. */
export function optimize(s: Sentence, passes: readonly Pass[], context: Context, off: ReadonlySet<string> = new Set(), trace?: Trace): { ir: Sentence; print: PrintOptions } {
  let at = s;
  const print: PrintOptions = { dropLoneNumbers: false, aNounForEvery: false };
  for (const pass of passes) {
    if (off.has(pass.name)) continue;
    if ('print' in pass) Object.assign(print, pass.print);
    else {
      at = pass.run(at, context);
      trace?.push({ pass: pass.name, after: at });
    }
  }
  return { ir: at, print };
}

/** Each child sentence of a node, rebuilt with `f`, and the same node where no child changes. */
export function children(s: Sentence, f: (child: Sentence) => Sentence): Sentence {
  switch (s.t) {
    case 'and':
    case 'or': {
      const items = s.items.map(f);
      return items.every((item, i) => item === s.items[i]) ? s : { ...s, items };
    }
    case 'not':
    case 'moment':
    case 'quant':
    case 'define': {
      const body = f(s.body);
      return body === s.body ? s : ({ ...s, body } as Sentence);
    }
    case 'rule': {
      const [when, then, otherwise] = [f(s.when), f(s.then), s.otherwise === undefined ? undefined : f(s.otherwise)];
      return when === s.when && then === s.then && otherwise === s.otherwise ? s : { ...s, when, then, ...(otherwise === undefined ? {} : { otherwise }) };
    }
    case 'iff': {
      const [l, r] = [f(s.l), f(s.r)];
      return l === s.l && r === s.r ? s : { ...s, l, r };
    }
    case 'until':
    case 'since': {
      const [a, b] = [f(s.a), f(s.b)];
      return a === s.a && b === s.b ? s : { ...s, a, b };
    }
    case 'reading': {
      // A noun phrase's conditions are a sentence of their own.
      const args = s.args.map(term => (term.t === 'np' && term.relative !== undefined ? { ...term, relative: f(term.relative) } : term));
      return args.every((term, i) => term === s.args[i] || (term.t === 'np' && term.relative === (s.args[i] as typeof term).relative)) ? s : { ...s, args };
    }
    case 'pair': {
      const [first, second] = [f(s.first), f(s.second)];
      return first === s.first && second === s.second ? s : ({ ...s, first, second } as Sentence);
    }
    case 'reach': {
      const step = f(s.step);
      return step === s.step ? s : { ...s, step };
    }
    case 'compare': {
      const [l, r] = [inNumber(s.l, f), inNumber(s.r, f)];
      return l === s.l && r === s.r ? s : { ...s, l, r };
    }
    default:
      return s;
  }
}

/** A number with the sentences inside it, its conditions, rebuilt with `f`. */
function inNumber(n: Num, f: (child: Sentence) => Sentence): Num {
  switch (n.t) {
    case 'count':
    case 'sumOf': {
      const cond = f(n.cond);
      return cond === n.cond ? n : { ...n, cond };
    }
    case 'sumOver': {
      const body = inNumber(n.body, f);
      return body === n.body ? n : { ...n, body };
    }
    case 'arith': {
      const [l, r] = [inNumber(n.l, f), inNumber(n.r, f)];
      return l === n.l && r === n.r ? n : { ...n, l, r };
    }
    default:
      return n;
  }
}

/** A pass of the IR that rewrites each node where `at` gives a new one, from the leaves up. */
export function everywhere(name: string, spec: string, at: (s: Sentence, context: Context) => Sentence | undefined): Pass {
  const run = (s: Sentence, context: Context): Sentence => {
    const inner = children(s, child => run(child, context));
    return at(inner, context) ?? inner;
  };
  return { name, spec, run };
}
