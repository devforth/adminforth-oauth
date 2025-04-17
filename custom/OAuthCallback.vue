<template>
  <div class="flex items-center justify-center min-h-screen">
    <div v-if="error" class="py-8 px-4 mx-auto max-w-screen-xl lg:py-16 lg:px-6">
      <div class="mx-auto max-w-screen-sm text-center">
        <h1 class="mb-4 text-7xl tracking-tight font-extrabold lg:text-9xl text-lightPrimary dark:text-darkPrimary">
          {{$t('Oops!')}}
        </h1>
        <p class="mb-4 text-3xl tracking-tight font-bold text-gray-900 md:text-4xl dark:text-white">
          {{$t('Authentication Failed')}}
        </p>
        <p class="mb-4 text-lg font-light text-gray-500 dark:text-gray-400">
          {{ error }}
        </p>
        <div class="flex justify-center">
          <LinkButton to="/login">{{$t('Back to Login')}}</LinkButton>
        </div>
      </div>
    </div>
    <Spinner v-else />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useUserStore } from '@/stores/user';
import { useRouter, useRoute } from 'vue-router';
import { callAdminForthApi } from '@/utils';
import { Spinner, LinkButton } from '@/afcl';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const router = useRouter();
const userStore = useUserStore();
const route = useRoute();
const error = ref(null);

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  
  const baseUrl = route.meta.baseUrl;
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const redirectUri = window.location.origin + normalizedBaseUrl + 'oauth/callback';
  
  if (code && state && redirectUri) {
    const encodedCode = encodeURIComponent(code);
    const encodedState = encodeURIComponent(state);
    const response = await callAdminForthApi({
      path: `/oauth/callback?code=${encodedCode}&state=${encodedState}&redirect_uri=${redirectUri}`,
      method: 'GET',
    });
    
    if (response.allowedLogin) {
      await userStore.finishLogin();
    } else if (response.redirectTo) {
      router.push(response.redirectTo);
    } else if (response.error) {
      error.value = response.error;
    }
  } else {
    error.value = t('Invalid authentication request. Missing required parameters.');
  }
});
</script>
