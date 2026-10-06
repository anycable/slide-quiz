/**
 * QuizManager — AnyCable-powered quiz engine (public streams, no secrets on frontend).
 *
 * Two subclasses:
 * - PresenterQuizManager: subscribes to results + sync streams, aggregates votes, broadcasts state
 * - ParticipantQuizManager: subscribes to sync stream, receives state, submits answers
 *
 * Streams (public, unsigned):
 * - quiz:{quizGroupId}:results — individual answers
 * - quiz:{quizGroupId}:sync    — full state + presence
 */
import { createCable } from "@anycable/web";
import type { Cable, Channel } from "@anycable/web";
import { atom, map } from "nanostores";
import * as v from "valibot";

// ── Types & Schemas (from shared module) ──

export type {
  VoteState,
  SyncPayload,
  AnswerPayload,
  QuizState,
  QuestionPayload,
  QuizEndpoints,
  QuizType,
  QuizError,
  QuizErrorKind,
  QuizErrorHandler,
  ConnectionStatus,
} from "./quiz-types";

import {
  SyncPayloadSchema,
  AnswerPayloadSchema,
  QuizEndpointsSchema,
  PresenterStateSchema,
  SubmittedAnswersSchema,
  MultiAnswerSchema,
  resultsStream,
  syncStream,
} from "./quiz-types";

import type {
  VoteState,
  SyncPayload,
  AnswerPayload,
  QuizState,
  QuestionPayload,
  QuizEndpoints,
  QuizManagerConfig,
  SessionVote,
  QuizError,
  QuizErrorHandler,
  ConnectionStatus,
} from "./quiz-types";

// ── Dev-only validation flag ──

const __DEV__ =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env.NODE_ENV !== "production";

// How long a dropped WebSocket may stay down before we tell the user.
// AnyCable reconnects with backoff; short blips should stay invisible.
const CONNECTION_GRACE_MS = 5_000;

// ── Endpoints ──

const DEFAULT_ENDPOINTS: QuizEndpoints = {
  answer: "/.netlify/functions/quiz-answer",
  sync: "/.netlify/functions/quiz-sync",
};

// ── Throttle utility ──

function throttle<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstRun = true;

  const throttled = (...args: Parameters<T>) => {
    clearTimeout(timer);
    if (firstRun) {
      firstRun = false;
      fn(...args);
    } else {
      timer = setTimeout(() => {
        fn(...args);
        firstRun = true;
      }, delay);
    }
  };
  throttled.cancel = () => clearTimeout(timer);
  return throttled;
}

// ── Message Validation ──

export function isValidSyncPayload(data: unknown): data is SyncPayload {
  return v.safeParse(SyncPayloadSchema, data).success;
}

export function isValidAnswerPayload(data: unknown): data is AnswerPayload {
  return v.safeParse(AnswerPayloadSchema, data).success;
}

function sameTally(a: VoteState, b: VoteState): boolean {
  const keys = Object.keys(a.votes);
  return a.total === b.total &&
    keys.length === Object.keys(b.votes).length &&
    keys.every((k) => a.votes[k] === b.votes[k]);
}

/** What a failed POST to the sync function means, and how to fix it. */
export function syncFailureHint(status: number, endpoint: string): string {
  switch (status) {
    case 404: {
      const vercel = endpoint.startsWith("/.netlify/")
        ? " On Vercel, add endpoints: { answer: /api/quiz-answer, sync: /api/quiz-sync } to your slideQuiz config."
        : "";
      return `Sync function not found at ${endpoint}. Check that your serverless functions are deployed.${vercel}`;
    }
    case 400:
      return "The sync function rejected this question (400): the deployed functions are older than the deck. " +
        "Copy the functions from slide-quiz again and redeploy.";
    case 502:
      return "The sync function can't reach AnyCable (502). Check ANYCABLE_BROADCAST_URL and " +
        "ANYCABLE_BROADCAST_KEY in your site's environment variables, then redeploy.";
    default:
      return `Sync function error (${status}): the audience won't see questions. Check the function logs on your host.`;
  }
}

// ── QuizManager (base class) ──

export type { QuizManagerConfig };

export class QuizManager {
  protected cable: Cable;
  protected syncChannel: Channel;
  protected quizGroupId: string;
  protected sessionId: string;
  readonly endpoints: QuizEndpoints;
  protected unsubs: (() => void)[] = [];
  private errorHandlers = new Set<QuizErrorHandler>();
  private connectionGraceId: ReturnType<typeof setTimeout> | undefined;

  // Reactive state via nanostores
  readonly store = {
    activeQuestionId: atom<string | null>(null),
    results: map<Record<string, VoteState>>({}),
    online: atom<number>(0),
    submitted: map<Record<string, string>>({}),
    questions: atom<QuestionPayload[]>([]),
    questionIndex: atom<number>(0),
    totalCount: atom<number>(0),
    /** Presenter only: last failure talking to the sync serverless function */
    syncError: atom<string | null>(null),
    /** WebSocket status. Starts as "connecting"; "closed" means AnyCable refused us. */
    connection: atom<ConnectionStatus>("connecting"),
    /** Set when the WebSocket has been down longer than a short grace period */
    connectionError: atom<string | null>(null),
    /** Presenter only: phones run an audience page older than the deck */
    audienceWarning: atom<string | null>(null),
  };

  constructor(config: QuizManagerConfig, historyWindow: number) {
    this.quizGroupId = config.quizGroupId;
    this.sessionId = config.sessionId || this.getOrCreateSessionId();
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints };
    if (config.onError) this.errorHandlers.add(config.onError);

    this.cable = createCable(config.wsUrl, {
      protocol: "actioncable-v1-ext-json",
      protocolOptions: {
        historyTimestamp:
          Math.floor((Date.now() - historyWindow) / 1000),
      },
    });

    // Both roles subscribe to sync channel (for presence + state)
    const stream = syncStream(config.quizGroupId);
    console.log("[slide-quiz] subscribing to stream:", stream);
    this.syncChannel = this.cable.streamFrom(stream);
    this.unsubs.push(this.syncChannel.on("message", this.onSyncMessage.bind(this)));
    this.unsubs.push(this.syncChannel.on("presence", this.onPresence.bind(this)));

    // Bootstrap presence count
    this.syncChannel.presence.info().catch(() => {});

    this.watchConnection(config.wsUrl);
  }

  // ── Public API ──

  /**
   * Register an error handler. Returns an unsubscribe function.
   * Handlers receive every error the engine detects (connection, sync, answer,
   * invalid payload). Wire this to your own monitoring; slide-quiz never
   * reports anywhere on its own.
   */
  onError(handler: QuizErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  getState(): QuizState {
    return {
      activeQuestionId: this.store.activeQuestionId.get(),
      results: structuredClone(this.store.results.get()),
      online: this.store.online.get(),
      submitted: { ...this.store.submitted.get() },
      questions: structuredClone(this.store.questions.get()),
      questionIndex: this.store.questionIndex.get(),
      totalCount: this.store.totalCount.get(),
    };
  }

  getQuizState(quizId: string): VoteState {
    return this.store.results.get()[quizId] || { votes: {}, total: 0 };
  }

  hasVoted(quizId: string): boolean {
    return quizId in this.store.submitted.get();
  }

  getVotedAnswer(quizId: string): string | null {
    return this.store.submitted.get()[quizId] ?? null;
  }

  disconnect(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    if (this.connectionGraceId) clearTimeout(this.connectionGraceId);
    this.cable.disconnect();
  }

  // ── Errors ──

  protected emitError(error: QuizError): void {
    console.warn(`[slide-quiz] ${error.kind}: ${error.message}`, error.cause ?? "");
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch (e) {
        console.error("[slide-quiz] onError handler threw:", e);
      }
    }
  }

  // ── Connection monitoring ──

  private watchConnection(wsUrl: string): void {
    const describe = (ev?: { message?: string; reason?: string }): string =>
      ev?.reason || ev?.message || "unknown reason";

    const scheduleError = (status: ConnectionStatus, reason: string) => {
      if (this.connectionGraceId) clearTimeout(this.connectionGraceId);
      this.connectionGraceId = setTimeout(() => {
        if (this.store.connection.get() === "connected") return;
        const message =
          status === "closed"
            ? `AnyCable closed the connection to ${wsUrl} (${reason}). Check wsUrl and that the cable is in public mode.`
            : `Can't connect to AnyCable at ${wsUrl} (${reason}). Check wsUrl in your slideQuiz config.`;
        this.store.connectionError.set(message);
        this.emitError({
          kind: "connection",
          message,
          cause: reason,
          context: { wsUrl, quizGroupId: this.quizGroupId, status },
        });
      }, CONNECTION_GRACE_MS);
    };

    this.unsubs.push(
      this.cable.on("connect", () => {
        if (this.connectionGraceId) clearTimeout(this.connectionGraceId);
        this.store.connection.set("connected");
        this.store.connectionError.set(null);
      }),
      this.cable.on("disconnect", (ev) => {
        this.store.connection.set("disconnected");
        scheduleError("disconnected", describe(ev));
      }),
      this.cable.on("close", (ev) => {
        this.store.connection.set("closed");
        scheduleError("closed", describe(ev));
      }),
    );
  }

  // ── Message Handlers (overridden by subclasses) ──

  protected onSyncMessage(_msg: unknown): void {
    // Base no-op; overridden in subclasses
  }

  protected async onPresence(): Promise<void> {
    try {
      const state = await this.syncChannel.presence.info();
      if (state) {
        this.store.online.set(Object.keys(state).length);
      }
    } catch {
      /* ignore */
    }
  }

  // ── Persistence ──

  private getOrCreateSessionId(): string {
    const key = `quiz-session-${this.quizGroupId}`;
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  }

}

// ── PresenterQuizManager ──

export class PresenterQuizManager extends QuizManager {
  private resultsChannel: Channel;
  // Per-session vote tracking: quizId → (sessionId → raw answer and counted keys)
  // Allows changed votes to decrement the old answer and keeps totals accurate.
  // A choice or text answer counts one key; a multi-select answer counts one
  // key per selected option, so `total` stays the number of respondents.
  // Saved with the results, so a presenter refresh keeps it; the raw answer
  // lets setQuestions() recount answers that arrived before their question.
  private sessionVotes = new Map<string, Map<string, SessionVote>>();

  protected keepaliveId: ReturnType<typeof setTimeout> | undefined;

  constructor(config: QuizManagerConfig) {
    super(config, 0); // No history — presenter is source of truth

    this.resultsChannel = this.cable.streamFrom(
      resultsStream(config.quizGroupId),
    );
    this.unsubs.push(this.resultsChannel.on("message", this.onResultsMessage.bind(this)));

    this.restoreState();

    // Auto-save: any store change → saveState → persist + broadcast
    this.unsubs.push(
      this.store.activeQuestionId.listen(() => this.saveState()),
      this.store.results.listen(() => this.saveState()),
    );

    // Note: no sendSync here — questions haven't been set yet.
    // setQuestions() triggers the first sync after plugin init.
  }

  /** Set the full list of questions (broadcast to participants via sync) */
  setQuestions(questions: QuestionPayload[]): void {
    this.store.questions.set(questions);
    // Answers that arrived before their question was known were counted as
    // single choice; recount them now that the question's type is known.
    for (const quizId of this.sessionVotes.keys()) this.recount(quizId);
    // Trigger initial broadcast if active question was restored from session
    if (this.store.activeQuestionId.get()) {
      this.sendSync();
    }
  }

  /** Set the active question (called when slide enters viewport) */
  setActiveQuestion(quizId: string): void {
    if (this.store.activeQuestionId.get() === quizId) return;
    this.store.activeQuestionId.set(quizId);
    // listen subscription → saveState → save + sendSync
  }

  /** Clear the active question (called when leaving a quiz slide) */
  clearActiveQuestion(): void {
    if (this.store.activeQuestionId.get() === null) return;
    this.store.activeQuestionId.set(null);
  }

  override disconnect(): void {
    this.sendSync.cancel();
    if (this.keepaliveId) {
      clearTimeout(this.keepaliveId);
    }
    super.disconnect();
  }

  // ── Message Handlers ──

  protected override onSyncMessage(msg: unknown): void {
    // Ignore other messages (presenter is source of truth, not a consumer of sync; a single presenter is assumed)
  }

  private getQuestion(quizId: string): QuestionPayload | undefined {
    return this.store.questions.get().find((q) => q.quizId === quizId);
  }

  /** The vote keys one answer counts toward, or null if it cannot be counted. */
  private answerKeys(quizId: string, answer: string): string[] | null {
    const question = this.getQuestion(quizId);
    switch (question?.type ?? "choice") {
      case "text":
        return [answer.trim().toLowerCase()];
      case "multi": {
        const labels = new Set(question!.options.map((o) => o.label));
        const parsed = v.safeParse(MultiAnswerSchema, answer);
        // An audience page older than multi-select treats the question as a
        // single choice and sends a bare label; count it as a one-option pick,
        // and tell the presenter to update the page.
        if (!parsed.success && labels.has(answer)) this.warnOutdatedAudiencePage(quizId);
        const picked = parsed.success ? parsed.output : [answer];
        // Count only the question's own options, so a crafted answer cannot
        // grow the vote map (and every sync payload) without bound.
        const keys = picked.filter((label) => labels.has(label));
        return keys.length > 0 ? keys : null;
      }
      default:
        return [answer];
    }
  }

  /** Rebuild one quiz's tally from the raw answers, if counting them again changes it. */
  private recount(quizId: string): void {
    const quizVotes = this.sessionVotes.get(quizId)!;
    const votes: Record<string, number> = {};
    for (const [sessionId, vote] of quizVotes) {
      const keys = this.answerKeys(quizId, vote.answer);
      if (!keys) {
        quizVotes.delete(sessionId);
        continue;
      }
      vote.keys = keys;
      for (const key of keys) votes[key] = (votes[key] || 0) + 1;
    }
    const next = { votes, total: quizVotes.size };
    const current = this.store.results.get()[quizId];
    if (current && sameTally(current, next)) return;
    this.store.results.setKey(quizId, next);
  }

  private warnOutdatedAudiencePage(quizId: string): void {
    if (this.store.audienceWarning.get()) return;
    const message =
      "Some phones run an audience page older than slide-quiz 0.7, which lets people pick only one option " +
      "on multi-select questions. Copy quiz.html from slide-quiz 0.7 or later into your site and redeploy.";
    this.store.audienceWarning.set(message);
    this.emitError({
      kind: "outdated-audience-page",
      message,
      context: { quizGroupId: this.quizGroupId, quizId },
    });
  }

  private onResultsMessage(msg: unknown): void {
    const data = msg as AnswerPayload;
    if (__DEV__ && !isValidAnswerPayload(data)) {
      this.emitError({
        kind: "invalid-payload",
        message: "Dropped answer message that does not match AnswerPayloadSchema",
        cause: msg,
        context: { quizGroupId: this.quizGroupId },
      });
      return;
    }
    if (data.sessionId === this.sessionId) return;

    const { quizId, sessionId } = data;
    const keys = this.answerKeys(quizId, data.answer);
    if (!keys) {
      if (__DEV__) {
        this.emitError({
          kind: "invalid-payload",
          message: "Dropped a multi-select answer that names none of the question's options",
          cause: data.answer,
          context: { quizGroupId: this.quizGroupId, quizId },
        });
      }
      return;
    }

    if (!this.sessionVotes.has(quizId)) {
      this.sessionVotes.set(quizId, new Map());
    }
    const quizVotes = this.sessionVotes.get(quizId)!;
    const previousKeys = quizVotes.get(sessionId)?.keys;
    quizVotes.set(sessionId, { answer: data.answer, keys });

    if (previousKeys && JSON.stringify(previousKeys) === JSON.stringify(keys)) return; // Same answer — no-op

    const results = this.store.results.get();
    const current = results[quizId] || { votes: {}, total: 0 };
    const updatedVotes = { ...current.votes };

    // Decrement old answer if changing vote
    for (const key of previousKeys ?? []) {
      updatedVotes[key] = (updatedVotes[key] || 1) - 1;
      if (updatedVotes[key] <= 0) delete updatedVotes[key];
    }

    for (const key of keys) {
      updatedVotes[key] = (updatedVotes[key] || 0) + 1;
    }
    this.store.results.setKey(quizId, { votes: updatedVotes, total: quizVotes.size });
  }

  // ── Sync Broadcasting ──

  private syncFailures = 0;

  private sendSync = throttle(() => {
    const activeId = this.store.activeQuestionId.get();
    if (!activeId && this.store.questions.get().length === 0) return;
    const questions = this.store.questions.get();
    const questionIndex = activeId ? questions.findIndex(q => q.quizId === activeId) : -1;
    const question = questionIndex >= 0 ? questions[questionIndex] : undefined;
    const payload = {
      activeQuestionId: activeId,
      sessionId: this.sessionId,
      quizGroupId: this.quizGroupId,
      results: this.store.results.get(),
      question,
      questionIndex,
      totalCount: questions.length,
    };
    console.log("[slide-quiz:presenter] sendSync:", {
      activeQuestionId: payload.activeQuestionId,
      quizGroupId: payload.quizGroupId,
      questionIndex: payload.questionIndex,
      totalCount: payload.totalCount,
      endpoint: this.endpoints.sync,
    });

    if (this.keepaliveId) {
      clearTimeout(this.keepaliveId);
    }

    fetch(this.endpoints.sync, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (res.ok) {
        if (this.syncFailures > 0) {
          this.syncFailures = 0;
          this.store.syncError.set(null);
        }

        // Ensure we send sync once in 120s, so the new clients pick up the history
        this.keepaliveId = setTimeout(() => {
          this.sendSync()
        }, 120000);
      } else {
        this.syncFailures++;
        const hint = syncFailureHint(res.status, this.endpoints.sync);
        this.emitError({
          kind: "sync",
          message: hint,
          cause: res.status,
          context: { endpoint: this.endpoints.sync, quizGroupId: this.quizGroupId, attempt: this.syncFailures },
        });
        if (this.syncFailures >= 2) {
          this.store.syncError.set(hint);
        }
      }
    }).catch((err) => {
      this.syncFailures++;
      const isLocal = typeof location !== "undefined" &&
        (location.hostname === "localhost" || location.hostname === "127.0.0.1");
      const hint = isLocal
        ? "Sync won't work locally — deploy your site to Netlify or Vercel so the audience can connect."
        : `Can't reach ${this.endpoints.sync} — check that your serverless functions are deployed.`;
      this.emitError({
        kind: "sync",
        message: hint,
        cause: err,
        context: { endpoint: this.endpoints.sync, quizGroupId: this.quizGroupId, attempt: this.syncFailures },
      });
      if (this.syncFailures >= 2) {
        this.store.syncError.set(hint);
      }
    });
  }, 200);

  // ── Persistence ──

  private saveState(): void {
    try {
      sessionStorage.setItem(
        `quiz-presenter-${this.quizGroupId}`,
        JSON.stringify({
          activeQuestionId: this.store.activeQuestionId.get(),
          results: this.store.results.get(),
          sessionVotes: Object.fromEntries(
            [...this.sessionVotes].map(([quizId, votes]) => [quizId, Object.fromEntries(votes)]),
          ),
        }),
      );
    } catch (e) {
      console.warn("[QuizManager] saveState failed:", e);
    }
    this.sendSync();
  }

  private restoreState(): void {
    try {
      const raw = sessionStorage.getItem(
        `quiz-presenter-${this.quizGroupId}`,
      );
      if (!raw) return;
      const parsed = v.safeParse(PresenterStateSchema, JSON.parse(raw));
      if (!parsed.success) return;
      const saved = parsed.output;
      if (saved.activeQuestionId) this.store.activeQuestionId.set(saved.activeQuestionId);
      if (saved.results) this.store.results.set(saved.results);
      for (const [quizId, votes] of Object.entries(saved.sessionVotes ?? {})) {
        this.sessionVotes.set(quizId, new Map(Object.entries(votes)));
      }
    } catch {
      /* ignore */
    }
  }
}

// ── ParticipantQuizManager ──

export class ParticipantQuizManager extends QuizManager {
  private onSyncThrottled: ReturnType<typeof throttle>;

  constructor(config: QuizManagerConfig) {
    super(config, 5 * 60_000); // 5-min history window

    this.onSyncThrottled = throttle(this.applySync.bind(this), 200);

    this.syncChannel.presence.join(this.sessionId, { id: this.sessionId });
    this.restoreSubmitted();
  }

  /** Submit an answer (or change a previous one) */
  async submitAnswer(quizId: string, answer: string): Promise<boolean> {
    if (this.getVotedAnswer(quizId) === answer) return false; // Same answer — no-op

    try {
      const res = await fetch(this.endpoints.answer, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId,
          answer,
          sessionId: this.sessionId,
          quizGroupId: this.quizGroupId,
        }),
      });
      if (res.ok) {
        this.store.submitted.setKey(quizId, answer);
        this.saveSubmitted();
      } else {
        this.emitError({
          kind: "answer",
          message: `Answer function returned ${res.status} from ${this.endpoints.answer}`,
          cause: res.status,
          context: { endpoint: this.endpoints.answer, quizGroupId: this.quizGroupId, quizId },
        });
      }
      return res.ok;
    } catch (err) {
      this.emitError({
        kind: "answer",
        message: `Can't reach ${this.endpoints.answer}`,
        cause: err,
        context: { endpoint: this.endpoints.answer, quizGroupId: this.quizGroupId, quizId },
      });
      return false;
    }
  }

  override disconnect(): void {
    this.onSyncThrottled.cancel();
    this.syncChannel.presence.leave();
    super.disconnect();
  }

  // ── Message Handlers ──

  protected override onSyncMessage(msg: unknown): void {
    console.log("[slide-quiz:participant] onSyncMessage received:", msg);
    const data = msg as Record<string, unknown>;

    // Regular broadcast sync
    const sync = data as unknown as SyncPayload;
    if (__DEV__ && !isValidSyncPayload(sync)) {
      this.emitError({
        kind: "invalid-payload",
        message: "Dropped sync message that does not match SyncPayloadSchema",
        cause: msg,
        context: { quizGroupId: this.quizGroupId },
      });
      return;
    }

    if (sync.sessionId === this.sessionId) {
      console.log("[slide-quiz:participant] ignoring own sync (same sessionId)");
      return;
    }

    this.onSyncThrottled(sync);
  }

  private applySync(data: SyncPayload): void {
    console.log("[slide-quiz:participant] applySync:", {
      activeQuestionId: data.activeQuestionId,
      question: data.question?.quizId,
      questionIndex: data.questionIndex,
      totalCount: data.totalCount,
    });

    // Upsert single question into accumulated array (set before activeQuestionId
    // so DOM is created before showQuestion fires)
    if (data.question) {
      const questions = [...this.store.questions.get()];
      const idx = questions.findIndex(q => q.quizId === data.question!.quizId);
      if (idx >= 0) {
        questions[idx] = data.question;
      } else {
        questions.push(data.question);
      }
      this.store.questions.set(questions);
    }
    if (data.questionIndex !== undefined) this.store.questionIndex.set(data.questionIndex);
    if (data.totalCount !== undefined) this.store.totalCount.set(data.totalCount);
    this.store.results.set(data.results);
    this.store.activeQuestionId.set(data.activeQuestionId);

    // Reset detection: clear submitted answer only when a quiz that
    // previously had votes is explicitly reset to total 0. Don't clear
    // when the quiz simply isn't in results yet (no votes received).
    for (const quizId of Object.keys(this.store.submitted.get())) {
      const quizResult = data.results[quizId];
      if (quizResult && quizResult.total === 0) {
        this.clearVotedAnswer(quizId);
      }
    }
  }

  // ── Persistence ──

  private saveSubmitted(): void {
    try {
      sessionStorage.setItem(
        `quiz-submitted-${this.quizGroupId}`,
        JSON.stringify(this.store.submitted.get()),
      );
    } catch {
      /* ignore */
    }
  }

  private restoreSubmitted(): void {
    try {
      const raw = sessionStorage.getItem(
        `quiz-submitted-${this.quizGroupId}`,
      );
      if (!raw) return;
      const parsed = v.safeParse(SubmittedAnswersSchema, JSON.parse(raw));
      if (!parsed.success) return;
      this.store.submitted.set(parsed.output);
    } catch {
      /* ignore */
    }
  }

  private clearVotedAnswer(quizId: string): void {
    const current = { ...this.store.submitted.get() };
    delete current[quizId];
    this.store.submitted.set(current);
    this.saveSubmitted();
  }
}

// ── Singleton Factories ──

const presenters = new Map<string, PresenterQuizManager>();

export function getQuizPresenter(config: {
  wsUrl: string;
  quizGroupId: string;
  endpoints?: Partial<QuizEndpoints>;
  onError?: QuizErrorHandler;
}): PresenterQuizManager {
  if (!presenters.has(config.quizGroupId)) {
    presenters.set(
      config.quizGroupId,
      new PresenterQuizManager(config),
    );
  }
  return presenters.get(config.quizGroupId)!;
}

/** Remove a presenter instance from the singleton cache. */
export function removeQuizPresenter(quizGroupId: string): void {
  presenters.delete(quizGroupId);
}

const participants = new Map<string, ParticipantQuizManager>();

export function getQuizParticipant(config: {
  wsUrl: string;
  quizGroupId: string;
  endpoints?: Partial<QuizEndpoints>;
  onError?: QuizErrorHandler;
}): ParticipantQuizManager {
  if (!participants.has(config.quizGroupId)) {
    participants.set(
      config.quizGroupId,
      new ParticipantQuizManager(config),
    );
  }
  return participants.get(config.quizGroupId)!;
}
