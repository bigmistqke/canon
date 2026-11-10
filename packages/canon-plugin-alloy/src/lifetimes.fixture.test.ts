/**
 * The lifetimes fixture, an example canon: its generated statements are current,
 * and the reported-failure spec says what pulse states. This file tests the
 * example project, not a claim of the checker's canon, so it carries no `@canon` tag.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { states, write } from './statements.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'lifetimes');
const src = readFileSync(join(FIXTURE, 'CANON.md'), 'utf8');

describe('the units of the lifetimes fixture', () => {
  it('has the statement of all six specs and of its scenario written from their formulas, as the document has them', () => {
    expect(states(src).map(s => s.kind)).toEqual(Array(7).fill('current'));
    expect(write(src)).toEqual({ src, written: [] });
  });

  it('says both sentences of the reported-failure spec, as pulse states them', () => {
    // Pulse: "An error that an owner's cleanup throws during its dispose reaches the nearest error handler or boundary above that owner. The dispose does not throw."
    expect(src).toContain('when pulse has disposed the owner and a [*failing cleanup*](#term-failing-cleanup) that runs is on the owner, then from now on, the dispose of the owner has not thrown');
    expect(src).toContain('>   - owner O2 is the nearest error handler or boundary above owner O1');
    expect(src).toContain('>   then now or later, the error of the failing cleanup has reached owner O2.');
  });
});
