<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { computeWordSizes } from "slide-quiz";
import { useQuizManager, useQuizUrl } from "../composables/useQuizManager";
import SlideQuizQR from "./SlideQuizQR.vue";

const props = defineProps<{ quizId: string; question?: string; animate?: boolean }>();

const { results } = useQuizManager();

const { quizUrl, quizUrlDisplay } = useQuizUrl();
const votes = computed(() => results.value[props.quizId] ?? { votes: {}, total: 0 });
const revealed = ref(false);

watch(() => props.animate, (val) => {
  if (val) requestAnimationFrame(() => { revealed.value = true; });
});

const words = computed(() => computeWordSizes(votes.value.votes));
</script>

<template>
  <div class="sq-wordcloud">
    <h2 v-if="question" class="sq-wordcloud__title">{{ question }}</h2>
    <div class="sq-results__body">
      <div class="sq-wordcloud__cloud">
        <p v-if="words.length === 0" class="sq-wordcloud__empty">
          Waiting for responses...
        </p>
        <span
          v-for="(w, i) in words" :key="w.word"
          class="sq-wordcloud__word"
          :class="{ 'sq-wordcloud__word--top': w.isTop }"
          :style="{
            fontSize: `${w.fontSize}rem`,
            opacity: revealed ? 1 : 0,
            transitionDelay: `${i * 0.08}s`,
          }"
          :title="`${w.word}: ${w.count}`"
        >{{ w.word }}</span>
      </div>
      <div v-if="quizUrl" class="sq-results__qr-side">
        <SlideQuizQR :url="quizUrl" :size="160" />
        <p class="sq-results__qr-url">{{ quizUrlDisplay }}</p>
      </div>
    </div>
  </div>
</template>
