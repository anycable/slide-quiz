<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { computeWordSizes } from "live-quiz";
import { useQuizManager } from "../composables/useQuizManager";

const props = defineProps<{ quizId: string; question?: string; animate?: boolean }>();

const { state } = useQuizManager();
const votes = computed(() => state.value?.results[props.quizId] ?? { votes: {}, total: 0 });
const revealed = ref(false);

watch(() => props.animate, (val) => {
  if (val) requestAnimationFrame(() => { revealed.value = true; });
});

const words = computed(() => computeWordSizes(votes.value.votes));
</script>

<template>
  <div class="lq-wordcloud">
    <h2 v-if="question" class="lq-wordcloud__title">{{ question }}</h2>
    <div class="lq-wordcloud__cloud">
      <p v-if="words.length === 0" class="lq-wordcloud__empty">
        Waiting for responses...
      </p>
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
