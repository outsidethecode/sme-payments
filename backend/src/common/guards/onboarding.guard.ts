import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Metadata key for the @RequireOnboarding() decorator.
 */
export const REQUIRE_ONBOARDING_KEY = "requireOnboarding";

/**
 * Decorator: Apply @RequireOnboarding() on a controller class or individual method.
 * When present, the guard blocks requests from organisations that have not completed onboarding.
 *
 * Use @SkipOnboardingCheck() on individual methods to exempt them
 * (e.g., read-only or public routes on an otherwise-guarded controller).
 */
export const RequireOnboarding = () =>
  SetMetadata(REQUIRE_ONBOARDING_KEY, true);

export const SKIP_ONBOARDING_KEY = "skipOnboardingCheck";

/**
 * Decorator: Apply @SkipOnboardingCheck() on a specific method to exempt it
 * from the class-level @RequireOnboarding() decorator.
 */
export const SkipOnboardingCheck = () => SetMetadata(SKIP_ONBOARDING_KEY, true);

@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if @RequireOnboarding() is applied
    const requireOnboarding = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ONBOARDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requireOnboarding) return true;

    // Check if @SkipOnboardingCheck() is applied on this specific method
    const skip = this.reflector.get<boolean>(
      SKIP_ONBOARDING_KEY,
      context.getHandler(),
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // No user or no org → let other guards handle authentication
    if (!user?.organisationId) return true;

    // ADMINs bypass onboarding check
    if (user.role === "ADMIN") return true;

    const org = await this.prisma.organisation.findUnique({
      where: { id: user.organisationId },
      select: { onboardingStatus: true, name: true },
    });

    if (!org) return true; // Org not found → let other handlers deal with it

    if (org.onboardingStatus !== "COMPLETED") {
      throw new ForbiddenException(
        `Organisation "${org.name}" has not completed onboarding (status: ${org.onboardingStatus}). ` +
          `Please complete all onboarding steps before accessing platform features.`,
      );
    }

    return true;
  }
}
