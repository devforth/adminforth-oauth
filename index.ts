import { AdminForthPlugin, Filters, AdminUser, HttpExtra } from "adminforth";
import type { IAdminForth, AdminForthResource } from "adminforth";
import { IHttpServer } from "adminforth";
import { randomUUID } from 'crypto';
import type { OAuth2Adapter } from "adminforth";
import { AdminForthDataTypes } from "adminforth";

interface OAuthPluginOptions {
  emailField: string;
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
  
  constructor(options: OAuthPluginOptions) {
    super(options, import.meta.url);
    if (!options.emailField) {
      throw new Error('OAuthPlugin: emailField is required');
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

    const providers = this.options.adapters.map(adapter => {
      const state = Buffer.from(JSON.stringify({
        provider: adapter.constructor.name
      })).toString('base64');
      return {
        authUrl: `${adapter.getAuthUrl()}&state=${state}`,
        provider: adapter.constructor.name,
        icon: adapter.getIcon(),
        buttonText: `${this.options.buttonText ? this.options.buttonText : 'Continue with'} ${(adapter.getName ? adapter.getName() : adapter.constructor.name)}`,
      };
    });


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
  
  const rememberMeDuration = this.options.authenticationExpireDuration ?? this.adminforth.config.auth.rememberMeDuration;
  await this.adminforth.restApi.processLoginCallbacks(adminUser, toReturn, response, { ...extra }, rememberMeDuration);
    if (toReturn.allowedLogin) {
      this.adminforth.auth.setAuthCookie({ 
        response,
        username,
        pk: user.id,
        expireInDuration: rememberMeDuration
      });
    }
    return toReturn;
  }

  setupEndpoints(server: IHttpServer) {
    server.endpoint({
      method: 'POST',
      path: '/oauth/callback',
      noAuth: true,
      handler: async ({ query, response, headers, cookies, requestUrl }) => {
        const { code, state, redirect_uri } = query;
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

          const userInfo = await adapter.getTokenFromCode(code, redirect_uri);

          let user = await this.adminforth.resource(this.resource.resourceId).get([
            Filters.EQ(this.options.emailField, userInfo.email)
          ]);

          if (!user) {
            // Check if open signup is enabled
            if (!this.options.openSignup?.enabled) {
              return { 
                error: 'User with your email is not registered in system and signup is not allowed. Please contact your administrator to get access to the system'
              };
            }

            // When creating a new user, set emailConfirmedField to true if it's configured
            const createData: any = {
              [this.options.emailField]: userInfo.email,
              [this.adminforth.config.auth.passwordHashField]: '',
              ...this.options.openSignup.defaultFieldValues
            };
            
            if (this.options.emailConfirmedField) {
              createData[this.options.emailConfirmedField] = true;
            }

            user = await this.adminforth.resource(this.resource.resourceId).create(createData);
          }

          if ( this.options.userFullNameField && userInfo.fullName ) {
            const userResourcePrimaryKey = this.resource.columns.find(col => col.primaryKey)?.name;
            const userFullName = user[this.options.userFullNameField];
            if (userFullName && userFullName !== userInfo.fullName) {
              await this.adminforth.resource(this.resource.resourceId).update(user[userResourcePrimaryKey], {
                [this.options.userFullNameField]: userInfo.fullName
              });
            }
          }

          if ( this.options.userAvatarField && userInfo.profilePictureUrl ) {
            const user = await this.adminforth.resource(this.resource.resourceId).get(Filters.EQ(this.options.emailField, userInfo.email));
            if (user && user[this.options.userAvatarField] === null) {
              const avatarResponse = await fetch(userInfo.profilePictureUrl);
              const blob = await avatarResponse.blob();
              const fileType = blob.type;
              const fileExtension = fileType.split('/')[1];
              const fileName=`avatar_${user[this.options.emailField]}_${randomUUID()}`;
              const file = new File([blob], fileName, { type: fileType });
              const { uploadUrl, uploadExtraParams, filePath, error } = await this.avatarUploadPlugin.getFileUploadUrl(
                fileName,
                fileType,
                null,
                fileExtension,
                null
              )
              const res = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                  'Content-Type': fileType,
                  ...uploadExtraParams
                },
                body: file
              });

              const success = res.ok;
              if (!success) {
                console.error('Failed to upload avatar for user', user[this.options.emailField]);
              } else {
                await this.avatarUploadPlugin.markKeyForNotDeletion(filePath);
                const userResourcePrimaryKey = this.resource.columns.find(col => col.primaryKey)?.name;
                this.adminforth.resource(this.resource.resourceId).update(user[userResourcePrimaryKey], {[this.options.userAvatarField]: filePath} )
              }
            }
          }

          return await this.doLogin(userInfo.email, response, { 
            headers, 
            cookies, 
            requestUrl,
            query,
            body: {},
            response
          });
        } catch (error) {
          console.error('OAuth authentication error:', error);
          return { 
            error: `Authentication failed: ${error}`
          };
        }
      }
    });
  }
}
