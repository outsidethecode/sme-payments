/**
 * Canonical JSON serialization with sorted keys.
 *
 * Single source of truth — all hash computations across the platform must
 * use this function. PostgreSQL JSONB does not preserve key order, so we
 * sort keys deterministically before hashing to ensure verify-after-read.
 *
 * Previously duplicated in ledger.service.ts, proof-generator.service.ts,
 * and proof-verifier.service.ts. Now consolidated here.
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (obj instanceof Date) return JSON.stringify(obj.toISOString());
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        JSON.stringify(key) +
        ":" +
        canonicalStringify((obj as Record<string, unknown>)[key]),
    )
    .join(",");
  return "{" + sorted + "}";
}
