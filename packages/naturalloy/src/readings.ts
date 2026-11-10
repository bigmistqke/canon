/**
 * The table of readings and the vocabulary it is read with: what each name of a formula stands for, and the words it
 * is said with. Shared by the verbalizer and its passes.
 */
import { type Decl, type Node, parseModule } from '@bigmistqke/parse-alloy';

/**
 * What naturalloy throws when a formula cannot be said without loss: the message names what cannot be said. Anything else
 * it throws is a fault of naturalloy, never a reason the formula has no words.
 */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

/** Whether an error is a refusal, also when it comes from another copy of naturalloy. */
export const isRefusal = (error: unknown): error is Refusal => error instanceof Error && error.name === 'Refusal';

/** An error rethrown unless it is a refusal. */
export function asRefusal(error: unknown): Refusal {
  if (!isRefusal(error)) throw error;
  return error;
}

/** How one thing is said, with `{1}`, `{2}` for the variables it is about. */
export interface Reading {
  positive: string;
  negative?: string;
  /** The verb the positive side marks between carets, which gives the reading its frame: `keeps` in `{1} ^keeps^ readings`. */
  verb?: string;
  /** Where a word in brackets that names no link of its own links to: the place that holds the line, as an href. */
  target?: string;
}

/** A predicate of the vocabulary: its parameters and its body, which says that the parameters marked `disj` are different. */
export interface Definition {
  params: string[];
  /** The signature each parameter is declared of, where its type is one: `o: Owner` and `o: one Owner` are of `Owner`. */
  types?: (string | undefined)[];
  body: Node;
}

/** A function of the vocabulary: its parameters, the type of its value, and the expression that is its value. */
export interface Function {
  params: string[];
  result: Node;
  body: Node;
}

export interface Readings {
  /** The noun for a signature: `Owner` is "owner". */
  nouns: Map<string, string>;
  /** Where a variable of the type links to where it is introduced, as an href: the place that holds a noun with a word in brackets, or the link the bracket names. */
  nounTargets: Map<string, string>;
  /** The article of a noun that was written with one, `noun Hour: an hour`: the default goes by the sound of the word, and a noun can say otherwise. */
  articles: Map<string, string>;
  /** The reading of a set, a field, a relation or a predicate, by its name. */
  atoms: Map<string, Reading>;
  /** The other forms of each verb a reading marks, by its third person: `keeps` has the infinitive `keep` and the participle `kept`. */
  verbs: Map<string, { infinitive: string; participle?: string }>;
  /**
   * The predicates of the vocabulary. A call of one that has no reading of its
   * own is said by its body, with the arguments in place of the parameters.
   */
  definitions: Map<string, Definition>;
  /** The fields the vocabulary declares, each with the signature that declares it and the type it points at: `on` is from `Cleanup` to `Owner`. */
  fields: Map<string, Field>;
  /** The fields that relate more than two things, `older: Cleanup -> Cleanup` of `Clock`: the signature that declares each and the types of its other columns. */
  relations?: Map<string, { owner: string; columns: string[] }>;
  /** The signatures the vocabulary declares `var`, whose members change from one moment to the next. */
  variables: Set<string>;
  /** The signature that holds each signature of the vocabulary: the one it is declared `in` or `extends`, or itself when it stands on its own. One declared in several has none. */
  holders: Map<string, string>;
  /** The signatures declared `in` another, which may share members with any other signature in it. */
  subsets?: Set<string>;
  /** The types of the columns of each field of more than one column, by `Sig.field`: each column a type, or the types of a union. */
  columns?: Map<string, string[][]>;
  /** The functions of the vocabulary. A call of one that has no reading of its own is said by its body. */
  functions: Map<string, Function>;
  /** The macros of the vocabulary, `let m[x] = …`, whose calls are said by their bodies. */
  macros: Map<string, Definition>;
}

/** A field of a signature, from the signature to the type it points at. Its owner is unknown when one declaration declares it for several signatures. */
export interface Field {
  owner?: string;
  type: string;
  /** Whether it can hold more than one value: declared `set` or `some`, and not `one` or `lone`. */
  many: boolean;
  /** Whether it holds exactly one value: declared `one`, or with no multiplicity. */
  exact: boolean;
}

/** The predicates of a module: `pred name[a: T, disj b, c: U] { body }`, read by the parser. A receiver's predicate is left out. */
export function parseDefinitions(vocabulary: string): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const p of parseModule(vocabulary).paragraphs) {
    if (p.t !== 'pred') continue;
    const params = paramsOf(p);
    const typed = (type: Node): string | undefined => {
      const base = type.t === 'mult' && type.q === 'one' ? type.e : type;
      return base.t === 'name' ? base.name : undefined;
    };
    definitions.set(p.name, { params: params.flatMap(d => d.names), types: params.flatMap(d => d.names.map(() => typed(d.type))), body: unqualified(withDifferences(params, p.body)) });
  }
  return definitions;
}

/** The parameters of a predicate or a function: a predicate of a signature, `pred T.p[…]`, takes `this` of that signature first. */
export function paramsOf(p: { receiver?: string; params?: Decl[] }): Decl[] {
  return [...(p.receiver === undefined ? [] : [{ names: ['this'], type: { t: 'name', name: p.receiver } } as Decl]), ...(p.params ?? [])];
}

/** The functions of a module: `fun name[a: T]: U { e }`, with `this` first for a function of a signature. */
export function parseFunctions(vocabulary: string): Map<string, Function> {
  const functions = new Map<string, Function>();
  for (const p of parseModule(vocabulary).paragraphs) if (p.t === 'fun') functions.set(p.name, { params: paramsOf(p).flatMap(d => d.names), result: unqualified(p.result), body: unqualified(p.body) });
  return functions;
}

/** The macros of a module: `let name[a, b] = …` and `let name[a, b] { … }`. */
export function parseMacros(vocabulary: string): Map<string, Definition> {
  const macros = new Map<string, Definition>();
  for (const p of parseModule(vocabulary).paragraphs) if (p.t === 'macro') macros.set(p.name, { params: p.params ?? [], body: unqualified(p.body) });
  return macros;
}

/** A body with the condition that the parameters of each declaration marked `disj` are different. */
export function withDifferences(params: Decl[], body: Node): Node {
  const different: Node[] = params
    .filter(d => d.disj || d.disjType)
    .flatMap(d => d.names.flatMap((a, i) => d.names.slice(i + 1).map((b): Node => ({ t: 'cmp', op: '!=', l: { t: 'name', name: a }, r: { t: 'name', name: b } }))));
  return different.length === 0 ? body : { t: 'and', items: [...different, ...(body.t === 'and' ? body.items : [body])] };
}

/**
 * The fields that the signatures of a module declare, with the type each
 * points at. A field of more than one column, a field defined by an
 * expression, and one that two declarations declare are left out: none has one type.
 */
export function parseFields(vocabulary: string): Map<string, Field> {
  const fields = new Map<string, Field>();
  const untyped = new Set<string>();
  for (const sig of parseModule(vocabulary).paragraphs) {
    if (sig.t !== 'sig') continue;
    for (const decl of sig.fields) {
      const type = decl.defined ? undefined : decl.type.t === 'name' ? { name: decl.type.name, q: 'one' } : decl.type.t === 'mult' && decl.type.e.t === 'name' ? { name: decl.type.e.name, q: decl.type.q } : undefined;
      for (const name of decl.names) {
        if (fields.has(name) || type === undefined) untyped.add(name);
        fields.set(name, { owner: sig.names.length === 1 ? sig.names[0] : undefined, type: type?.name ?? '', many: type?.q === 'set' || type?.q === 'some', exact: type?.q === 'one' });
      }
    }
  }
  for (const name of untyped) fields.delete(name);
  return fields;
}

/** The fields of a module whose type is an arrow of names, `older: Cleanup -> Cleanup`, with the signature that declares each and the types of the arrow. */
export function parseRelations(vocabulary: string): Map<string, { owner: string; columns: string[] }> {
  const relations = new Map<string, { owner: string; columns: string[] }>();
  const names = (type: Node): string[] | undefined => {
    if (type.t === 'name') return [type.name];
    if (type.t !== 'arrow') return undefined;
    const [l, r] = [names(type.l), names(type.r)];
    return l === undefined || r === undefined ? undefined : [...l, ...r];
  };
  for (const sig of parseModule(vocabulary).paragraphs) {
    if (sig.t !== 'sig' || sig.names.length !== 1) continue;
    for (const decl of sig.fields) {
      const columns = decl.defined || decl.type.t !== 'arrow' ? undefined : names(decl.type);
      // A reading of `Sig.rel` takes the types of its columns from `columns`, which keys them by the signature too.
      if (columns !== undefined) for (const name of decl.names) relations.set(name, { owner: sig.names[0] as string, columns });
    }
  }
  return relations;
}

/** The signatures a module declares `var`. */
export function parseVariables(vocabulary: string): Set<string> {
  return new Set(parseModule(vocabulary).paragraphs.flatMap(p => (p.t === 'sig' && p.var ? p.names : [])));
}

/** The signature that holds each signature of a module: `Emitting` in `var sig Emitting in Edge` is held by `Edge`, and `Edge` in `sig Edge {}` by itself. */
export function parseHolders(vocabulary: string): Map<string, string> {
  const holders = new Map<string, string>();
  for (const p of parseModule(vocabulary).paragraphs) {
    if (p.t !== 'sig') continue;
    const holder = p.parent === undefined ? undefined : p.parent.kind !== '=' && p.parent.names.length === 1 ? p.parent.names[0] : null;
    if (holder === null) continue;
    for (const name of p.names) holders.set(name, holder ?? name);
  }
  return holders;
}

/** The signatures a module declares `in` another. */
export function parseSubsets(vocabulary: string): Set<string> {
  return new Set(parseModule(vocabulary).paragraphs.flatMap(p => (p.t === 'sig' && p.parent?.kind === 'in' ? p.names : [])));
}

/** The types of the columns of each field of a signature, by `Sig.field`, where each column is a name or a union of names. */
export function parseColumns(vocabulary: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  const union = (n: Node): string[] | undefined => (n.t === 'name' ? [n.name] : n.t === 'union' ? [...(union(n.l) ?? []), ...(union(n.r) ?? [])] : undefined);
  const columns = (n: Node): string[][] | undefined => {
    if (n.t === 'arrow') {
      const [l, r] = [columns(n.l), columns(n.r)];
      return l === undefined || r === undefined ? undefined : [...l, ...r];
    }
    const u = n.t === 'mult' ? union(n.e) : union(n);
    return u === undefined ? undefined : [u];
  };
  for (const sig of parseModule(vocabulary).paragraphs) {
    if (sig.t !== 'sig') continue;
    for (const decl of sig.fields) {
      const c = decl.defined ? undefined : columns(decl.type);
      if (c !== undefined) for (const owner of sig.names) for (const name of decl.names) out.set(`${owner}.${name}`, c);
    }
  }
  return out;
}

/**
 * The readings with what a module declares: its predicates, so that one with
 * no reading of its own can be said by its body, its fields and its `var`
 * signatures, and the signature that holds each signature. Throws an AlloyParseError when the vocabulary is not Alloy.
 */
export const withDefinitions = (readings: Readings, vocabulary: string): Readings => ({
  ...readings,
  definitions: parseDefinitions(vocabulary),
  fields: parseFields(vocabulary),
  relations: parseRelations(vocabulary),
  variables: parseVariables(vocabulary),
  holders: parseHolders(vocabulary),
  subsets: parseSubsets(vocabulary),
  columns: parseColumns(vocabulary),
  functions: parseFunctions(vocabulary),
  macros: parseMacros(vocabulary)
});

/**
 * Read a table of readings, held at `target`, an href. A word in brackets names
 * a term and links to `target`, `[freelancing]`, or to the href it names,
 * `[checker](#term-checker)`. A line is `noun Name: words`, which
 * may start with the article the noun takes (`noun Hour: an hour`), or
 * `key: positive | negative` for an atom, whose key is the name of a set
 * (`Ran`), a field (`on`), a relation (`Clock.older`), a primed set (`Throwing'`)
 * or a predicate (`dispose`). Blank lines and lines that start with `#` are skipped.
 * A table held in another document has `base`, the path to that document: a
 * link in it to an anchor of its own document, `(#term-checker)`, goes through the path.
 */
export function parseReadings(text: string, target?: string, base?: string): Readings {
  const readings: Readings = { nouns: new Map([['Int', 'integer'], ['seq/Int', 'sequence index']]), nounTargets: new Map(), articles: new Map(), atoms: new Map(), verbs: new Map(), definitions: new Map(), fields: new Map(), variables: new Set(), holders: new Map(), functions: new Map(), macros: new Map() };
  const lines = text.split('\n').map(raw => (base === undefined ? raw : raw.replace(/\]\(#([^)\s]+)\)/g, `](${base}#$1)`)).trim());
  // The verb lines first, so that a reading above its verb's line takes the verb's forms too.
  for (const line of lines) {
    const verb = /^verb\s+(\S+)\s*:\s*(.+)$/.exec(line);
    if (!verb) continue;
    const [infinitive, participle] = (verb[2] as string).split(',').map(form => form.trim());
    if (!infinitive) throw new Refusal(`a verb line gives no infinitive: ${line}`);
    readings.verbs.set(verb[1] as string, participle ? { infinitive, participle } : { infinitive });
  }
  for (const line of lines) {
    if (line === '' || line.startsWith('#') || /^verb\s/.test(line)) continue;
    const noun = /^noun\s+(\w+)\s*:\s*(.+)$/.exec(line);
    if (noun) {
      const written = /^(an?)\s+(.+)$/.exec((noun[2] as string).trim());
      readings.nouns.set(noun[1] as string, written ? (written[2] as string) : (noun[2] as string).trim());
      if (written) readings.articles.set(noun[1] as string, written[1] as string);
      // The variables of the type link to its term only where the author marked the noun.
      const marked = /\[([^\]]+)\](?:\(([^)\s]*#[^)\s]+)\))?/.exec(noun[2] as string);
      const to = marked === null ? undefined : (marked[2] ?? target);
      if (to !== undefined) readings.nounTargets.set(noun[1] as string, to);
      balanced(line);
      continue;
    }
    const atom = /^([\w.'/]+)\s*:\s*(.+)$/.exec(line);
    if (!atom) throw new Refusal(`cannot read the line of readings: ${line}`);
    const [marked, written] = (atom[2] as string).split('|').map(part => part.trim());
    const verb = /\^([^^]+)\^/.exec(marked as string);
    const positive = (marked as string).replace(/\^([^^]+)\^/g, '$1');
    const negative = written !== undefined && written !== '' ? written.replace(/\^([^^]+)\^/g, '$1') : verb === null ? undefined : framedNegative(marked as string, verb[1] as string, readings.verbs, line);
    readings.atoms.set(atom[1] as string, { positive, ...(negative === undefined ? {} : { negative }), ...(verb === null ? {} : { verb: unbracketed(verb[1] as string) }), target });
    balanced(line);
  }
  return readings;
}

/**
 * The negative of a reading that marks its verb and writes none: its positive with "not" at the verb. "is" and "are"
 * take "not" after them; any other verb takes "does not" and its infinitive, which a verb line gives, keeping a link
 * the verb has. A verb with no infinitive refuses the line.
 */
function framedNegative(marked: string, verb: string, verbs: Readings['verbs'], line: string): string {
  const word = unbracketed(verb);
  let negated: string;
  if (word === 'is' || word === 'are') negated = `${verb} not`;
  else {
    const forms = verbs.get(word);
    if (forms === undefined) throw new Refusal(`no verb line gives the infinitive of "${word}", so the line has no negative: ${line}`);
    negated = `does not ${verb.replace(word, forms.infinitive)}`;
  }
  return marked.replace(`^${verb}^`, negated).replace(/\^([^^]+)\^/g, '$1');
}

/** Marks a word that names a term, and so links: the mark, the href, the mark, the word, the mark. */
export const LINK = '\u0002';
export const LINK_MARK = /\u0002([^\u0002]*)\u0002([^\u0002]*)\u0002/g;

/** A word in brackets, with the href it links to when it names one. */
export const BRACKETED = /\[([^\]]+)\](?:\(([^)\s]*#[^)\s]+)\))?/g;

/** Words of a reading or a noun without the brackets and the links of their terms: `[checker](#term-checker)` is "checker". */
export const unbracketed = (words: string): string => words.replace(BRACKETED, (_, word: string) => word);

export function balanced(line: string): void {
  if (/[[\]]/.test(line.replace(BRACKETED, ''))) throw new Refusal(`a bracket in the line of readings has no partner: ${line}`);
}

/** The words of a reading, where each word in brackets is marked as the name of a term: it links to the href it names, or else to the place that holds the reading. */
export function mark(words: string, target: string | undefined): string {
  return words.replace(BRACKETED, (_, word: string, href: string | undefined) => {
    const to = href ?? target;
    return to === undefined ? word : `${LINK}${to}${LINK}${word}${LINK}`;
  });
}

/** The words without the marks of their links. */
export const plain = (words: string): string => words.replace(LINK_MARK, (_, __, word: string) => word);

/** Whether a word may name the target of its link as a term mark, `*word*`, instead of the link. */
export type Marked = (target: string, word: string) => boolean;

/**
 * Resolve the marks of links, in the order a reader meets them. Only the first
 * mention of a term is a link, and nothing links to `self`, the href of the
 * place the words are for; the text layout has no links.
 */
export function resolveLinks(text: string, links: boolean, self: string | undefined): string {
  const seen = new Set<string>(self === undefined ? [] : [self]);
  return text.replace(LINK_MARK, (_, target: string, word: string) => {
    if (!links || seen.has(target)) return word;
    seen.add(target);
    return `[${word}](${target})`;
  });
}

/**
 * Each link of finished words that `marked` allows, as a term mark: `[run](#term-run)` is `[*run*](#term-run)`. It reads the words
 * as the reader gets them, after the numbers of variables are settled, so that a mark spells what the reader reads.
 */
export const markTerms = (text: string, marked: Marked): string =>
  text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (link: string, word: string, target: string) => (marked(target, word) ? `[*${word}*](${target})` : link));

/** A formula with the names of this module as plain names: `this/Ran` and `@Ran` are `Ran`, and `fun/min`, `fun/max` and `fun/next` are `min`, `max` and `next`. */
export function unqualified(node: Node): Node {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk);
    if (n === null || typeof n !== 'object') return n;
    const o = { ...(n as Record<string, unknown>) };
    if ((o.t === 'name' || o.t === 'call') && typeof o.name === 'string') o.name = o.name.replace(/^@/, '').replace(/^this\//, '').replace(/^fun\/(min|max|next)$/, '$1');
    for (const [key, value] of Object.entries(o)) if (key !== 'span' && key !== 'name') o[key] = walk(value);
    return o;
  };
  return walk(node) as Node;
}
