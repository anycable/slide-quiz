<script setup lang="ts">
import { onMounted } from "vue";
import { onSlideEnter } from "@slidev/client";
import * as v from "valibot";
import LiveQuizQuestion from "../components/LiveQuizQuestion.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QuizFrontmatterSchema } from "../schemas";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string }[];
}>();

const parsed = v.parse(QuizFrontmatterSchema, props);
const { registerQuestion, setActive } = useQuizManager();

onMounted(() => {
  registerQuestion({
    quizId: parsed.quizId,
    question: parsed.question,
    type: parsed.type,
    options: parsed.options.map((o) => ({ label: o.label, text: o.text })),
  });
});

onSlideEnter(() => {
  setActive(parsed.quizId);
});
</script>

<template>
  <LiveQuizQuestion v-bind="parsed" />
</template>
