/**
 * The standard verbs, from the verb terms of VERBS.md: each term's third person, its stem as its infinitive, and its
 * participle. Run with `--write` to write them into src/core/verbs.ts, between its markers.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'src', 'core', 'verbs.ts');
const BEGIN = '// verbs:begin';
const END = '// verbs:end';

/** The lines `holds: hold, held` that the verb terms of a document give, in the order the document writes them. */
export function verbLines(md: string): string[] {
  const lines: string[] = [];
  for (const m of md.matchAll(/^#{2,6} @term (\S+)\n([\s\S]*?)(?=^#{2,6} @|(?![\s\S]))/gm)) {
    const [, stem, own] = m as unknown as [string, string, string];
    const cell = (role: string): string | undefined => new RegExp(`^\\|\\s*${role}\\s*\\|\\s*([^|]*?)\\s*\\|`, 'm').exec(own)?.[1];
    if (cell('type') !== 'verb') continue;
    const third = cell('third person');
    const participle = cell('participle');
    if (third === undefined || participle === undefined) throw new Error(`the verb term ${stem} gives no third person or no participle`);
    lines.push(`${third}: ${stem.replace(/-/g, ' ')}, ${participle}`);
  }
  return lines;
}

/** The source with the lines that VERBS.md gives between its markers. */
export function written(): string {
  const source = readFileSync(SOURCE, 'utf8');
  const at = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  const head = source.slice(0, source.indexOf('\n', at) + 1);
  const lines = verbLines(readFileSync(join(ROOT, 'VERBS.md'), 'utf8'));
  return `${head}const LINES = \`\n${lines.join('\n')}\n\`;\n${source.slice(end)}`;
}

if (process.argv.includes('--write')) writeFileSync(SOURCE, written());
