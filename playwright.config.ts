import { defineConfig, devices } from "@playwright/test";

// Load .env.local into the test process so the service-role DB helper (seed /
// expire / cleanup) and the dev server both see the cloud Supabase credentials.
try {
	process.loadEnvFile(".env.local");
} catch {
	// CI may inject env another way; ignore if the file is absent.
}

/**
 * E2E config. Specs use the `.e2e.ts` suffix (not `.spec.ts`/`.test.ts`) so the
 * Bun unit-test runner ignores them. Single worker: the suite shares one cloud
 * Supabase project, and serial runs keep slot contention deterministic.
 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [["list"]],
	use: {
		baseURL: "http://localhost:3000",
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "bun run dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
