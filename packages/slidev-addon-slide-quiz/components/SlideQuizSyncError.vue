<script setup lang="ts">
import { inject, shallowRef, ref, computed, onScopeDispose } from "vue";
import { useIsSlideActive, useSlideContext } from "@slidev/client";
import { QUIZ_MANAGER_KEY } from "../injectionKeys";
import * as Quiz from "slide-quiz";

const manager = inject(QUIZ_MANAGER_KEY, null);
const isSlideActive = useIsSlideActive();
const { $renderContext } = useSlideContext();

const error = shallowRef<string | null>(null);
const health = shallowRef<{status: string; message: string} | null>(null);
if (manager) {
  // Connection problems come first: without a WebSocket nothing else matters.
  const { connectionError, syncError, audienceWarning } = manager.store;
  const update = () => {
    error.value = connectionError.get() ?? syncError.get() ?? audienceWarning.get();
  };
  const unsubs = [connectionError, syncError, audienceWarning].map((store) => store.subscribe(update));
  onScopeDispose(() => unsubs.forEach((u) => u()));
  // Guard public APIs until the addon requires the diagnostics engine release.
  const delivery = (manager.store as any).delivery;
  const getHealth = (Quiz as any).deliveryHealth;
  if (delivery && getHealth) {
    const updateHealth = () => { health.value = getHealth(delivery.get(), manager.store.connection.get()); };
    const stop = delivery.subscribe(updateHealth);
    const stopConnection = manager.store.connection.subscribe(updateHealth);
    const clock = setInterval(updateHealth, 1000);
    onScopeDispose(() => { stop(); stopConnection(); clearInterval(clock); });
  }
}
const warning = computed(() => !!error.value || health.value?.status === "warning");
const message = computed(() => error.value ?? health.value?.message ?? null);

// Only the slide on screen shows the error, once. Presenter view gets the
// full message; the projected slide gets a small pill the presenter can
// click to read it, so the audience does not see a red banner.
const mode = computed(() => {
  if (!isSlideActive.value) return null;
  if (!error.value && (!health.value || health.value.status === "idle")) return null;
  if ($renderContext.value === "presenter") return "full";
  if ($renderContext.value === "slide") return "compact";
  return null;
});
const expanded = ref(false);

// The pill must never keep focus: a focused button swallows the arrow keys,
// and the presenter could no longer change slides.
function toggle(event: MouseEvent) {
  expanded.value = !expanded.value;
  (event.currentTarget as HTMLElement).blur();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="mode === 'full'" class="sq-sync-error sq-sync-error--presenter" :class="{ 'sq-sync-error--status': !warning }" aria-label="Live quiz delivery">{{ warning ? '⚠ ' : '' }}{{ message }}</div>
    <button
      v-else-if="mode === 'compact'"
      type="button"
      class="sq-sync-error"
      :class="{ 'sq-sync-error--compact': !expanded, 'sq-sync-error--status': !warning }"
      :title="message ?? undefined"
      tabindex="-1"
      @mousedown.prevent
      @click="toggle"
    >
      {{ expanded ? `${warning ? '⚠ ' : ''}${message}` : (warning ? "⚠ Live quiz problem · details" : "Live quiz · delivery details") }}
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
  bottom: 3.25rem;
}

/* Presenter view: at the top, clear of Slidev's toolbar at the bottom */
.sq-sync-error--presenter {
  bottom: auto;
  top: 3rem;
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
.sq-sync-error--status { background: color-mix(in srgb, var(--sq-accent, #f59e0b) 25%, #111); color: #fff; }
</style>
