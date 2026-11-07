/**
 * The Alloy analyzer run from Node: each program in a process of its own, as
 * many at once as the machine holds, and each answer kept for the next run.
 */
export { HEAP_GB, heap, javaOptions, jobs, type Machine } from './jobs.ts';
export { analyzerOf, attempt, failed, run, type Analyzer, type Attempt, type Failure, type Program, type Ran } from './run.ts';
export { ask, cacheFolder, keep, keyOf, readKept, sweep } from './cache.ts';
