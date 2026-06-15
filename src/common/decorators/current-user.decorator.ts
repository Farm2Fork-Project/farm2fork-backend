import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from '../guards/roles.guard';

/**
 * Injects the authenticated user (populated by JwtStrategy) into a handler.
 * Usage: `@CurrentUser() user: RequestUser` or `@CurrentUser('id') id: string`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) {
      return undefined;
    }
    return data ? user[data] : user;
  },
);
