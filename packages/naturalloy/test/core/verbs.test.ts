/** The standard verbs, as the verb terms of VERBS.md give them. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_VERBS } from '../../src/core/verbs.ts';
import { verbLines, written } from './verbs.ts';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'core', 'verbs.ts');

describe('the standard verbs', () => {
  /**
   * @canon spec-the-standard-verbs-are-the-verb-terms-of-verbs-md
   */
  it('are the verb terms of VERBS.md, as src/core/verbs.ts holds them', () => {
    expect(readFileSync(SOURCE, 'utf8')).toBe(written());
    expect(STANDARD_VERBS.get('holds')).toEqual({ infinitive: 'hold', participle: 'held' });
    expect(verbLines('### @term tend\n\n> A thing that tends looks after a thing.\n\n| grammar | |\n|---|---|\n| type | verb |\n| third person | tends |\n| participle | tended |\n')).toEqual(['tends: tend, tended']);
  });
});
