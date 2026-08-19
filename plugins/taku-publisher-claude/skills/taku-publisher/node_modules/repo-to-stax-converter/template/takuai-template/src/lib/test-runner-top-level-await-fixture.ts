import type { TestRunnerTopLevelAwaitValue } from './test-runner-top-level-await-types';

export type { TestRunnerTopLevelAwaitValue } from './test-runner-top-level-await-types';

export async function resolveTestRunnerTopLevelAwaitValue(
  value: TestRunnerTopLevelAwaitValue
): Promise<TestRunnerTopLevelAwaitValue> {
  return Promise.resolve(value);
}
