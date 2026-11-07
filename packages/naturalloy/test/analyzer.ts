/**
 * The Alloy analyzer, asked many checks at once, through run-alloy. The tests need its jar: set CANON_ALLOY_JAR, and
 * CANON_JAVA when `java` is older than 17. A verdict is kept by the module of its one check, so a run after a change
 * asks the analyzer only what changed: in the folder CANON_ALLOY_CACHE_DIR names, or else in `.cache/canon-alloy` of
 * this package. CANON_ALLOY_CACHE=0 asks it everything.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzerOf, attempt, cacheFolder, failed, keep, keyOf, readKept, sweep } from '@bigmistqke/run-alloy';

const ANALYZER = analyzerOf();
export const JAR = ANALYZER?.jar;

/** The analyzer's options: check every command, and print each verdict. */
const ARGS = ['exec', '-f', '-c', '*'];

/** The name under which a verdict is kept: what this harness reads of a process. */
const FORM = 'naturalloy verdict';

const FOLDER = cacheFolder({ fallback: join(dirname(fileURLToPath(import.meta.url)), '../.cache/canon-alloy') });

/** The analyzer on one module: what it prints, or what went wrong; and whether it exited with code 0, as it does only when it solved every check. */
async function analyze(module: string): Promise<{ out: string; solved: boolean }> {
  const { answer, solved } = await attempt(ANALYZER!, { text: module }, ARGS, ran => ran.output);
  return failed(answer) ? { out: answer.error, solved: false } : { out: answer, solved };
}

/**
 * Each check with the analyzer's verdict: `UNSAT` when no counterexample exists, `SAT` when one does, or what went
 * wrong. `module` writes the module for a batch of claims, each as `check check_<i> { … }`. A batch that does not
 * compile is asked again one check at a time, so that one the analyzer rejects names itself. A verdict is kept under
 * the module of its one check, which holds the claim and its declarations: a batch answers each of its checks as that
 * module would.
 */
export async function verdicts<T>(given: T[], module: (batch: T[]) => string, size = 40): Promise<{ item: T; verdict: string }[]> {
  const analyzer = ANALYZER!;
  const keys = new Map(given.map(item => [item, FOLDER === undefined ? undefined : keyOf(analyzer, { text: module([item]) }, ARGS, FORM)]));
  const results: { item: T; verdict: string }[] = [];
  const all: T[] = [];
  for (const item of given) {
    const key = keys.get(item);
    const verdict = key === undefined ? undefined : readKept<string>(FOLDER as string, key);
    if (verdict === undefined) all.push(item);
    else results.push({ item, verdict });
  }
  const answer = (item: T, verdict: string, solved: boolean): void => {
    results.push({ item, verdict });
    const key = keys.get(item);
    // Only a verdict of a process that solved every check is kept: what went wrong is asked again.
    if (key !== undefined && solved && (verdict === 'UNSAT' || verdict === 'SAT')) keep(FOLDER as string, key, verdict);
  };
  const ask = async (batch: T[]): Promise<void> => {
    const { out, solved } = await analyze(module(batch));
    const lines = [...out.matchAll(/^\d+\. check check_(\d+)\s.*?\s(UNSAT|SAT)\s*$/gm)];
    if (lines.length === batch.length) {
      for (const [, i, verdict] of lines) answer(batch[Number(i)] as T, verdict as string, solved);
    } else if (batch.length > 1) {
      await Promise.all(batch.map(item => ask([item])));
    } else answer(batch[0] as T, out.trim().split('\n').slice(0, 4).join(' '), solved);
  };
  const batches: T[][] = [];
  for (let i = 0; i < all.length; i += size) batches.push(all.slice(i, i + size));
  // run-alloy starts no more processes at once than the machine holds.
  await Promise.all(batches.map(ask));
  if (FOLDER !== undefined) sweep(FOLDER);
  return results;
}
