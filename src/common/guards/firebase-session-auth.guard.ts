import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FirebaseAuthService } from '../../infrastructure/firebase/firebase-auth.service';
import { User, UserDocument } from '../../modules/auth/schemas/user.schema';
import { RequestUser } from './roles.guard';

/**
 * Web authentication: resolves an HTTP-only Firebase Admin session cookie to the
 * active Farm2Fork user, then uses that database record's role for authorization
 * (the backend, not Firebase, is the role authority). Mobile continues to use
 * the Bearer JWT path.
 */
@Injectable()
export class FirebaseSessionAuthGuard implements CanActivate {
  constructor(
    private readonly firebaseAuthService: FirebaseAuthService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      cookies?: Record<string, string | undefined>;
      user?: RequestUser;
    }>();

    const cookieName = this.config.get<string>(
      'WEB_SESSION_COOKIE_NAME',
      'f2f_session',
    );
    const sessionCookie = request.cookies?.[cookieName];
    if (!sessionCookie) {
      throw new UnauthorizedException('Session cookie is missing');
    }

    const identity =
      await this.firebaseAuthService.verifySessionCookie(sessionCookie);

    const user = await this.userModel
      .findOne({ firebaseUid: identity.uid })
      .select('role email isActive')
      .lean()
      .exec();

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }

    request.user = {
      id: (user._id as { toString(): string }).toString(),
      role: user.role,
      email: user.email,
    };
    return true;
  }
}
