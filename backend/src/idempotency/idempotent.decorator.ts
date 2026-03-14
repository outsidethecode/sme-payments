import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key used by IdempotencyInterceptor to identify idempotent endpoints.
 */
export const IDEMPOTENT_KEY = "idempotent";

/**
 * Mark a controller method as idempotent.
 *
 * When the `Idempotency-Key` header is present on a request to this endpoint,
 * the IdempotencyInterceptor will:
 *   1. Check for a cached response matching the key
 *   2. Return the cached response if found (skipping handler execution)
 *   3. Execute the handler and cache the response if not found
 *
 * If no `Idempotency-Key` header is present, the request proceeds normally
 * without idempotency enforcement (backwards compatible).
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
