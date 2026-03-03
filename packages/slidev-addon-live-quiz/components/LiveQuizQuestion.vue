<script setup lang="ts">
import { computed } from "vue";
import { useQuizManager } from "../composables/useQuizManager";
import LiveQuizQR from "./LiveQuizQR.vue";

const props = defineProps<{
  quizId: string;
  question: string;
  type?: string;
  options?: { label: string; text: string }[];
}>();

const { state, config } = useQuizManager();

const quizUrl = computed(() => config?.quizUrl);
const online = computed(() => state.value?.online ?? 0);
const answered = computed(() => state.value?.results[props.quizId]?.total ?? 0);
const isText = computed(() => (props.type ?? "choice") === "text");
</script>

<template>
  <div class="lq-question">
    <h2 class="lq-question__title">{{ config?.titleText ?? "Pop quiz!" }}</h2>
    <div class="lq-question__body">
      <div v-if="quizUrl" class="lq-question__qr-side">
        <LiveQuizQR :url="quizUrl" />
        <p class="lq-question__url">{{ quizUrl.replace(/^https?:\/\//, "") }}</p>
      </div>
      <div class="lq-question__content">
        <p class="lq-question__text">{{ question }}</p>
        <p v-if="isText" class="lq-question__hint">Open your phone and type your answer!</p>
        <div v-else class="lq-question__options">
          <div v-for="opt in options" :key="opt.label" class="lq-question__option">
            <span class="lq-question__option-label">{{ opt.label }}</span>
            <span class="lq-question__option-text">{{ opt.text }}</span>
          </div>
        </div>
        <div class="lq-question__counter">
          <span class="lq-online">{{ online }}</span> online ·
          <span class="lq-answered">{{ answered }}</span> answered
        </div>
      </div>
    </div>
  </div>
</template>
