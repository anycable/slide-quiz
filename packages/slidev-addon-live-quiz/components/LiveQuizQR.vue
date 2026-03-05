<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { useDarkMode } from "@slidev/client";
import * as QRCode from "qrcode";

const props = defineProps<{ url: string; size?: number }>();
const { isDark } = useDarkMode();
const src = ref("");

watchEffect(async () => {
  src.value = await QRCode.toDataURL(props.url, {
    width: props.size ?? 240,
    margin: 1,
    color: {
      dark: isDark.value ? "#ffffff" : "#000000",
      light: "#00000000",
    },
  });
});
</script>

<template>
  <img :src="src" :alt="`Scan to join: ${url}`" class="lq-qr" :width="size ?? 240" :height="size ?? 240" />
</template>
