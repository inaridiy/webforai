import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** Drizzle bound to D1 with the full platform schema (auth tables included). */
export type PlatformDb = DrizzleD1Database<typeof schema>;

/**
 * D1 bindings only exist inside a request, so the client is created per request rather than
 * at module scope.
 */
export const createDb = (env: Env): PlatformDb => drizzle(env.DB, { schema });
