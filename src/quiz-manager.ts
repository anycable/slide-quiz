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

// AnyCable's default reconnect backoff starts at 3-6s and doubles without a
// ceiling, so after a minute or two of bad venue wifi a phone's next attempt
// can be minutes away, past the stream history's five-minute TTL. Start
// under a second (most drops are brief) and cap the wait, keeping the jitter
// so a room full of phones does not reconnect in lockstep.
const RECONNECT_FIRST_MS = 1_000;
const RECONNECT_MAX_MS = 3_000;

/** Delay before reconnect attempt `attempts` (0-based): 0.5-1s, 1-2s, then 1.5-3s. */
export function reconnectDelay(attempts: number): number {
  const ceiling = Math.min(RECONNECT_FIRST_MS * 2 ** attempts, RECONNECT_MAX_MS);
  return ceiling * (0.5 + Math.random() * 0.5);
}

// AnyCable's client has no handshake timeout: an attempt whose handshake never
// completes (an overloaded access point that accepts the connection and then
// drops everything) stays "connecting" until the OS gives up, which can take
// minutes, and no further attempt is scheduled meanwhile. Abandon it instead.
const CONNECT_TIMEOUT_MS = 6_000;

// ── Endpoints ──

const DEFAULT_ENDPOINTS: QuizEndpoints = {
  answer: "/.netlify/functions/quiz-answer",
  sync: "/.netlify/functions/quiz-sync",
};

// How often the presenter re-sends the current state when nothing changes.
// Phones joining or reconnecting read the state from the sync stream's
// history, which AnyCable keeps for five minutes by default; the keepalive
// makes sure the history always holds a recent copy, even on a quiet slide.
const SYNC_KEEPALIVE_MS = 60_000;
// Phones apply incoming sync at most this often, using the latest message.
const SYNC_APPLY_WINDOW_MS = 100;
// Minimum gap between two sync requests; changes in between share one request.
const SYNC_COALESCE_MS = 200;
// A sync request that takes longer is aborted and retried with fresh state.
const SYNC_TIMEOUT_MS = 10_000;
// Retries after a failure back off from 1s up to this.
const SYNC_RETRY_MAX_MS = 10_000;

// ── Throttle utility ──

/**
 * Run at most once per `delay`, always with the latest arguments. A pending
 * run is never postponed, so a steady stream of calls cannot starve it.
 * With `leading: false` even the first call waits, so a burst applies only
 * its last call.
 */
function throttle<T extends (...args: any[]) => any>(fn: T, delay: number, { leading = true } = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Parameters<T> | undefined;
  let lastRun = -Infinity;

  const run = () => {
    timer = undefined;
    lastRun = Date.now();
    const args = pending!;
    pending = undefined;
    fn(...args);
  };

  const throttled = (...args: Parameters<T>) => {
    pending = args;
    if (timer) return;
    const wait = leading ? lastRun + delay - Date.now() : delay;
    if (wait <= 0) run();
    else timer = setTimeout(run, wait);
  };
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
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
  private connectWatchdogId: ReturnType<typeof setInterval> | undefined;

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
      reconnectStrategy: (attempts: number) => {
        const delay = reconnectDelay(attempts);
        this.logConnection(`reconnect attempt ${attempts + 1} in ${(delay / 1000).toFixed(1)}s`);
        return delay;
      },
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
    clearInterval(this.connectWatchdogId);
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

    const startedAt = Date.now();
    let lostAt: number | undefined;
    const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

    let connectingSince: number | undefined;
    this.connectWatchdogId = setInterval(() => {
      if (this.cable.state !== "connecting") {
        connectingSince = undefined;
        return;
      }
      connectingSince ??= Date.now();
      if (Date.now() - connectingSince < CONNECT_TIMEOUT_MS) return;
      connectingSince = undefined;
      this.logConnection(`no answer from the server within ${seconds(CONNECT_TIMEOUT_MS)}; abandoning this attempt`, "warn");
      // Closing the transport fails the attempt, so the client schedules the next one
      this.cable.transport.close();
    }, 1_000);

    this.unsubs.push(
      this.cable.on("connect", (ev) => {
        if (this.connectionGraceId) clearTimeout(this.connectionGraceId);
        this.store.connection.set("connected");
        this.store.connectionError.set(null);
        if (lostAt === undefined) {
          this.logConnection(`connected in ${seconds(Date.now() - startedAt)}`);
        } else {
          const session = ev?.restored ? "session restored" : "new session";
          this.logConnection(`reconnected after ${seconds(Date.now() - lostAt)} offline (${session})`);
          lostAt = undefined;
        }
      }),
      this.cable.on("disconnect", (ev) => {
        this.store.connection.set("disconnected");
        lostAt ??= Date.now();
        this.logConnection(`lost (${describe(ev)})`, "warn");
        scheduleError("disconnected", describe(ev));
      }),
      this.cable.on("close", (ev) => {
        this.store.connection.set("closed");
        this.logConnection(`closed by the server (${describe(ev)}); not reconnecting`, "warn");
        scheduleError("closed", describe(ev));
      }),
      // Whether the stream history arrived after (re)subscribing: phones
      // depend on it for the current question.
      this.syncChannel.on("info", (ev: { type: string }) => {
        if (ev.type === "history_received") this.logConnection("sync history received");
        if (ev.type === "history_not_found") {
          this.logConnection("sync history unavailable; waiting for the next broadcast", "warn");
        }
      }),
    );
  }

  /** One line per connection event, so a phone's console tells the whole story. */
  protected logConnection(message: string, level: "info" | "warn" = "info"): void {
    console[level](`[slide-quiz:connection] ${message}`);
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
      // Phones may have missed broadcasts while either side was offline
      this.store.connection.listen((status) => {
        if (status === "connected") this.refreshSync();
      }),
    );
    if (typeof window !== "undefined") {
      const onOnline = () => this.refreshSync();
      window.addEventListener("online", onOnline);
      this.unsubs.push(() => window.removeEventListener("online", onOnline));
    }

    // Note: no sendSync here — questions haven't been set yet.
    // setQuestions() triggers the first sync after plugin init.
  }

  /** Set the full list of questions (broadcast to participants via sync) */
  setQuestions(questions: QuestionPayload[]): void {
    this.store.questions.set(questions);
    // Answers that arrived before their question was known were counted as
    // single choice; recount them now that the question's type is known.
    for (const quizId of this.sessionVotes.keys()) this.recount(quizId);
    // First broadcast, which also starts the keepalive. With no active
    // question it moves phones left on an old question back to Waiting.
    this.refreshSync();
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
    this.syncStopped = true;
    clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    this.syncRequest?.abort();
    super.disconnect();
  }

  // ── Message Handlers ──

  protected override onSyncMessage(msg: unknown): void {
    // Ignore other messages (presenter is source of truth, not a consumer of sync; a single presenter is assumed)
  }

  protected override async onPresence(): Promise<void> {
    await super.onPresence();
    // A phone joined (or rejoined): send it the current state now instead of
    // relying on the stream history reaching it.
    this.refreshSync();
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
  //
  // One request at a time, built from the state at the moment it is sent, so
  // a retry never resends a question the presenter has already left and a
  // slow response cannot be overtaken. After every request the next one is
  // scheduled: soon if the state changed meanwhile, with backoff after a
  // failure, otherwise as a keepalive.

  private syncFailures = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private syncDueAt = 0;
  private syncRequest: AbortController | undefined;
  private syncDirty = false;
  private syncStopped = false;
  private lastSyncAt = -Infinity;
  private syncSeq = 0;

  /** The state changed: send it as soon as the coalescing window allows. */
  private sendSync(): void {
    if (this.syncStopped) return;
    this.syncDirty = true;
    if (this.syncRequest) return; // sent when the current request settles
    // While the endpoint is failing, keep at least a second between attempts
    const gap = this.syncFailures > 0 ? 1_000 : SYNC_COALESCE_MS;
    const wait = Math.max(0, this.lastSyncAt + gap - Date.now());
    if (this.syncTimer && this.syncDueAt <= Date.now() + wait) return; // never postpone a send
    if (wait === 0) this.flushSync();
    else this.scheduleSync(wait);
  }

  /** Resend the current state once questions are known (nothing changed). */
  private refreshSync(): void {
    if (this.store.questions.get().length > 0) this.sendSync();
  }

  private scheduleSync(delay: number): void {
    clearTimeout(this.syncTimer);
    this.syncDueAt = Date.now() + delay;
    this.syncTimer = setTimeout(() => this.flushSync(), delay);
  }

  private buildSyncPayload(): SyncPayload & { quizGroupId: string } | null {
    const activeId = this.store.activeQuestionId.get();
    const questions = this.store.questions.get();
    if (!activeId && questions.length === 0) return null;
    const questionIndex = activeId ? questions.findIndex(q => q.quizId === activeId) : -1;
    // Increases with every broadcast, and across reloads of this tab, so a
    // phone can drop a broadcast that arrives after a newer one.
    this.syncSeq = Math.max(this.syncSeq + 1, Date.now());
    return {
      activeQuestionId: activeId,
      sessionId: this.sessionId,
      quizGroupId: this.quizGroupId,
      results: this.store.results.get(),
      question: questionIndex >= 0 ? questions[questionIndex] : undefined,
      questionIndex,
      totalCount: questions.length,
      seq: this.syncSeq,
    };
  }

  private async flushSync(): Promise<void> {
    clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    if (this.syncStopped || this.syncRequest) return;

    const payload = this.buildSyncPayload();
    this.syncDirty = false;
    if (!payload) {
      this.scheduleSync(SYNC_KEEPALIVE_MS);
      return;
    }
    console.log("[slide-quiz:presenter] sendSync:", {
      activeQuestionId: payload.activeQuestionId,
      quizGroupId: payload.quizGroupId,
      questionIndex: payload.questionIndex,
      totalCount: payload.totalCount,
      endpoint: this.endpoints.sync,
    });

    const request = new AbortController();
    this.syncRequest = request;
    this.lastSyncAt = Date.now();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      request.abort();
    }, SYNC_TIMEOUT_MS);

    try {
      const res = await fetch(this.endpoints.sync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
      if (this.syncStopped) return;
      if (res.ok) {
        if (this.syncFailures > 0) {
          this.syncFailures = 0;
          this.store.syncError.set(null);
        }
      } else {
        this.syncFailed(syncFailureHint(res.status, this.endpoints.sync), res.status);
      }
    } catch (err) {
      if (this.syncStopped) return;
      const isLocal = typeof location !== "undefined" &&
        (location.hostname === "localhost" || location.hostname === "127.0.0.1");
      const hint = timedOut
        ? `${this.endpoints.sync} did not respond within ${SYNC_TIMEOUT_MS / 1000}s; retrying.`
        : isLocal
          ? "Sync won't work locally — deploy your site to Netlify or Vercel so the audience can connect."
          : `Can't reach ${this.endpoints.sync} — check that your serverless functions are deployed.`;
      this.syncFailed(hint, err);
    } finally {
      clearTimeout(timeout);
      if (this.syncRequest === request) this.syncRequest = undefined;
      if (!this.syncStopped) {
        const delay = this.syncFailures > 0
          ? Math.min(1_000 * 2 ** (this.syncFailures - 1), SYNC_RETRY_MAX_MS)
          : this.syncDirty
            ? Math.max(0, this.lastSyncAt + SYNC_COALESCE_MS - Date.now())
            : SYNC_KEEPALIVE_MS;
        this.scheduleSync(delay);
      }
    }
  }

  private syncFailed(hint: string, cause: unknown): void {
    this.syncFailures++;
    this.emitError({
      kind: "sync",
      message: hint,
      cause,
      context: { endpoint: this.endpoints.sync, quizGroupId: this.quizGroupId, attempt: this.syncFailures },
    });
    if (this.syncFailures >= 2) {
      this.store.syncError.set(hint);
    }
  }

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
  private lastSeq: { sessionId: string; seq: number } | undefined;
  // Log the first state applied after each (re)connect: the line that tells
  // whether a phone actually got the current question.
  private awaitingState = true;

  constructor(config: QuizManagerConfig) {
    super(config, 5 * 60_000); // 5-min history window

    // Stream history replays every broadcast of the last five minutes in one
    // burst, oldest first; applying only the burst's last message keeps an
    // old question from flashing on screen before the current one.
    this.onSyncThrottled = throttle(this.applySync.bind(this), SYNC_APPLY_WINDOW_MS, { leading: false });

    // Rejects while offline; AnyCable re-sends presence when the session is restored
    this.syncChannel.presence.join(this.sessionId, { id: this.sessionId }).catch(() => {});
    this.unsubs.push(this.store.connection.listen((status) => {
      if (status === "connected") this.awaitingState = true;
    }));
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
    this.syncChannel.presence.leave().catch(() => {});
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

    // A broadcast whose request was slow can arrive after a newer one from
    // the same presenter tab; applying it would bring back an old question.
    if (sync.seq !== undefined) {
      const last = this.lastSeq;
      if (last && last.sessionId === sync.sessionId && sync.seq <= last.seq) return;
      this.lastSeq = { sessionId: sync.sessionId, seq: sync.seq };
    }

    this.onSyncThrottled(sync);
  }

  private applySync(data: SyncPayload): void {
    if (this.awaitingState) {
      this.awaitingState = false;
      this.logConnection(`current state received: ${data.activeQuestionId ? `question ${data.activeQuestionId}` : "no open question (Waiting)"}`);
    }
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
