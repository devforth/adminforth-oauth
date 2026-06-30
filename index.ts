import AdminForth, { AdminForthPlugin, Filters, AdminUser, HttpExtra, RateLimiter } from "adminforth";
import type { IAdminForth, AdminForthResource } from "adminforth";
import { IHttpServer } from "adminforth";
import { randomUUID } from 'crypto';
import type { OAuth2Adapter } from "adminforth";
import { AdminForthDataTypes } from "adminforth";
import { ExternalIdentityStore } from "./externalIdentityStore.js";
import type { ExternalIdentityResourceOptions, OAuthIdentity } from "./externalIdentityStore.js";
import { clearNonceCookie, consumeOAuthState, issueOAuthState } from "./oauthState.js";
import { z } from "zod";

const oauthDisconnectBodySchema = z.object({
  identityId: z.string(),
}).strict();

const oauthConnectActionBodySchema = z.object({
  provider: z.string(),
  redirectUri: z.string(),
}).strict();

const oauthCallbackBodySchema = z.object({
  provider: z.string().optional(),
  redirectUri: z.string().optional(),
}).strict();

type OAuth2UserInfo = Awaited<ReturnType<OAuth2Adapter['getTokenFromCode']>> & {
  provider?: string;
  subject?: string;
  phone?: string;
  meta?: Record<string, any>;
  externalUserId?: string | number | null;
};

interface OAuthPluginOptions {
  emailField: string;
  externalIdentityResource?: ExternalIdentityResourceOptions;
  emailConfirmedField?: string;
  userFullNameField?: string;
  adapters: OAuth2Adapter[];
  buttonText?: string;
  iconOnly?: boolean;
  pill?: boolean;
  authenticationExpireDuration?: string;
  openSignup?: {
    enabled?: boolean;
    defaultFieldValues?: Record<string, any>;
  };
  componentsOrderUnderLoginButton?: number;
  userAvatarField?: string;
}

export default class OAuthPlugin extends AdminForthPlugin {
  private options: OAuthPluginOptions;
  public adminforth: IAdminForth;
  private resource: AdminForthResource;
  public avatarUploadPlugin: any;
  private externalIdentityStoreInstance: ExternalIdentityStore | null = null;
  private userPrimaryKeyField: string;
  private oauthRateLimiters: RateLimiter[] = [];
  
  private parseBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    response: { setStatus: (code: number, message: string) => void },
  ): { ok: true; data: T } | { ok: false; error: { error: string; details: unknown } } {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      response.setStatus(400, '');
      return {
        ok: false,
        error: { error: 'Request body validation failed', details: parsed.error.issues },
      };
    }
    return { ok: true, data: parsed.data };
  }

  constructor(options: OAuthPluginOptions) {
    super(options, import.meta.url);
    if (!options.emailField) {
      throw new Error('OAuthPlugin: emailField is required');
    }
    if (!options.externalIdentityResource) {
      console.warn(
        'OAuthPlugin: using OAuth without externalIdentityResource is deprecated. Please migrate to the external identity resource configuration.'
      );
    }
    
    // Set default values for openSignup
    this.options = {
      ...options,
      iconOnly: options.iconOnly ?? false,
      pill: options.pill ?? false,
      openSignup: {
        enabled: options.openSignup?.enabled ?? false,
        defaultFieldValues: options.openSignup?.defaultFieldValues ?? {},
      }
    };
    this.shouldHaveSingleInstancePerWholeApp = () => true;
  }

  
  modifyResourceConfig(adminforth: IAdminForth, resource: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resource);

    this.adminforth = adminforth;
    this.resource = resource;
    this.oauthRateLimiters = (adminforth.config.auth as any).rateLimit.map((rate) => new RateLimiter(rate));
    const userPrimaryKey = resource.columns.find(col => col.primaryKey)?.name;
    if (!userPrimaryKey) {
      throw new Error(`OAuthPlugin: user resource "${resource.resourceId}" has no primary key`);
    }
    this.userPrimaryKeyField = userPrimaryKey;
    this.externalIdentityStoreInstance = this.options.externalIdentityResource
      ? new ExternalIdentityStore(adminforth, this.options.externalIdentityResource)
      : null;
    adminforth.config.customization.customPages.push({
      path: '/oauth/callback',
      component: { 
        file: this.componentPath('OAuthCallback.vue'), 
        meta: { 
          title: 'OAuth Callback',
          sidebarAndHeader: "none",
          baseUrl: adminforth.config.baseUrl,
        },
      }
    });

    if (this.options.externalIdentityResource && !adminforth.config.auth.userMenuSettingsPages?.find(page => page.slug === 'connected-accounts')) {
      if (!adminforth.config.auth.userMenuSettingsPages) {
        adminforth.config.auth.userMenuSettingsPages = [];
      }
      adminforth.config.auth.userMenuSettingsPages.push({
        icon: 'flowbite:link-outline',
        pageLabel: 'Connected Accounts',
        slug: 'connected-accounts',
        component: this.componentPath('OAuthConnectedAccounts.vue'),
        isVisible: () => true,
      });
    }

    // Validate emailField exists in resource
    if (!resource.columns.find(col => col.name === this.options.emailField)) {
      throw new Error(`OAuthPlugin: emailField "${this.options.emailField}" not found in resource columns`);
    }

    // Validate emailConfirmedField if provided
    if (this.options.emailConfirmedField) {
      const confirmedField = resource.columns.find(col => col.name === this.options.emailConfirmedField);
      if (!confirmedField) {
        throw new Error(`OAuthPlugin: emailConfirmedField "${this.options.emailConfirmedField}" not found in resource columns`);
      }
      if (confirmedField.type !== AdminForthDataTypes.BOOLEAN) {
        throw new Error(`OAuthPlugin: emailConfirmedField "${this.options.emailConfirmedField}" must be a boolean field`);
      }
    }

    if (this.options.userFullNameField) {
      const nameField = resource.columns.find(col => col.name === this.options.userFullNameField);
      if (!nameField) {
        throw new Error(`OAuthPlugin: userFullNameField "${this.options.userFullNameField}" not found in resource columns`);
      }
    }

    // Make sure customization and loginPageInjections exist
    if (!adminforth.config.customization?.loginPageInjections) {
      adminforth.config.customization = {
        ...adminforth.config.customization,
        loginPageInjections: { underInputs: [], underLoginButton: [], panelHeader: [] }
      };
    }
    
    // Register the component with the correct plugin path
    const componentPath = `@@/plugins/${this.constructor.name}/OAuthLoginButtons.vue`;
    this.componentPath('OAuthLoginButtons.vue');

    const providers = this.options.adapters.map(adapter => ({
      provider: adapter.constructor.name,
      icon: adapter.getIcon(),
      buttonText: `${this.options.buttonText ? this.options.buttonText : 'Continue with'} ${(adapter.getName ? adapter.getName() : adapter.constructor.name)}`,
    }));


    const plugins = this.resource.plugins;
    const avatarUploadPlugin = plugins.find(p => (p as any).options?.pathColumnName === this.options.userAvatarField);
    this.avatarUploadPlugin = avatarUploadPlugin;

    (adminforth.config.customization.loginPageInjections.underLoginButton as Array<any>).push({
      file: componentPath,
      meta: {
        afOrder: this.options.componentsOrderUnderLoginButton || 0,
        providers,
        iconOnly: this.options.iconOnly,
        pill: this.options.pill,
        baseUrl: adminforth.config.baseUrl,
      }
    });
  }
  
 
  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
  }

  private serverFetchUrl(url: string, internalApiOrigin: string): string {
    return new URL(url, internalApiOrigin).toString();
  }

  private async getAdminUserFromCookies(cookies: Array<{ key: string; value: string }>) {
    const brandSlug = this.adminforth.config.customization.brandNameSlug;
    const jwt = cookies.find(({ key }) => key === `adminforth_${brandSlug}_jwt`)?.value;
    return jwt ? await this.adminforth.auth.verify(jwt, 'auth') : null;
  }

  private async syncUserProfile(user: any, userInfo: OAuth2UserInfo, server: IHttpServer) {
    if (this.options.userFullNameField && userInfo.fullName) {
      const userFullName = user[this.options.userFullNameField];
      if (userFullName && userFullName !== userInfo.fullName) {
        await this.adminforth.resource(this.resource.resourceId).update(user[this.userPrimaryKeyField], {
          [this.options.userFullNameField]: userInfo.fullName
        });
      }
    }

    if (!this.options.userAvatarField || !userInfo.profilePictureUrl || user[this.options.userAvatarField] !== null) {
      return;
    }

    const avatarResponse = await fetch(userInfo.profilePictureUrl);
    if (!avatarResponse.ok) {
      console.error('Failed to fetch avatar for user', user[this.options.emailField]);
      return;
    }

    const fileType = avatarResponse.headers.get('content-type');
    if (!fileType) {
      console.error('Avatar response has no content-type for user', user[this.options.emailField]);
      return;
    }

    const fileExtension = fileType.split('/')[1];
    const fileName = `avatar_${user[this.options.emailField]}_${randomUUID()}`;
    const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());
    const { uploadUrl, uploadExtraParams, filePath, error } = await this.avatarUploadPlugin.getFileUploadUrl(
      fileName,
      fileType,
      null,
      fileExtension,
      null
    );
    if (error) {
      throw new Error(error);
    }

    const res = await fetch(this.serverFetchUrl(uploadUrl, (server as any).getInternalApiOrigin()), {
      method: 'PUT',
      headers: {
        'Content-Type': fileType,
        ...uploadExtraParams
      },
      body: avatarBuffer
    });

    if (!res.ok) {
      console.error('Failed to upload avatar for user', user[this.options.emailField]);
      return;
    }

    await this.avatarUploadPlugin.markKeyForNotDeletion(filePath);
    await this.adminforth.resource(this.resource.resourceId).update(user[this.userPrimaryKeyField], {
      [this.options.userAvatarField]: filePath
    });
  }


  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    if (this.options.userAvatarField) {
      for (const adapter of this.options.adapters) {
        if ((adapter as any).useOpenID === true || (adapter as any).useOpenIdConnect === true) {
          throw new Error(`OAuthPlugin: userAvatarField is not supported with OpenID adapters`);
        }
      }
      //console.log(this.resource.plugins);


      if (!this.avatarUploadPlugin) {
        throw new Error(`OAuthPlugin: userAvatarField "${this.options.userAvatarField}" requires an upload plugin configured for the same field`);
      }
      //const uploadPlugin 
      //const uploadPlugin = this.resource

    }
  }

  async doLogin(email: string, response: any, extra: HttpExtra): Promise<{ error?: string; allowedLogin: boolean; redirectTo?: string; }> {
    const user = await this.adminforth.resource(this.resource.resourceId).get([
      Filters.EQ(this.options.emailField, email)
    ]);

    if (!user) {
      return { error: 'User not found', allowedLogin: false };
    }

    return this.doLoginUser(user, email, response, extra);
  }

  async doLoginUser(user: any, username: string, response: any, extra: HttpExtra): Promise<{ error?: string; allowedLogin: boolean; redirectTo?: string; }> {
    const userPk = user[this.userPrimaryKeyField];
    if (this.options.emailConfirmedField && user[this.options.emailConfirmedField] === false) {
      await this.adminforth.resource(this.resource.resourceId).update(userPk, {
        [this.options.emailConfirmedField]: true
      });
    }

    const adminUser = { 
      dbUser: user,
      pk: userPk,
      username,
    };
    const toReturn = { allowedLogin: true, error: '' };
  
    const rememberMeDuration = this.options.authenticationExpireDuration ?? this.adminforth.config.auth.rememberMeDuration;
    await this.adminforth.restApi.processLoginCallbacks(adminUser, toReturn, response, { ...extra }, rememberMeDuration);
    if (toReturn.allowedLogin) {
      this.adminforth.auth.setAuthCookie({ 
        response,
        username,
        pk: userPk,
        expireInDuration: rememberMeDuration
      });
    }
    return toReturn;
  }

  setupEndpoints(server: IHttpServer) {
    if (this.options.externalIdentityResource) {
      const externalIdentityStore = this.externalIdentityStoreInstance!;

      server.endpoint({
        method: 'POST',
        path: '/oauth/external-identities',
        handler: async ({ adminUser }) => {
          return externalIdentityStore.connectedAccounts(adminUser!.pk, this.options.adapters);
        },
      });

      server.endpoint({
        method: 'POST',
        path: '/oauth/external-identity/disconnect',
        handler: async ({ body, adminUser, response }) => {
          const parsed = this.parseBody(oauthDisconnectBodySchema, body, response);
          if ('error' in parsed) return parsed.error;
          const data = parsed.data;
          return externalIdentityStore.disconnect(data.identityId, adminUser!.pk);
        },
      });

      server.endpoint({
        method: 'POST',
        path: '/oauth/external-identity/connect-action',
        handler: async ({ body, response }) => {
          const parsed = this.parseBody(oauthConnectActionBodySchema, body, response);
          if ('error' in parsed) return parsed.error;
          const data = parsed.data;
          const adapter = this.options.adapters.find(adapter => adapter.constructor.name === data.provider);
          if (!adapter) {
            return { error: 'Invalid OAuth provider' };
          }

          const url = new URL(adapter.getAuthUrl());
          url.searchParams.set('redirect_uri', data.redirectUri);
          url.searchParams.set('state', issueOAuthState(this.adminforth, response, {
            provider: data.provider,
            action: 'connect',
            redirectUri: data.redirectUri,
          }));

          return {
            action: {
              type: 'url',
              url: url.toString(),
            },
          };
        },
      });
    }

    server.endpoint({
      method: 'POST',
      path: '/oauth/callback',
      noAuth: true,
      handler: async ({ body, query, response, headers, cookies, requestUrl }) => {
        const parsed = this.parseBody(oauthCallbackBodySchema, body, response);
        if ('error' in parsed) return parsed.error;
        const data = parsed.data;
        const oauthRateLimitKey = this.adminforth.auth.getClientIp(headers) || 'unknown';
        const rateLimitResults = await Promise.all(this.oauthRateLimiters.map((limiter) => limiter.consume(oauthRateLimitKey)));
        if (!rateLimitResults.every(Boolean)) {
          response.setStatus(429);
          return { error: 'Too many login attempts, please try again later' };
        }

        const { code, state, redirect_uri } = query;
        if (!code) {
          if (!data.provider) {
            return { error: 'No authorization code provided' };
          }

          const adapter = this.options.adapters.find(adapter => adapter.constructor.name === data.provider);
          if (!adapter) {
            return { error: 'Invalid OAuth provider' };
          }

          const url = new URL(adapter.getAuthUrl());
          url.searchParams.set('redirect_uri', data.redirectUri as string);
          url.searchParams.set('state', issueOAuthState(this.adminforth, response, {
            provider: data.provider,
            redirectUri: data.redirectUri,
          }));

          return {
            action: {
              type: 'url',
              url: url.toString(),
            },
          };
        }

        if (!state) {
          return { error: 'No OAuth state provided' };
        }

        try {
          const providerState = await consumeOAuthState(this.adminforth, state, cookies as any, response);
          const adapter = this.options.adapters.find(adapter => adapter.constructor.name === providerState.provider);
          if (!adapter) {
            return { error: 'Invalid OAuth provider' };
          }

          const userInfo = await adapter.getTokenFromCode(code, providerState.redirectUri || redirect_uri) as OAuth2UserInfo;
          if (this.externalIdentityStoreInstance || providerState.action === 'connect') {
            if (!userInfo.provider || !userInfo.subject) {
              return { error: 'OAuth adapter must return provider and subject when external identities are enabled' };
            }
          }
          const identityPayload = userInfo.provider && userInfo.subject ? userInfo as OAuthIdentity : undefined;

          if (providerState.action === 'connect') {
            const externalIdentityStore = this.externalIdentityStoreInstance;
            if (!externalIdentityStore) {
              return { error: 'External identities are not configured' };
            }

            const adminUser = await this.getAdminUserFromCookies(cookies as any);
            if (!adminUser) {
              return { error: 'Unauthorized by AdminForth' };
            }

            await externalIdentityStore.createOrUpdate(adminUser.pk, identityPayload!);
            return { redirectTo: '/settings/connected-accounts' };
          }

          const externalIdentityStore = this.externalIdentityStoreInstance;
          let user;
          if (externalIdentityStore) {
            const identity = await externalIdentityStore.findByIdentity(identityPayload!);
            user = identity ? await this.adminforth.resource(this.resource.resourceId).get(
              Filters.EQ(this.userPrimaryKeyField, externalIdentityStore.linkedAdminUserPk(identity))
            ) : null;

            if (!user && userInfo.email) {
              user = await this.adminforth.resource(this.resource.resourceId).get(
                Filters.EQ(this.options.emailField, userInfo.email)
              );
              if (user) {
                await externalIdentityStore.createOrUpdate(user[this.userPrimaryKeyField], identityPayload!);
              }
            }
          } else if (userInfo.email) {
            user = await this.adminforth.resource(this.resource.resourceId).get(
              Filters.EQ(this.options.emailField, userInfo.email)
            );
          }

          if (!user) {
            if (!userInfo.email) {
              return {
                error: 'OAuth provider did not return an email and signup is not possible. Please contact your administrator to get access to the system'
              };
            }
            if (!this.options.openSignup?.enabled) {
                response.setStatus(403);
              return { 
                error: 'User with your email is not registered in system and signup is not allowed. Please contact your administrator to get access to the system'
              };
            }

            const createData: any = {
              [this.options.emailField]: userInfo.email,
              [this.adminforth.config.auth.passwordHashField]: await AdminForth.Utils.generatePasswordHash(randomUUID()),
              ...this.options.openSignup.defaultFieldValues
            };

            if (this.options.emailConfirmedField) {
              createData[this.options.emailConfirmedField] = true;
            }

            const createResult = await this.adminforth.resource(this.resource.resourceId).create(createData);
            user = createResult.createdRecord;
            if (identityPayload) {
              await this.externalIdentityStoreInstance?.createOrUpdate(user[this.userPrimaryKeyField], identityPayload);
            }
          }

          await this.syncUserProfile(user, userInfo, server);
          const loginResult = await this.doLoginUser(user, user[this.options.emailField], response, { 
            headers, 
            cookies, 
            requestUrl,
            query,
            body: {},
            response
          });
          clearNonceCookie(this.adminforth, response);
          return loginResult;
        } catch (error) {
          console.error('OAuth authentication error:', error);
          response.setStatus(400);
          return { 
            error: `Authentication failed: ${error}`
          };
        }
      }
    });
  }
}
