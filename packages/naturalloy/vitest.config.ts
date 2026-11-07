import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The test files run one after another, so a single process starts the Alloy analyzer and the job count of
    // run-alloy holds for the whole suite; files side by side would each start as many analyzers as the machine holds.
    fileParallelism: false
  }
});
