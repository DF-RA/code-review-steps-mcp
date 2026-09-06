import type { TestContext } from "node:test";

/**
 * Sets environment variables for one test and puts them back afterwards.
 * Several modules read `process.env` on every call on purpose, so the tests
 * have to be able to change it without leaking into the next one.
 */
export function stubEnv(t: TestContext, vars: Record<string, string | undefined>): void {
  const previous = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(vars)) {
    previous.set(name, process.env[name]);

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}
