<script setup lang="ts">
import { inject, shallowRef, onScopeDispose } from "vue";
import { QUIZ_MANAGER_KEY } from "../injectionKeys";

const manager = inject(QUIZ_MANAGER_KEY, null);

const error = shallowRef<string | null>(null);
if (manager) {
  // Connection problems come first: without a WebSocket nothing else matters.
  // connectionError exists from slide-quiz 0.6; the addon also accepts 0.5.
  const connectionError = manager.store.connectionError;
  const update = () => {
    error.value = connectionError?.get() ?? manager.store.syncError.get();
  };
  const unsubs = [manager.store.syncError.subscribe(update)];
  if (connectionError) unsubs.push(connectionError.subscribe(update));
  onScopeDispose(() => unsubs.forEach((u) => u()));
}
</script>

<template>
  <Teleport to="body">
    <div v-if="error" class="sq-sync-error">⚠ {{ error }}</div>
  </Teleport>
</template>

<style>
.sq-sync-error {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(220, 38, 38, 0.9);
  color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 0.85rem;
  padding: 0.5rem 1.2rem;
  border-radius: 0.5rem;
  z-index: 100;
  max-width: 90vw;
  text-align: center;
}
</style>
