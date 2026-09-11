import type { GoogleOperationConfiguration } from './contracts.js';
import { validateAbsoluteHttpsUrl, validateGoogleConfiguration } from './security.js';

/**
 * Read Google settings only when a Google operation is about to run. The
 * process environment is the sole default source; no environment files are
 * loaded here. Lazy reading lets non-Google routes remain available when Google
 * configuration is absent, while an attempted sign-in fails closed.
 */
export function readGoogleConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOperationConfiguration {
  return validateGoogleConfiguration({
    clientId: environment['GOOGLE_CLIENT_ID'],
    clientSecret: environment['GOOGLE_CLIENT_SECRET'],
    redirectUri: environment['GOOGLE_REDIRECT_URI'],
    appOrigin: environment['APP_ORIGIN'],
  });
}

/**
 * Read the trusted application origin only for state-changing operations.
 * Validation requires one exact HTTPS origin—not a prefix or wildcard—so an
 * attacker-controlled lookalike origin cannot satisfy logout's Origin check.
 */
export function readAppOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment['APP_ORIGIN'];
  return validateAbsoluteHttpsUrl(value, true);
}
