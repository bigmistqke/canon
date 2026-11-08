/**
 * The short names of the variables of a statement: the first letters of a variable's noun, as a capital, and its
 * number, `U1`, with the noun before the name where the words first name it, `every unit U1`. The printer names a
 * variable `unit_1` as it goes; `shortNames` gives the finished words the short names, and `longNames` gives them back
 * the long ones, so the words can be read back the way the printer made them.
 */

/** A name the printer gives: the noun of the variable, its words joined by `_`, and its number. */
const LONG = /\b([a-z][a-z_]*?)_(\d+)\b/g;

/** A short name: the letters of a noun, the first a capital, and a number. */
const SHORT = /\b([A-Z][A-Za-z]*)(\d+)\b/g;

/** The letters of a noun, `k` of its first word: `unit` gives U, `listing frontmatter` gives LF, and with 2, LiF. */
function letters(noun: string, k: number): string {
  const [head = '', ...rest] = noun.split(' ');
  const start = head.slice(0, k);
  return `${start.charAt(0).toUpperCase()}${start.slice(1)}${rest.map(word => word.charAt(0).toUpperCase()).join('')}`;
}

/** The letters of each noun, as few as tell the nouns apart: `unit` and `use` give Un and Us. */
function lettersOf(nouns: string[]): Map<string, string> {
  const k = new Map(nouns.map(noun => [noun, 1]));
  for (let round = 0; round < 64; round++) {
    const byLetters = new Map<string, string[]>();
    for (const noun of nouns) {
      const key = letters(noun, k.get(noun) as number);
      byLetters.set(key, [...(byLetters.get(key) ?? []), noun]);
    }
    const clashes = [...byLetters.values()].filter(group => group.length > 1);
    if (clashes.length === 0) break;
    let grew = false;
    for (const group of clashes)
      for (const noun of group) {
        const head = noun.split(' ')[0] as string;
        if ((k.get(noun) as number) < head.length) {
          k.set(noun, (k.get(noun) as number) + 1);
          grew = true;
        }
      }
    // Nouns whose first words are spent: each word in full.
    if (!grew) return new Map(nouns.map(noun => [noun, noun.split(' ').map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')]));
  }
  return new Map(nouns.map(noun => [noun, letters(noun, k.get(noun) as number)]));
}

/**
 * The words with each variable `unit_1` named by its noun and then its letters and number, `unit U1`, wherever the
 * words name it: `every unit_1` is `every unit U1`, `[unit_1](#term-unit)` is `[unit](#term-unit) U1`. A number of
 * the words' own, `number_1`, keeps its name.
 */
export function shortNames(text: string): string {
  const nounOf = new Map<string, string>();
  for (const [whole, stem] of text.matchAll(LONG)) if (stem !== 'number' && !nounOf.has(whole)) nounOf.set(whole, (stem as string).replace(/_/g, ' '));
  if (nounOf.size === 0) return text;
  const byNoun = lettersOf([...new Set(nounOf.values())]);
  const shortOf = (long: string): string => `${byNoun.get(nounOf.get(long) as string)}${long.slice(long.lastIndexOf('_') + 1)}`;
  const out = text
    .replace(/\[([a-z][a-z_]*?_\d+)\](\([^)]*\))/g, (whole, long: string, href: string) => (nounOf.has(long) ? `[${nounOf.get(long)}]${href} ${shortOf(long)}` : whole))
    .replace(LONG, (whole: string) => (nounOf.has(whole) ? `${nounOf.get(whole)} ${shortOf(whole)}` : whole));
  // Words that open with a variable open with its noun, which takes a capital as any word of their own would.
  return /^\[?[a-z][a-z_]*?_\d+\b/.test(text) && !/^\[?number_/.test(text) ? out.replace(/^(\[?)([a-z])/, (_, bracket: string, c: string) => `${bracket}${c.toUpperCase()}`) : out;
}

/**
 * The words with each short name given back its long one: `unit U1` and `[unit](#term-unit) U1` are `unit_1` and
 * `[unit_1](#term-unit)` again. `nouns` are the nouns the words may name a variable by.
 */
export function longNames(text: string, nouns: Iterable<string>): string {
  const known = [...new Set(nouns)].sort((a, b) => b.length - a.length).map(noun => noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (known.length === 0) return text;
  const alternatives = known.join('|');
  const long = (noun: string, number: string): string => `${noun.toLowerCase().replace(/ /g, '_')}_${number}`;
  return text
    .replace(new RegExp(`\\[(${alternatives})\\](\\([^)]*\\)) [A-Z][A-Za-z]*(\\d+)\\b`, 'gi'), (_, noun: string, href: string, number: string) => `[${long(noun, number)}]${href}`)
    .replace(new RegExp(`\\b(${alternatives}) [A-Z][A-Za-z]*(\\d+)\\b`, 'gi'), (_, noun: string, number: string) => long(noun, number));
}
