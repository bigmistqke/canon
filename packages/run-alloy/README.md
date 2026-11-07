# @bigmistqke/run-alloy

The [Alloy analyzer](https://github.com/AlloyTools/org.alloytools.alloy) run from Node: each program in a Java process of its own, no more processes at once than the machine holds, and each answer kept for the next run. The Alloy plugin of the canon checker runs the analyzer through it, and so do the tests of naturalloy and parse-alloy.

```ts
import { analyzerOf, ask, cacheFolder, sweep } from '@bigmistqke/run-alloy';

const analyzer = analyzerOf(); // CANON_ALLOY_JAR, and CANON_JAVA or `java`
const folder = cacheFolder({ fallback: '.cache/canon-alloy' });
const output = await ask(analyzer!, { text: 'sig A {}\nrun {} for 3\n' }, ['exec', '-f', '-c', '*'], ran => ran.output, { folder, form: 'output' });
if (folder) sweep(folder);
```

- `run(analyzer, program, args, read)` runs `java -jar alloy.jar <args> -o <out> <file>` in a temporary folder that holds the program and the files beside it, and gives what `read` makes of the ended process. A process that wrote no `receipt.json` gives `{ error }`, and so does a `read` that throws.
- `ask(…, { folder, form })` is `run` with a folder of kept answers. An answer is kept under a hash of the program, the files beside it, the content of the jar, the options of Java and the analyzer, `form`, and the major version of Java. A failure is never kept, nor the answer of a process that exited with another code than 0: the analyzer exits with 1 both for a command it cannot translate and for a process out of memory. `attempt` is `run` that also says whether the process exited with 0.
- Each process runs with `-Xmx1g`, or with the heap `CANON_ALLOY_HEAP` sets, such as `2g` or `512m`. No more of them run at once than the machine has processors, nor than half of its memory holds at that heap. `CANON_ALLOY_JOBS` sets another number.
- `cacheFolder({ set, fallback })` is the folder of kept answers: `set`, else `CANON_ALLOY_CACHE_DIR`, else `fallback`. `CANON_ALLOY_CACHE=0` gives none.
- `sweep(folder)` removes each kept answer that no run used in 30 days. It sweeps a folder once in a process; a later call does nothing.
- `@bigmistqke/run-alloy/testing` is for tests only: `fakeAnalyzer`, a stand-in for Java and the analyzer that logs each call, and `forgetSweeps`, so that a test can sweep a folder twice in one process.

[`CANON.md`](CANON.md) says what it does and why.
