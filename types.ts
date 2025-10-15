import type { AdminForthResource, IAdminForth, IHttpServer } from 'adminforth';

/**
 * Configuration for an OAuth2 provider adapter
 */
export interface OAuth2ProviderAdapter {
  /**
   * Unique identifier for this OAuth provider
   */
  providerId: string;

  /**
   * Display name of the provider shown in the UI
   */
  providerName: string;

  /**
   * URL to provider's logo image to show in login button
   */
  providerLogo?: string;

  /**
   * Validate adapter configuration
   * Throws error if configuration is invalid
   */
  validate(): void;

  /**
   * Get OAuth2 authorization URL that user will be redirected to
   */
  getAuthorizationUrl(): string;

  /**
   * Exchange authorization code for access token and user info
   */
  exchangeCodeForToken(code: string): Promise<{
    error?: string;
    userInfo?: {
      email: string;
      name?: string;
      picture?: string;
      [key: string]: any;
    };
  }>;
}

/**
 * Plugin options for SSO authentication
 */
export interface PluginOptions {
  /**
   * OAuth2 provider adapter implementation
   */
  provider: OAuth2ProviderAdapter;

  /**
   * Optional callback URL override
   * If not provided, will use default AdminForth callback URL
   */
  callbackUrl?: string;

  /**
   * Optional function to transform user info from provider
   * into AdminForth user record before saving
   */
  transformUserInfo?: (userInfo: any) => Promise<Record<string, any>>;

  /**
   * Optional function to validate if user is allowed to login
   * For example to check if email domain is allowed
   */
  validateUser?: (userInfo: any) => Promise<{
    allowed: boolean;
    error?: string;
  }>;

  /**
   * Order of components under the login button, if there is more than one injected component
   */
  componentsOrderUnderLoginButton?: number;
}

export interface HttpExtra {
  headers: Record<string, string>;
  cookies: Record<string, string>;
  requestUrl: string;
  query: Record<string, any>;
  body: Record<string, any>;
}
