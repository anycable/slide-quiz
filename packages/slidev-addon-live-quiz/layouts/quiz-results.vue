<script setup lang="ts">
import { ref } from "vue";
import { onSlideEnter } from "@slidev/client";
import * as v from "valibot";
import LiveQuizResults from "../components/LiveQuizResults.vue";
import LiveQuizWordCloud from "../components/LiveQuizWordCloud.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QuizResultsFrontmatterSchema } from "../schemas";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string; correct?: boolean }[];
}>();

const parsed = v.parse(QuizResultsFrontmatterSchema, props);
const { setActive } = useQuizManager();

const isText = parsed.type === "text";
const entered = ref(false);

onSlideEnter(() => {
  setActive(parsed.quizId);
  entered.value = true;
});
</script>

<template>
  <LiveQuizWordCloud v-if="isText" :quiz-id="parsed.quizId" :question="parsed.question" :animate="entered" />
  <LiveQuizResults v-else :quiz-id="parsed.quizId" :question="parsed.question" :options="parsed.options" :animate="entered" />
</template>
