/**
 * `canon alloy:logic`: the logic layer of the documents, checked. A document with
 * fenced blocks of a language is handed to that language's backend, and what
 * the backend finds is reported in the units' own words.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { alloyProgram, checkAlloy, predicateName, type AlloyOptions } from './alloy.ts';
import { contextOf } from '@bigmistqke/canon/extends';
import { checkIntents, printIntents, readStdin, writeIntent } from './intent.ts';
import { checkMaps, reviewMaps } from './map.ts';
import { listReadings, rewordReading } from './readings.ts';
import type { Plugin } from '@bigmistqke/canon/plugin';
import * as statements from './statements.ts';
import type { Context } from './statements.ts';
import type { Readings } from '@bigmistqke/naturalloy';
import { checkLoneFormulas, checkWords } from './words.ts';
import { sayWorld } from './world.ts';

/** The documents a document extends, nearest first, each with its path from the folder of the document. */
function contextFor(file: string, root: string): Context[] {
  return contextOf(file, root).map(other => ({ path: relative(dirname(file), other).split('\\').join('/'), src: readFileSync(other, 'utf8') }));
}

/** The readings of a document, or none when it keeps none or they cannot be read: a world is then said in Alloy. */
function readingsFor(src: string, context: Context[]): Readings | undefined {
  try {
    return statements.readingsOf(src, context);
  } catch {
    return undefined;
  }
}

/**
 * Check each document's maps and alloy blocks, and print the world of each
 * scenario that `show` names by the id of its statement; the exit code: 0 when
 * the maps are current and every scenario can happen, 1 when not, 2 when a
 * check could not run or `show` names no scenario that it checks.
 */
export async function logic(documents: string[], root: string, options: AlloyOptions, show: string[] = []): Promise<number> {
  const read = documents.map(doc => {
    const file = resolve(root, doc);
    if (!existsSync(file)) return { doc, file };
    const src = readFileSync(file, 'utf8');
    const program = alloyProgram(src);
    // A document with no unit of its own to hold is not checked here.
    return { doc, file, src, checked: program.units.length > 0, scenarios: program.scenarios.map(s => s.name) };
  });
  const scenarios = new Set(read.flatMap(d => (d.checked ? d.scenarios : [])));
  const unknown = show.filter(id => !scenarios.has(predicateName(id)));
  if (unknown.length > 0) {
    for (const id of unknown) console.error(`canon: --show names no scenario that logic checks in the documents: ${id}`);
    return 2;
  }
  const ids = new Map(show.map(id => [predicateName(id), id]));
  let code = 0;
  let checked = 0;
  for (const { doc, file, src, checked: holds } of read) {
    if (src === undefined) {
      console.error(`canon: no such document "${doc}"`);
      return 2;
    }
    const context = contextFor(file, root);
    if (!holds) continue;
    checked++;
    // The maps are read before the solver runs: they need no Java, and a stale one says the predicate is not what the prose says.
    const maps = checkMaps(src);
    if (maps.length > 0) code = 1;
    for (const finding of maps) console.log(`${doc}: ${finding.unit}: ${finding.kind}: ${finding.message}`);
    const result = await checkAlloy(src, { ...options, context: context.map(c => c.src), show: [...ids.keys()] });
    if ('error' in result) {
      console.error(`canon: ${doc}: the Alloy analyzer did not run\n${result.error}`);
      return 2;
    }
    const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
    console.log(`${doc}: ${count(result.units.length, 'unit')}, ${count(result.scenarios, 'scenario')}`);
    for (const failure of result.ok ? [] : result.failures) {
      code = 1;
      console.log(
        failure.unit === undefined
          ? '  the units contradict each other in every trace within the bounds'
          : `  the scenario of ${failure.unit} cannot happen while every unit holds`
      );
      if (failure.unit !== undefined) {
        console.log(`    one of these has to change: ${failure.conflict.join(', ') || 'no single unit (several together)'}`);
      } else {
        console.log(`    these units cannot all hold: ${failure.conflict.join(', ')}`);
      }
    }
    const readings = 'worlds' in result && result.worlds.length > 0 ? readingsFor(src, context) : undefined;
    for (const world of 'worlds' in result ? result.worlds : []) {
      const heading = `  the world of ${ids.get(world.scenario) ?? world.scenario}:`;
      // The check stands without the world: a world the analyzer did not write is only said to be missing.
      if (world.trace === undefined) {
        console.log(`${heading} the analyzer wrote none`);
        continue;
      }
      console.log(heading);
      for (const line of sayWorld(world.trace, world.model, readings, world.scenario)) console.log(`    ${line}`);
    }
  }
  if (checked === 0) console.log('no alloy blocks in the documents');
  return code;
}

/** Mark the named units' maps reviewed, as they now stand, in each document that holds them; the exit code: 0, or 2 when a unit has no map. */
export function review(documents: string[], root: string, units: string[]): number {
  let left = units;
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    const { src, missing } = reviewMaps(readFileSync(file, 'utf8'), units);
    const done = units.filter(id => !missing.includes(id));
    if (done.length > 0) {
      writeFileSync(file, src);
      for (const id of done) console.log(`${doc}: ${id}: reviewed`);
    }
    left = left.filter(id => missing.includes(id));
  }
  for (const id of left) console.error(`canon: ${id} has no map and predicate in the documents`);
  return left.length === 0 ? 0 : 2;
}

const WHAT: Record<string, string> = {
  stale: 'the statement is not what the predicate says; run `canon generate`',
  missing: 'the statement is not written; run `canon generate`',
  handwritten: 'has a statement of its own; delete it to let it be said from its predicate',
  orphaned: 'a generated statement whose region names no unit or scenario of the document; delete the region'
};

/** Write the statements of each document that keeps readings; the exit code: 0, or 1 when a statement cannot be written. */
export function generateStatements(documents: string[], root: string): number {
  let code = 0;
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const context = contextFor(file, root);
    for (const state of statements.states(src, context)) {
      if (state.kind === 'unsayable') console.log(`${doc}: ${state.unit}: unsayable: ${state.message}`);
      if (state.kind === 'unsayable' || state.kind === 'handwritten') code = 1;
      if (state.kind === 'handwritten') console.log(`${doc}: ${state.unit}: handwritten: ${WHAT.handwritten}`);
    }
    const { src: next, written } = statements.write(src, context);
    if (next === src) continue;
    writeFileSync(file, next);
    for (const unit of written) console.log(`wrote the statement of ${unit} in ${doc}`);
  }
  return code;
}

/** Report each statement that is not what its predicate says; the exit code: 0, or 1 when there is one. */
export function checkStatements(documents: string[], root: string): number {
  let code = 0;
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    for (const state of statements.states(readFileSync(file, 'utf8'), contextFor(file, root))) {
      if (state.kind === 'current') continue;
      code = 1;
      console.log(`${doc}: ${state.unit}: ${state.kind}: ${state.kind === 'unsayable' || state.kind === 'misread' ? state.message : WHAT[state.kind]}`);
    }
  }
  return code;
}

/** Report the words of each document that keeps readings that are undeclared, misplaced, apart from their reading or unused, and the formulas that are lone on a signature; the exit code: 0, or 1 when there is one. */
export function checkDocumentWords(documents: string[], root: string): number {
  let code = 0;
  for (const doc of documents) {
    const file = resolve(root, doc);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const context = contextFor(file, root).map(c => c.src);
    for (const finding of [...checkWords(src, context), ...checkLoneFormulas(src, context)]) {
      code = 1;
      console.log(`${doc}: ${finding.unit}: ${finding.kind}: ${finding.message}`);
    }
  }
  return code;
}

/** The `logic` field of the scope: where the Alloy analyzer is. Paths are relative to the project root. */
interface LogicConfig {
  alloy?: { jar?: string; java?: string };
}

export const plugin: Plugin = {
  name: 'alloy',
  config: 'logic',
  commands: {
    generate: ({ root, documents }) => generateStatements(documents, root),
    intent: ({ args, root, documents, options }) =>
      options.write === true ? readStdin().then(text => writeIntent(documents, root, args, text)) : printIntents(documents, root, args),
    readings: ({ args, root, documents, options }) =>
      options.write === true ? rewordReading(documents, root, args, file => contextFor(file, root)) : listReadings(documents, root),    check: ({ root, documents }) =>
      Math.max(
        checkStatements(documents, root),
        checkDocumentWords(documents, root),
        checkIntents(documents, root, file => contextFor(file, root).map(c => c.src))
      ),
    logic: ({ args, root, documents, config, options }) => {
      const documentsToRead = args.length > 0 ? args : documents;
      if (options.review !== undefined) return review(documentsToRead, root, options.review as string[]);
      const alloy = (config as LogicConfig | undefined)?.alloy;
      return logic(
        documentsToRead,
        root,
        {
          jar: alloy?.jar === undefined ? undefined : resolve(root, alloy.jar),
          java: alloy?.java === undefined ? undefined : resolve(root, alloy.java)
        },
        (options.show as string[] | undefined) ?? []
      );
    }
  }
};
