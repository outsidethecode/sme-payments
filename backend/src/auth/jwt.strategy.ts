import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../users/users.service";
import { OrganisationsService } from "../organisations/organisations.service";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  organisationId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly orgsService: OrganisationsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET"),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }

    // Get org info
    const orgInfo = await this.orgsService.getOrgByUserId(user.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyName: user.companyName || orgInfo?.name,
      organisationId: orgInfo?.id,
      orgRole: orgInfo?.orgRole,
      jurisdiction: orgInfo?.jurisdiction,
      currency: orgInfo?.currency,
    };
  }
}
