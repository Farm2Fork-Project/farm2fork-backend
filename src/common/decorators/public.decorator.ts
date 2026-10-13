import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public so the global JwtAuthGuard skips authentication.
 * Used for /auth/login, /auth/register and the password-reset endpoints
 * (master context 9.3 - all other endpoints require a valid JWT).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
