<script setup lang="ts">
defineProps<{
  title: string;
  message: string;
  fix?: string;
}>();
</script>

<template>
  <div class="sq-error">
    <p class="sq-error__title">{{ title }}</p>
    <p class="sq-error__message">{{ message }}</p>
    <pre v-if="fix" class="sq-error__fix">{{ fix }}</pre>
  </div>
</template>

<style>
.sq-error {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 36rem;
  margin: 2rem auto;
  padding: 1.5rem;
  border: 1px solid var(--sq-accent, #f59e0b);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--sq-accent, #f59e0b) 8%, transparent);
  font-family: system-ui, sans-serif;
}
.sq-error__title {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--sq-accent, #f59e0b);
  margin: 0;
}
.sq-error__message {
  font-size: 0.95rem;
  line-height: 1.5;
  margin: 0;
  opacity: 0.85;
}
.sq-error__fix {
  font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
  font-size: 0.85rem;
  line-height: 1.6;
  padding: 1rem;
  border-radius: 0.375rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
  margin: 0;
  white-space: pre-wrap;
}
</style>
