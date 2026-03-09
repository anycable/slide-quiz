<script setup lang="ts">
import { computed } from "vue";
import { useQuizManager } from "../composables/useQuizManager";
import LiveQuizQR from "./LiveQuizQR.vue";

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
  <div class="lq-question">
    <h2 v-if="props.titleText ?? config?.titleText" class="lq-question__title">
      {{ props.titleText ?? config?.titleText }}
    </h2>
    <div class="lq-question__body">
      <div v-if="quizUrl" class="lq-question__qr-side">
        <LiveQuizQR :url="quizUrl" />
        <p class="lq-question__url">{{ quizUrlDisplay }}</p>
      </div>
      <p v-else class="lq-question__qr-hint">
        Add quizUrl to liveQuiz config to show a QR code
      </p>
      <div class="lq-question__content">
        <p class="lq-question__text">{{ question }}</p>
        <p v-if="isText && hintText" class="lq-question__hint">{{ hintText }}</p>
        <div v-else-if="!isText" class="lq-question__options">
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
