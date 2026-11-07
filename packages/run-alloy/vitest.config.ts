import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tests run a stand-in for the analyzer, whose processes start Node; beside the other packages' suites, as
    // `pnpm -w test` runs them, one can take several seconds.
    testTimeout: 30_000
  }
});
