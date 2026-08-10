import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/db/schema.ts (`pnpm db:generate`) and applied with
// `wrangler d1 migrations apply` — drizzle-kit never talks to D1 directly.
// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
});
