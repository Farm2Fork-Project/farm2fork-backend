import { readFileSync } from 'fs';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  App,
  cert,
  Credential,
  getApp,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { FIREBASE_APP } from './firebase.constants';
import { FirebaseAuthService } from './firebase-auth.service';

/**
 * Initialises the Firebase Admin app once and exposes it (or null) via
 * FIREBASE_APP. Global so any module can inject FirebaseAuthService.
 *
 * Credential resolution order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON  - inline JSON (containers / CI)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH  - explicit file path
 *   3. GOOGLE_APPLICATION_CREDENTIALS - the standard Google env var
 *
 * The service-account key is a SECRET and must live OUTSIDE the repo.
 *
 * Resilience: when FIREBASE_AUTH_ENABLED is false, or no credentials are
 * supplied, the app boots with a null Firebase app so unrelated work is not
 * blocked; Firebase endpoints then return 503 until it is configured. When
 * credentials ARE supplied but fail to load, we throw - a misconfigured secret
 * must fail loudly, not degrade silently.
 */
function initFirebaseApp(config: ConfigService): App | null {
  const logger = new Logger('FirebaseModule');
  const enabled = config.get<boolean>('FIREBASE_AUTH_ENABLED', false);

  if (!enabled) {
    logger.warn(
      'FIREBASE_AUTH_ENABLED is false - Firebase auth endpoints will return 503',
    );
    return null;
  }

  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = config.get<string>('FIREBASE_PROJECT_ID');
  const credential = resolveCredential(config, logger);

  if (!credential) {
    logger.warn(
      'FIREBASE_AUTH_ENABLED is true but no service-account credentials were found - Firebase auth endpoints will return 503',
    );
    return null;
  }

  const app = initializeApp({ credential, projectId });
  logger.log(
    `Firebase Admin initialised${projectId ? ` for project ${projectId}` : ''}`,
  );
  return app;
}

function resolveCredential(
  config: ConfigService,
  logger: Logger,
): Credential | null {
  const inlineJson = config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (inlineJson) {
    return cert(JSON.parse(inlineJson) as ServiceAccount);
  }

  const path =
    config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH') ??
    config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
  if (path) {
    const raw = readFileSync(path, 'utf8');
    logger.log(`Loading Firebase service account from ${path}`);
    return cert(JSON.parse(raw) as ServiceAccount);
  }

  return null;
}

@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_APP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => initFirebaseApp(config),
    },
    FirebaseAuthService,
  ],
  exports: [FIREBASE_APP, FirebaseAuthService],
})
export class FirebaseModule {}
