# @bigmistqke/naturalloy

Alloy formulas said in English, from a table of readings, without loss. naturalloy says a formula only in words that say what it says and nothing else, and it refuses a formula it cannot say that way. It never guesses, and no language model is involved: the same formula and the same readings give the same words every time.

```bash
pnpm add @bigmistqke/naturalloy
```

```ts
import { parseReadings, verbalize, withDefinitions } from '@bigmistqke/naturalloy';

const readings = withDefinitions(
  parseReadings(`
noun Owner: an [owner]
noun Cleanup: cleanup
Ran: {1} has run | {1} has not run
on: {1} is on {2} | {1} is not on {2}
dispose: pulse disposes {1} | pulse does not dispose {1}
`, '#term-owner'),
  'sig Owner {} sig Cleanup { var on: lone Owner } var sig Ran in Cleanup {} pred dispose[o: Owner] { some o }'
);

verbalize('always all o: Owner, c: Cleanup | (dispose[o] and c.on = o) implies eventually c in Ran', readings);
// From now on, for every owner and every cleanup:
//   when pulse disposes the owner and the cleanup is on the owner, then now or later, the cleanup has run.
```

The [canon plugin for Alloy](../canon-plugin-alloy) uses naturalloy to write the statement of each unit of a canon from its formula.

## Readings

A table of readings says each name a formula uses. A line `key: positive | negative` gives the words for a set, a field, a relation (`Clock.older`), a primed set (`Throwing'`) or a predicate, with `{1}`, `{2}` for the variables it is about. A line `noun Name: words` gives the noun of a signature, with the article it takes when the sound of the word would choose the wrong one (`noun Hour: an hour`). Blank lines and lines that start with `#` are skipped.

`withDefinitions(readings, vocabulary)` adds what the vocabulary declares: the predicates, so that a predicate with no line of its own is said by its body, the fields and `var` signatures, whose types and changes some constructs need, and the signature each signature is declared `in` or `extends`.

## How a formula reads

A formula reads as sentences where it can. A "there is" or "there is no" over a variable that is said once becomes a noun phrase in its place: `spec S1 cites no axiom`, `unit U1 names an issue that tracker does not know`, `another unit sits in unit U1`, `a test checks a bug that sits in unit U1`; what else is true of the variable becomes a relative clause. Up to three short clauses stand in one sentence, a subject that two clauses share is said once, and a rule that fits on a line says "when …, …". A definition whose alternatives each begin by saying what kind of thing it is about is said by cases, one noun phrase to a kind. Anything that does not fit these is said in full, with "there is … such that" and lists.

A variable is named after the first letter of its noun and the number it is, `U1`, `U2`, `S1`, whatever the formula called it, and its noun comes before its name wherever the words name it: `for every unit U1 and every unit U2`, `unit U1 cites unit U2`. Two nouns of one statement that begin alike take more letters until they differ, `Un1` for a unit and `Us1` for a use, and a noun of several words takes the first letter of each, `LF1` for a listing frontmatter. A variable that is the only one of its noun, where no other word says that noun, is named the noun alone: `the unit`. The names are given again in each statement. In the Markdown layout, a line that opens a part of the statement ends in a line break, `\`, in place of an empty line.

The temporal operators read as moments: `always` is "now and at every later moment", `eventually` "now or at a later moment", `after` "at the next moment", `before` "there is a moment before, and at it", `once` "now or at an earlier moment", `historically` "now and at every earlier moment". `until` and `since` read in two parts, the moment where the second side holds and the stretch of moments where the first does, each set apart. `releases` and `triggered` read as the alternatives they mean: `a releases b` is `always b or (b until (a and b))`. `;` reads as one clause where both its sides are plain clauses. A primed set or field with no line of its own reads "at the next moment, …" when it is the one changing part of its clause.

A field after a variable, `y.f`, is said with the reading of the field. A transpose of it, `y.~f`, is the navigation the other way. Two values compared, or a field of many values compared with a variable, are said member by member, over the type the field declares. In `some S` and `no S`, a member of the signature that holds `S` takes the place of the variable of its reading: "an edge is being delivered". A quantifier over a set with no noun ranges over that signature.

The verbalizer says any other expression through members of the types of its columns, which the vocabulary declares. A union reads "or" and an intersection "and". A chain of navigations goes through a member between: "c is on an owner that p is the parent of". The verbalizer says an expression member by member where a comparison, an equality, or `some`, `no`, `one` or `lone` takes it.

An override, a restriction, `iden`, `none` and a set comprehension each read as the memberships they mean. A closure reads "o reaches p in one or more steps", and a reading of the relation says what a step is. A call takes an expression where its body or its reading can say it. A function or a macro reads by its own reading, or else by its body.

`iff` reads "exactly when", or "both or neither of these hold". `implies … else …` reads "when …, …; otherwise, …". `one` and `lone` read "exactly one" and "at most one". A `not` before a compound moves inward where an equal formula has it on clauses. Elsewhere it reads "it is not the case that:", with the formula set apart. A `let` reads with its values in place. 

A time phrase at the start of a sentence covers the whole sentence. Where it covers one part, the parts are bullets. A part whose end the words cannot mark is set apart on lines of its own, below "the following holds": a time phrase before another, a rule inside a rule, and a side of `until` that is more than one plain clause.

The analyzer keeps integers in a fixed bit width and wraps a number that leaves it. So a comparison of integers opens with "in integers that wrap around at the analyzer's bit width". A count, a sum or a division gets a name, `number_1`. The words after "where" say what it is: "the number of values of owner O1 such that c is on owner O1". A division says how it rounds and what dividing by zero gives.

Whatever cannot be said without loss is refused with the reason, never skipped: a name with no reading, a reading that leaves out a variable the formula gives, a comparison of sides that Alloy does not compare, a construct with no words. Among those constructs are a variable of several things, an arrow with a multiplicity and a shift. Two sets compared are said member by member. [Issue #29](https://github.com/bigmistqke/canon/issues/29) lists, production by production of Alloy's grammar, what is said and what is not yet.

## Links

`verbalize(formula, readings, 'markdown', self)` writes links; the text layout has none. A word in brackets in a reading names a term and links to it: `[freelancing]` links to the place that holds the table, the href given to `parseReadings`, and `[checker](#term-checker)` links to the href it names. Only the first mention of a term is a link, and nothing links to `self`, the href of the place the words are for. A table held in another document is read with `base`, the path to that document, so that its links to anchors of its own (`#term-unit`) go through the path.

## Canon

naturalloy has its own [canon](CANON.md): the claims of how it reads and says a formula, each with a test that cites it. Where it says a formula through another, a test asks the Alloy analyzer for a world in which the two differ, for each rewrite that a sweep of some 1700 formulas makes.
