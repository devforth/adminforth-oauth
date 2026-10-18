<template>
  <div class="af-oauth-login flex flex-col gap-4">
    <div class="af-oauth-divider flex items-center gap-3 text-xs text-lightLoginViewSubTextColor dark:text-darkLoginViewSubTextColor">
      <span class="h-px flex-1 bg-lightDialogBreakLine dark:bg-darkDialogBreakLine" />
      {{ meta.iconOnly ? $t('or continue with') : $t('or') }}
      <span class="h-px flex-1 bg-lightDialogBreakLine dark:bg-darkDialogBreakLine" />
    </div>
    <!-- icons share the row equally and wrap when too many providers do not fit -->
    <div :class="meta.iconOnly ? 'af-oauth-buttons grid grid-cols-[repeat(auto-fit,minmax(2.75rem,1fr))] gap-2' : 'af-oauth-buttons flex flex-col gap-2'">
      <Button
        v-for="provider in meta.providers"
        :key="provider.provider"
        type="button"
        variant="secondary"
        :iconOnly="meta.iconOnly"
        :class="['af-oauth-button w-full gap-2', { 'rounded-full': meta.pill }]"
        :aria-label="meta.iconOnly ? getButtonText(provider.buttonText) : undefined"
        :disabled="startingProvider === provider.provider"
        :loader="startingProvider === provider.provider"
        @click="handleLogin(provider.provider)"
      >
        <span
          v-html="provider.icon"
          aria-hidden="true"
          :class="['af-oauth-button-icon shrink-0 [&>svg]:w-full [&>svg]:h-full', meta.iconOnly ? 'w-[18px] h-[18px]' : 'w-4 h-4']"
        />
        <span v-if="!meta.iconOnly">{{ getButtonText(provider.buttonText) }}</span>
      </Button>
    </div>
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
