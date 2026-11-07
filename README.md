# skills

Agent skills by [bigmistqke](https://github.com/bigmistqke), and the tools they drive.

## Install

Any agent that reads [Agent Skills](https://agentskills.io):

```
npx skills add bigmistqke/canon
```

Claude Code, as a plugin:

```
/plugin marketplace add bigmistqke/canon
/plugin install canon@bigmistqke
```

## canon

A project keeps its theory — how the program meets the world it serves, in the sense of Peter Naur's [Programming as Theory Building](https://gwern.net/doc/cs/algorithm/1985-naur.pdf) — in a `CANON.md` of axioms, facts, specs and exceptions. Tests cite the units, the code expresses them, and a checker reports every claim, test or link that goes stale.

- [`skills/canon`](skills/canon/SKILL.md): the protocol for working in a project with a `CANON.md`.
- [`skills/grill-with-canon`](skills/grill-with-canon/SKILL.md): settle a design question the canon does not decide by interviewing the owner of the design, and write each answer into the canon.
- [`packages/canon`](packages/canon): the checker, published as `@bigmistqke/canon`. A project installs it as a dev dependency so it runs in CI too; [`checker.md`](skills/canon/checker.md) has the setup.
- [`packages/canon-plugin-retext`](packages/canon-plugin-retext): the prose checks, published as `@bigmistqke/canon-plugin-retext`.
- [`packages/canon-plugin-alloy`](packages/canon-plugin-alloy): the logic checks and the generated statements, published as `@bigmistqke/canon-plugin-alloy`.

## Development

```
pnpm install
pnpm test         # the checker's tests, and that the kinds table in writing-units.md is current
pnpm generate     # rewrite that table from the checker's ruleset
pnpm lint:prose   # the checker's language checks, on the skills
```

Publish the checker from `packages/canon`, with an npm token in `NPM_TOKEN`:

```
pnpm bump
pnpm publish
```

## License

MIT
