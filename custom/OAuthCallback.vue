<template>
  <div class="flex items-center justify-center min-h-screen">
    <Spinner />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useUserStore } from '@/stores/user';
import { useRouter, useRoute } from 'vue-router';
import { callAdminForthApi } from '@/utils';
import { Spinner } from '@/afcl';

const router = useRouter();
const userStore = useUserStore();
const route = useRoute();

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
      router.push({
        name: 'login',
        query: { error: response.error }
      });
    }
  } else {
    router.push({ name: 'login' });
  }
});
</script>
