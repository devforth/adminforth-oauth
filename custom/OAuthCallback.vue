<template>
  <div class="flex items-center justify-center min-h-screen">
    <Spinner />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useUserStore } from '@/stores/user';
import { useRouter } from 'vue-router';
import { callAdminForthApi } from '@/utils';
import { Spinner } from '@/afcl';

const router = useRouter();
const userStore = useUserStore();

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const redirectUri = window.location.origin + '/oauth/callback';
  if (code && state && redirectUri) {
    const encodedCode = encodeURIComponent(code);
    const encodedState = encodeURIComponent(state);
    const encodedRedirectUri = encodeURIComponent(redirectUri);
    const response = await callAdminForthApi({
      path: `/oauth/callback?code=${encodedCode}&state=${encodedState}&redirect_uri=${encodedRedirectUri}`,
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
