import { Hono } from "hono";

// Placeholder during scaffolding — routes are wired in follow-up steps.
const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));

// biome-ignore lint/style/noDefaultExport: Workers entrypoint
export default app;
export { NodejsFnContainer } from "./__generated__/create-nodejs-fn.do";
