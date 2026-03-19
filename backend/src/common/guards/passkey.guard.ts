import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PasskeysService } from "../../passkeys/passkeys.service";

/**
 * Metadata key for the @RequirePasskey() decorator.
 */
export const REQUIRE_PASSKEY_KEY = "requirePasskey";

/**
 * Decorator: Apply @RequirePasskey() on a controller class or individual method.
 * When present, the guard blocks requests from users who haven't registered a passkey.
 *
 * Use @SkipPasskeyCheck() on individual methods to exempt them.
 */
export const RequirePasskey = () => SetMetadata(REQUIRE_PASSKEY_KEY, true);

export const SKIP_PASSKEY_KEY = "skipPasskeyCheck";

/**
 * Decorator: Apply @SkipPasskeyCheck() on a specific method to exempt it
 * from the class-level @RequirePasskey() decorator.
 */
export const SkipPasskeyCheck = () => SetMetadata(SKIP_PASSKEY_KEY, true);

@Injectable()
export class PasskeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly passkeysService: PasskeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if @RequirePasskey() is applied
    const requirePasskey = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PASSKEY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirePasskey) return true;

    // Check if @SkipPasskeyCheck() is applied on this specific method
    const skip = this.reflector.get<boolean>(
      SKIP_PASSKEY_KEY,
      context.getHandler(),
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // No user → let other guards handle authentication
    if (!user?.id) return true;

    // ADMINs bypass passkey check
    if (user.role === "ADMIN") return true;

    const has = await this.passkeysService.hasPasskey(user.id);

    if (!has) {
      throw new ForbiddenException(
        "Passkey registration required. Please register a passkey during onboarding " +
          "before accessing platform features. Passkeys provide cryptographic proof of identity " +
          "for all state-changing actions.",
      );
    }

    return true;
  }
}
