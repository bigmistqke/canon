/**
 * The verbalizer as a compiler: a formula is lowered to the sentence IR, the passes change how it is said, and the
 * printer lays it out. With no passes, the words are the literal reading, `-O0`.
 */
import { parseModule } from '@bigmistqke/parse-alloy';
import { paramsOf, type Readings, Refusal, unqualified, withDifferences, type Marked } from '../readings.ts';
import type { Sentence } from './ir.ts';
import { read } from './formula.ts';
import { Lower } from './lower.ts';
import { Vocabulary } from './vocabulary.ts';
import { type Context, optimize, type Pass, type PrintOptions, type Trace } from './pass.ts';
import { PASSES } from './passes/index.ts';
import { finish, Printer } from './print.ts';
import { meaning } from './ir.ts';
import { meant, type ReadBack, readBack } from './parse.ts';

export interface Options {
  layout?: 'text' | 'markdown';
  /** The href of the place the words are for, which they never link to. */
  self?: string;
  /** Which words may name the target of their link as a term mark instead. */
  marked?: Marked;
  passes?: readonly Pass[];
  /** The names of passes left out. */
  off?: ReadonlySet<string>;
  trace?: Trace;
}

/** A formula as the IR, before any pass. */
export function lower(source: string, readings: Readings): Sentence {
  return new Lower(new Vocabulary(readings)).sentence(read(source));
}

/** What a pass may consult. */
export function context(readings: Readings): Context {
  return {
    readings,
    words: s => {
      try {
        const doc = new Printer(readings, true).sentence(s);
        return typeof doc === 'string' ? doc : undefined;
      } catch {
        return undefined;
      }
    },
    opening: s => {
      try {
        const doc = new Printer(readings, true).sentence(s);
        return typeof doc === 'string' ? undefined : doc.kind === 'rule' ? { rule: true } : { intro: doc.intro };
      } catch {
        return undefined;
      }
    }
  };
}

/** The words for a formula. Throws a Refusal that names what cannot be said. */
export function say(source: string, readings: Readings, options: Options = {}): string {
  const { ir, print: printing } = optimize(lower(source, readings), options.passes ?? [], context(readings), options.off, options.trace);
  return print(ir, readings, options, printing);
}

/** The IR as words. */
export function print(s: Sentence, readings: Readings, options: Options = {}, printing: PrintOptions = { dropLoneNumbers: false, aNounForEvery: false }): string {
  return finish(new Printer(readings).statement(s), options.layout ?? 'text', options.self, printing, options.marked);
}

/** A definition, `pred name[params] { body }` or `fun name[params]: T { e }`, as the IR. */
export function lowerDefinition(source: string, readings: Readings): Sentence {
  const written = 'a definition is written `pred name[parameters] { formula }` or `fun name[parameters]: type { expression }`';
  if (!isDefinition(source)) throw new Refusal(written);
  const paragraphs = parseModule(source).paragraphs;
  const p = paragraphs[0];
  if (paragraphs.length !== 1 || p === undefined) throw new Refusal(written);
  if (p.t === 'macro') throw new Refusal('a parameter of a macro has no type, so a macro has no words "for every" value of it');
  if (p.t !== 'pred' && p.t !== 'fun') throw new Refusal(written);
  const decls = paramsOf(p);
  const params = decls.flatMap(d =>
    d.names.map(name => {
      const base = d.type.t === 'mult' && d.type.q === 'one' ? d.type.e : d.type;
      if (base.t === 'mult' || base.t === 'arrow') throw new Refusal(`the parameter "${name}" can hold none or several things, and a definition is said for every one thing`);
      if (base.t !== 'name') throw new Refusal(`the parameter "${name}" has no type that is a name`);
      return { name, type: base.name };
    })
  );
  const lower = new Lower(new Vocabulary(readings));
  if (p.t === 'pred') return lower.definition(p.name, params, unqualified(withDifferences(decls, p.body)));
  const result = p.result.t === 'mult' ? p.result.e : p.result;
  if (result.t !== 'name') throw new Refusal(`the value of "${p.name}" has no type that is a name`);
  return lower.fn(p.name, params, result.name, unqualified(p.body));
}

export function sayDefinition(source: string, readings: Readings, options: Options = {}): string {
  const { ir, print: printing } = optimize(lowerDefinition(source, readings), options.passes ?? [], context(readings), options.off, options.trace);
  return print(ir, readings, options, printing);
}

/** Whether the text is a definition, `pred name[params] { body }`, and not a formula. */
export const isDefinition = (source: string): boolean => /^\s*(?:private\s+)?(?:pred|fun)\b/.test(source) || /^\s*let\s+[\w']+\s*\[/.test(source);

/**
 * The words for the formula in `source`, with every pass, as lines of text or as markdown with links. `self` is the
 * href of the place the words are for, which they never link to, and `marked` says which words may be a term mark
 * instead of a link. Throws a Refusal that names what cannot be said.
 */
export function verbalize(source: string, readings: Readings, layout: 'text' | 'markdown' = 'text', self?: string, marked?: Marked): string {
  return say(source, readings, { layout, self, marked, passes: PASSES });
}

/** The words for a definition, `pred name[params] { body }`: what it names, exactly when its body holds. */
export function verbalizeDefinition(source: string, readings: Readings, layout: 'text' | 'markdown' = 'text', self?: string, marked?: Marked): string {
  return sayDefinition(source, readings, { layout, self, marked, passes: PASSES });
}

/** A formula or a definition, said with every pass and read back by the reading rules. */
export function readsBack(source: string, readings: Readings, free: Iterable<string> = []): ReadBack {
  const lowered = isDefinition(source) ? lowerDefinition(source, readings) : lower(source, readings);
  const { ir, print: printing } = optimize(lowered, PASSES, context(readings));
  const words = print(ir, readings, {}, printing);
  return { words, meanings: readBack(words, readings, free, meaning), meant: meant(defined(ir), meaning) };
}

/** A definition as the rule it states: for every value of its parameters, what it names exactly when its body holds. */
function defined(s: Sentence): Sentence {
  if (s.t !== 'define') return s;
  const body: Sentence = s.body.t === 'and' && s.body.items.length === 0 ? s.head : { t: 'iff', l: s.head, r: s.body };
  return s.params.length === 0 ? body : { t: 'quant', q: 'all', vars: s.params, body };
}
