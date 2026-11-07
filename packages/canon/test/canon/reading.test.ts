/**
 * The commands that read the canon for a reader: `show`, `find`, and `tree`
 * with a unit.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { canon, generated, piped, pipedSlowly, run, scratch } from './project.ts';

/** The tag a test cites a unit with, spelled apart so the checker does not read this file's templates as citations. */
const TAG = ['@', 'canon'].join('');

const DOCUMENT = canon(`
### @spec a-parent

> A parent says one thing for every target.

#### @spec a-leaf

> A leaf says one thing on a target.

Prose about the leaf.

#### @spec a-sibling

> A sibling says another thing.

## @axiom another-root

> Another root holds.

### @spec a-follower

> A follower says what the leaf says, later.

Derives from: [\`@spec a-leaf\`](#spec-a-leaf)

## Terms

### @term target

> A target is where a program runs.
`);

const TESTS = `/**
 * ${TAG} spec-a-leaf
 */
it('checks the leaf', () => {});

/**
 * ${TAG} spec-a-leaf
 */
it('checks the leaf again', () => {});

/**
 * ${TAG} spec-a-sibling
 */
it('checks the sibling', () => {});

/**
 * ${TAG} spec-a-follower
 */
it('checks the follower', () => {});
`;

/** The lines of `out` under the line `title`, up to the first line that is not indented. */
function section(out: string, title: string): string[] {
  const lines = out.split('\n');
  const at = lines.indexOf(title);
  if (at === -1) return [];
  const under: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('  ')) break;
    under.push(line.trim());
  }
  return under;
}

/** The line where `heading` starts in the document as the run reads it, with its index generated. */
const lineOf = await (async () => {
  const lines = (await generated(DOCUMENT)).split('\n');
  return (heading: string): number => lines.indexOf(heading) + 1;
})();

describe('show', () => {
  const show = async (...names: string[]) => await run(await scratch(DOCUMENT, TESTS), 'show', ...names);

  /**
   * @canon spec-show-prints-the-own-text-of-a-unit-with-where-it-starts
   */
  it('prints the heading and the own text of a unit after where it starts', async () => {
    const { stdout, status } = await show('spec-a-parent');
    expect(status).toBe(0);
    expect(stdout.split('\n')[0]).toBe(`CANON.md:${lineOf('### @spec a-parent')}  spec-a-parent`);
    expect(stdout).toContain('### @spec a-parent\n\n> A parent says one thing for every target.');
    expect(stdout).not.toContain('Prose about the leaf.');
  });

  /**
   * @canon spec-show-lists-the-units-a-unit-sits-in-up-to-its-root
   */
  it('lists the units a unit sits in, up to its root', async () => {
    expect(section((await show('spec-a-leaf')).stdout, 'Sits in:')).toEqual([
      `CANON.md:${lineOf('### @spec a-parent')}  spec-a-parent — A parent says one thing for every target.`,
      `CANON.md:${lineOf('## @axiom a-program-means-one-thing')}  axiom-a-program-means-one-thing — A program means one thing.`
    ]);
    expect(section((await show('axiom-another-root')).stdout, 'Sits in:')).toEqual(['none']);
  });

  /**
   * @canon spec-show-lists-the-units-a-unit-derives-from-on-its-derives-from-line
   */
  it('lists the units the "Derives from:" line of a unit names', async () => {
    expect(section((await show('spec-a-follower')).stdout, 'Derives from:')).toEqual([
      `CANON.md:${lineOf('#### @spec a-leaf')}  spec-a-leaf — A leaf says one thing on a target.`
    ]);
  });

  /**
   * @canon spec-show-lists-the-units-that-sit-in-a-unit
   */
  it('lists the units that sit in a unit, each with its tests', async () => {
    expect(section((await show('spec-a-parent')).stdout, 'Sitting in it:')).toEqual([
      `CANON.md:${lineOf('#### @spec a-leaf')}  spec-a-leaf  2 tests — A leaf says one thing on a target.`,
      `CANON.md:${lineOf('#### @spec a-sibling')}  spec-a-sibling  1 test — A sibling says another thing.`
    ]);
  });

  /**
   * @canon spec-show-lists-the-units-that-derive-from-a-unit-on-their-derives-from-line
   */
  it('lists the units whose "Derives from:" line names a unit', async () => {
    expect(section((await show('spec-a-leaf')).stdout, 'Deriving from it:')).toEqual([
      `CANON.md:${lineOf('### @spec a-follower')}  spec-a-follower — A follower says what the leaf says, later.`
    ]);
  });

  /**
   * @canon spec-show-lists-the-tests-that-check-a-unit
   */
  it('lists each test that checks a unit by its file, line and title', async () => {
    expect(section((await show('spec-a-leaf')).stdout, 'Tested by:')).toEqual([
      'test/canon/a.test.ts:4  checks the leaf',
      'test/canon/a.test.ts:9  checks the leaf again'
    ]);
    expect(section((await show('spec-a-parent')).stdout, 'Tested by:')).toEqual(['none']);
  });

  /**
   * @canon spec-show-reads-an-id-as-the-heading-or-the-tree-writes-it
   */
  it('reads a unit as its id, as its kind and stem after an @, or in words', async () => {
    const header = `CANON.md:${lineOf('#### @spec a-leaf')}  spec-a-leaf`;
    // One project for the four names: show only reads it.
    const dir = await scratch(DOCUMENT, TESTS);
    for (const names of [['spec-a-leaf'], ['@spec a-leaf'], ['@spec', 'a-leaf'], ['@spec A leaf']]) {
      expect((await run(dir, 'show', ...names)).stdout.split('\n')[0]).toBe(header);
    }
  });

  /**
   * @canon spec-show-of-a-name-that-names-no-unit-fails-the-run
   */
  it('says so, and exits with code 2, when a name names no unit', async () => {
    const { stdout, stderr, status } = await show('spec-a-leaf', 'spec-no-such-thing');
    expect(status).toBe(2);
    expect(stderr).toContain('"spec-no-such-thing" names no unit');
    expect(stdout.split('\n')[0]).toBe(`CANON.md:${lineOf('#### @spec a-leaf')}  spec-a-leaf`);
  });
});

describe('show with a part', () => {
  const PARTS = canon(`
### @spec a-claim-with-blocks

> A claim with blocks holds on every [target](#term-target),
> and says so.

Prose about the claim.

\`\`\`json
{ "target": "browser" }
\`\`\`

\`\`\`yaml
target: browser
\`\`\`

#### @spec a-plain-claim

> A plain claim holds.

## Terms

### @term target

> A target is where a program runs.
`);
  let lines: string[] = [];
  beforeAll(async () => {
    lines = (await generated(PARTS)).split('\n');
  });
  const header = (heading: string, id: string) => `CANON.md:${lines.indexOf(heading) + 1}  ${id}`;
  const show = async (...args: string[]) => await run(await scratch(PARTS, ''), 'show', ...args);

  /**
   * @canon spec-show-with-statement-prints-the-statement-as-it-reads
   */
  it('prints the statement without its quote marks, each link as its words', async () => {
    const { stdout, status } = await show('spec-a-claim-with-blocks', '--statement');
    expect(status).toBe(0);
    expect(stdout).toBe(`${header('### @spec a-claim-with-blocks', 'spec-a-claim-with-blocks')}\n\nA claim with blocks holds on every target,\nand says so.\n`);
  });

  /**
   * @canon spec-show-with-body-prints-the-own-text-after-the-statement
   */
  it('prints the own text after the statement, as written, and no unit around it', async () => {
    const { stdout } = await show('spec-a-claim-with-blocks', '--body');
    expect(stdout).toBe(`${header('### @spec a-claim-with-blocks', 'spec-a-claim-with-blocks')}\n\nProse about the claim.\n\n\`\`\`json\n{ "target": "browser" }\n\`\`\`\n\n\`\`\`yaml\ntarget: browser\n\`\`\`\n`);
  });

  /**
   * @canon spec-show-of-a-part-a-unit-lacks-says-none
   */
  it('prints none under a unit that has no part of those named', async () => {
    const { stdout, status } = await show('spec-a-plain-claim', '--body');
    expect(status).toBe(0);
    expect(stdout).toBe(`${header('#### @spec a-plain-claim', 'spec-a-plain-claim')}\n\nnone\n`);
  });
});

describe('find', () => {
  const find = async (...args: string[]) => (await run(await scratch(DOCUMENT, TESTS), 'find', ...args)).stdout.trim().split('\n').filter(Boolean);

  /**
   * @canon spec-find-matches-a-word-in-the-id-or-the-own-text-whatever-its-case
   */
  it('matches a word in the id or the own text, in capitals or not', async () => {
    expect(await find('FOLLOWER')).toEqual([`CANON.md:${lineOf('### @spec a-follower')}  spec-a-follower — A follower says what the leaf says, later.`]);
    expect(await find('prose')).toEqual([`CANON.md:${lineOf('#### @spec a-leaf')}  spec-a-leaf — A leaf says one thing on a target.`]);
  });

  /**
   * @canon spec-find-lists-a-unit-only-when-it-holds-every-word
   */
  it('leaves out a unit that holds some of the words and not every one', async () => {
    expect((await find('says', 'thing')).map(line => line.split('  ')[1]?.split(' ')[0])).toEqual(['spec-a-parent', 'spec-a-leaf', 'spec-a-sibling']);
    expect((await find('says', 'another')).map(line => line.split('  ')[1]?.split(' ')[0])).toEqual(['spec-a-sibling']);
  });

  /**
   * @canon spec-find-with-a-kind-lists-only-units-of-that-kind
   */
  it('lists only the units of the kind on its command line', async () => {
    const ids = (lines: string[]) => lines.map(line => line.split('  ')[1]?.split(' ')[0]);
    expect(ids(await find('target'))).toEqual(['spec-a-parent', 'spec-a-leaf', 'term-target']);
    expect(ids(await find('target', '--kind', 'term'))).toEqual(['term-target']);
  });
});

describe('tree of a unit', () => {
  /**
   * @canon spec-tree-of-a-unit-draws-the-tree-from-that-unit-down
   */
  it('draws the unit and the units that sit in it, and nothing else', async () => {
    const { stdout, status } = await run(await scratch(DOCUMENT, TESTS), 'tree', 'spec-a-parent');
    expect(status).toBe(0);
    expect(stdout).toContain('@spec A parent');
    expect(stdout).toContain('@spec A leaf');
    expect(stdout).toContain('@spec A sibling');
    expect(stdout).not.toContain('@axiom');
    expect(stdout).not.toContain('@spec A follower');
    expect(stdout).not.toContain('@term');
  });
});

describe('find with filters', () => {
  const find = async (...args: string[]) => await run(await scratch(DOCUMENT, TESTS), 'find', ...args);

  /**
   * @canon spec-find-with-several-kinds-lists-the-units-of-each-of-them
   */
  it('lists the units of each kind it is given, and of no other', async () => {
    expect((await find('target', '--kind', 'spec', '--kind', 'term', '--ids')).stdout).toBe('spec-a-parent\nspec-a-leaf\nterm-target\n');
    expect((await find('target', '--kind', 'axiom', '--kind', 'term', '--ids')).stdout).toBe('term-target\n');
  });

  /**
   * @canon spec-find-in-id-matches-a-word-in-the-id-alone
   */
  it('matches a word only in the id with --in id', async () => {
    expect((await find('leaf', '--ids')).stdout).toBe('spec-a-leaf\nspec-a-follower\n');
    expect((await find('leaf', '--in', 'id', '--ids')).stdout).toBe('spec-a-leaf\n');
  });

  /**
   * @canon spec-find-in-statement-matches-a-word-in-the-statement-as-show-prints-it
   */
  it('matches a word only in the statement with --in statement', async () => {
    expect((await find('prose', '--ids')).stdout).toBe('spec-a-leaf\n');
    expect((await find('prose', '--in', 'statement', '--ids')).stdout).toBe('');
    expect((await find('later', '--in', 'statement', '--ids')).stdout).toBe('spec-a-follower\n');
  });

  /**
   * @canon spec-find-in-body-matches-a-word-in-the-body-as-show-prints-it
   */
  it('matches a word only in the body with --in body, fenced blocks included', async () => {
    const dir = await scratch(
      canon(`
### @spec a-claim-with-a-block

> A claim holds.

Prose about the claim.

\`\`\`json
{ "target": "browser" }
\`\`\`
`),
      ''
    );
    expect((await run(dir, 'find', 'prose', '--in', 'body', '--ids')).stdout).toBe('spec-a-claim-with-a-block\n');
    expect((await run(dir, 'find', 'browser', '--in', 'body', '--ids')).stdout).toBe('spec-a-claim-with-a-block\n');
    expect((await run(dir, 'find', 'holds', '--in', 'body', '--ids')).stdout).toBe('');
  });

  /**
   * @canon spec-find-in-all-matches-a-word-as-find-does-without-a-part
   */
  it('matches a word in the id or the own text with --in all, as without --in', async () => {
    const dir = await scratch(DOCUMENT, TESTS);
    for (const words of [['leaf'], ['prose'], ['says', 'thing'], ['FOLLOWER']]) {
      expect((await run(dir, 'find', ...words, '--in', 'all')).stdout).toBe((await run(dir, 'find', ...words)).stdout);
    }
  });

  /**
   * @canon spec-find-with-no-words-lists-every-unit-its-filters-let-through
   */
  it('lists every unit its filters let through when it is given no word', async () => {
    expect((await find('--kind', 'axiom', '--kind', 'term', '--ids')).stdout).toBe('axiom-a-program-means-one-thing\naxiom-another-root\nterm-target\n');
    expect((await find('--ids')).stdout.split('\n').filter(Boolean)).toHaveLength(7);
  });
});

describe('the exit code of find', () => {
  const find = async (...args: string[]) => await run(await scratch(DOCUMENT, TESTS), 'find', ...args);

  /**
   * @canon spec-find-that-lists-a-unit-exits-with-code-0
   */
  it('exits with code 0 when it lists a unit', async () => {
    expect((await find('leaf')).status).toBe(0);
  });

  /**
   * @canon spec-find-that-lists-no-unit-exits-with-code-1
   */
  it('prints nothing on standard output and exits with code 1 when no unit matches', async () => {
    const { stdout, status } = await find('nowhere', '--ids');
    expect(stdout).toBe('');
    expect(status).toBe(1);
    expect((await find('nowhere')).status).toBe(1);
  });

  /**
   * @canon spec-find-with-a-kind-it-does-not-know-exits-with-code-2
   */
  it('says so, and exits with code 2, for a kind that is no kind of unit', async () => {
    const { stderr, status } = await find('leaf', '--kind', 'claim');
    expect(status).toBe(2);
    expect(stderr).toContain('"claim"');
  });

  /**
   * @canon spec-find-with-a-part-it-does-not-know-exits-with-code-2
   */
  it('says so, and exits with code 2, for a part it does not know', async () => {
    const { stderr, status } = await find('leaf', '--in', 'title');
    expect(status).toBe(2);
    expect(stderr).toContain('"title"');
  });
});

describe('tree of several units', () => {
  /**
   * @canon spec-tree-of-several-units-draws-the-tree-from-each-in-turn
   */
  it('draws the tree from each unit, in the order of the names', async () => {
    const dir = await scratch(DOCUMENT, TESTS);
    const forth = await run(dir, 'tree', 'spec-a-parent', 'spec-a-follower');
    expect(forth.status).toBe(0);
    expect(forth.stdout.indexOf('@spec A parent')).toBeLessThan(forth.stdout.indexOf('@spec A follower'));
    expect(forth.stdout).toContain('@spec A leaf');
    expect(forth.stdout).not.toContain('@axiom');
    const back = (await run(dir, 'tree', 'spec-a-follower', 'spec-a-parent')).stdout;
    expect(back.indexOf('@spec A follower')).toBeLessThan(back.indexOf('@spec A parent'));
  });
});

describe('--ids', () => {
  /**
   * @canon spec-find-with-ids-prints-the-id-of-each-unit-it-lists
   */
  it('prints the id of each unit find lists, one on each line, in the same order', async () => {
    const dir = await scratch(DOCUMENT, TESTS);
    const lines = (await run(dir, 'find', 'says', '--kind', 'spec')).stdout.trim().split('\n');
    const ids = (await run(dir, 'find', 'says', '--kind', 'spec', '--ids')).stdout;
    expect(ids).toBe(`${lines.map(line => line.split('  ')[1]?.split(' ')[0]).join('\n')}\n`);
    expect(ids).toBe('spec-a-parent\nspec-a-leaf\nspec-a-sibling\nspec-a-follower\n');
  });

  /**
   * @canon spec-show-with-ids-prints-the-id-of-each-unit-it-names
   */
  it('prints the id of each unit show is given, in the order of the names', async () => {
    const { stdout, status } = await run(await scratch(DOCUMENT, TESTS), 'show', '@spec A leaf', 'spec-a-parent', '@spec', 'a-follower', '--ids');
    expect(status).toBe(0);
    expect(stdout).toBe('spec-a-leaf\nspec-a-parent\nspec-a-follower\n');
  });

  /**
   * @canon spec-tree-with-ids-prints-the-id-of-each-unit-of-the-whole-tree
   */
  it('prints the id of each unit of the whole tree, once, in the order the tree draws them', async () => {
    const { stdout, status } = await run(await scratch(DOCUMENT, TESTS), 'tree', '--ids');
    expect(status).toBe(0);
    expect(stdout).toBe(
      ['term-target', 'axiom-a-program-means-one-thing', 'spec-a-parent', 'spec-a-leaf', 'spec-a-sibling', 'axiom-another-root', 'spec-a-follower', ''].join('\n')
    );
  });

  /**
   * @canon spec-tree-of-a-unit-with-ids-prints-the-ids-of-that-unit-and-what-sits-in-it
   */
  it('prints the id of the unit and of each unit tree draws under it', async () => {
    expect((await run(await scratch(DOCUMENT, TESTS), 'tree', 'spec-a-parent', '--ids')).stdout).toBe('spec-a-parent\nspec-a-leaf\nspec-a-sibling\n');
  });

  /**
   * @canon spec-tree-with-gaps-and-ids-prints-the-ids-on-the-branches-to-a-gap
   */
  it('prints the ids of the units on the branches that lead to an untested claim', async () => {
    const untested = TESTS.split('\n\n').filter(test => !test.includes('spec-a-leaf')).join('\n\n');
    expect((await run(await scratch(DOCUMENT, untested), 'tree', '--gaps', '--ids')).stdout).toBe('axiom-a-program-means-one-thing\nspec-a-parent\nspec-a-leaf\n');
    expect((await run(await scratch(DOCUMENT, TESTS), 'tree', '--gaps', '--ids')).stdout).toBe('');
  });

  /**
   * @canon spec-tree-with-suspect-and-ids-prints-the-id-of-each-suspect
   */
  it('prints the id of each spec tree --suspect lists', async () => {
    expect((await run(await scratch(DOCUMENT, TESTS), 'tree', '--suspect', '2', '--ids')).stdout).toBe('spec-a-leaf\n');
  });
});

describe('- for the names on standard input', () => {
  /**
   * @canon spec-show-reads-the-names-of-a-dash-from-standard-input
   */
  it('prints each unit a line of standard input names, as show prints a unit on its command line', async () => {
    const dir = await scratch(DOCUMENT, TESTS);
    const { stdout, status } = await piped(dir, 'spec-a-leaf\nspec-a-follower\n', 'show', '-');
    expect(status).toBe(0);
    expect(stdout).toBe((await run(dir, 'show', 'spec-a-leaf', 'spec-a-follower')).stdout);
    expect((await piped(dir, 'spec-a-leaf\n', 'show', '-', '--statement')).stdout).toBe((await run(dir, 'show', 'spec-a-leaf', '--statement')).stdout);
    // A command earlier in a pipeline can be slow to write, and a plugin can
    // touch standard input as it loads, which makes a pipe non-blocking; show
    // waits for the names all the same.
    const touchy = await scratch(`---\nplugins: ["canon-touchy"]\n---\n${DOCUMENT}`, TESTS, {
      files: {
        'node_modules/canon-touchy/package.json': JSON.stringify({ name: 'canon-touchy', version: '1.0.0', main: 'index.js' }),
        'node_modules/canon-touchy/index.js': `process.stdin.isTTY;\nexports.plugin = { name: 'touchy', commands: {} };`
      }
    });
    const slow = await pipedSlowly(touchy, 'spec-a-leaf\nspec-a-follower\n', 'show', '-', '--ids');
    expect(slow.stderr).toBe('');
    expect(slow.stdout).toBe('spec-a-leaf\nspec-a-follower\n');
  });

  /**
   * @canon spec-tree-reads-the-names-of-a-dash-from-standard-input
   */
  it('draws the tree from each unit a line of standard input names', async () => {
    const dir = await scratch(DOCUMENT, TESTS);
    expect((await piped(dir, 'spec-a-parent\n', 'tree', '-')).stdout).toBe((await run(dir, 'tree', 'spec-a-parent')).stdout);
    expect((await piped(dir, 'spec-a-parent\nspec-a-follower\n', 'tree', '-', '--ids')).stdout).toBe('spec-a-parent\nspec-a-leaf\nspec-a-sibling\nspec-a-follower\n');
  });

  /**
   * @canon spec-a-line-of-standard-input-names-a-unit-in-any-form-show-reads
   */
  it('reads a line as a unit named by its id, as a heading writes it, or in words', async () => {
    const input = 'spec-a-leaf\n@spec a-sibling\n@spec A follower\nCANON.md#spec-a-parent\n';
    expect((await piped(await scratch(DOCUMENT, TESTS), input, 'show', '-', '--ids')).stdout).toBe('spec-a-leaf\nspec-a-sibling\nspec-a-follower\nspec-a-parent\n');
  });

  /**
   * @canon spec-a-blank-line-of-standard-input-names-no-unit
   */
  it('reads no unit from a line of blank space', async () => {
    const { stdout, stderr, status } = await piped(await scratch(DOCUMENT, TESTS), '\nspec-a-leaf\n   \n\t\nspec-a-sibling\n\n', 'show', '-', '--ids');
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe('spec-a-leaf\nspec-a-sibling\n');
  });

  /**
   * @canon spec-a-dash-with-no-names-on-standard-input-prints-nothing
   */
  it('prints nothing, and exits with code 0, when standard input names no unit', async () => {
    const dir = await scratch(DOCUMENT, TESTS);
    for (const args of [['show', '-'], ['tree', '-'], ['tree', '-', '--ids'], ['tree', '-', '--gaps']]) {
      for (const input of ['', '\n\n']) {
        const { stdout, status } = await piped(dir, input, ...args);
        expect(stdout).toBe('');
        expect(status).toBe(0);
      }
    }
  });
});
