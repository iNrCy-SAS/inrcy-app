import * as Sentry from '@sentry/nextjs';
import { log } from '@/lib/observability/logger';
import { getRequestId, getRequestMeta } from '@/lib/observability/request';

type OAuthOutcome =
  | 'started'
  | 'success'
  | 'cancelled'
  | 'state_invalid'
  | 'not_authenticated'
  | 'config_error'
  | 'failed';

type OAuthEventInput = {
  provider: string;
  outcome: OAuthOutcome;
  error?: string;
  message?: string;
  user_id?: string;
  return_to?: string;
  status_code?: number;
  capture_in_sentry?: boolean;
  [k: string]: unknown;
};

function isUserResolvableOAuthException(message: string): boolean {
  const raw = String(message || '').toLowerCase();
  return [
    'insufficient authentication scopes',
    'request had insufficient authentication scopes',
    'aucune propriété ga4 ne correspond à ce domaine',
    'aucune propriete ga4 ne correspond a ce domaine',
    'aucune propriété search console ne correspond',
    'aucune propriete search console ne correspond',
    'access_denied',
    'user_denied',
    'invalid_state',
    'state invalid',
    'authorization code has been used',
    'code has been used',
    'code was already used',
    'unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code',
    'authorization code expired',
    'external member binding exists',
    'permissions error',
    'permission error',
    'google_permissions_incomplete',
  ].some((needle) => raw.includes(needle));
}

function isUserResolvableOAuthInput(input: OAuthEventInput): boolean {
  return isUserResolvableOAuthException(`${String(input.error || '')} ${String(input.message || '')}`);
}

function levelForOAuthEvent(input: OAuthEventInput): 'info' | 'warn' | 'error' {
  if (input.outcome === 'success' || input.outcome === 'started') return 'info';
  if (
    input.outcome === 'cancelled' ||
    input.outcome === 'state_invalid' ||
    input.outcome === 'not_authenticated' ||
    (input.outcome === 'failed' && isUserResolvableOAuthInput(input))
  ) {
    return 'warn';
  }
  return 'error';
}

function sentryLevelForOAuthEvent(input: OAuthEventInput): 'info' | 'warning' | 'error' {
  const level = levelForOAuthEvent(input);
  return level === 'warn' ? 'warning' : level;
}

function shouldCaptureOAuthInSentry(input: OAuthEventInput): boolean {
  if (!input.capture_in_sentry) return false;
  // Les retours OAuth expirés/refusés et les mauvais comptes sont des cas terrain normaux.
  // Ils restent dans les logs métier, mais ne doivent pas polluer Sentry comme des bugs techniques.
  if (
    input.outcome === 'cancelled' ||
    input.outcome === 'state_invalid' ||
    input.outcome === 'not_authenticated' ||
    isUserResolvableOAuthInput(input)
  ) {
    return false;
  }
  const statusCode = typeof input.status_code === 'number' ? input.status_code : null;
  if (input.outcome === 'failed') return statusCode !== null && statusCode >= 500;
  return true;
}

export function oauthCallbackEvent(req: Request, input: OAuthEventInput) {
  const request_id = getRequestId(req);
  const meta = getRequestMeta(req);
  const level = levelForOAuthEvent(input);
  const sentryLevel = sentryLevelForOAuthEvent(input);
  const payload = {
    request_id,
    route: meta.pathname,
    method: meta.method,
    ip: meta.ip,
    ...input,
  };

  log[level]('oauth_callback', payload);

  if (shouldCaptureOAuthInSentry(input)) {
    Sentry.withScope((scope: any) => {
      scope.setTag('area', 'oauth');
      scope.setTag('provider', input.provider);
      scope.setTag('outcome', input.outcome);
      if (request_id) scope.setTag('request_id', request_id);
      if (input.user_id) scope.setUser({ id: input.user_id });
      scope.setContext('oauth', {
        provider: input.provider,
        outcome: input.outcome,
        route: meta.pathname,
        method: meta.method,
        error: input.error,
        message: input.message,
        return_to: input.return_to,
      });
      Sentry.captureMessage(`oauth_callback:${input.provider}:${input.outcome}`, { level: sentryLevel });
    });
  }
}

export function oauthCallbackException(
  req: Request,
  provider: string,
  error: unknown,
  extra: Omit<OAuthEventInput, 'provider' | 'outcome'> = {},
) {
  const request_id = getRequestId(req);
  const meta = getRequestMeta(req);
  const message = error instanceof Error ? error.message : String(error);

  const logLevel = isUserResolvableOAuthException(message) ? 'warn' : 'error';
  log[logLevel]('oauth_callback_exception', {
    request_id,
    route: meta.pathname,
    method: meta.method,
    ip: meta.ip,
    provider,
    outcome: 'failed',
    error: extra.error || 'oauth_callback_failed',
    message,
    ...extra,
  });

  if (isUserResolvableOAuthException(message)) return;

  Sentry.withScope((scope: any) => {
    scope.setTag('area', 'oauth');
    scope.setTag('provider', provider);
    scope.setTag('outcome', 'failed');
    if (request_id) scope.setTag('request_id', request_id);
    if (typeof extra.user_id === 'string') scope.setUser({ id: extra.user_id });
    scope.setContext('oauth', {
      route: meta.pathname,
      method: meta.method,
      provider,
      error: extra.error || 'oauth_callback_failed',
      return_to: extra.return_to,
      ...extra,
    });
    Sentry.captureException(error instanceof Error ? error : new Error(message));
  });
}
