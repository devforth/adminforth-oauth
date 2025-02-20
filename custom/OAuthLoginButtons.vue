<template>
  <div :class="meta.iconOnly ? 'flex flex-row justify-center items-center gap-3' : 'flex flex-col justify-center items-center gap-2'" >
    <button 
      v-for="provider in meta.providers" 
      :key="provider.provider"
      @click="handleLogin(provider.authUrl)" 
      class="border dark:border-gray-400 flex items-center justify-center hover:bg-gray-50 hover:dark:border-gray-300 hover:dark:bg-gray-700"
      :class="[
        meta.iconOnly ? 'w-11 h-11 p-0' : 'w-full py-2 px-4',
        meta.pill ? 'rounded-full' : 'rounded-md'
      ]"
    >
      <div v-html="provider.icon" class="w-6 h-6" :class="meta.iconOnly ? 'mr-0' : 'mr-4'" :alt="getProviderName(provider.provider)" />
      <span v-if="!meta.iconOnly" class="font-medium dark:text-white">Continue with {{ getProviderName(provider.provider) }}</span>
    </button>
  </div>
</template>

<script setup>
const props = defineProps({
  meta: {
    type: Object,
    required: true
  }
});

const getProviderName = (provider) => {
  return provider.replace('AdminForthAdapter', '').replace('Oauth2', '');
};

const handleLogin = (authUrl) => {
  window.location.href = authUrl;
};
</script>