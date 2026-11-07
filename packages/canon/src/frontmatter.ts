/**
 * The frontmatter of a canon document: a block between two lines of `---` at
 * the very top. It names the plugins whose checks apply to the document, and
 * the documents it extends:
 *
 *     ---
 *     plugins: ["@bigmistqke/canon-forge"]
 *     extends: ["../canon/CANON.md"]
 *     ---
 *
 * It also holds the settings of a project, in the entry document:
 *
 *     ---
 *     suites: test/canon
 *     sources: [src, test]
 *     tracker: {kind: github, repo: bigmistqke/canon}
 *     ---
 *
 * This reads a small part of YAML and nothing else, so the core needs no YAML
 * library: keys whose values are a string, a list of strings
 * written inline (`[a, "b"]`) or as lines that start with a dash, or a map
 * written between braces (`{a: b}`), which may nest. Everything it accepts is
 * also valid YAML, so other tools can read the same block.
 */
import { runnersOf } from './runners.ts';

/** The block at the top of a document, with its closing line. */
export const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** A value of a setting: a string, a list, or a map of keys and values. */
export type Value = string | Value[] | { [key: string]: Value };

export interface Frontmatter {
  /** The plugins the document names; undefined when it has no `plugins` key. */
  plugins?: string[];
  /** The paths of the documents it extends, as written; undefined when it has no `extends` key. */
  extends?: string[];
  /** The settings of the project, as written; each is undefined when the block does not have its key. */
  documents?: string[];
  suites?: string;
  sources?: string[];
  references?: string[];
  command?: string;
  tracker?: { [key: string]: Value };
  runners?: Value[];
  /** The keys that a plugin defines, which the reader accepts when its caller names them. */
  other?: { [key: string]: Value };
}

/** The keys whose value is a list of strings. */
const LISTS = ['plugins', 'extends', 'documents', 'sources', 'references'] as const;

/** The keys of the project's settings. */
export const SETTINGS = ['documents', 'suites', 'sources', 'references', 'command', 'tracker', 'runners'] as const;

/** The keys the block may have of its own. */
const KEYS = ['plugins', 'extends', ...SETTINGS] as const;

/** Whether the block holds a setting: any key besides `plugins` and `extends`. */
export function hasSettings(frontmatter: Frontmatter | undefined): boolean {
  return frontmatter !== undefined && Object.keys(frontmatter).some(key => key !== 'plugins' && key !== 'extends');
}

/** A plain YAML scalar cannot start with these, and the `@` is the one a package name starts with. */
const RESERVED_START = /^[@`%!&*|>'"[\]{},#?:-]/;

/** One scalar: double quoted, single quoted, or plain. */
function scalar(raw: string): string {
  const text = raw.trim();
  if (text === '') throw new Error('an empty entry in the list');
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) throw new Error(`the string ${text} has no closing quote`);
    return text.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new Error(`the string ${text} has no closing quote`);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (RESERVED_START.test(text)) {
    throw new Error(`${text} must be in quotes: a plain YAML value cannot start with "${text[0]}". Write "${text}".`);
  }
  if (/[:#,[\]{}]/.test(text) || /\s/.test(text)) throw new Error(`${text} must be in quotes`);
  return text;
}

/** The entries of `[a, "b"]`. Commas inside quotes belong to the string. */
function inlineList(raw: string): string[] {
  const body = raw.trim();
  if (!body.startsWith('[') || !body.endsWith(']')) throw new Error('the list has no closing "]"');
  const inner = body.slice(1, -1);
  const items: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const ch of inner) {
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== undefined) throw new Error('a quote in the list is never closed');
  if (current.trim() !== '' || items.length > 0) items.push(current);
  return items.map(scalar);
}


/** One value of a setting, read from `raw`: a quoted or plain string, a list between brackets, or a map between braces. */
function value(raw: string, key: string): Value {
  let at = 0;
  const skip = (): void => {
    while (at < raw.length && /\s/.test(raw[at] as string)) at++;
  };
  const quoted = (): string => {
    const quote = raw[at] as string;
    let text = '';
    for (at++; at < raw.length; at++) {
      const ch = raw[at] as string;
      if (quote === '"' && ch === '\\' && (raw[at + 1] === '"' || raw[at + 1] === '\\')) text += raw[++at];
      else if (quote === "'" && ch === "'" && raw[at + 1] === "'") text += raw[++at];
      else if (ch === quote) {
        at++;
        return text;
      } else text += ch;
    }
    throw new Error(`a quote in the value of "${key}" is never closed`);
  };
  /** A plain string ends at the end of the text at the top, and at a comma, bracket or brace inside a list or a map. */
  const plain = (inside: boolean): string => {
    const start = at;
    while (at < raw.length && !(inside && /[,\]}]/.test(raw[at] as string))) at++;
    const text = raw.slice(start, at).trim();
    if (text === '') throw new Error(`an empty value in "${key}"`);
    if (RESERVED_START.test(text)) throw new Error(`${text} must be in quotes: a plain YAML value cannot start with "${text[0]}". Write "${text}".`);
    if (/:(\s|$)|\s#/.test(text)) throw new Error(`${text} must be in quotes`);
    return text;
  };
  const item = (inside: boolean): Value => {
    skip();
    const ch = raw[at];
    if (ch === '[') return list();
    if (ch === '{') return map();
    if (ch === '"' || ch === "'") return quoted();
    return plain(inside);
  };
  const list = (): Value[] => {
    const items: Value[] = [];
    at++;
    for (;;) {
      skip();
      if (raw[at] === ']') {
        at++;
        return items;
      }
      if (at >= raw.length) throw new Error(`the list in "${key}" has no closing "]"`);
      items.push(item(true));
      skip();
      if (raw[at] === ',') at++;
      else if (raw[at] !== ']') throw new Error(`the list in "${key}" has no closing "]"`);
    }
  };
  const map = (): { [key: string]: Value } => {
    const entries: { [key: string]: Value } = {};
    at++;
    for (;;) {
      skip();
      if (raw[at] === '}') {
        at++;
        return entries;
      }
      if (at >= raw.length) throw new Error(`the map in "${key}" has no closing "}"`);
      let name: string;
      if (raw[at] === '"' || raw[at] === "'") name = quoted();
      else {
        const start = at;
        while (at < raw.length && !/[:,{}[\]]/.test(raw[at] as string)) at++;
        name = raw.slice(start, at).trim();
      }
      skip();
      if (name === '' || raw[at] !== ':') throw new Error(`the map in "${key}" has a key with no ":" and a value`);
      at++;
      if (Object.hasOwn(entries, name)) throw new Error(`the key "${name}" appears twice in "${key}"`);
      entries[name] = item(true);
      skip();
      if (raw[at] === ',') at++;
      else if (raw[at] !== '}') throw new Error(`the map in "${key}" has no closing "}"`);
    }
  };
  const result = item(false);
  skip();
  if (at < raw.length) throw new Error(`cannot read the rest of the value of "${key}": ${raw.slice(at)}`);
  return result;
}

const isStrings = (v: Value): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

/** Check the type a setting has, and keep it. `later` leaves the runners to a caller that checks the keys later. */
function setting(result: Frontmatter, key: (typeof SETTINGS)[number], v: Value, later: boolean): void {
  const need = (what: string): never => {
    throw new Error(`the key "${key}" takes ${what}`);
  };
  switch (key) {
    case 'documents':
    case 'sources':
    case 'references':
      if (!isStrings(v)) need('a list of strings');
      result[key] = v as string[];
      return;
    case 'suites':
    case 'command':
      if (typeof v !== 'string') need('a string');
      result[key] = v as string;
      return;
    case 'tracker':
      if (typeof v !== 'object' || Array.isArray(v) || !Object.values(v).every(x => typeof x === 'string')) need('a map of strings, such as {kind: github, repo: owner/name}');
      result[key] = v as { [key: string]: Value };
      return;
    case 'runners':
      if (!Array.isArray(v)) need('a list of runners, such as [vitest, playwright]');
      // A runner the checker does not know would change which calls are tests.
      if (!later) runnersOf(v);
      result[key] = v as Value[];
  }
}

/**
 * Read the frontmatter of a document. Returns undefined when the document has
 * none. Throws an Error that says what is wrong when the block is not in the
 * accepted part of YAML; a key the tool does not know is an error too, so a
 * misspelled `plugin` cannot silently drop a check. `pluginKeys` are the keys
 * that plugins define, which are known as well, and `true` knows every key, for
 * a caller that checks the keys later.
 */
export function readFrontmatter(src: string, pluginKeys: readonly string[] | true = []): Frontmatter | undefined {
  const block = FRONTMATTER.exec(src);
  if (block === null) return undefined;
  // The matched text is the opening line, the body, the closing line, and the newline after it, if any.
  const lines = block[0].split(/\r?\n/);
  lines.shift();
  if (lines.at(-1) === '') lines.pop();
  lines.pop();
  const result: Frontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const key = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
    if (key === null) throw new Error(`cannot read the line "${line.trim()}"`);
    const name = key[1] as string;
    const own = KEYS.find(k => k === name);
    if (own === undefined && pluginKeys !== true && !pluginKeys.includes(name)) {
      throw new Error(`unknown key "${name}"; the keys are ${[...KEYS, ...pluginKeys].map(k => `"${k}"`).join(', ')}`);
    }
    if (own !== undefined ? result[own] !== undefined : result.other !== undefined && Object.hasOwn(result.other, name)) {
      throw new Error(`the key "${name}" appears twice`);
    }
    const rest = (key[2] as string).replace(/[ \t]+#.*$/, '');
    let read: Value;
    if (rest !== '' && (own === undefined || !(LISTS as readonly string[]).includes(own))) {
      read = value(rest, name);
    } else if (rest !== '') {
      read = inlineList(rest);
    } else {
      const items: string[] = [];
      while (i + 1 < lines.length && /^[ \t]*-([ \t]|$)/.test(lines[i + 1] as string)) {
        i++;
        items.push(scalar((lines[i] as string).replace(/^[ \t]*-[ \t]*/, '').replace(/[ \t]+#.*$/, '')));
      }
      if (items.length === 0 && own !== undefined && !(LISTS as readonly string[]).includes(own)) {
        throw new Error(`the key "${name}" has no value; write it after the colon`);
      }
      read = items;
    }
    if (own === 'plugins' || own === 'extends') result[own] = read as string[];
    else if (own !== undefined) setting(result, own as (typeof SETTINGS)[number], read, pluginKeys === true);
    else (result.other ??= {})[name] = read;
  }
  return result;
}
