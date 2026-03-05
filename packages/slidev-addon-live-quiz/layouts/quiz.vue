<script setup lang="ts">
import { onMounted } from "vue";
import { onSlideEnter } from "@slidev/client";
import LiveQuizQuestion from "../components/LiveQuizQuestion.vue";
import LiveQuizError from "../components/LiveQuizError.vue";
import { useQuizManager } from "../composables/useQuizManager";

const props = defineProps<{
  quizId?: string;
  question?: string;
  type?: string;
  options?: { label: string; text: string }[];
}>();

const type = props.type ?? "choice";
const options = props.options ?? [];
const { configured, registerQuestion, setActive } = useQuizManager();

const missingProps = [
  !props.quizId && "quizId",
  !props.question && "question",
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
  <LiveQuizError
    v-if="!configured"
    title="live-quiz not configured"
    message="Add a liveQuiz block to your first slide's frontmatter:"
    :fix="`---\nliveQuiz:\n  wsUrl: wss://your-cable.anycable.io/cable\n  quizGroupId: my-talk\n  quizUrl: https://your-site.com/quiz.html\n---`"
  />
  <LiveQuizError
    v-else-if="missingProps.length"
    title="Missing quiz frontmatter"
    :message="`This slide is missing required fields: ${missingProps.join(', ')}`"
    :fix="`---\nlayout: quiz\nquizId: q1\nquestion: Your question here?\noptions:\n  - { label: A, text: Option 1 }\n  - { label: B, text: Option 2 }\n---`"
  />
  <LiveQuizQuestion
    v-else
    :quiz-id="props.quizId!"
    :question="props.question!"
    :type="type"
    :options="options"
  />
</template>
