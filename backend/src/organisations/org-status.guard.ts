import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";

export const REQUIRE_ACTIVE_ORG_KEY = "requireActiveOrg";

/**
 * Decorator: marks a route as requiring the caller's org to be ACTIVE.
 * Usage: `@RequireActiveOrg()` on a controller method or class.
 */
export const RequireActiveOrg = () => SetMetadata(REQUIRE_ACTIVE_ORG_KEY, true);

/**
 * Guard that ensures the authenticated user's organisation has status ACTIVE.
 * Applied via the `@RequireActiveOrg()` decorator.
 *
 * Rejects `PENDING` and `SUSPENDED` orgs with a clear 403 message.
 * Skips when: no org (e.g. admin without org), or decorator not applied.
 */
@Injectable()
export class OrgStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireActive = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ACTIVE_ORG_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requireActive) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.organisationId) return true; // no org (admin, etc.)

    const org = await this.prisma.organisation.findUnique({
      where: { id: user.organisationId },
      select: { status: true, name: true },
    });

    if (!org) return true; // org not found — let other guards handle

    if (org.status !== "ACTIVE") {
      throw new ForbiddenException(
        `Organisation "${org.name}" is ${org.status}. Only ACTIVE organisations may perform this action.`,
      );
    }

    return true;
  }
}
