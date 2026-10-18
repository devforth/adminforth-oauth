<template>
  <div :class="meta.iconOnly ? 'flex flex-row justify-center items-center gap-3' : 'flex flex-col justify-center items-center gap-2'" >
    <Button
      v-for="provider in meta.providers"
      :key="provider.provider"
      type="button"
      variant="secondary"
      :iconOnly="meta.iconOnly"
      :class="[meta.iconOnly ? 'w-11 h-11' : 'w-full', { 'rounded-full': meta.pill }]"
      :aria-label="meta.iconOnly ? getButtonText(provider.buttonText) : undefined"
      :disabled="startingProvider === provider.provider"
      :loader="startingProvider === provider.provider"
      @click="handleLogin(provider.provider)"
    >
      <div v-html="provider.icon" class="w-5 h-5" />
      <span v-if="!meta.iconOnly">{{ getButtonText(provider.buttonText) }}</span>
    </Button>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminforth } from '@/adminforth';
import { Button } from '@/afcl';
import { callAdminForthApi } from '@/utils';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  meta: {
    type: Object,
    required: true
  }
});

const route = useRoute();
const { alert } = useAdminforth();
const { t } = useI18n();
const startingProvider = ref(null);

const getProviderName = (provider) => {
  return provider.replace('AdminForthAdapter', '').replace('Oauth2', '');
};
const getButtonText = (buttonText) => {
  return buttonText.replace('AdminForthAdapter', '').replace('Oauth2', '');
};

const getRedirectUri = () => {
  const baseUrl = props.meta.baseUrl || '';
  const baseUrlSlashed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return window.location.origin + baseUrlSlashed + 'oauth/callback';
};

const handleLogin = async (provider) => {
  startingProvider.value = provider;

  try {
    const response = await callAdminForthApi({
      path: '/oauth/callback',
      method: 'POST',
      body: {
        provider,
        redirectUri: getRedirectUri(),
      },
    });

    if (response.action?.type === 'url') {
      window.location.href = response.action.url;
    } else if (response.error) {
      alert({ variant: 'warning', message: response.error });
    }
  } finally {
    startingProvider.value = null;
  }
};

async function tryStartOAuth(query) {
  if (!('start_oauth' in query)) return;
  const startOAuth = Array.isArray(query.start_oauth) ? query.start_oauth[0] : query.start_oauth;

  const provider = props.meta.providers.find(({ provider }) =>
    getProviderName(provider).toLowerCase() === String(startOAuth || '').toLowerCase()
  );

  if (provider) {
    await handleLogin(provider.provider);
  } else if (!startOAuth) {
    alert({ variant: 'warning', message: t('Empty OAuth provider') });
  } else {
    alert({ variant: 'warning', message: t('Unknown OAuth provider: {provider}', { provider: startOAuth }) });
  }
}

onMounted(async () => {
  await tryStartOAuth(route.query);
});
</script>
