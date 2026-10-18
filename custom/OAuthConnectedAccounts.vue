<template>
  <div>
    <PageHeader
      :title="$t('Connected accounts')"
      :description="$t('Connect an external account to sign in without a password.')"
    />

    <div class="mt-6 overflow-hidden rounded-lg border border-lightCardBorder bg-lightCardBackground dark:border-darkCardBorder dark:bg-darkCardBackground">
      <div
        v-for="provider in providers"
        :key="provider.provider"
        class="flex flex-wrap items-center gap-3 border-b border-lightCardBorder px-4 py-3.5 last:border-b-0 dark:border-darkCardBorder"
      >
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-lightCardBorder bg-lightSecondaryDarken text-lightCardTitle dark:border-darkCardBorder dark:bg-darkSecondaryLighten dark:text-darkCardTitle">
          <div v-html="provider.icon" class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium text-lightCardTitle dark:text-darkCardTitle">
            {{ provider.name }}
          </p>
          <p
            class="text-xs"
            :class="provider.connected ? 'text-lightSuccess dark:text-darkSuccess' : 'text-lightCardDescription dark:text-darkCardDescription'"
          >
            {{ provider.connected ? $t('Connected') : $t('Not connected') }}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          :disabled="connectingProvider === provider.provider"
          :loader="connectingProvider === provider.provider"
          @click="connectProvider(provider.provider)"
        >
          {{ provider.connected ? $t('Connect another') : $t('Connect') }}
        </Button>
      </div>
    </div>

    <Table
      v-if="identities.length"
      class="mt-6"
      :columns="identityColumns"
      :data="identities"
    >
      <template #cell:account="{ item }">
        <div class="flex items-center gap-3">
          <img
            v-if="item.avatarUrl"
            :src="item.avatarUrl"
            class="h-8 w-8 shrink-0 rounded-full object-cover"
            alt=""
          />
          <div v-else class="h-8 w-8 shrink-0 rounded-full bg-lightSecondaryDarken dark:bg-darkSecondaryLighten" />
          <div class="min-w-0">
            <p class="truncate font-medium">
              {{ item.fullName || item.email || item.phone || item.subject }}
            </p>
            <p v-if="item.email || item.phone" class="truncate text-xs text-lightInputIconColor dark:text-darkInputIconColor">
              {{ item.email || item.phone }}
            </p>
          </div>
        </div>
      </template>

      <template #cell:providerName="{ item }">
        <div class="flex items-center gap-2">
          <div v-if="item.providerIcon" v-html="item.providerIcon" class="h-4 w-4 shrink-0" />
          <span>{{ item.providerName }}</span>
        </div>
      </template>

      <template #cell:subject="{ item }">
        <span class="text-lightInputIconColor dark:text-darkInputIconColor">{{ item.subject }}</span>
      </template>

      <template #cell:actions="{ item }">
        <div class="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            :disabled="disconnectingIdentity === item.id"
            :loader="disconnectingIdentity === item.id"
            @click="disconnectIdentity(item.id)"
          >
            {{ $t('Disconnect') }}
          </Button>
        </div>
      </template>
    </Table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, PageHeader, Table } from '@/afcl';
import { callAdminForthApi } from '@/utils';
import { useCoreStore } from '@/stores/core';

type OAuthProvider = {
  provider: string;
  name: string;
  icon: string;
  connected: boolean;
};

type OAuthIdentity = {
  id: string;
  provider: string;
  providerName: string;
  providerIcon?: string;
  subject: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
};

const providers = ref<OAuthProvider[]>([]);
const identities = ref<OAuthIdentity[]>([]);
const connectingProvider = ref<string | null>(null);
const disconnectingIdentity = ref<string | null>(null);
const coreStore = useCoreStore();
const { t } = useI18n();

const identityColumns = computed(() => [
  { label: t('Account'), fieldName: 'account' },
  { label: t('Provider'), fieldName: 'providerName' },
  { label: t('Identifier'), fieldName: 'subject' },
  { label: t('Actions'), fieldName: 'actions' },
]);

onMounted(async () => {
  await loadProviders();
});

async function loadProviders() {
  const response = await callAdminForthApi({
    method: 'POST',
    path: '/oauth/external-identities',
    body: {},
  });

  providers.value = response.providers;
  identities.value = response.identities || [];
}

async function connectProvider(provider: string) {
  connectingProvider.value = provider;

  try {
    const response = await callAdminForthApi({
      method: 'POST',
      path: '/oauth/external-identity/connect-action',
      body: {
        provider,
        redirectUri: getRedirectUri(),
      },
    });

    if (response.action.type === 'url') {
      window.location.href = response.action.url;
    }
  } finally {
    connectingProvider.value = null;
  }
}

async function disconnectIdentity(identityId: string) {
  disconnectingIdentity.value = identityId;

  try {
    await callAdminForthApi({
      method: 'POST',
      path: '/oauth/external-identity/disconnect',
      body: { identityId },
    });
    await loadProviders();
  } finally {
    disconnectingIdentity.value = null;
  }
}

function getRedirectUri() {
  const baseUrl = coreStore.config?.baseUrl || '';
  const baseUrlSlashed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${window.location.origin}${baseUrlSlashed}oauth/callback`;
}
</script>
