import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { FirebaseSessionAuthGuard } from './firebase-session-auth.guard';

/**
 * Global authentication guard. Validates the JWT Bearer token via the 'jwt'
 * Passport strategy unless the route is marked @Public.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly firebaseSessionAuthGuard: FirebaseSessionAuthGuard,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | undefined>;
      cookies?: Record<string, string | undefined>;
    }>();
    if (request.headers?.authorization?.startsWith('Bearer ')) {
      return super.canActivate(context);
    }
    return this.firebaseSessionAuthGuard.canActivate(context);
  }
}
