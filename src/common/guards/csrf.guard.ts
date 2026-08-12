import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF/origin protection for cookie-authenticated browser traffic.
 *
 * For unsafe methods that look like browser requests - an `Origin` header or the
 * web session cookie is present - the request must come from the exact
 * `WEB_APP_ORIGIN` and carry `X-Farm2Fork-CSRF: 1`. The custom header forces a
 * CORS preflight, and the exact-origin CORS allowlist prevents another site from
 * adding it. Mobile Bearer requests (no Origin, no cookie) are exempt because a
 * browser cannot silently attach the secure-storage token.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers?: Record<string, string | undefined>;
      cookies?: Record<string, string | undefined>;
    }>();

    const method = (request.method ?? 'GET').toUpperCase();
    if (!UNSAFE_METHODS.has(method)) {
      return true;
    }

    const headers = request.headers ?? {};
    const origin = headers.origin;
    const cookieName = this.config.get<string>(
      'WEB_SESSION_COOKIE_NAME',
      'f2f_session',
    );
    const hasSessionCookie = Boolean(request.cookies?.[cookieName]);

    // Not a browser request (no Origin, no session cookie): exempt (mobile).
    if (!origin && !hasSessionCookie) {
      return true;
    }

    const webAppOrigin = this.config.get<string>('WEB_APP_ORIGIN');
    if (origin !== webAppOrigin || headers['x-farm2fork-csrf'] !== '1') {
      throw new ForbiddenException('Invalid browser request origin');
    }
    return true;
  }
}
