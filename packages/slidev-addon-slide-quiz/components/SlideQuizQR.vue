<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ url: string; size?: number }>();
const src = ref("");

// Use watch (not watchEffect) so we can cancel stale async renders
let generation = 0;
watch(
  () => props.url,
  async (url) => {
    const gen = ++generation;
    const mod = await import("qrcode");
    if (gen !== generation) return; // stale
    const QRCode = mod.default ?? mod;
    const isDark = document.documentElement.classList.contains("dark");
    const result = await QRCode.toDataURL(url, {
      width: props.size ?? 240,
      margin: 1,
      color: {
        dark: isDark ? "#ffffff" : "#000000",
        light: "#00000000",
      },
    });
    if (gen !== generation) return; // stale
    src.value = result;
  },
  { immediate: true },
);
</script>

<template>
  <img v-if="src" :src="src" :alt="`Scan to join: ${url}`" class="sq-qr" :width="size ?? 240" :height="size ?? 240" />
</template>
