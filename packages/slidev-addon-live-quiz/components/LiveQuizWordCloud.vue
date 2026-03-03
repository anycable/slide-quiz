<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuizManager } from "../composables/useQuizManager";

const props = defineProps<{ quizId: string; question?: string; animate?: boolean }>();

const { state } = useQuizManager();
const votes = computed(() => state.value?.results[props.quizId] ?? { votes: {}, total: 0 });
const revealed = ref(false);

watch(() => props.animate, (val) => {
  if (val) requestAnimationFrame(() => { revealed.value = true; });
});

const MIN_FONT = 0.8;
const MAX_FONT = 3;

const words = computed(() => {
  const entries = Object.entries(votes.value.votes);
  if (!entries.length) return [];
  const maxCount = Math.max(...entries.map(([, c]) => c));
  return entries.map(([word, count]) => ({
    word,
    count,
    fontSize: maxCount > 1
      ? MIN_FONT + ((count - 1) / (maxCount - 1)) * (MAX_FONT - MIN_FONT)
      : (MIN_FONT + MAX_FONT) / 2,
    isTop: count === maxCount,
  }));
});
</script>

<template>
  <div class="lq-wordcloud">
    <h2 v-if="question" class="lq-wordcloud__title">{{ question }}</h2>
    <div class="lq-wordcloud__cloud">
      <span
        v-for="(w, i) in words" :key="w.word"
        class="lq-wordcloud__word"
        :class="{ 'lq-wordcloud__word--top': w.isTop }"
        :style="{
          fontSize: `${w.fontSize}rem`,
          opacity: revealed ? 1 : 0,
          transitionDelay: `${i * 0.08}s`,
        }"
        :title="`${w.word}: ${w.count}`"
      >{{ w.word }}</span>
    </div>
  </div>
</template>
