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
import * as v from "valibot";

// ── Types & Schemas (from shared module) ──

export type {
  VoteState,
  SyncPayload,
  AnswerPayload,
  QuizState,
  StateCallback,
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
} from "./quiz-types";

import type {
  VoteState,
  SyncPayload,
  AnswerPayload,
  QuizState,
  StateCallback,
  QuestionPayload,
  QuizEndpoints,
  QuizType,
} from "./quiz-types";

// ── Endpoints ──

const DEFAULT_ENDPOINTS: QuizEndpoints = {
  answer: "/.netlify/functions/quiz-answer",
  sync: "/.netlify/functions/quiz-sync",
};

// ── Message Validation ──

export function isValidSyncPayload(data: unknown): data is SyncPayload {
  return v.safeParse(SyncPayloadSchema, data).success;
}

export function isValidAnswerPayload(data: unknown): data is AnswerPayload {
  return v.safeParse(AnswerPayloadSchema, data).success;
}

// ── QuizManager (base class) ──

export interface QuizManagerConfig {
  wsUrl: string;
  quizGroupId: string;
  sessionId?: string;
  endpoints?: Partial<QuizEndpoints>;
}

export class QuizManager {
  protected cable: Cable;
  protected syncChannel: Channel;
  protected quizGroupId: string;
  protected sessionId: string;
  protected endpoints: QuizEndpoints;

  // State
  protected activeQuizId: string | null = null;
  protected results: Record<string, VoteState> = {};
  protected online = 0;
  protected submitted: Record<string, string> = {};
  protected questions: QuestionPayload[] = [];

  // Callbacks
  protected listeners: StateCallback[] = [];

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
      `quiz:${config.quizGroupId}:sync`,
    );
    this.syncChannel.on("message", this.onSyncMessage.bind(this));

    // Presence — patch stateFromInfo to handle servers that return
    // presence info without a `records` array.
    // This is a workaround for Managed AnyCable compatibility: some server
    // configurations return presence state as a flat object (without the
    // `records` wrapper the @anycable/web client expects). We can't fix this
    // server-side, so we patch the client's stateFromInfo to handle both formats.
    interface PresenceWithPatch {
      stateFromInfo?: (data: Record<string, unknown>) => Record<string, unknown>;
    }
    const presence = this.syncChannel.presence as PresenceWithPatch;
    if (typeof presence.stateFromInfo === "function") {
      const orig = presence.stateFromInfo.bind(presence);
      presence.stateFromInfo = (data: Record<string, unknown>) => {
        if (!data?.records) {
          if (data && typeof data === "object") {
            const { type, ...rest } = data;
            return rest;
          }
          return {};
        }
        return orig(data);
      };
    }

    this.syncChannel.on("presence", this.onPresence.bind(this));
    // Bootstrap presence count
    this.syncChannel.presence
      .info()
      .then((state) => {
        if (state) {
          this.online = Object.keys(state).length;
          this.notifyStateChange();
        }
      })
      .catch(() => {});
  }

  // ── Public API ──

  subscribe(cb: StateCallback): () => void {
    this.listeners.push(cb);
    cb(this.getState());
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  getState(): QuizState {
    return {
      activeQuizId: this.activeQuizId,
      results: structuredClone(this.results),
      online: this.online,
      submitted: { ...this.submitted },
      questions: structuredClone(this.questions),
    };
  }

  getQuizState(quizId: string): VoteState {
    return this.results[quizId] || { votes: {}, total: 0 };
  }

  hasVoted(quizId: string): boolean {
    return quizId in this.submitted;
  }

  getVotedAnswer(quizId: string): string | null {
    return this.submitted[quizId] ?? null;
  }

  disconnect(): void {
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
        this.online = Object.keys(state).length;
        this.notifyStateChange();
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

  // ── Helpers ──

  protected notifyStateChange(): void {
    const state = this.getState();
    for (const cb of this.listeners) cb(state);
  }

  protected parse(msg: unknown): Record<string, unknown> {
    if (typeof msg === "string") {
      try {
        return JSON.parse(msg);
      } catch {
        return {};
      }
    }
    if (msg && typeof msg === "object") return msg as Record<string, unknown>;
    return {};
  }
}

// ── PresenterQuizManager ──

export class PresenterQuizManager extends QuizManager {
  private resultsChannel: Channel;
  private voters: Record<string, Set<string>> = {};

  // Outgoing sync throttle
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncPending = false;

  constructor(config: QuizManagerConfig) {
    super(config, 300_000); // 5-min history window

    this.resultsChannel = this.cable.streamFrom(
      `quiz:${config.quizGroupId}:results`,
    );
    this.resultsChannel.on("message", this.onResultsMessage.bind(this));
    this.restoreState();
    // Re-broadcast after restore so late-joining participants get the state
    if (this.activeQuizId) {
      this.sendSync();
    }
  }

  /** Set the full list of questions (broadcast to participants via sync) */
  setQuestions(questions: QuestionPayload[]): void {
    this.questions = questions;
  }

  /** Set the active quiz (called when slide enters viewport) */
  setActiveQuiz(quizId: string): void {
    if (this.activeQuizId === quizId) return;
    this.activeQuizId = quizId;
    this.saveState();
    this.sendSync();
  }

  // ── Message Handlers ──

  protected override onSyncMessage(msg: unknown): void {
    // Presenter ignores sync messages (they're echoes of its own broadcasts)
    const data = this.parse(msg);
    if (!isValidSyncPayload(data)) return;
    if (data.sessionId === this.sessionId) return;
    // Presenter doesn't apply incoming sync — it IS the source of truth
  }

  protected override async onPresence(): Promise<void> {
    try {
      const state = await this.syncChannel.presence.info();
      if (state) {
        this.online = Object.keys(state).length;
        this.notifyStateChange();
        // Re-broadcast so late-joining participants get the current state
        if (this.activeQuizId) {
          this.sendSyncThrottled();
        }
      }
    } catch {
      /* ignore */
    }
  }

  private getQuizType(quizId: string): QuizType {
    return this.questions.find((q) => q.quizId === quizId)?.type ?? "choice";
  }

  private normalizeAnswer(quizId: string, answer: string): string {
    return this.getQuizType(quizId) === "text" ? answer.trim().toLowerCase() : answer;
  }

  private onResultsMessage(msg: unknown): void {
    const data = this.parse(msg);
    if (!isValidAnswerPayload(data)) return;
    if (data.sessionId === this.sessionId) return;

    const { quizId, sessionId } = data;
    const answer = this.normalizeAnswer(quizId, data.answer);

    // Dedup by sessionId per quiz
    if (!this.voters[quizId]) this.voters[quizId] = new Set();
    if (this.voters[quizId].has(sessionId)) return;
    this.voters[quizId].add(sessionId);

    // Aggregate
    if (!this.results[quizId]) {
      this.results[quizId] = { votes: {}, total: 0 };
    }
    this.results[quizId].votes[answer] =
      (this.results[quizId].votes[answer] || 0) + 1;
    this.results[quizId].total += 1;

    this.saveState();
    this.notifyStateChange();
    this.sendSyncThrottled();
  }

  // ── Sync Broadcasting ──

  private sendSyncThrottled(): void {
    if (this.syncTimer) {
      this.syncPending = true;
      return;
    }
    this.sendSync();
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (this.syncPending) {
        this.syncPending = false;
        this.sendSync();
      }
    }, 200);
  }

  private async sendSync(): Promise<void> {
    try {
      await fetch(this.endpoints.sync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeQuizId: this.activeQuizId,
          sessionId: this.sessionId,
          quizGroupId: this.quizGroupId,
          results: this.results,
          questions: this.questions,
        }),
      });
    } catch {
      /* ignore */
    }
  }

  // ── Persistence ──

  private saveState(): void {
    try {
      sessionStorage.setItem(
        `quiz-presenter-${this.quizGroupId}`,
        JSON.stringify({
          activeQuizId: this.activeQuizId,
          results: this.results,
          voters: Object.fromEntries(
            Object.entries(this.voters).map(([k, v]) => [k, [...v]]),
          ),
        }),
      );
    } catch (e) {
      console.warn("[QuizManager] saveState failed:", e);
    }
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
      if (saved.activeQuizId) this.activeQuizId = saved.activeQuizId;
      if (saved.results) this.results = saved.results;
      if (saved.voters) {
        for (const [k, arr] of Object.entries(saved.voters)) {
          this.voters[k] = new Set(arr);
        }
      }
    } catch {
      /* ignore */
    }
  }
}

// ── ParticipantQuizManager ──

export class ParticipantQuizManager extends QuizManager {
  // Incoming sync throttle
  private incomingSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private incomingSyncData: SyncPayload | null = null;

  constructor(config: QuizManagerConfig) {
    super(config, 60_000); // 1-min history window

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
        this.submitted[quizId] = answer;
        this.saveSubmitted();
        this.notifyStateChange();
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  override disconnect(): void {
    this.syncChannel.presence.leave();
    this.cable.disconnect();
  }

  // ── Message Handlers ──

  protected override onSyncMessage(msg: unknown): void {
    const data = this.parse(msg);
    if (!isValidSyncPayload(data)) return;
    if (data.sessionId === this.sessionId) return;

    this.applySyncThrottled(data);
  }

  private applySyncThrottled(data: SyncPayload): void {
    if (this.incomingSyncTimer) {
      // During throttle window — stash for trailing apply
      this.incomingSyncData = data;
      return;
    }

    this.applySync(data);
    this.incomingSyncData = null;
    this.incomingSyncTimer = setTimeout(() => {
      this.incomingSyncTimer = null;
      if (this.incomingSyncData) {
        this.applySync(this.incomingSyncData);
        this.incomingSyncData = null;
      }
    }, 200);
  }

  private applySync(data: SyncPayload): void {
    this.activeQuizId = data.activeQuizId;
    this.results = data.results;
    if (data.questions) {
      this.questions = data.questions;
    }

    // Reset detection: clear submitted answer when totals drop to 0
    for (const quizId of Object.keys(this.submitted)) {
      const total = data.results[quizId]?.total ?? 0;
      if (total === 0) {
        this.clearVotedAnswer(quizId);
      }
    }
    this.notifyStateChange();
  }

  // ── Persistence ──

  private saveSubmitted(): void {
    try {
      sessionStorage.setItem(
        `quiz-submitted-${this.quizGroupId}`,
        JSON.stringify(this.submitted),
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
      this.submitted = parsed.output;
    } catch {
      /* ignore */
    }
  }

  private clearVotedAnswer(quizId: string): void {
    delete this.submitted[quizId];
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

/** Remove a participant instance from the singleton cache. */
export function removeQuizParticipant(quizGroupId: string): void {
  participants.delete(quizGroupId);
}
