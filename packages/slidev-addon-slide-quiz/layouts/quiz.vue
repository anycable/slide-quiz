<script setup lang="ts">
import { inject, onMounted } from "vue";
import { onSlideEnter } from "@slidev/client";
import SlideQuizQuestion from "../components/SlideQuizQuestion.vue";
import SlideQuizError from "../components/SlideQuizError.vue";
import SlideQuizSyncError from "../components/SlideQuizSyncError.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QUIZ_CONFIG_ERROR_KEY } from "../injectionKeys";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string }[];
  titleText?: string;
  hintText?: string;
}>();

const type = props.type ?? "choice";
const options = props.options ?? [];
const { configured, registerQuestion, setActive } = useQuizManager();
const configError = inject(QUIZ_CONFIG_ERROR_KEY, null);

const validTypes = ["choice", "text"];
const missingProps = [
  !props.quizId && "quizId",
  !props.question && "question",
  props.type && !validTypes.includes(props.type) && `type (must be "choice" or "text", got "${props.type}")`,
  type !== "text" && options.length === 0 && "options",
].filter(Boolean);

onMounted(() => {
  if (!configured || missingProps.length) return;
  registerQuestion({
    quizId: props.quizId!,
    question: props.question!,
    type,
    options: options.map((o) => ({ label: o.label, text: o.text })),
  });
});

onSlideEnter(() => {
  if (configured && props.quizId) setActive(props.quizId);
});
</script>

<template>
  <div class="slidev-layout sq-layout">
    <SlideQuizError
      v-if="configError"
      title="slide-quiz config error"
      :message="configError"
      :fix="`---\nslideQuiz:\n  wsUrl: wss://<YOUR-ANYCABLE-URL>/cable\n  quizGroupId: <YOUR-GROUP-ID>\n  quizUrl: https://<YOUR-SITE>/quiz.html\n---`"
    />
    <SlideQuizError
      v-else-if="!configured"
      title="slide-quiz not configured"
      message="Add a slideQuiz block to your first slide's frontmatter:"
      :fix="`---\nslideQuiz:\n  wsUrl: wss://<YOUR-ANYCABLE-URL>/cable\n  quizGroupId: <YOUR-GROUP-ID>\n  quizUrl: https://<YOUR-SITE>/quiz.html\n---`"
    />
    <SlideQuizError
      v-else-if="missingProps.length"
      title="Missing quiz frontmatter"
      :message="`This slide is missing required fields: ${missingProps.join(', ')}`"
      :fix="`---\nlayout: quiz\nquizId: q1\nquestion: Your question here?\noptions:\n  - { label: A, text: Option 1 }\n  - { label: B, text: Option 2 }\n---`"
    />
    <SlideQuizQuestion
      v-else
      :quiz-id="props.quizId!"
      :question="props.question!"
      :type="type"
      :options="options"
      :title-text="props.titleText"
      :hint-text="props.hintText"
    />
    <SlideQuizSyncError />
  </div>
</template>
