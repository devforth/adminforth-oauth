<template>
  <div :class="meta.iconOnly ? 'flex flex-row justify-center items-center gap-3' : 'flex flex-col justify-center items-center gap-2'" >
    <a 
      v-for="provider in meta.providers" 
      :key="provider.provider"
      :href="handleLogin(provider.authUrl)" 
      class="border dark:border-gray-400 flex items-center justify-center hover:bg-gray-50 hover:dark:border-gray-300 hover:dark:bg-gray-700"
      :class="[
        meta.iconOnly ? 'w-11 h-11 p-0' : 'w-full py-2 px-4',
        meta.pill ? 'rounded-full' : 'rounded-md'
      ]"
    >
      <div v-html="provider.icon" class="w-5 h-5 dark:text-white" :class="meta.iconOnly ? 'mr-0' : 'mr-2'" :alt="getProviderName(provider.provider)" />
      <span v-if="!meta.iconOnly" class="font-medium dark:text-white">{{ getButtonText(provider.buttonText) }}</span>
    </a>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminforth } from '@/adminforth';
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

const getProviderName = (provider) => {
  return provider.replace('AdminForthAdapter', '').replace('Oauth2', '');
};
const getButtonText = (buttonText) => {
  return buttonText.replace('AdminForthAdapter', '').replace('Oauth2', '');
};

const handleLogin = (authUrl) => {
  const baseUrl = props.meta.baseUrl;
  const baseUrlSlashed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const redirectUri = window.location.origin + baseUrlSlashed + 'oauth/callback';
  
  const url = new URL(authUrl);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
};

function tryStartOAuth(query) {
  if (!('start_oauth' in query)) return;

  const provider = props.meta.providers.find(({ provider }) =>
    getProviderName(provider).toLowerCase() === query.start_oauth.toLowerCase()
  );

  if (provider) {
    window.location.href = handleLogin(provider.authUrl);
  } else if (query.start_oauth === '') {
    alert({ variant: 'warning', message: t('Empty OAuth provider') });
  } else {
    alert({ variant: 'warning', message: t('Unknown OAuth provider: {provider}', { provider: query.start_oauth }) });
  }
}

onMounted(() => {
  tryStartOAuth(route.query);
});
</script>