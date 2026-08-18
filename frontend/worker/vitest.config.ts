import { defineConfig } from 'vitest/config';

// Standalone config for worker/*.spec.ts: this directory sits outside
// src/, which the Angular project's own test builder (npm test) is scoped
// to, so it needs its own run (npm run test:worker). Plain Node environment
// — no jsdom, no Angular TestBed, none of it applies to a Worker script.
export default defineConfig({
  test: {
    // No explicit `root`: Vitest defaults it to this config file's own
    // directory, which is exactly worker/ — no __dirname needed (this file
    // compiles as ESM, where that's not a global).
    include: ['**/*.spec.ts'],
    environment: 'node',
  },
});
