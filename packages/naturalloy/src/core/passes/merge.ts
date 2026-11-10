/** A "for every" right inside another is one "for every" with it: for every x, for every y, is for every x and every y. */
import type { Sentence } from '../ir.ts';
import { everywhere } from '../pass.ts';

export const forEveryTogether = everywhere('for-every-together', 'spec-a-for-every-right-inside-a-for-every-is-one-for-every', s =>
  s.t === 'quant' && s.q === 'all' && s.body.t === 'quant' && s.body.q === 'all' ? { t: 'quant', q: 'all', vars: [...s.vars, ...s.body.vars], body: s.body.body } : undefined
);

/**
 * The sentence as text in which each variable it declares is named by the order it declares them in, so that two
 * copies of one sentence lowered apart read the same. A variable it does not declare keeps its own name.
 */
function shape(s: Sentence): string {
  const named = new Map<string, string>();
  const declare = (v: unknown): void => {
    const id = (v as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && !named.has(id)) named.set(id, `#${named.size}`);
  };
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x === null || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    for (const key of ['vars', 'params']) if (Array.isArray(o[key])) (o[key] as unknown[]).forEach(declare);
    if (o.t === 'np' || o.t === 'sumOf') declare(o.v);
    if (o.t === 'reach') [o.p, o.q].forEach(declare);
    if (o.t === 'pair') [o.a, o.b].forEach(declare);
    Object.values(o).forEach(walk);
  };
  walk(s);
  return JSON.stringify(s, (key, value: unknown) => (key === 'id' && typeof value === 'string' ? (named.get(value) ?? value) : value));
}

/** The same sentence, part for part, whatever names the variables it declares have. */
const same = (a: Sentence, b: Sentence): boolean => shape(a) === shape(b);
const compound = (s: Sentence): boolean => s.t === 'and' || s.t === 'or';

/**
 * Two rules of one "all of these hold", each with no "otherwise" and the first side of each the second side of the
 * other, said as one equivalence of those sides, where the first of the two stood. A run of clauses is the second side.
 */
export const rulesAsEquivalence = everywhere('rules-as-equivalence', 'spec-two-rules-that-go-each-way-are-said-as-one-equivalence', s => {
  if (s.t !== 'and') return undefined;
  const items = [...s.items];
  let changed = false;
  for (let i = 0; i < items.length; i++) {
    const a = items[i] as Sentence;
    if (a.t !== 'rule' || a.otherwise !== undefined) continue;
    const j = items.findIndex((b, k) => k > i && b.t === 'rule' && b.otherwise === undefined && same(b.when, a.then) && same(b.then, a.when));
    if (j === -1) continue;
    const [l, r] = compound(a.then) && !compound(a.when) ? [a.when, a.then] : [a.then, a.when];
    items[i] = { t: 'iff', l, r };
    items.splice(j, 1);
    changed = true;
  }
  if (!changed) return undefined;
  return items.length === 1 ? (items[0] as Sentence) : { ...s, items };
});
