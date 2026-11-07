/**
 * Which plugins apply to which documents, and how a plugin the project has
 * installed is found. Each case builds a small project in a temporary directory
 * and runs the command line over it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawned } from './project.ts';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'cli.ts');

const DIRS: string[] = [];
afterEach(() => {
  for (const dir of DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const doc = (frontmatter: string | undefined, body = ''): string =>
  `${frontmatter === undefined ? '' : `---\n${frontmatter}\n---\n`}# Canon\n\n${body}\n`;

/** A project of the given documents, with the command run over it; returns what it printed and its exit code. */
async function project(documents: Record<string, string>, args: string[], extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'canon-plugins-'));
  DIRS.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ canon: { documents: Object.keys(documents) } }));
  for (const [name, text] of Object.entries({ ...documents, ...extra })) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const run = await spawned(process.execPath, [CLI, ...args], { cwd: dir });
  return { out: `${run.stdout}${run.stderr}`, code: run.status };
}

const PLUGIN = {
  'node_modules/canon-fake/package.json': JSON.stringify({ name: 'canon-fake', version: '1.0.0', main: 'index.js' }),
  'node_modules/canon-fake/index.js': `exports.plugin = {
name: 'fake',
config: 'fake',
commands: { fake(context) {
  console.log(JSON.stringify({ args: context.args, documents: context.documents, config: context.config }));
  return 0;
} },
};`
};

describe('a plugin the project has installed', () => {
  /**
   * @canon spec-a-plugin-a-document-lists-runs-over-it
   * @canon spec-a-plugin-a-document-does-not-list-does-not-run-over-it
   * @canon spec-a-document-with-no-plugins-list-asks-for-no-plugin
   */
  it('adds its command, over the documents that name it', async () => {
    const { out, code } = await project(
      { 'A.md': doc('plugins: ["canon-fake"]'), 'B.md': doc(undefined) },
      ['fake', 'one'],
      PLUGIN
    );
    expect(JSON.parse(out.trim())).toEqual({ args: ['one'], documents: ['A.md'] });
    expect(code).toBe(0);
  });

  /**
   * @canon spec-an-empty-list-asks-for-no-plugin
   * @canon spec-an-available-command-is-not-reported-as-unknown
   * @canon spec-a-run-with-no-finding-succeeds
   */
  it('applies no plugin to a document that names an empty list', async () => {
    const { out, code } = await project(
      { 'A.md': doc('plugins: []'), 'B.md': doc('plugins: ["canon-fake"]') },
      ['fake'],
      PLUGIN
    );
    expect(out).not.toContain('unknown command');
    expect(JSON.parse(out.trim()).documents).toEqual(['B.md']);
    expect(code).toBe(0);
  });

  /**
   * @canon spec-a-document-named-on-the-command-line-is-checked-whatever-its-frontmatter-says
   */
  it('hands a plugin a file named on the command line whatever its frontmatter says', async () => {
    const { out, code } = await project(
      { 'A.md': doc('plugins: []'), 'B.md': doc('plugins: ["canon-fake"]') },
      ['fake', 'A.md'],
      PLUGIN
    );
    expect(JSON.parse(out.trim())).toMatchObject({ args: ['A.md'], documents: ['B.md'] });
    expect(code).toBe(0);
  });

  /**
   * @canon spec-a-missing-plugin-is-reported
   * @canon spec-a-missing-plugin-stops-the-run
   */
  it('says so when a document names a plugin the project does not have', async () => {
    const { out, code } = await project({ 'A.md': doc('plugins: ["canon-missing"]') }, ['fake']);
    expect(out).toContain('the plugin "canon-missing" is not installed in this project');
    expect(code).toBe(2);
  });

  /**
   * @canon spec-a-missing-plugin-stops-the-run
   */
  it('stops a command of this package when a document names a plugin that does not exist', async () => {
    const { out, code } = await project({ 'A.md': doc('plugins: ["@bigmistqke/canon/logic"]') }, ['logic']);
    expect(out).toContain('the plugin "@bigmistqke/canon/logic" is not installed in this project');
    expect(code).toBe(2);
  });

  /**
   * @canon spec-a-command-that-is-not-available-is-reported-as-unknown
   * @canon spec-a-command-that-is-not-available-stops-the-run
   */
  it('says a command is unknown when no plugin adds it', async () => {
    const { out, code } = await project({ 'A.md': doc(undefined) }, ['fake']);
    expect(out).toContain('unknown command "fake"');
    expect(code).toBe(2);
  });

  /**
   * @canon spec-a-document-with-a-refused-frontmatter-is-reported
   * @canon spec-a-report-of-an-unreadable-frontmatter-stops-the-run
   * @canon spec-the-refusal-of-a-misquoted-entry-says-to-write-it-in-quotes
   */
  it('says what is wrong with a frontmatter it cannot read', async () => {
    const { out, code } = await project({ 'A.md': doc('plugins: [@x/y]') }, ['fake']);
    expect(out).toContain('A.md: frontmatter:');
    expect(out).toContain('must be in quotes');
    expect(code).toBe(2);
  });
});

/** A package that adds `command`, which prints `says` and returns `code`. */
const adder = (name: string, command: string, says: string, code: number): Record<string, string> => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
  [`node_modules/${name}/index.js`]: `exports.plugin = { name: '${name}', commands: { '${command}': () => { console.log('${says}'); return ${code}; } } };`
});

describe('the same command from several plugins', () => {
  const both = { ...adder('canon-a', 'generate', 'a ran', 0), ...adder('canon-b', 'generate', 'b ran', 1) };

  /**
   * @canon spec-every-plugin-a-run-calls-runs
   * @canon spec-a-finding-fails-the-run
   */
  it('runs every plugin that adds it, and exits with the worst code', async () => {
    const { out, code } = await project({ 'A.md': doc('plugins: ["canon-a", "canon-b"]') }, ['generate'], both);
    expect(out).toContain('a ran');
    expect(out).toContain('b ran');
    expect(code).toBe(1);
  });

  /**
   * @canon spec-a-plugin-that-could-not-run-stops-the-run
   */
  it('puts a check that could not run above a finding', async () => {
    const three = { ...both, ...adder('canon-c', 'generate', 'c ran', 2) };
    const { code } = await project({ 'A.md': doc('plugins: ["canon-a", "canon-b", "canon-c"]') }, ['generate'], three);
    expect(code).toBe(2);
  });

});

/** A package named `name` whose plugin calls itself `calls` and adds `commands`, each of which prints its name and the words after it. */
const named = (name: string, calls: string, commands: string[]): Record<string, string> => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
  [`node_modules/${name}/index.js`]: `exports.plugin = { name: '${calls}', commands: { ${commands
    .map(command => `'${command}': (context) => { console.log('${name} ${command} ran ' + context.args.join(' ')); return 0; }`)
    .join(', ')} } };`
});

describe('the name a plugin adds a command under', () => {
  const fake = named('canon-plugin-fake', 'other', ['fake', 'generate']);

  /**
   * @canon spec-a-run-asks-for-a-command-of-a-plugin-by-its-prefixed-name
   */
  it('runs the command of the plugin that the prefix names', async () => {
    const { out, code } = await project({ 'A.md': doc('plugins: ["canon-plugin-fake"]') }, ['fake:fake', 'one'], fake);
    expect(out).toContain('canon-plugin-fake fake ran one');
    expect(code).toBe(0);
  });

  /**
   * @canon spec-the-prefix-is-the-name-of-the-package-without-its-scope-and-without-canon-plugin
   */
  it('takes the prefix from the package, not from the name the plugin gives itself', async () => {
    const scoped = named('@acme/canon-plugin-fake', 'other', ['fake']);
    const ran = await project({ 'A.md': doc('plugins: ["@acme/canon-plugin-fake"]') }, ['fake:fake'], scoped);
    expect(ran.out).toContain('@acme/canon-plugin-fake fake ran');
    expect(ran.code).toBe(0);
    const faked = await project({ 'A.md': doc('plugins: ["canon-plugin-fake"]') }, ['other:fake'], fake);
    expect(faked.out).toContain('unknown command "other:fake"');
    expect(faked.code).toBe(2);
  });

  /**
   * @canon spec-a-plugin-adds-to-check-and-generate-without-a-prefix
   */
  it('runs a plugin part of generate under generate, and under no prefixed name', async () => {
    const generate = await project({ 'A.md': doc('plugins: ["canon-plugin-fake"]') }, ['generate'], fake);
    expect(generate.out).toContain('canon-plugin-fake generate ran');
    const prefixed = await project({ 'A.md': doc('plugins: ["canon-plugin-fake"]') }, ['fake:generate'], fake);
    expect(prefixed.out).not.toContain('canon-plugin-fake generate ran');
    expect(prefixed.out).toContain('unknown command "fake:generate"');
    expect(prefixed.code).toBe(2);
  });

  /**
   * @canon spec-a-bare-name-runs-the-one-command-that-has-it
   */
  it('runs the one command that has a bare name', async () => {
    const { out, code } = await project({ 'A.md': doc('plugins: ["canon-plugin-fake"]') }, ['fake', 'one'], fake);
    expect(out).toContain('canon-plugin-fake fake ran one');
    expect(code).toBe(0);
  });

  /**
   * @canon spec-an-ambiguous-bare-name-is-reported-with-the-commands-that-have-it
   * @canon spec-an-ambiguous-bare-name-stops-the-run
   */
  it('names the commands that share a bare name, runs neither, and fails the run', async () => {
    const two = { ...named('canon-plugin-a', 'a', ['fake']), ...named('canon-plugin-b', 'b', ['fake']) };
    const { out, code } = await project({ 'A.md': doc('plugins: ["canon-plugin-a", "canon-plugin-b"]') }, ['fake'], two);
    expect(out).toContain('"fake" is the bare name of more than one command');
    expect(out).toContain('a:fake');
    expect(out).toContain('b:fake');
    expect(out).not.toContain('ran');
    expect(code).toBe(2);
  });
});

describe('check over a document with frontmatter', () => {
  const body = `<!-- toc:begin — generated by \`canon generate\`; edits are overwritten -->\n<!-- toc:end -->\n\n## @axiom a-program-means-one-thing\n\n> A program means one thing.\n`;

  /** Generate, then check, a project of one document; the document as generate left it, and what check printed. */
  async function checked(text: string) {
    const dir = mkdtempSync(join(tmpdir(), 'canon-plugins-'));
    DIRS.push(dir);
    mkdirSync(join(dir, 'test', 'canon'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ canon: { documents: ['CANON.md'], suites: 'test/canon', sources: ['test'], command: 'canon' } })
    );
    writeFileSync(join(dir, 'CANON.md'), text);
    await spawned(process.execPath, [CLI, 'generate'], { cwd: dir });
    const run = await spawned(process.execPath, [CLI, 'check'], { cwd: dir });
    // The first line names the temporary directory.
    return { document: readFileSync(join(dir, 'CANON.md'), 'utf8'), out: run.stdout.split('\n').slice(1).join('\n'), code: run.status };
  }

  /**
   * @canon spec-a-frontmatter-changes-no-finding
   * @canon spec-generate-keeps-the-frontmatter-of-a-document
   */
  it('reports what it reports without the frontmatter, and leaves the frontmatter as it was', async () => {
    const frontmatter = `---\nplugins: []\n---\n`;
    const without = await checked(`# Canon\n\n${body}`);
    const withIt = await checked(`${frontmatter}# Canon\n\n${body}`);
    expect(withIt.out).toBe(without.out);
    expect(withIt.code).toBe(without.code);
    expect(withIt.document.startsWith(frontmatter)).toBe(true);
    expect(withIt.document.slice(frontmatter.length)).toBe(without.document);
  });
});
