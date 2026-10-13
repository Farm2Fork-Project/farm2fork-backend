import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Model } from 'mongoose';
import { RequestUser } from '../../../common/guards/roles.guard';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ?? 'dev-insecure-secret',
    });
  }

  /**
   * Runs on every authenticated request. Re-checks the user still exists and
   * is active so a deactivated account (admin_action, master context 6.5)
   * cannot keep using a previously issued token. The returned value becomes
   * request.user.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.userModel
      .findById(payload.sub)
      .select('role email isActive')
      .lean()
      .exec();

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Account is inactive or no longer exists',
      );
    }

    return { id: payload.sub, role: user.role, email: user.email };
  }
}
