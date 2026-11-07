/**
 * What the tests of the Alloy backend share: the lifetimes example, and the way
 * to ask the analyzer which spec alone keeps something from happening. This
 * file tests the checker's own tooling, so it carries no `@canon` tag.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { cacheFolder } from '@bigmistqke/run-alloy';
import { checkAlloy } from './alloy.ts';

/**
 * The folder of kept answers for the tests that ask the analyzer in this
 * process: the one CANON_ALLOY_CACHE_DIR names, or else `.cache/canon-alloy` of
 * this package, as for the tests of naturalloy and parse-alloy.
 */
export const CACHE = cacheFolder({ fallback: fileURLToPath(new URL('../.cache/canon-alloy', import.meta.url)) });

export const LIFETIMES = readFileSync(new URL('../fixtures/lifetimes/CANON.md', import.meta.url), 'utf8');

export const REPORTED_STEM = 'a-throwing-owner-cleanup-is-reported';
export const REPORTED = `spec-${REPORTED_STEM}`;

/** The document with a scenario added to the unit with this stem; a scenario may sit on any unit. */
export const withScenario = (src: string, stem: string, scenario: string): string =>
  src.replace(`### @spec ${stem}\n`, `### @spec ${stem}\n\n\`\`\`alloy scenario\n${scenario}\n\`\`\`\n`);

/** What a failing cleanup of a disposed owner does, written as a scenario: it runs while its owner is disposed, and then `after` happens. */
export const failing = (after: string): string =>
  `some o, h: Owner, c: Failing | o.handler = h and eventually (dispose[o] and c.on = o and eventually (runNow[c] and ${after}))`;

/** The entry of the answer for a spec that alone keeps something out. */
export const alone = (stem: string): [string, string[]] => [`spec-${stem}`, [`spec-${stem}`]];

// One scenario on each of several units, so that one run of the analyzer answers for all of them, and the unit that holds a scenario says which it was.
// Each scenario says which unit is expected to keep it out, and the analyzer is asked about leaving out that one alone: if the scenario can happen without it,
// nothing else was keeping it out, and each question costs one run instead of one for every unit.
export const answers = async (scenarios: [stem: string, scenario: string, keeper?: string][]): Promise<unknown> => {
  // None of the scenarios takes more than five events, and fewer steps make the analyzer prove that something cannot happen much sooner.
  const shorter = LIFETIMES.replace('for 3 but 1..8 steps', 'for 3 but 1..6 steps');
  const leave = Object.fromEntries(scenarios.map(([stem, , keeper]) => [`spec-${stem}`, [`spec-${keeper ?? stem}`]]));
  const result = await checkAlloy(scenarios.reduce((src, [stem, scenario]) => withScenario(src, stem, scenario), shorter), { leave, cache: CACHE });
  expect(result).toMatchObject({ ok: false });
  return 'failures' in result && Object.fromEntries(result.failures.map(f => [f.unit, f.conflict]));
};
