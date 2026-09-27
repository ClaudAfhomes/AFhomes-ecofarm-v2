export function delay(ms = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulates an async read from a mock repository so loading states behave as
 * they will against a real API.
 */
export async function mockRead<T>(factory: () => T, ms = 350): Promise<T> {
  await delay(ms);
  return factory();
}