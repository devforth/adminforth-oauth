<template>
  <div class="flex flex-col justify-center mr-6 md:mr-12">
    <h2 class="flex items-start justify-start leading-none text-gray-800 dark:text-gray-50 text-3xl font-semibold">
      {{ $t('Connected Accounts') }}
    </h2>
    <p class="text-sm mt-3">
      {{ $t('Connect external accounts to your AdminForth user') }}
    </p>

    <div class="mt-6 flex flex-wrap gap-4">
      <div
        v-for="provider in providers"
        :key="provider.provider"
        class="flex flex-col w-full lg:w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm"
      >
        <div class="flex items-center justify-between gap-3 mb-4">
          <div class="min-w-0 flex items-center gap-3">
            <div v-html="provider.icon" class="w-6 h-6 shrink-0 dark:text-white" />
            <div class="min-w-0">
              <p class="font-semibold text-gray-900 dark:text-white truncate">
                {{ provider.name }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ provider.connected ? $t('Connected') : $t('Not connected') }}
              </p>
            </div>
          </div>
          <span
            class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
            :class="provider.connected
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'"
          >
            {{ provider.connected ? $t('Active') : $t('Inactive') }}
          </span>
        </div>

        <Button
          class="w-full mt-auto"
          :disabled="connectingProvider === provider.provider"
          :loader="connectingProvider === provider.provider"
          @click="connectProvider(provider.provider)"
        >
          {{ provider.connected ? $t('Connect another') : $t('Connect') }}
        </Button>
      </div>
    </div>

    <div v-if="identities.length" class="mt-6 overflow-hidden border border-gray-200 dark:border-gray-700 rounded-lg">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              {{ $t('Account') }}
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              {{ $t('Provider') }}
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              {{ $t('Identifier') }}
            </th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
              {{ $t('Actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
          <tr v-for="identity in identities" :key="`${identity.provider}:${identity.subject}`">
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <img
                  v-if="identity.avatarUrl"
                  :src="identity.avatarUrl"
                  class="h-9 w-9 rounded-full object-cover"
                  alt=""
                />
                <div v-else class="h-9 w-9 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div class="min-w-0">
                  <p class="truncate font-medium text-gray-900 dark:text-white">
                    {{ identity.fullName || identity.email || identity.phone || identity.subject }}
                  </p>
                  <p v-if="identity.email || identity.phone" class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ identity.email || identity.phone }}
                  </p>
                </div>
              </div>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <div v-if="identity.providerIcon" v-html="identity.providerIcon" class="h-5 w-5 shrink-0" />
                <span class="text-sm text-gray-700 dark:text-gray-200">{{ identity.providerName }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              {{ identity.subject }}
            </td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                :disabled="disconnectingIdentity === identity.id"
                @click="disconnectIdentity(identity.id)"
              >
                {{ disconnectingIdentity === identity.id ? $t('Disconnecting') : $t('Disconnect') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button } from '@/afcl';
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
