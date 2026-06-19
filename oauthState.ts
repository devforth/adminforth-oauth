import { randomBytes } from 'crypto';
import type { IAdminForth } from 'adminforth';

export type OAuthProviderState = {
  provider: string;
  action?: 'connect';
  redirectUri?: string;
  nonce: string;
};

const OAUTH_STATE_COOKIE_NAME = 'oauth_state_nonce';
const OAUTH_STATE_EXPIRES_IN_SECONDS = 10 * 60;

type Cookie = { key: string; value: string };
type ResponseWithHeaders = {
  headers?: Array<[string, string | string[]]>;
  setHeader(name: string, value: string | string[]): void;
};

function oauthStateCookieKey(adminforth: IAdminForth) {
  const brandSlug = adminforth.config.customization.brandNameSlug;
  return `adminforth_${brandSlug}_${OAUTH_STATE_COOKIE_NAME}`;
}

function getCookieValue(cookies: Cookie[], key: string) {
  return cookies.find(cookie => cookie.key === key)?.value || null;
}

function createOauthNonce() {
  return randomBytes(32).toString('base64url');
}

export function appendSetCookie(response: ResponseWithHeaders, cookie: string) {
  const headers = response.headers;
  if (!headers) {
    response.setHeader('Set-Cookie', cookie);
    return;
  }

  const setCookieValues: string[] = [];
  for (let i = headers.length - 1; i >= 0; i -= 1) {
    const [name, value] = headers[i];
    if (name.toLowerCase() === 'set-cookie') {
      setCookieValues.unshift(...(Array.isArray(value) ? value : [value]));
      headers.splice(i, 1);
    }
  }

  response.setHeader('Set-Cookie', [...setCookieValues, cookie]);
}

export function setNonceCookie(adminforth: IAdminForth, response: ResponseWithHeaders, nonce: string) {
  appendSetCookie(
    response,
    `${oauthStateCookieKey(adminforth)}=${nonce}; Path=${adminforth.config.baseUrl || '/'}; HttpOnly; SameSite=Strict; Max-Age=${OAUTH_STATE_EXPIRES_IN_SECONDS}`
  );
}

export function clearNonceCookie(adminforth: IAdminForth, response: ResponseWithHeaders) {
  appendSetCookie(
    response,
    `${oauthStateCookieKey(adminforth)}=; Path=${adminforth.config.baseUrl || '/'}; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

export function issueOAuthState(
  adminforth: IAdminForth,
  response: ResponseWithHeaders,
  payload: Omit<OAuthProviderState, 'nonce'>
) {
  const nonce = createOauthNonce();
  setNonceCookie(adminforth, response, nonce);
  return adminforth.auth.issueJWT({ ...payload, nonce }, 'oauth-state', OAUTH_STATE_EXPIRES_IN_SECONDS);
}

export async function consumeOAuthState(
  adminforth: IAdminForth,
  state: string,
  cookies: Cookie[],
  response: ResponseWithHeaders
): Promise<OAuthProviderState> {
  if (!state) {
    throw new Error('No OAuth state provided');
  }

  const providerState = await adminforth.auth.verify(state, 'oauth-state', false) as OAuthProviderState | null;
  const cookieNonce = getCookieValue(cookies, oauthStateCookieKey(adminforth));

  if (!providerState?.nonce || !cookieNonce || providerState.nonce !== cookieNonce) {
    throw new Error('Invalid OAuth state');
  }

  clearNonceCookie(adminforth, response);
  return providerState;
}
