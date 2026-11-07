/**
 * The Alloy backend, on the lifetimes fixture. It needs an Alloy jar and a Java
 * 17 or later: set CANON_ALLOY_JAR, and CANON_JAVA when `java` is older.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { alloyProgram, checkAlloy, predicateName } from '../../src/alloy.ts';
import { CACHE, LIFETIMES, withScenario } from '../../src/alloy.support.ts';

describe('the program of a document', () => {
  const { program, units } = alloyProgram(LIFETIMES);

  /**
   * @canon spec-a-formula-with-no-keyword-is-a-claim-to-hold
   * @canon spec-the-scope-of-a-document-is-given-to-every-search
   */
  it('names a predicate after each unit that holds a bare formula, and leaves the bounds out of the program', () => {
    expect(units).toContain('spec-a-disposed-owner-cannot-be-entered');
    expect(program).toContain(`pred ${predicateName('spec-a-disposed-owner-cannot-be-entered')} {`);
    expect(program).not.toMatch(/^for 3 but/m);
  });

  /**
   * @canon spec-a-unit-that-holds-only-definitions-is-in-the-model-and-is-no-claim
   */
  it('leaves a unit that holds only definitions out of the claims, and keeps its definitions in the model', () => {
    const src = `# Canon

## @term orphan

\`\`\`alloy
sig Node {}
pred orphan[n: Node] { no m: Node | m != n }
\`\`\`

## @axiom a-node-exists

\`\`\`alloy
some Node
\`\`\`
`;
    const { program, units } = alloyProgram(src);
    expect(units).toEqual(['axiom-a-node-exists']);
    expect(program).toContain('pred orphan[n: Node]');
    expect(program).not.toContain('term_orphan');
  });

  /**
   * @canon spec-the-first-searches-leave-no-unit-out
   * @canon spec-a-trial-is-made-only-for-a-scenario-that-cannot-happen
   */
  it('asks first only whether the scenarios can happen, and leaves the units out afterwards', () => {
    const asked = alloyProgram(LIFETIMES, 'check').program;
    expect(asked).toMatch(/^run consistent \{/m);
    expect(asked).toMatch(/^run scenario_1_term_teardown_model_with_all \{/m);
    expect(asked).not.toContain('_without_');
    const blame = alloyProgram(LIFETIMES, 'blame', { scenarios: ['scenario_1_term_teardown_model'], leave: ['spec-dispose-runs-once'] }).program;
    expect(blame).not.toMatch(/^run consistent/m);
    expect(blame.match(/^run .*_without_/gm)).toHaveLength(1);
  });

  /**
   * @canon spec-a-trial-leaves-out-only-the-units-the-author-asks-about
   */
  it('leaves out only the units asked about, for each scenario by the unit that holds it', () => {
    const blame = alloyProgram(LIFETIMES, 'blame', { leave: { 'term-teardown-model': ['spec-dispose-runs-once', 'spec-a-disposed-owner-cannot-be-entered'] } }).program;
    expect(blame.match(/^run .*_without_/gm)).toHaveLength(2);
  });

  /**
   * @canon spec-each-unit-the-author-asks-about-gets-a-trial
   */
  it('makes a trial for each held unit the author asks about', () => {
    const asked = ['spec-dispose-runs-once', 'spec-a-disposed-owner-cannot-be-entered'];
    const blame = alloyProgram(LIFETIMES, 'blame', { leave: { 'term-teardown-model': asked } }).program;
    for (const unit of asked) expect(blame).toContain(`_without_${predicateName(unit)} {`);
  });

  /**
   * @canon spec-a-search-about-the-units-together-asks-for-every-held-unit-and-no-other
   * @canon spec-each-scenario-gets-a-search-with-every-held-unit
   * @canon spec-a-trial-leaves-out-one-held-unit-and-keeps-the-rest
   * @canon spec-a-trial-is-made-for-each-held-unit-of-a-scenario-that-cannot-happen
   */
  it('runs the units with each scenario, and without each unit', () => {
    expect(program).toContain(`run scenario_1_term_teardown_model_without_${predicateName('spec-dispose-runs-once')} {`);
    expect(program).toMatch(/^run consistent \{.*\} for 3 but 1\.\.8 steps$/m);
  });
});

describe.skipIf(!process.env.CANON_ALLOY_JAR)('the check', () => {
  // The analyzer is run to completion, which blocks this thread. The test runner answers its messages only when the event loop turns, so let it turn between tests.
  afterEach(() => new Promise(resolve => setTimeout(resolve, 0)));

  /**
   * @canon spec-a-scenario-that-can-happen-is-not-reported
   */
  it('allows the scenario of the example: a failing cleanup runs while its owner is disposed, and its error reaches the nearest handler', { timeout: 600_000 }, async () => {
    expect(await checkAlloy(LIFETIMES, { cache: CACHE })).toMatchObject({ ok: true });
  });

  /**
   * @canon spec-a-scenario-that-cannot-happen-while-every-unit-holds-is-reported
   * @canon spec-the-report-of-a-scenario-names-each-unit-whose-removal-lets-it-happen
   * @canon spec-the-report-of-a-scenario-names-no-other-unit
   */
  it('names the two specs that keep a scenario from happening when a spec contradicts another', { timeout: 600_000 }, async () => {
    const contradicting = `${LIFETIMES}
### @spec a-disposed-owner-can-be-entered

\`\`\`alloy
always all o: Owner | (enter[o] and o in Disposed) implies no Throwing'
\`\`\`
`;
    const result = await checkAlloy(withScenario(contradicting, 'a-disposed-owner-can-be-entered', 'eventually some o: Owner | enter[o] and o in Disposed'), { cache: CACHE });
    expect(result).toMatchObject({ ok: false });
    expect('failures' in result && result.failures.map(f => f.conflict.sort())).toEqual([
      ['spec-a-disposed-owner-can-be-entered', 'spec-a-disposed-owner-cannot-be-entered']
    ]);
  });
});
