<script setup lang="ts">
import { inject, shallowRef, ref, computed, onScopeDispose } from "vue";
import { useIsSlideActive, useSlideContext } from "@slidev/client";
import { QUIZ_MANAGER_KEY } from "../injectionKeys";

const manager = inject(QUIZ_MANAGER_KEY, null);
const isSlideActive = useIsSlideActive();
const { $renderContext } = useSlideContext();

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

// Only the slide on screen shows the error, once. Presenter view gets the
// full message; the projected slide gets a small pill the presenter can
// click to read it, so the audience does not see a red banner.
const mode = computed(() => {
  if (!error.value || !isSlideActive.value) return null;
  if ($renderContext.value === "presenter") return "full";
  if ($renderContext.value === "slide") return "compact";
  return null;
});
const expanded = ref(false);
</script>

<template>
  <Teleport to="body">
    <div v-if="mode === 'full'" class="sq-sync-error">⚠ {{ error }}</div>
    <button
      v-else-if="mode === 'compact'"
      type="button"
      class="sq-sync-error"
      :class="{ 'sq-sync-error--compact': !expanded }"
      :title="error ?? undefined"
      @click="expanded = !expanded"
    >
      {{ expanded ? `⚠ ${error}` : "⚠ Live quiz problem · details" }}
    </button>
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
  border: none;
  border-radius: 0.5rem;
  z-index: 100;
  max-width: 90vw;
  text-align: center;
}

button.sq-sync-error {
  cursor: pointer;
}

.sq-sync-error--compact {
  left: auto;
  right: 1rem;
  transform: none;
  font-size: 0.75rem;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  opacity: 0.85;
}
</style>
