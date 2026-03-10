<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuizManager } from "../composables/useQuizManager";

const props = defineProps<{
  quizId: string;
  question?: string;
  options?: { label: string; text: string; correct?: boolean }[];
  animate?: boolean;
}>();

const { results } = useQuizManager();
const votes = computed(() => results.value[props.quizId] ?? { votes: {}, total: 0 });
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
  <div class="sq-results">
    <h2 v-if="question" class="sq-results__title">{{ question }}</h2>
    <div class="sq-results__bars">
      <div
        v-for="(opt, i) in options" :key="opt.label"
        class="sq-result-bar"
        :class="{ 'sq-result-bar--correct': opt.correct }"
      >
        <div class="sq-result-bar__label">
          <span class="sq-result-bar__letter">{{ opt.label }}</span>
          <span class="sq-result-bar__text">{{ opt.text }}</span>
        </div>
        <div class="sq-result-bar__track">
          <div
            class="sq-result-bar__fill"
            :style="{
              width: revealed ? `${pct(opt.label)}%` : '0%',
              transitionDelay: `${i * 0.15}s`,
            }"
          />
        </div>
        <div class="sq-result-bar__stats">
          <span class="sq-result-bar__pct">{{ revealed ? pct(opt.label) : 0 }}%</span>
          <span class="sq-result-bar__count">{{ count(opt.label) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
