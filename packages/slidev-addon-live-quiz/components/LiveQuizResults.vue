<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuizManager } from "../composables/useQuizManager";

const props = defineProps<{
  quizId: string;
  question?: string;
  options?: { label: string; text: string; correct?: boolean }[];
  animate?: boolean;
}>();

const { state } = useQuizManager();
const votes = computed(() => state.value?.results[props.quizId] ?? { votes: {}, total: 0 });
const revealed = ref(false);

// Trigger bar animation when animate prop becomes true
watch(() => props.animate, (val) => {
  if (val) requestAnimationFrame(() => { revealed.value = true; });
});

function pct(label: string): number {
  const total = votes.value.total || 1;
  return Math.round(((votes.value.votes[label] || 0) / total) * 100);
}
function count(label: string): number {
  return votes.value.votes[label] || 0;
}
</script>

<template>
  <div class="lq-results">
    <h2 v-if="question" class="lq-results__title">{{ question }}</h2>
    <div class="lq-results__bars">
      <div
        v-for="(opt, i) in options" :key="opt.label"
        class="lq-result-bar"
        :class="{ 'lq-result-bar--correct': opt.correct }"
      >
        <div class="lq-result-bar__label">
          <span class="lq-result-bar__letter">{{ opt.label }}</span>
          <span class="lq-result-bar__text">{{ opt.text }}</span>
        </div>
        <div class="lq-result-bar__track">
          <div
            class="lq-result-bar__fill"
            :style="{
              width: revealed ? `${pct(opt.label)}%` : '0%',
              transitionDelay: `${i * 0.15}s`,
            }"
          />
        </div>
        <div class="lq-result-bar__stats">
          <span class="lq-result-bar__pct">{{ revealed ? pct(opt.label) : 0 }}%</span>
          <span class="lq-result-bar__count">{{ count(opt.label) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
