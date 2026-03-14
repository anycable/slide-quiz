<script setup lang="ts">
import { inject, ref } from "vue";
import { onSlideEnter, onSlideLeave } from "@slidev/client";
import SlideQuizResults from "../components/SlideQuizResults.vue";
import SlideQuizWordCloud from "../components/SlideQuizWordCloud.vue";
import SlideQuizError from "../components/SlideQuizError.vue";
import SlideQuizSyncError from "../components/SlideQuizSyncError.vue";
import { useQuizManager } from "../composables/useQuizManager";
import { QUIZ_CONFIG_ERROR_KEY } from "../injectionKeys";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string; correct?: boolean }[];
}>();

const type = props.type ?? "choice";
const options = props.options ?? [];
const { configured, registerQuestion, setActive, clearActive } = useQuizManager();
const configError = inject(QUIZ_CONFIG_ERROR_KEY, null);

const isText = type === "text";
const entered = ref(false);

// Register question so standalone results slides (no matching quiz slide) work
if (configured && props.quizId) {
  registerQuestion({
    quizId: props.quizId,
    question: props.question ?? "",
    type: type as "choice" | "text",
    options: options.map((o) => ({ label: o.label, text: o.text })),
  });
}

onSlideEnter(() => {
  if (configured && props.quizId) setActive(props.quizId);
  entered.value = true;
});

onSlideLeave(() => {
  if (configured) clearActive();
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
      v-else-if="!props.quizId"
      title="Missing quiz frontmatter"
      message="This results slide is missing the required quizId field."
      :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\n---`"
    />
    <SlideQuizError
      v-else-if="!isText && options.length === 0"
      title="Missing options for choice results"
      message="This results slide needs options to display bar charts."
      :fix="`---\nlayout: quiz-results\nquizId: q1\nquestion: Your question here?\noptions:\n  - { label: A, text: Option 1 }\n  - { label: B, text: Option 2 }\n---`"
    />
    <SlideQuizWordCloud v-else-if="isText" :quiz-id="props.quizId" :question="props.question" :animate="entered" />
    <SlideQuizResults v-else :quiz-id="props.quizId" :question="props.question" :options="options" :animate="entered" />
    <SlideQuizSyncError />
  </div>
</template>
