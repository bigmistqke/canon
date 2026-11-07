import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { javaOptions } from './jobs.ts';
import { attempt, failed, type Analyzer, type Failure, type Program, type Ran } from './run.ts';

/**
 * The folder of the kept answers: none when `CANON_ALLOY_CACHE` is `0`;
 * otherwise the folder the project sets, else the one `CANON_ALLOY_CACHE_DIR`
 * names, else the caller's default; none when nothing names one.
 *
 * @canon spec-the-folder-of-the-kept-answers-is-the-first-one-named
 */
export function cacheFolder({ set, fallback }: { set?: string; fallback?: string } = {}, env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.CANON_ALLOY_CACHE === '0') return undefined;
  return set ?? (env.CANON_ALLOY_CACHE_DIR ? resolve(env.CANON_ALLOY_CACHE_DIR) : undefined) ?? fallback;
}

/** The major version of each Java, by its path, as it says it with `-version`; none when it does not say. */
const majors = new Map<string, number | undefined>();

function javaMajor(java: string): number | undefined {
  if (!majors.has(java)) {
    const said = spawnSync(java, ['-version'], { encoding: 'utf8' });
    // `openjdk version "21.0.2"`, or `java version "1.8.0_391"` before Java 9.
    const m = /version "(\d+)(?:\.(\d+))?/.exec(`${said.stderr ?? ''}${said.stdout ?? ''}`);
    majors.set(java, m === null ? undefined : Number(m[1] === '1' ? m[2] : m[1]));
  }
  return majors.get(java);
}

/** The hash of each jar's content, by its path, with the size and the time of change it was read at. */
const jars = new Map<string, { stamp: string; hash: string }>();

function jarHash(jar: string): string | undefined {
  try {
    const { size, mtimeMs } = statSync(jar);
    const stamp = `${size}:${mtimeMs}`;
    const known = jars.get(jar);
    if (known?.stamp === stamp) return known.hash;
    const hash = createHash('sha256').update(readFileSync(jar)).digest('hex');
    jars.set(jar, { stamp, hash });
    return hash;
  } catch {
    return undefined;
  }
}

/**
 * Which answers run-alloy keeps. It is part of every key, so that a change to
 * it leaves the answers kept before unread.
 *
 * @canon spec-an-answer-kept-under-an-earlier-rule-is-not-read
 */
const RULE = 'kept only when the process exited with code 0';

/**
 * The key of a program's answer: the program, with the files beside it; the
 * content of the analyzer's jar; the options of Java and of the analyzer, and
 * the form in which the caller reads the answer; and the major version of Java.
 * Nothing else decides the answer. None when the jar cannot be read or the Java
 * does not say its version: such a program keeps no answer.
 *
 * @canon spec-a-program-asked-of-the-same-analyzer-keeps-its-earlier-answer
 */
export function keyOf(analyzer: Analyzer, program: Program, args: readonly string[], form: string): string | undefined {
  const hash = jarHash(analyzer.jar);
  const major = javaMajor(analyzer.java);
  if (hash === undefined || major === undefined) return undefined;
  const beside = Object.entries(program.beside ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256')
    .update(JSON.stringify({ program: program.text, path: program.path ?? 'model.als', beside, jar: hash, options: [...javaOptions(), ...args], form, java: major, rule: RULE }))
    .digest('hex');
}

/** How long a kept answer that no run uses stays: thirty days. */
const KEPT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** The folders this process swept already, by their absolute path. */
const swept = new Set<string>();

/** Forget the folders this process swept, so that the next sweep of each reads it again. Only tests call it. */
export function forgetSweeps(): void {
  swept.clear();
}

/**
 * Remove each kept answer of `folder` that no run used in the time a kept
 * answer stays. A file's time of change is the last time a run used it. A
 * folder is swept once in a process: a later sweep of it does nothing.
 *
 * @canon spec-the-kept-answers-are-only-those-used-in-the-last-thirty-days
 * @canon spec-a-folder-of-kept-answers-is-swept-once-in-a-process
 */
export function sweep(folder: string, now = Date.now()): void {
  const path = resolve(folder);
  if (swept.has(path)) return;
  swept.add(path);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json/.test(name)) continue;
    const file = join(folder, name);
    try {
      if (now - statSync(file).mtimeMs > KEPT_FOR_MS) rmSync(file, { force: true });
    } catch {
      // Another run removed it first.
    }
  }
}

/**
 * The answer kept under `key` in `folder`, or none when there is none or it
 * cannot be read. One that is read counts as used now.
 *
 * @canon spec-a-kept-answer-that-a-run-uses-is-kept-for-thirty-more-days
 */
export function readKept<T>(folder: string, key: string): T | undefined {
  const file = join(folder, `${key}.json`);
  let kept: { answer: T };
  try {
    kept = JSON.parse(readFileSync(file, 'utf8')) as { answer: T };
  } catch {
    return undefined;
  }
  try {
    const now = new Date();
    utimesSync(file, now, now);
  } catch {
    // A folder that cannot be written still answers; its answers only age.
  }
  return kept.answer;
}

/**
 * Keep an answer under `key` in `folder`. Several processes may write at once,
 * so each writes a file of its own and moves it in place. A folder that cannot
 * be written only costs time.
 */
export function keep<T>(folder: string, key: string, answer: T): void {
  const file = join(folder, `${key}.json`);
  const part = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(part, JSON.stringify({ answer }));
    renameSync(part, file);
  } catch {
    rmSync(part, { force: true });
  }
}

/**
 * The answer to a program: the one kept for it in `folder`, or else what `read`
 * makes of the analyzer's process, which is then kept. `form` names what `read`
 * makes of a process, so that two callers that read the same program in two
 * ways keep two answers. A failure is never kept: it says nothing about the
 * program. Nor is the answer of a process that exited with another code than 0,
 * which the caller still gets. With no folder, nothing is kept or read.
 *
 * @canon spec-an-unchanged-program-is-answered-without-the-analyzer
 */
export async function ask<T>(analyzer: Analyzer, program: Program, args: readonly string[], read: (ran: Ran) => T | Failure, { folder, form }: { folder?: string; form: string }): Promise<T | Failure> {
  const key = folder === undefined ? undefined : keyOf(analyzer, program, args, form);
  if (key !== undefined) {
    const kept = readKept<T>(folder as string, key);
    if (kept !== undefined) return kept;
  }
  const { answer, solved } = await attempt(analyzer, program, args, read);
  if (key !== undefined && solved && !failed(answer)) keep(folder as string, key, answer);
  return answer;
}
