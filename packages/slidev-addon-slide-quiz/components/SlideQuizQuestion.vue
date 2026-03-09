<script setup lang="ts">
import { computed } from "vue";
import { useQuizManager } from "../composables/useQuizManager";
import SlideQuizQR from "./SlideQuizQR.vue";

const props = defineProps<{
  quizId: string;
  question: string;
  type?: string;
  options?: { label: string; text: string }[];
  titleText?: string;
  hintText?: string;
}>();

const { state, config } = useQuizManager();

const quizUrl = computed(() => {
  if (!config?.quizUrl) return undefined;
  const url = new URL(config.quizUrl, window.location.origin);
  url.searchParams.set("wsUrl", config.wsUrl);
  url.searchParams.set("quizGroupId", config.quizGroupId);
  return url.toString();
});
const quizUrlDisplay = computed(() =>
  config?.quizUrl?.replace(/^https?:\/\//, "") ?? "",
);
const online = computed(() => state.value?.online ?? 0);
const answered = computed(() => state.value?.results[props.quizId]?.total ?? 0);
const isText = computed(() => (props.type ?? "choice") === "text");
</script>

<template>
  <div class="sq-question">
    <h2 v-if="props.titleText ?? config?.titleText" class="sq-question__title">
      {{ props.titleText ?? config?.titleText }}
    </h2>
    <div class="sq-question__body">
      <div v-if="quizUrl" class="sq-question__qr-side">
        <SlideQuizQR :url="quizUrl" />
        <p class="sq-question__url">{{ quizUrlDisplay }}</p>
      </div>
      <p v-else class="sq-question__qr-hint">
        Add quizUrl to slideQuiz config to show a QR code
      </p>
      <div class="sq-question__content">
        <p class="sq-question__text">{{ question }}</p>
        <p v-if="isText && hintText" class="sq-question__hint">{{ hintText }}</p>
        <div v-else-if="!isText" class="sq-question__options">
          <div v-for="opt in options" :key="opt.label" class="sq-question__option">
            <span class="sq-question__option-label">{{ opt.label }}</span>
            <span class="sq-question__option-text">{{ opt.text }}</span>
          </div>
        </div>
        <div class="sq-question__counter">
          <span class="sq-online">{{ online }}</span> online ·
          <span class="sq-answered">{{ answered }}</span> answered
        </div>
      </div>
    </div>
  </div>
</template>
