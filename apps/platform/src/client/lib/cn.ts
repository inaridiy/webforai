export type ClassValue = string | false | null | undefined;

/**
 * Minimal class joiner. Deliberately not `tailwind-merge` — the primitives in `ui/` never
 * emit conflicting utilities for the same property, so plain concatenation is enough.
 */
export const cn = (...values: ClassValue[]): string => values.filter(Boolean).join(" ");
