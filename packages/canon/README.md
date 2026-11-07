# @bigmistqke/canon

The checker for a project's canon: the derivation links between `CANON.md`, the tests that cite it and the code it names. The protocol it serves is the [`canon` skill](https://github.com/bigmistqke/canon/tree/main/skills/canon).

```bash
pnpm add -D @bigmistqke/canon
```

```json
{
  "canon": { "documents": ["CANON.md"], "suites": "test/canon", "sources": ["src", "test"] }
}
```

`canon --help` lists the commands and every finding `check` reports. Needs Node 22 or later.

## The command line

`canon <command>` runs in the project of the folder you call it from: the scope is the frontmatter of the nearest `CANON.md` that holds a setting, from that folder upwards, or the `canon` field of `package.json` while no document holds one. The commands fall in three groups: `check` and `generate` keep the canon closed, `tree`, `show` and `find` read it, and `rename` and `log` change it and the history around it.

### Keeping the canon closed

```bash
canon check              # every finding; exits 1 on a finding
canon check --offline    # the same, without asking the tracker about the issues of bugs and conflicts
canon generate           # rewrite the generated regions: the index of each document, and what plugins generate
```

`check` reads the documents, the suites and the sources, and prints each kind of finding with its count and its entries. It ends with `clean` and exits 0, or exits 1 when there is a finding, or 2 when a check could not run. A stale generated region is a finding, which `generate` fixes. `canon --help` lists every finding and what it means.

### Reading the canon

Read the canon through these commands, not through a search of its text: a search finds the heading of a unit, and misses the units above it, the units that derive from it and the tests that check it.

```bash
canon tree                       # the terms, the facts, the conflicts and threads, then the derivation tree of each axiom
canon tree -v                    # the same, with each unit's statement under its stem
canon tree --gaps                # only the branches that lead to a claim no test checks
canon tree --suspect 3           # specs with no nested specs and three or more tests
canon tree spec-a-stem           # one unit and what sits in it
canon tree spec-one spec-two     # the tree from each unit, in the order named
```

The tree counts the tests of each claim, and marks a leaf with none. `├─` is nesting, the ordinary citation; `├╌` is a spec in a table that links to its parent; `→` is a further parent from a "Derives from:" line.

```bash
canon show spec-a-stem                 # the unit's own text, the units it sits in up to its root, the units
                                       # its "Derives from:" line names, the units that sit in it, the units
                                       # that derive from it, and the tests that check it
canon show spec-a-stem --statement     # only its statement, as it reads: no quote marks, each link as its words
canon show spec-a-stem --body          # only the rest of its own text, as written
canon show spec-one spec-two           # several units, in the order named
```

`show` and `tree` take a unit in any of these forms, so a name can be copied from wherever it was seen:

| form | where it comes from |
| --- | --- |
| `spec-a-stem` | the id, as a test cites it |
| `"@spec a-stem"` or `@spec a-stem` | the heading of the unit |
| `"@spec A stem"` | the tree |
| `CANON.md#spec-a-stem` | a finding of `check` |

A name that names no unit is reported, and the run exits with code 2 after printing the units it found. A unit that lacks a part `show` was asked for prints `none` under its id.

```bash
canon find cache flush                 # the units whose id or own text holds every word, in any case
canon find cache --kind spec           # only specs
canon find cache --kind spec --kind exception   # specs and exceptions
canon find cache --in statement        # only units whose statement holds the word
canon find --kind fact                 # no word: every unit the filters let through, here every fact
```

Each line of `find` holds the document and the line where the unit starts, its id and its statement. `--kind` takes `axiom`, `fact`, `spec`, `exception`, `bug`, `conflict`, `thread` or `term`, and can be given more than once. `--in` says where a word must stand:

| `--in` | a word matches when it stands in |
| --- | --- |
| `all` (the default) | the id or the own text of the unit, fenced blocks included |
| `id` | the id |
| `statement` | the statement, as `show --statement` prints it |
| `body` | the rest of the own text, as `show --body` prints it |

`find` exits as `grep` does: 0 when it lists a unit, 1 when it lists none, and 2 on bad usage, such as a kind or a part it does not know. A script can ask `canon find … > /dev/null` whether the canon holds a unit.

### Composing commands

The reading commands join in a shell pipeline, so that `xargs`, `sort`, `comm`, `wc -l` and the other commands work on units.

- `--ids` makes `find`, `show` and `tree` print the id of each unit they would print, one on each line, and nothing else: no header, no statement, no blank line. `tree --ids` prints each id once, in the order the tree draws them, and works with a unit, `--gaps` and `--suspect` too. `show --ids` turns names of any form into ids.
- `-` in place of the units of `show`, `tree` and `alloy:intent` reads the names from standard input, one on each line, in any form the command reads on its command line. A blank line names no unit. When standard input names none, the command prints nothing and exits 0: `tree -` never falls back to the whole tree. `alloy:intent --write` takes the new intent from standard input, so `-` is no name there.

```bash
canon find ConditionApart --ids | canon show - --statement         # the statements of the units that hold a word
canon find --kind fact --ids | wc -l                               # how many facts the canon has
canon tree spec-a-parent --ids | canon show - --statement          # the statements of a unit and what sits in it
comm -12 <(canon tree --gaps --ids | sort) <(canon find flush --ids | sort)   # untested branches about flushing
canon find --kind spec --in statement formula --ids | canon alloy:intent -    # the intents of specs with that word
```

### Changing the canon by its units

```bash
canon rename spec-a-leaf a-single-leaf             # give a unit a new stem, and move every name of it
canon rename spec-a-leaf a-single-leaf --dry-run   # print each line it would change, and change nothing
canon log                                          # commits that change the implementation without naming a unit
canon log main..HEAD                               # the same, over a range
```

`rename` keeps the kind of the unit. It moves the heading, every pointer in the documents and the references, every `@canon` tag and every link in a comment, every code span that is the id, and every generated region named after the unit, then writes the generated regions. It changes no file and exits 2 when the old id names no unit, the new id is in use, or the new stem is not a stem.

`log` lists the commits that change the implementation without naming a unit in their message. With no range it checks the commits not yet pushed. It exits 1 when it lists one.

### Commands of plugins

A plugin adds commands under the name of its package, such as `retext:lint`, `alloy:logic`, `alloy:intent`, `alloy:readings` and `pele:graph`; [Plugins](#plugins) says how. `canon --help` lists them.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | success: no finding, or `find` listed a unit |
| 1 | `check` or `log` found something, or `find` listed no unit |
| 2 | bad usage, or a check that could not run |

## Plugins

The command `retext:lint` comes from [`@bigmistqke/canon-plugin-retext`](../canon-plugin-retext), and `alloy:logic` from [`@bigmistqke/canon-plugin-alloy`](../canon-plugin-alloy), so `canon` itself depends only on [acorn](https://github.com/acornjs/acorn) and its TypeScript plugin, which read the tests and comments of a suite: `retext:lint` brings the packages that read prose, and `alloy:logic` needs a Java and the Alloy analyzer. A document chooses its plugins in its frontmatter, a block between two lines of `---` at the very top, and names each by the package that holds it:

```md
---
plugins: ["@bigmistqke/canon-plugin-retext", "@bigmistqke/canon-plugin-alloy"]
---
# Canon
```

A document gets the plugins it names and no others, and a document with no `plugins` key, or with `plugins: []`, names none. A plugin's commands run over the documents that name it; a file named on the command line is always run.

Any other name is a package too. It is looked up from the project root, so it has to be a dependency of the project: a document can choose among the packages the project already has and cannot make `canon` fetch or run anything new. The package exports a `plugin`, described by the types in `@bigmistqke/canon/plugin`:

```ts
import type { Plugin } from '@bigmistqke/canon/plugin';

export const plugin: Plugin = {
  name: 'example',
  commands: {
    check: ({ documents }) => 0, // adds to `canon check`
    explain: ({ args }) => 0 // a command of its own: `canon example:explain` from the package `canon-plugin-example`
  }
};
```

A command gets the arguments, the project root, the documents that name the plugin and the plugin's own options, and returns an exit code: 0 when everything holds, 1 when there is a finding, 2 when a check could not run. A plugin adds to `check` and `generate` under those names, and the same one from several plugins runs them all, with the highest exit code. Every other command is the plugin's own, under the name of its package: `@bigmistqke/canon-plugin-<name>` adds `<name>:<command>`. Its bare name, `<command>`, runs it too while no other plugin has a command of that name; when two do, the run names both and exits with code 2. Its entry has to be reachable by `require`, through `main` or an `exports` entry with a `default` condition.

The frontmatter reads a small part of YAML, all of it valid YAML: the keys `plugins` and `extends`, with a list of strings, inline (`["a", "b"]`) or as lines that start with a dash. A name that starts with `@` must be quoted. Any other key is an error, so a misspelled key cannot silently drop a check.

`extends` lists the paths of the documents this document extends, each read from the folder of the document that lists it, as a link in the document would be:

```md
---
extends: ["../canon/CANON.md"]
---
```

An extended document is context. Its units and its words are read with the document, and it is checked where it lives, so its units owe nothing in the document that extends it. A document extends what the documents it extends extend. An id that both declare is reported, because a pointer or a tag cannot say which of the two units it names. A path that names no document, and an extension that leads back to a document on the way, are refused with exit code 2. `check` and `generate` run what the plugins add to them, and read the frontmatter only to know which plugins apply.

## The logic layer

A canon can keep its claims as logic. [`@bigmistqke/canon-plugin-alloy`](../canon-plugin-alloy) is the plugin that says them in words, one statement under each unit, and that asks the Alloy analyzer whether the claims of a canon can all be true. Install it and name it in the frontmatter of the documents that use it. A canon can extend another canon, `extends: ["../canon/CANON.md"]`, to use its words and its claims.
