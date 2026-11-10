/**
 * The words of a generated statement, and what a statement being generated means for the map checks. This file
 * tests the checker's own tooling, not a project's canon, so it carries no
 * `@canon` tag.
 */
import { describe, expect, it } from 'vitest';
import { checkMaps } from './map.ts';
import { isGenerated, write } from './statements.ts';
import { readUnits } from '@bigmistqke/canon/units';

const READINGS = '```readings\nnoun Node: node\nStarted: {1} has started | {1} has not started\nDone: {1} is done | {1} is not done\n```';

/** A document of one unit with a predicate; its statement is `statement` when given. */
const doc = (predicate = 'always all n: Node | n in Started implies eventually n in Done', statement = '', readings = READINGS): string => `# Canon

## @axiom a-root

> A root.

\`\`\`alloy vocabulary
sig Node {}
var sig Started, Done in Node {}
\`\`\`

${readings}

### @spec a-leaf

${statement}\`\`\`alloy
${predicate}
\`\`\`
`;

describe('the words of a statement as the unit reads it', () => {
  it('says the statement as the unit reads it, in words from the readings', () => {
    const { src } = write(doc());
    const [unit] = readUnits(src).filter(u => u.id === 'spec-a-leaf');
    expect(unit?.statement).toContain('From now on, for every node:');
    expect(unit?.statement).toContain('when the node has started, then now or later, the node is done.');
  });
});

describe('the words of a statement', () => {
  const linked = `# Canon

## @term node

> A node is a node.

\`\`\`alloy vocabulary
sig Node {}
var sig Started, Done in Node {}
\`\`\`

\`\`\`readings
noun Node: [node]
Started: {1} has [started] | {1} has not [started]
\`\`\`

## @term done

\`\`\`alloy
pred finished[n: Node] { n in Done and n in Started }
\`\`\`

\`\`\`alloy vocabulary
\`\`\`

\`\`\`readings
Done: {1} is [done] | {1} is not [done]
finished: {1} is [finished] | {1} is not [finished]
\`\`\`

## @axiom a-node-finishes

\`\`\`alloy
always all n: Node | n in Started implies eventually finished[n]
\`\`\`
`;

  it('name the terms that say them, the first time each is mentioned', () => {
    const { src } = write(linked);
    const unit = readUnits(src).find(u => u.id === 'axiom-a-node-finishes');
    // Each word that links to a term is a term mark: the link with its words between single asterisks.
    expect(unit?.statement).toContain('for every [*node*](#term-node)');
    // "started" is said by the term for the node, which the statement has already named: a term is named once
    expect(unit?.statement).toContain('the node has started');
    expect(unit?.statement).not.toContain('[started]');
    expect(unit?.statement).not.toContain('*started*');
    // "finished" is no form of the term done, so it links as a plain link.
    expect(unit?.statement).toContain('[finished](#term-done)');
  });

  it('never name its own unit in a statement', () => {
    const { src } = write(linked);
    const unit = readUnits(src).find(u => u.id === 'term-done');
    expect(unit?.statement).toContain('*node*');
    expect(unit?.statement).not.toContain('(#term-done)');
    expect(unit?.statement).not.toContain('*finished*');
  });
});

describe('a unit whose statement is generated', () => {
  it('is known as generated, and needs no map', () => {
    const plain = doc();
    expect(checkMaps(plain).map(f => f.kind)).toEqual(['unmapped']);
    const { src } = write(plain);
    expect(isGenerated(src, 'spec-a-leaf')).toBe(true);
    expect(checkMaps(src)).toEqual([]);
  });
});
