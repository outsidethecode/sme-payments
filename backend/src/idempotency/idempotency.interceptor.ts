import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, of } from "rxjs";
import { tap } from "rxjs/operators";
import { IdempotencyService } from "./idempotency.service";
import { IDEMPOTENT_KEY } from "./idempotent.decorator";

/**
 * Intercepts requests to @Idempotent() endpoints.
 *
 * If the `Idempotency-Key` header is present:
 *   - Returns cached response on cache hit
 *   - Executes handler and caches the response on cache miss
 *
 * If the header is absent, the request proceeds without idempotency enforcement.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly idempotencyService: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    // Only apply to handlers marked @Idempotent()
    const isIdempotent = this.reflector.get<boolean>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );
    if (!isIdempotent) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers["idempotency-key"];

    // No header → proceed normally (backwards compatible)
    if (!idempotencyKey) {
      return next.handle();
    }

    // Check for cached response
    const cached = await this.idempotencyService.check(idempotencyKey);
    if (cached) {
      this.logger.debug(`Idempotency cache hit for key=${idempotencyKey}`);
      const response = context.switchToHttp().getResponse();
      response.status(cached.statusCode);
      return of(cached.body);
    }

    // Cache miss → execute handler and cache the result
    const endpoint = `${request.method} ${request.route?.path ?? request.url}`;

    return next.handle().pipe(
      tap(async (responseBody) => {
        try {
          await this.idempotencyService.record(
            idempotencyKey,
            endpoint,
            HttpStatus.OK,
            responseBody,
          );
        } catch (err) {
          // Non-fatal: log but don't fail the request
          this.logger.warn(
            `Failed to cache idempotency record for key=${idempotencyKey}: ${err}`,
          );
        }
      }),
    );
  }
}
