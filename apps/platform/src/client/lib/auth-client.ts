import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";

/**
 * Better Auth browser client. Same-origin: the Worker mounts the auth handler at
 * `/api/auth/*`, so the default baseURL (current origin) is correct.
 */
export const authClient = createAuthClient({ plugins: [apiKeyClient()] });

export type Session = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;
export type SessionUser = Session["user"];

type ApiKeyList = NonNullable<Awaited<ReturnType<typeof authClient.apiKey.list>>["data"]>;
export type ApiKeySummary = ApiKeyList["apiKeys"][number];

type CreatedKey = NonNullable<Awaited<ReturnType<typeof authClient.apiKey.create>>["data"]>;
export type CreatedApiKey = CreatedKey;

/** Better Auth client errors are `{ message?, code?, status? }` — never assume a message exists. */
export const authErrorMessage = (error: { message?: string } | null | undefined, fallback: string): string =>
	error?.message !== undefined && error.message.length > 0 ? error.message : fallback;
