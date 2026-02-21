/**
 * QuizManager — AnyCable-powered quiz engine (public streams, no secrets on frontend).
 *
 * Two modes:
 * - Presenter: subscribes to results + sync streams, aggregates votes, broadcasts state
 * - Participant: subscribes to sync stream, receives state, submits answers
 *
 * Streams (public, unsigned):
 * - quiz:{quizGroupId}:results — individual answers
 * - quiz:{quizGroupId}:sync    — full state + presence
 */
import { createCable } from "@anycable/web";
import type { Cable, Channel } from "@anycable/web";

// ── Types (re-exported from shared module) ──

export type {
  VoteState,
  SyncPayload,
  AnswerPayload,
  QuizState,
  StateCallback,
} from "./quiz-types";

import type {
  VoteState,
  SyncPayload,
  AnswerPayload,
  QuizState,
  StateCallback,
} from "./quiz-types";

// ── Endpoints ──

export interface QuizEndpoints {
  answer: string;
  sync: string;
}

const DEFAULT_ENDPOINTS: QuizEndpoints = {
  answer: "/.netlify/functions/quiz-answer",
  sync: "/.netlify/functions/quiz-sync",
};

// ── Message Validation ──

export function isValidSyncPayload(data: unknown): data is SyncPayload {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    (obj.activeQuizId === null || typeof obj.activeQuizId === "string") &&
    typeof obj.results === "object" &&
    obj.results !== null
  );
}

export function isValidAnswerPayload(data: unknown): data is AnswerPayload {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.quizId === "string" &&
    typeof obj.answer === "string" &&
    typeof obj.sessionId === "string"
  );
}

// ── QuizManager ──

export class QuizManager {
  private cable: Cable;
  private syncChannel: Channel;
  private resultsChannel: Channel | null = null;
  private role: "presenter" | "participant";
  private quizGroupId: string;
  private sessionId: string;
  private endpoints: QuizEndpoints;

  // State
  private activeQuizId: string | null = null;
  private results: Record<string, VoteState> = {};
  private voters: Record<string, Set<string>> = {};
  private online = 0;
  private submitted: Record<string, string> = {};

  // Callbacks
  private listeners: StateCallback[] = [];

  // Outgoing sync throttle
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncPending = false;

  // Incoming sync throttle (participant)
  private incomingSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private incomingSyncData: SyncPayload | null = null;

  constructor(config: {
    wsUrl: string;
    quizGroupId: string;
    role: "presenter" | "participant";
    sessionId?: string;
    endpoints?: Partial<QuizEndpoints>;
  }) {
    this.role = config.role;
    this.quizGroupId = config.quizGroupId;
    this.sessionId = config.sessionId || this.getOrCreateSessionId();
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints };

    // Both roles fetch recent history to recover from disconnects/reloads.
    // Participant: 1 min (catch up on current state).
    // Presenter: 5 min (re-aggregate any votes missed during reload).
    // The voters Set (restored from sessionStorage) prevents double-counting.
    const historyWindow = config.role === "participant" ? 60_000 : 300_000;

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
    // presence info without a `records` array (Managed AnyCable compat)
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
    if (config.role === "participant") {
      this.syncChannel.presence.join(this.sessionId, { id: this.sessionId });
    }
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

    // Presenter also subscribes to results stream
    if (config.role === "presenter") {
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

    // Participant: restore submitted answers from sessionStorage
    if (config.role === "participant") {
      this.restoreSubmitted();
    }
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

  /** Presenter: set the active quiz (called when slide enters viewport) */
  setActiveQuiz(quizId: string): void {
    if (this.role !== "presenter") return;
    if (this.activeQuizId === quizId) return;
    this.activeQuizId = quizId;
    this.saveState();
    this.sendSync();
  }

  /** Participant: submit an answer */
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

  disconnect(): void {
    if (this.role === "participant") {
      this.syncChannel.presence.leave();
    }
    this.cable.disconnect();
  }

  // ── Message Handlers ──

  private onSyncMessage(msg: unknown): void {
    const data = this.parse(msg);
    if (!isValidSyncPayload(data)) return;
    if (data.sessionId === this.sessionId) return;

    if (this.role === "participant") {
      this.applySyncThrottled(data);
    }
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

    // Reset detection: clear submitted answer when totals drop to 0
    for (const quizId of Object.keys(this.submitted)) {
      const total = data.results[quizId]?.total ?? 0;
      if (total === 0) {
        this.clearVotedAnswer(quizId);
      }
    }
    this.notifyStateChange();
  }

  private onResultsMessage(msg: unknown): void {
    if (this.role !== "presenter") return;

    const data = this.parse(msg);
    if (!isValidAnswerPayload(data)) return;
    if (data.sessionId === this.sessionId) return;

    const { quizId, answer, sessionId } = data;

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

  private async onPresence(): Promise<void> {
    try {
      const state = await this.syncChannel.presence.info();
      if (state) {
        this.online = Object.keys(state).length;
        this.notifyStateChange();
        // Re-broadcast so late-joining participants get the current state
        if (this.role === "presenter" && this.activeQuizId) {
          this.sendSyncThrottled();
        }
      }
    } catch {
      /* ignore */
    }
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
    if (this.role !== "presenter") return;
    try {
      await fetch(this.endpoints.sync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeQuizId: this.activeQuizId,
          sessionId: this.sessionId,
          quizGroupId: this.quizGroupId,
          results: this.results,
        }),
      });
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

  private saveState(): void {
    if (this.role !== "presenter") return;
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
      const saved = JSON.parse(raw);
      if (saved.activeQuizId) this.activeQuizId = saved.activeQuizId;
      if (saved.results) this.results = saved.results;
      if (saved.voters) {
        for (const [k, v] of Object.entries(saved.voters)) {
          this.voters[k] = new Set(v as string[]);
        }
      }
    } catch {
      /* ignore */
    }
  }

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
      this.submitted = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }

  private clearVotedAnswer(quizId: string): void {
    delete this.submitted[quizId];
    this.saveSubmitted();
  }

  // ── Helpers ──

  private notifyStateChange(): void {
    const state = this.getState();
    for (const cb of this.listeners) cb(state);
  }

  private parse(msg: unknown): Record<string, unknown> {
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

// ── Singleton Factories ──

const presenters = new Map<string, QuizManager>();

export function getQuizPresenter(config: {
  wsUrl: string;
  quizGroupId: string;
  endpoints?: Partial<QuizEndpoints>;
}): QuizManager {
  if (!presenters.has(config.quizGroupId)) {
    presenters.set(
      config.quizGroupId,
      new QuizManager({ ...config, role: "presenter" }),
    );
  }
  return presenters.get(config.quizGroupId)!;
}

/** Remove a presenter instance from the singleton cache. */
export function removeQuizPresenter(quizGroupId: string): void {
  presenters.delete(quizGroupId);
}

const participants = new Map<string, QuizManager>();

export function getQuizParticipant(config: {
  wsUrl: string;
  quizGroupId: string;
  endpoints?: Partial<QuizEndpoints>;
}): QuizManager {
  if (!participants.has(config.quizGroupId)) {
    participants.set(
      config.quizGroupId,
      new QuizManager({ ...config, role: "participant" }),
    );
  }
  return participants.get(config.quizGroupId)!;
}

/** Remove a participant instance from the singleton cache. */
export function removeQuizParticipant(quizGroupId: string): void {
  participants.delete(quizGroupId);
}
