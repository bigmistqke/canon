/**
 * The canons of the checker, of naturalloy and of the Alloy plugin, written in Alloy: their
 * statements are what their predicates and definitions say, the words of each
 * are in order, and the checker passes each. This file tests the checker's own
 * tooling, not a project's canon, so it carries no `@canon` tag.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBlocks } from '@bigmistqke/canon/blocks';
import { readUnits } from '@bigmistqke/canon/units';
import { readingsOf, states, write } from '../../src/statements.ts';
import { checkWords } from '../../src/words.ts';
import { CLI, CORE, NATURALLOY, PACKAGE } from '../canon/cli.ts';

const read = (dir: string): string => readFileSync(join(dir, 'CANON.md'), 'utf8');
const CORE_CANON = read(CORE);
const NATURALLOY_CANON = read(NATURALLOY);
const CANONS = [
  { name: 'the checker', dir: CORE, src: CORE_CANON, context: [] as { path: string; src: string }[], least: 100 },
  { name: 'naturalloy', dir: NATURALLOY, src: NATURALLOY_CANON, context: [] as { path: string; src: string }[], least: 117 },
  {
    name: 'the Alloy plugin',
    dir: PACKAGE,
    src: read(PACKAGE),
    context: [
      { path: '../canon/CANON.md', src: CORE_CANON },
      { path: '../naturalloy/CANON.md', src: NATURALLOY_CANON }
    ],
    least: 100
  }
];

describe.each(CANONS)('the canon of $name', ({ dir, src, context, least }) => {
  const units = readUnits(src);

  it('has the units it had, and only grows', () => {
    expect(units.length).toBeGreaterThanOrEqual(least);
  });

  it('has the statement of every claim, every defined word and every scenario written from its formula', () => {
    expect(states(src, context).filter(s => s.kind !== 'current')).toEqual([]);
    expect(write(src, context)).toEqual({ src, written: [] });
  });

  it('links the words of every statement to terms that a document declares, and never a statement to its own unit', () => {
    const statements = new Map(units.map(u => [u.id, u.statement ?? '']));
    const own = new Set(units.filter(u => u.kind === 'term').map(u => u.id));
    const extended = new Set(context.flatMap(c => readUnits(c.src)).filter(u => u.kind === 'term').map(u => u.id));
    // the statements of units; a scenario has a statement of its own, which no unit holds
    for (const id of states(src, context).map(s => s.unit).filter(id => statements.has(id))) {
      const said = statements.get(id) ?? '';
      expect(said).not.toContain(`(#${id})`);
      for (const [, target] of said.matchAll(/\]\(#([\w-]+)\)/g)) expect(own.has(target as string)).toBe(true);
      for (const [, target] of said.matchAll(/\]\(\.\.\/canon\/CANON\.md#([\w-]+)\)/g)) expect(extended.has(target as string)).toBe(true);
    }
  });

  it('keeps the bugs as prose, since a bug states what the code does wrong, which the specs forbid', () => {
    const logic = new Set(readBlocks(src).filter(b => b.lang === 'alloy' && b.role === 'unit').map(b => b.unit));
    for (const bug of units.filter(u => u.kind === 'bug')) expect(logic.has(bug.id)).toBe(false);
  });

  it('gives every name a claim uses words, and every word a body or a declaration', () => {
    expect(readingsOf(src, context)).toBeDefined();
    expect(checkWords(src, context.map(c => c.src))).toEqual([]);
  });

  it('passes the check of the checker', () => {
    const run = spawnSync(process.execPath, [CLI, 'check', '--offline'], { cwd: dir, encoding: 'utf8' });
    expect(run.stdout).toMatch(/^units: \d+$/m);
    expect(run.stdout).toMatch(/^clean$/m);
    expect(run.status).toBe(0);
  });
});

describe('the canon of the checker', () => {
  it('names the terms it uses in the first statement that mentions them, by term mark', () => {
    const statements = new Map(readUnits(CORE_CANON).map(u => [u.id, u.statement ?? '']));
    expect(statements.get('term-unfounded')).toContain('*cites*');
    expect(statements.get('term-unfounded')).toContain('*spec*');
    expect(statements.get('spec-a-spec-cites-an-axiom-or-a-spec')).toContain('*checker* reports a *freelancing*');
  });
});
