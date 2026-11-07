# @bigmistqke/parse-alloy

A parser for Alloy 6 in TypeScript: Alloy as a string in, a typed syntax tree out, grouped exactly as the [Alloy analyzer](https://github.com/AlloyTools/org.alloytools.alloy) groups it. It refuses, with the place and the reason, anything it cannot read that way. No dependencies, synchronous, no Node APIs.

```bash
pnpm add @bigmistqke/parse-alloy
```

```ts
import { parseModule, parseFormula, print, AlloyParseError } from '@bigmistqke/parse-alloy';

parseFormula('all c: Cleanup | c in Ran implies eventually c in Done');
// { t: 'quant', q: 'all', decls: [{ names: ['c'], type: { t: 'name', name: 'Cleanup' } }],
//   body: { t: 'implies', l: { t: 'cmp', op: 'in', … }, r: { t: 'unary', op: 'eventually', … } }, span: { start: 0, end: 54 } }

print(parseFormula('a or b and c iff d'));
// '(a || ((b && c) <=> d))'

parseModule('sig A { f: set A }\nfact { all x: A | x !in x.^f }');
// { t: 'module', opens: [], paragraphs: [{ t: 'sig', names: ['A'], fields: [...] }, { t: 'fact', body: ... }], comments: [] }
```

- `parseModule(text)` reads a whole `.als` file, or a vocabulary block: the `module` header, `open` lines and paragraphs. A paragraph is a `sig` with its fields and fact, a `pred`, `fun`, `fact`, `assert`, `enum`, `let` macro or a command. Comments come back as a list of spans.
- `parseFormula(text)` and `parseExpression(text)` read one formula or expression. Alloy reads both with one grammar.
- `print(node)` writes a tree back as Alloy with every group in parentheses.
- Every node has a `span`. A name stays as written: `p[x]` is a `call`, which may also be a box join, because only the types decide.
- Anything it cannot read throws an `AlloyParseError` with the `span`, `line` and `column`, and what it expected. It never returns a partial tree.

## How it is tested

The tests read every model in the analyzer's own jar, 94 of them: all parse. For every fact, assertion, predicate and function in them, the analyzer checks the body as written against the body printed with every group in parentheses, and finds no counterexample: 633 parts. Where the analyzer cannot decide a whole body, because it quantifies over relations, it checks the parts. Two models, `s_ringlead.als` and `ins.als`, are beyond the analyzer: their own commands fail too. Set `CANON_ALLOY_JAR` (and `CANON_JAVA` when `java` is older than 17) to run these tests; without a jar they are skipped.

It follows the syntax of the Alloy analyzer 6.2.0 (`794226d`): `Alloy.cup`, `Alloy.lex` and `CompFilter.java`. [Issue #34](https://github.com/bigmistqke/canon/issues/34) describes its design. [naturalloy](../naturalloy) builds on it to say formulas in English.

parse-alloy has its own [canon](CANON.md): the claims of how it reads Alloy, each with a test that cites it.
