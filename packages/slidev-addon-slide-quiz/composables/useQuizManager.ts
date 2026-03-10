import { inject, shallowRef, readonly, onScopeDispose } from "vue";
import type { Ref } from "vue";
import type { PresenterQuizManager, QuestionPayload } from "slide-quiz";
import { QUIZ_MANAGER_KEY, QUIZ_CONFIG_KEY } from "../injectionKeys";

// Module-level state for question registration (survives HMR)
const registeredQuestions: QuestionPayload[] = [];
let registrationTimer: ReturnType<typeof setTimeout> | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    registeredQuestions.length = 0;
  });
}

function useNanoStore<T>(store: { get(): T; subscribe(cb: (val: T) => void): () => void }): Readonly<Ref<T>> {
  const ref = shallowRef(store.get());
  const unsub = store.subscribe(v => { ref.value = v as typeof ref.value; });
  onScopeDispose(unsub);
  return readonly(ref) as Readonly<Ref<T>>;
}

export function useQuizManager() {
  const manager = inject(QUIZ_MANAGER_KEY, null);
  const config = inject(QUIZ_CONFIG_KEY, null);

  function registerQuestion(q: QuestionPayload) {
    if (!manager) return;
    if (registeredQuestions.some((r) => r.quizId === q.quizId)) return;
    registeredQuestions.push(q);

    // Debounce: all layouts mount within ~3s, batch setQuestions
    if (registrationTimer) clearTimeout(registrationTimer);
    registrationTimer = setTimeout(() => {
      manager.setQuestions([...registeredQuestions]);
    }, 100);
  }

  function setActive(quizId: string) {
    manager?.setActiveQuestion(quizId);
  }

  return {
    manager,
    config,
    configured: manager !== null,
    online: manager ? useNanoStore(manager.store.online) : readonly(shallowRef(0)),
    results: manager ? useNanoStore(manager.store.results) : readonly(shallowRef({})),
    registerQuestion,
    setActive,
  };
}
