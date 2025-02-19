import { AdminForthPlugin, Filters, AdminUser } from "adminforth";
import type { IAdminForth, AdminForthResource } from "adminforth";
import { IHttpServer } from "adminforth";
import { randomUUID } from 'crypto';
import type { OAuth2Adapter } from "adminforth";
import { AdminForthDataTypes } from "adminforth";
import type { HttpExtra } from './types.js';

interface OAuthPluginOptions {
  emailField: string;
  emailConfirmedField?: string;
  adapters: OAuth2Adapter[];
}

export class OAuthPlugin extends AdminForthPlugin {
  private options: OAuthPluginOptions;
  public adminforth: IAdminForth;
  private resource: AdminForthResource;

  constructor(options: OAuthPluginOptions) {
    super(options, import.meta.url);
    if (!options.emailField) {
      throw new Error('OAuthPlugin: emailField is required');
    }
    this.options = options;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resource: AdminForthResource) {
    await super.modifyResourceConfig(adminforth, resource);
    
    this.adminforth = adminforth;
    this.resource = resource;

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

    // Make sure customization and loginPageInjections exist
    if (!adminforth.config.customization?.loginPageInjections) {
      adminforth.config.customization = {
        ...adminforth.config.customization,
        loginPageInjections: { underInputs: [] }
      };
    }

    // Register the component with the correct plugin path
    const componentPath = `@@/plugins/${this.constructor.name}/OAuthLoginButton.vue`;
    this.componentPath('OAuthLoginButton.vue');

    const baseUrl = adminforth.config.baseUrl || '';
    this.options.adapters.forEach(adapter => {
      const state = Buffer.from(JSON.stringify({
        provider: adapter.constructor.name
      })).toString('base64');

      adminforth.config.customization.loginPageInjections.underInputs.push({
        file: componentPath,
        meta: {
          authUrl: `${adapter.getAuthUrl()}&state=${state}`,
          provider: adapter.constructor.name,
          baseUrl,
          icon: adapter.getIcon?.() || ''
        }
      });
    });
  }

  async doLogin(email: string, response: any, extra: HttpExtra): Promise<{ error?: string; allowedLogin: boolean; redirectTo?: string; }> {
    const username = email;
    const user = await this.adminforth.resource(this.resource.resourceId).get([
      Filters.EQ(this.options.emailField, email)
    ]);
    
    if (!user) {
      return { error: 'User not found', allowedLogin: false };
    }

    // If emailConfirmedField is set and the field is false, update it to true
    if (this.options.emailConfirmedField && user[this.options.emailConfirmedField] === false) {
      await this.adminforth.resource(this.resource.resourceId).update(user.id, {
        [this.options.emailConfirmedField]: true
      });
    }

    const adminUser = { 
      dbUser: user,
      pk: user.id,
      username,
    };
    const toReturn = { allowedLogin: true, error: '' };

    await this.adminforth.restApi.processLoginCallbacks(adminUser, toReturn, response, extra);
    
    if (toReturn.allowedLogin) {
      this.adminforth.auth.setAuthCookie({ 
        response,
        username,
        pk: user.id,
        expireInDays: this.adminforth.config.auth.rememberMeDays 
      });
    }

    return toReturn;
  }

  setupEndpoints(server: IHttpServer) {
    server.endpoint({
      method: 'GET',
      path: '/oauth/callback',
      noAuth: true,
      handler: async ({ query, response, headers, cookies, requestUrl }) => {
        const { code, state } = query;
        if (!code) {
          return { error: 'No authorization code provided' };
        }

        try {
          // The provider information is now passed through the state parameter
          const providerState = JSON.parse(Buffer.from(state, 'base64').toString());
          const provider = providerState.provider;

          const adapter = this.options.adapters.find(a => 
            a.constructor.name === provider
          );

          if (!adapter) {
            return { error: 'Invalid OAuth provider' };
          }

          const userInfo = await adapter.getTokenFromCode(code);

          let user = await this.adminforth.resource(this.resource.resourceId).get([
            Filters.EQ(this.options.emailField, userInfo.email)
          ]);

          if (!user) {
            // When creating a new user, set emailConfirmedField to true if it's configured
            const createData: any = {
              id: randomUUID(),
              created_at: new Date().toISOString(),
              [this.options.emailField]: userInfo.email,
              role: 'user',
              password_hash: ''
            };
            
            if (this.options.emailConfirmedField) {
              createData[this.options.emailConfirmedField] = true;
            }

            user = await this.adminforth.resource(this.resource.resourceId).create(createData);
          }

          return await this.doLogin(userInfo.email, response, { 
            headers, 
            cookies, 
            requestUrl,
            query,
            body: {}
          });
        } catch (error) {
          console.error('OAuth authentication error:', error);
          return { 
            error: 'Authentication failed',
            redirectTo: '/login'
          };
        }
      }
    });
  }
}
