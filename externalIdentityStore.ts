import { Filters } from "adminforth";
import type { IAdminForth } from "adminforth";

export interface ExternalIdentityResourceOptions {
  resourceId: string;
  adminUserIdField?: string;
  providerField?: string;
  subjectField?: string;
  emailField?: string;
  phoneField?: string;
  fullNameField?: string;
  avatarUrlField?: string;
  externalUserIdField?: string;
  metaField?: string;
}

export interface OAuthIdentity {
  provider: string;
  subject: string;
  email?: string;
  phone?: string;
  meta?: Record<string, any>;
  fullName?: string;
  profilePictureUrl?: string | null;
  externalUserId?: string | number | null;
}

type OAuthAdapterDisplay = {
  constructor: { name: string };
  getName?: () => string;
  getIcon: () => string;
};

export class ExternalIdentityStore {
  private primaryKeyField: string;
  private adminUserIdField: string;
  private providerField: string;
  private subjectField: string;
  private externalUserIdField: string;

  constructor(
    private adminforth: IAdminForth,
    private config: ExternalIdentityResourceOptions,
  ) {
    this.primaryKeyField = this.resolvePrimaryKey();
    this.adminUserIdField = config.adminUserIdField ?? 'adminUserId';
    this.providerField = config.providerField ?? 'provider';
    this.subjectField = config.subjectField ?? 'subject';
    this.externalUserIdField = config.externalUserIdField ?? 'externalUserId';
  }

  private resource() {
    return this.adminforth.resource(this.config.resourceId);
  }

  private resolvePrimaryKey() {
    const primaryKey = this.adminforth.config.resources
      .find(resource => resource.resourceId === this.config.resourceId)
      ?.columns.find(column => column.primaryKey)?.name;

    if (!primaryKey) {
      throw new Error(`External identity resource "${this.config.resourceId}" has no primary key`);
    }

    return primaryKey;
  }

  private identityRecord(adminUserPk: any, identity: OAuthIdentity) {
    const record: Record<string, any> = {
      [this.adminUserIdField]: adminUserPk,
      [this.providerField]: identity.provider,
      [this.subjectField]: identity.subject,
    };
    const fields = [
      [this.config.emailField, identity.email],
      [this.config.phoneField, identity.phone],
      [this.config.fullNameField, identity.fullName],
      [this.config.avatarUrlField, identity.profilePictureUrl],
      [this.externalUserIdField, identity.externalUserId],
      [this.config.metaField, identity.meta],
    ] as const;

    for (const [field, value] of fields) {
      if (field && value !== undefined) {
        record[field] = value;
      }
    }

    return record;
  }

  findByIdentity(identityPayload: OAuthIdentity) {
    return this.resource().get([
      Filters.EQ(this.providerField, identityPayload.provider),
      Filters.EQ(this.subjectField, identityPayload.subject),
    ]);
  }

  linkedAdminUserPk(identity: any) {
    return identity[this.adminUserIdField];
  }

  async createOrUpdate(adminUserPk: any, identityPayload: OAuthIdentity) {
    const existingIdentity = await this.findByIdentity(identityPayload);
    const identityRecord = this.identityRecord(adminUserPk, identityPayload);

    if (existingIdentity) {
      if (existingIdentity[this.adminUserIdField] !== adminUserPk) {
        throw new Error('This external account is already connected to another user');
      }
      await this.resource().update(
        existingIdentity[this.primaryKeyField],
        identityRecord,
      );
      return;
    }

    await this.resource().create(identityRecord);
  }

  async disconnect(identityId: string, adminUserPk: any) {
    const identity = await this.resource().get([
      Filters.EQ(this.primaryKeyField, identityId),
      Filters.EQ(this.adminUserIdField, adminUserPk),
    ]);

    if (!identity) {
      return { error: 'Connected account not found' };
    }

    await this.resource().delete(identityId);
    return { ok: true };
  }

  async connectedAccounts(adminUserPk: any, adapters: OAuthAdapterDisplay[]) {
    const identities = await this.resource().list(
      Filters.EQ(this.adminUserIdField, adminUserPk)
    );

    return {
      providers: adapters.map((adapter) => ({
        provider: adapter.constructor.name,
        name: adapter.getName ? adapter.getName() : adapter.constructor.name,
        icon: adapter.getIcon(),
        connected: identities.some((identity) => identity[this.providerField] === adapter.constructor.name),
      })),
      identities: identities.map((identity) => {
        const adapter = adapters.find((adapter) => adapter.constructor.name === identity[this.providerField]);
        return {
          id: identity[this.primaryKeyField],
          provider: identity[this.providerField],
          providerName: adapter?.getName ? adapter.getName() : identity[this.providerField],
          providerIcon: adapter?.getIcon(),
          subject: identity[this.subjectField],
          email: this.config.emailField ? identity[this.config.emailField] : null,
          phone: this.config.phoneField ? identity[this.config.phoneField] : null,
          fullName: this.config.fullNameField ? identity[this.config.fullNameField] : null,
          avatarUrl: this.config.avatarUrlField ? identity[this.config.avatarUrlField] : null,
        };
      }),
    };
  }
}
