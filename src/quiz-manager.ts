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
} from "./quiz-types";

import {
  SyncPayloadSchema,
  AnswerPayloadSchema,
  QuizEndpointsSchema,
  PresenterStateSchema,
  SubmittedAnswersSchema,
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
  QuizType,
  QuizManagerConfig,
} from "./quiz-types";

// ── Dev-only validation flag ──

const __DEV__ =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env.NODE_ENV !== "production";

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

// ── QuizManager (base class) ──

export type { QuizManagerConfig };

export class QuizManager {
  protected cable: Cable;
  protected syncChannel: Channel;
  protected quizGroupId: string;
  protected sessionId: string;
  protected endpoints: QuizEndpoints;
  protected unsubs: (() => void)[] = [];

  // Reactive state via nanostores
  readonly store = {
    activeQuestionId: atom<string | null>(null),
    results: map<Record<string, VoteState>>({}),
    online: atom<number>(0),
    submitted: map<Record<string, string>>({}),
    questions: atom<QuestionPayload[]>([]),
  };

  constructor(config: QuizManagerConfig, historyWindow: number) {
    this.quizGroupId = config.quizGroupId;
    this.sessionId = config.sessionId || this.getOrCreateSessionId();
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints };

    this.cable = createCable(config.wsUrl, {
      protocol: "actioncable-v1-ext-json",
      protocolOptions: {
        historyTimestamp:
          Math.floor((Date.now() - historyWindow) / 1000),
      },
    });

    // Both roles subscribe to sync channel (for presence + state)
    this.syncChannel = this.cable.streamFrom(
      syncStream(config.quizGroupId),
    );
    this.unsubs.push(this.syncChannel.on("message", this.onSyncMessage.bind(this)));
    this.unsubs.push(this.syncChannel.on("presence", this.onPresence.bind(this)));

    // Bootstrap presence count
    this.syncChannel.presence.info().catch(() => {});
  }

  // ── Public API ──

  getState(): QuizState {
    return {
      activeQuestionId: this.store.activeQuestionId.get(),
      results: structuredClone(this.store.results.get()),
      online: this.store.online.get(),
      submitted: { ...this.store.submitted.get() },
      questions: structuredClone(this.store.questions.get()),
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
    this.cable.disconnect();
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

    // Re-broadcast after restore so late-joining participants get the state
    if (this.store.activeQuestionId.get()) {
      this.sendSync();
    }
  }

  /** Set the full list of questions (broadcast to participants via sync) */
  setQuestions(questions: QuestionPayload[]): void {
    this.store.questions.set(questions);
  }

  /** Set the active question (called when slide enters viewport) */
  setActiveQuestion(quizId: string): void {
    if (this.store.activeQuestionId.get() === quizId) return;
    this.store.activeQuestionId.set(quizId);
    // listen subscription → saveState → save + sendSync
  }

  override disconnect(): void {
    this.sendSync.cancel();
    super.disconnect();
  }

  // ── Message Handlers ──

  protected override async onPresence(): Promise<void> {
    await super.onPresence();
    this.sendSync(); // Re-broadcast for late joiners
  }

  private getQuizType(quizId: string): QuizType {
    return this.store.questions.get().find((q) => q.quizId === quizId)?.type ?? "choice";
  }

  private normalizeAnswer(quizId: string, answer: string): string {
    return this.getQuizType(quizId) === "text" ? answer.trim().toLowerCase() : answer;
  }

  private onResultsMessage(msg: unknown): void {
    const data = msg as AnswerPayload;
    if (__DEV__ && !isValidAnswerPayload(data)) return;
    if (data.sessionId === this.sessionId) return;

    const { quizId } = data;
    const answer = this.normalizeAnswer(quizId, data.answer);

    // Aggregate directly — AnyCable offset tracking prevents redelivery
    const results = this.store.results.get();
    const current = results[quizId] || { votes: {}, total: 0 };
    const updatedVotes = { ...current.votes, [answer]: (current.votes[answer] || 0) + 1 };
    this.store.results.setKey(quizId, { votes: updatedVotes, total: current.total + 1 });
  }

  // ── Sync Broadcasting ──

  private sendSync = throttle(() => {
    if (!this.store.activeQuestionId.get()) return;
    fetch(this.endpoints.sync, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeQuestionId: this.store.activeQuestionId.get(),
        sessionId: this.sessionId,
        quizGroupId: this.quizGroupId,
        results: this.store.results.get(),
        questions: this.store.questions.get(),
      }),
    }).catch(() => {});
  }, 200);

  // ── Persistence ──

  private saveState(): void {
    try {
      sessionStorage.setItem(
        `quiz-presenter-${this.quizGroupId}`,
        JSON.stringify({
          activeQuestionId: this.store.activeQuestionId.get(),
          results: this.store.results.get(),
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
    } catch {
      /* ignore */
    }
  }
}

// ── ParticipantQuizManager ──

export class ParticipantQuizManager extends QuizManager {
  private onSyncThrottled: ReturnType<typeof throttle>;

  constructor(config: QuizManagerConfig) {
    super(config, 60_000); // 1-min history window

    this.onSyncThrottled = throttle(this.applySync.bind(this), 200);

    this.syncChannel.presence.join(this.sessionId, { id: this.sessionId });
    this.restoreSubmitted();
  }

  /** Submit an answer */
  async submitAnswer(quizId: string, answer: string): Promise<boolean> {
    if (this.hasVoted(quizId)) return false;

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
      }
      return res.ok;
    } catch {
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
    const data = msg as SyncPayload;
    if (__DEV__ && !isValidSyncPayload(data)) return;
    if (data.sessionId === this.sessionId) return;

    this.onSyncThrottled(data);
  }

  private applySync(data: SyncPayload): void {
    this.store.activeQuestionId.set(data.activeQuestionId);
    this.store.results.set(data.results);
    if (data.questions) {
      this.store.questions.set(data.questions);
    }

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
}): ParticipantQuizManager {
  if (!participants.has(config.quizGroupId)) {
    participants.set(
      config.quizGroupId,
      new ParticipantQuizManager(config),
    );
  }
  return participants.get(config.quizGroupId)!;
}
