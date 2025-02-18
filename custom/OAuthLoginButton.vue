<template>
    <button 
      @click="handleLogin" 
      class="border w-full rounded-full py-2 px-4 font-bold flex items-center justify-center hover:bg-gray-50"
    >
      <div v-html="meta.icon" class="w-6 h-6 mr-4" :alt="providerName" />
      <span class="font-bold">Login with {{ providerName }}</span>
    </button>
  </template>
  
  <script setup>
  import { computed } from 'vue';
  const props = defineProps({
    meta: {
      type: Object,
      required: true
    }
  });
  const providerName = computed(() => {
    return props.meta.provider.replace('AdminForthAdapter', '').replace('Oauth2', '');
  });
  
  const handleLogin = () => {
    window.location.href = props.meta.authUrl;
  };
  </script>