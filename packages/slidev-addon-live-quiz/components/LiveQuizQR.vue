<script setup lang="ts">
import { ref, watchEffect } from "vue";

const props = defineProps<{ url: string; size?: number }>();
const src = ref("");

watchEffect(async () => {
  const mod = await import("qrcode");
  const QRCode = mod.default ?? mod;
  const isDark = document.documentElement.classList.contains("dark");
  src.value = await QRCode.toDataURL(props.url, {
    width: props.size ?? 240,
    margin: 1,
    color: {
      dark: isDark ? "#ffffff" : "#000000",
      light: "#00000000",
    },
  });
});
</script>

<template>
  <img v-if="src" :src="src" :alt="`Scan to join: ${url}`" class="lq-qr" :width="size ?? 240" :height="size ?? 240" />
</template>
