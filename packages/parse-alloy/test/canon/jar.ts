/**
 * The models that the jar of the Alloy analyzer holds, read straight from the
 * jar, and the analyzer run on a model. The tests that use them need the jar:
 * set CANON_ALLOY_JAR, and CANON_JAVA when `java` is older than 17.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { analyzerOf, ask, cacheFolder, failed, sweep } from '@bigmistqke/run-alloy';

const ANALYZER = analyzerOf();
export const JAR = ANALYZER?.jar;

/** The analyzer's options: check every command, and print each verdict. */
const ARGS = ['exec', '-f', '-c', '*'];

/** The folder of kept answers: the one CANON_ALLOY_CACHE_DIR names, or else `.cache/canon-alloy` of this package. */
const FOLDER = cacheFolder({ fallback: join(dirname(fileURLToPath(import.meta.url)), '../../.cache/canon-alloy') });

/** The `.als` files of a zip, by their path in it, read from its central directory. */
export function modelsOf(jar: string): Map<string, string> {
  const zip = readFileSync(jar);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${jar} is not a zip`);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const models = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (name.endsWith('.als')) {
      const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(data, data + size);
      models.set(name, (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return models;
}

/**
 * Run the analyzer on each of a set of modules, each beside the models of the
 * jar at the paths they had in it, so that an `open` of a module beside it finds
 * it; the output of each. run-alloy runs as many at once as the machine holds,
 * and keeps each output for the next run.
 */
export async function runAll(models: Map<string, string>, modules: { path: string; source: string }[]): Promise<Map<string, string>> {
  const beside = Object.fromEntries(models);
  const outputs = await Promise.all(
    modules.map(async ({ path, source }) => {
      const result = await ask(ANALYZER!, { text: source, path, beside }, ARGS, ran => ran.output, { folder: FOLDER, form: 'parse-alloy output' });
      return [path, failed(result) ? result.error : result] as const;
    })
  );
  if (FOLDER !== undefined) sweep(FOLDER);
  return new Map(outputs);
}
