/*
 * kinds.ts — the unit kinds: the ruleset the checker enforces, driven by the
 * id prefix, and the table that states it for a reader.
 */
import { beginMarker } from "./regions.ts";

// ---------------------------------------------------------------------------
// The ruleset is driven entirely by the id prefix.
// ---------------------------------------------------------------------------

/**
 * A unit's kind, which is exactly its id prefix. Writing it as a union rather
 * than as `string` is most of the point of this file being typed: a prefix added
 * to `OWES` without a matching entry here, or cited by a name that is not one of
 * these, stops compiling instead of silently matching nothing.
 */
export type Kind = 'axiom-' | 'fact-' | 'spec-' | 'exception-' | 'bug-' | 'conflict-' | 'thread-' | 'term-';

/**
 * kind → what a reader reaches for it for. Generated into `writing-units.md` beside
 * `OWES`, so the table there is this table and cannot drift from it.
 */
export const MEANS: Record<Kind, string> = {
  'axiom-':
    'a value: how the project wants the world of the people using it to be — never a decision about how to build it',
  'fact-':
    'how the platform the project is built on is, whatever the project does',
  'spec-':
    'what the system does, stated so a test could contradict it, and optionally the place in the code that does it',
  'exception-': 'where a fact keeps a spec from holding fully',
  'bug-':
    'where the code breaks the spec it sits in: a known defect, with an issue and a test that fails until it is fixed',
  'conflict-':
    'where units of the canon cannot all hold: a known contradiction, with an issue, that waits for the owner of the design to rule which unit holds',
  'thread-':
    'a question the canon does not decide yet, which the owner of the design has parked: a thought outside the derivation graph, kept so that it is not lost',
  'term-':
    'a word of the project\'s language: what the thing it names is — never what it does'
};

/**
 * kind → what it must cite, as groups: at least one kind from every group.
 * `null` means it owes nothing. An exception owes two things at once, the spec
 * it narrows and the fact that forces it, which one list of alternatives could
 * not say.
 */
export const OWES: Record<Kind, Kind[][] | null> = {
  'axiom-': null, // primitive by kind — owes nothing
  'fact-': null, // imposed by the platform — owes nothing
  'spec-': [['axiom-', 'spec-']],
  'exception-': [['spec-'], ['fact-']],
  'bug-': [['spec-']],
  'conflict-': null, // names the units it sets against each other on its "Between:" line, which is no citation
  'thread-': null, // an open question follows from nothing
  'term-': null // a definition, outside the derivation graph — owes nothing
};

/**
 * kind → the kinds it may cite without owing them. An axiom owes nothing, so a
 * root axiom stands alone, but it may narrow a more general axiom by sitting
 * inside it or naming it on its "Derives from:" line. A spec names the facts
 * it relies on the same way.
 */
export const MAY_CITE: Partial<Record<Kind, Kind[]>> = {
  'axiom-': ['axiom-'],
  'spec-': ['fact-'],
  // A term may sit in a more general term, which it narrows: an installed plugin is a kind of plugin.
  'term-': ['term-']
};

/** kind → every kind it may cite, owed or not. */
export const citable = (kind: Kind): Kind[] => [
  ...(OWES[kind] ?? []).flat(),
  ...(MAY_CITE[kind] ?? [])
];

/** The kinds that make a claim a test can contradict, and so owe a test. */
export const CLAIMS: Kind[] = ['spec-', 'exception-', 'bug-'];

/**
 * The kinds that refine the spec they sit in. A bug only marks where the code
 * breaks its spec, so a spec holding bugs alone stays a leaf.
 */
export const REFINES: Kind[] = ['spec-', 'exception-'];

export const PREFIXES = Object.keys(OWES) as Kind[];
export const kindOf = (id: string): Kind | undefined =>
  PREFIXES.find(p => id.startsWith(p));

/** `'spec-'` → `'spec'`, for prose. */
export const noun = (kind: Kind): string => kind.slice(0, -1);

/** `'exception-'` → `'an exception'`, for prose. */
export const aNoun = (kind: Kind): string =>
  `${/^[aeiou]/.test(noun(kind)) ? 'an' : 'a'} ${noun(kind)}`;

export const KINDS_BEGIN = beginMarker('kinds');
export const KINDS_END = '<!-- kinds:end -->';

/**
 * The unit kinds, as a table, from `MEANS` and `OWES`.
 *
 * Generated rather than written because it is the checker's own ruleset stated
 * for a reader: a kind added to `OWES` without a row here would be a second
 * place for the hierarchy to be wrong, which is the failure this whole protocol
 * is about.
 */
export function kindsTable(): string {
  const tag = (k: Kind): string => `\`@${noun(k)}\``;
  const rows = PREFIXES.map(k => {
    const owes = OWES[k];
    const may = (MAY_CITE[k] ?? []).map(tag).join(' or ');
    const owed =
      owes === null
        ? `nothing${may ? ` — may narrow ${may}` : ''}`
        : owes.map(group => group.map(tag).join(' or ')).join(' and ') +
          (may ? ` — may cite ${may}` : '');
    return `| ${tag(k)} | ${MEANS[k]} | ${owed} |`;
  });
  return ['| tag | what it is | cites |', '| --- | --- | --- |', ...rows].join(
    '\n'
  );
}
