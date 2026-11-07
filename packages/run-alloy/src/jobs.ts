import { availableParallelism, totalmem } from 'node:os';

/** The largest heap of each analyzer process, in gigabytes, when `CANON_ALLOY_HEAP` sets none. */
export const HEAP_GB = 1;

/**
 * The largest heap of each analyzer process, as Java writes it, and in bytes:
 * the size `CANON_ALLOY_HEAP` holds, such as `2g` or `512m`, or else a gigabyte.
 *
 * @canon spec-canon-alloy-heap-sets-the-heap-of-each-process
 */
export function heap(env: Record<string, string | undefined> = process.env): { option: string; bytes: number } {
  const m = /^\s*(\d+)\s*([gGmM])\s*$/.exec(env.CANON_ALLOY_HEAP ?? '');
  const size = m === null ? 0 : Number(m[1]);
  if (m === null || size < 1) return { option: `${HEAP_GB}g`, bytes: HEAP_GB * 2 ** 30 };
  const unit = (m[2] as string).toLowerCase();
  return { option: `${size}${unit}`, bytes: size * (unit === 'g' ? 2 ** 30 : 2 ** 20) };
}

/**
 * The options of Java for each analyzer process. One collector thread: several
 * processes run at once, and a collector with a thread for every core makes them
 * wait for each other. A heap with a limit, so that the processes that memory
 * holds can be counted.
 *
 * @canon spec-each-analyzer-process-takes-a-heap-of-at-most-one-gigabyte
 */
export function javaOptions(env: Record<string, string | undefined> = process.env): string[] {
  return ['-XX:+UseSerialGC', `-Xmx${heap(env).option}`];
}

/** What a machine has for the analyzer: its processors, and its memory in bytes. */
export interface Machine {
  processors: number;
  memory: number;
}

/**
 * How many analyzer processes run at once: `CANON_ALLOY_JOBS` when it holds a
 * number above zero; otherwise no more than the machine has processors, no more
 * than half of its memory holds at the largest heap of each, the one
 * `CANON_ALLOY_HEAP` sets or else a gigabyte, and at least one.
 *
 * @canon spec-the-analyzer-runs-no-more-processes-at-once-than-the-machine-holds
 */
export function jobs(env: Record<string, string | undefined> = process.env, machine: Machine = { processors: availableParallelism(), memory: totalmem() }): number {
  const asked = Math.floor(Number(env.CANON_ALLOY_JOBS));
  if (asked >= 1) return asked;
  return Math.max(1, Math.min(machine.processors, Math.floor(machine.memory / 2 / heap(env).bytes)));
}

/** The processes of this Node process that run now, and the callers that wait for one to end. */
let running = 0;
const waiting: (() => void)[] = [];

/**
 * Wait for a place among the processes that run at once, and give a function
 * that gives it back. The number is read again at each start, so that a change
 * to `CANON_ALLOY_JOBS` holds from the next process on.
 */
export async function slot(): Promise<() => void> {
  while (running >= jobs()) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  let given = false;
  return () => {
    if (given) return;
    given = true;
    running--;
    waiting.shift()?.();
  };
}
