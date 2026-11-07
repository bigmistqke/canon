# @bigmistqke/canon-plugin-alloy

The Alloy plugin for [`@bigmistqke/canon`](../canon): the logic of a canon said in words, and checked by the [Alloy analyzer](https://github.com/AlloyTools/org.alloytools.alloy). It writes the statement of each unit from its formula, so that the statement cannot say what the logic does not, and it asks whether the claims of a canon contradict each other.

```bash
pnpm add -D @bigmistqke/canon @bigmistqke/canon-plugin-alloy
```

A document names the plugin in its frontmatter:

```md
---
plugins: ["@bigmistqke/canon-plugin-alloy"]
---
# Canon
```

It adds the command `alloy:logic` (or `logic` while no other plugin has a command of that name), writes the statements when you run `canon generate`, and reports the statements and the words that are not in order when you run `canon check`. A canon that extends another (`extends: ["../canon/CANON.md"]` in its frontmatter) says its statements with the readings of the other canon, and its model holds the claims of the other.

## Statements said from predicates

A document that keeps readings has the statement of each unit with an Alloy predicate written from that predicate, in the same words every time, so the statement cannot say anything the predicate does not. `canon generate` writes it between two markers below the unit's heading, and `canon check` reports it when it is missing or stale. No language model is involved.

```md
| reading | holds              | does not hold              |
| ------- | ------------------ | -------------------------- |
| Ran     | {1} has run        | {1} has not run            |
| dispose | pulse disposes {1} | pulse does not dispose {1} |
```

A reading table has the headers `reading`, `holds` and `does not hold`, and a noun table the headers `signature` and `noun`:

```md
| signature | noun               |
| --------- | ------------------ |
| Installed | [installed plugin] |
```

A signature named after the term that declares it needs no noun row: `sig Owner`, declared in the term `owner`, has the noun `[owner]`, which links to that term. `canon generate` lines up the columns of each table. A `readings` fence holds the same lines naturalloy reads, `Ran: {1} has run | {1} has not run` and `noun Owner: owner`, and the plugin reads it too.

The words come from [naturalloy](../naturalloy), which says a formula only in words that translate it without loss and refuses one it cannot say that way. Its README says how a formula reads.

A line gives the positive and the negative reading of a set, a field, a relation or an event of the vocabulary, with `{1}`, `{2}` for the variables it is about, and `noun Name: words` gives the noun of a signature. A word in brackets names a term and links to it, so that a statement points at the definitions it relies on: `Freelancing: checker reports a [freelancing] for {1} | …`, `noun Unit: [unit]`, where the first variable of the type links to the term. It links to the unit that holds the line, or to the unit it points at, `[checker](#term-checker)`. Only the first mention of a term in a statement is a link, a statement never links to its own unit, and the text layout has no links. A name or a construct with no words is reported, never skipped. `canon alloy:readings` lists each reading with where it is, its unit and its key. `canon alloy:readings <key> --write "<positive> | <negative>"` rewords the one reading with that key in place, and names the statements that are stale until `canon generate`. [`fixtures/lifetimes/CANON.md`](fixtures/lifetimes/CANON.md) is an example: its readings, its predicates, and the statements said from them.

`canon check` also checks the words of such a document, with no Java. The terms are where the words are named, so the declaration of a word and the readings that say it belong in its term. It reports a reading of a word that nothing declares (`undeclared`), a declaration that is not in a term (`misplaced`), a reading in another unit than the declaration it says (`apart`), a word that no claim, definition or fact uses (`unused`), and a formula that uses a signature no other unit and no scenario names (`lone`). No other formula can contradict a lone formula, so tie the signature to the model, or drop the formula and write the statement by hand. The check reads names only, so the canon of the plugin lists where it falls short of that.

A scenario, a block that says a situation must be possible, is said the same way, just above its block, under the words "It must be possible that:", so that a reader sees a possibility claim and not a rule. Its statement goes by the place of the scenario among the scenarios of its unit, `scenario-1-term-checker`, and `check` reports it when it is missing, stale or cannot be said.

A document that extends another (`extends` in its frontmatter) says its statements with the readings of the extended document too, and a word of the extended document links to that document, `[unit](../canon/CANON.md#term-unit)`. The words the extended document declares count as declared in the words check. `generate` writes statements only in the documents the project checks, never in the ones they extend.

Under the generated statement, and under a "Derives from:" line if the unit has one, the author writes the intent of the unit: the prose up to its first fenced block or `<details>` fold. `canon alloy:intent <unit>` prints it, under the place and the id of the unit. `canon alloy:intent <unit> --write` reads a new intent from standard input and puts it in place of the old one, and changes nothing else. It refuses text with a fence, a heading, a quote, a comment, or a "Derives from:" or "Site:" line. In a document that keeps readings, `canon check` reports a unit with a formula and no intent (`intentless`).

The statement is the plugin's to write: `generate` never overwrites one that a person wrote, and says so; delete it to let it be generated. In a document that keeps readings, a statement outside the markers is `handwritten`, whatever else its unit holds. Keep the sentence of a person in the body, below the generated statement, as an explanation that adds no claim. A document that keeps no readings is left as it is.

## The logic layer

A unit can hold fenced blocks next to its statement. `canon alloy:logic` hands the `alloy` blocks of the documents to the [Alloy analyzer](https://github.com/AlloyTools/org.alloytools.alloy) and asks whether each scenario can happen while every unit holds. When one cannot, it names the units a repair has to touch.

The claims of the documents a document extends join its model, so a claim of the document that contradicts one of theirs is found, and the report names both. A group of units that holds no block of the checked document is left to the document that holds it. The analyzer is started once for each run, as many at a time as the machine has processors; `CANON_ALLOY_JOBS` sets another number.

````md
```alloy vocabulary   the signatures, relations and events the units share
```alloy bounds       the scope of the search, `for 3 but 1..8 steps` by default
```alloy scenario     a situation the units must allow, on any unit
```alloy              the unit's own predicate; a bare formula is named after the unit
````

In a document that keeps no readings, a person writes each statement. A unit with a predicate then also holds a `map` block, whose lines say which words of the statement became which part of the predicate. A person reads a map against both and marks it reviewed:

````md
```map reviewed=3d2900e5d6b6
"each cleanup that code has registered on the owner" -> c in Registered and c.on = o
"did not run" -> c not in Ran
```
````

`canon alloy:logic` reports a map that is missing or malformed, a fragment that is not in the statement, a part that is not in the predicate, and a sentence of the statement that no line covers. It also reports a map that is unreviewed, or stale: the mark is a hash of the statement, the predicate and the map, so a change to any of them needs a new review. `canon alloy:logic --review <unit>` writes the mark, as the reviewer's word that the map is right. These checks read text only and need no Java.

The logic checks need the analyzer's jar and a Java 17 or later, which `canon` does not install:

```md
---
plugins: ["@bigmistqke/canon-plugin-alloy"]
logic: {alloy: {jar: tools/alloy.jar, java: /opt/homebrew/opt/openjdk@21/bin/java}}
---
```

A scenario that cannot happen is a strong result: no world within the bounds has it. A scenario that can happen is a weak one. The model may reach it through a way out that the system does not have. So `canon alloy:logic --show <scenario>` prints, after the report, the world the analyzer found, and you can see which way it took. Name the scenario by the id of its statement, and repeat `--show` for more:

```
  the world of scenario-1-spec-a-claim-ends:
    c is claim_1
    throughout:
      claim_1 belongs to holder_1
    step 0:
      lane_1 holds claim_1
    step 1:
      + claim_1 has ended
      + lane_1 holds claim_2
      - lane_1 holds claim_1
    then back to step 1
```

A thing is named after its noun and its number, as a variable of a statement is. A tuple that is true at every step appears once, under `throughout:`. The first step says every other tuple that is true, and each later step says what became true (`+`) and false (`-`).

The positive reading of a word says each of its tuples. A word with no reading appears in Alloy, `Ended: claim_1`. A thing that no sentence names gets a line of its own, `AtOnce$0 exists`. So the world keeps every tuple. A scenario that cannot happen has no world, and its report names the units to change.

`CANON_ALLOY_JAR` and `CANON_JAVA` give the same paths. The result holds only within the bounds. See [`fixtures/lifetimes/CANON.md`](fixtures/lifetimes/CANON.md).
