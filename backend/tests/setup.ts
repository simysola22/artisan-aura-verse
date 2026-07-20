/**
 * Global test setup.
 *
 * Sets the minimum environment variables required by the config module so
 * tests don't fail with "Invalid configuration" before they've even run.
 *
 * Tests that need specific values can override them locally.
 */
import { resetConfig } from "../src/config/index.js";

// Minimum required environment for the config to validate
process.env["NODE_ENV"] = "test";
process.env["JWT_SECRET"] = "test-secret-at-least-32-characters-long!!";

// Reset the config cache before each test so env overrides take effect
beforeEach(() => {
  resetConfig();
});

afterEach(() => {
  resetConfig();
});
