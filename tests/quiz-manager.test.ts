import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QuizState } from "../src/quiz-manager";

// ── Mock @anycable/web ──

type MessageHandler = (msg: unknown) => void;
type PresenceHandler = () => void;

let syncMessageHandler: MessageHandler;
let syncPresenceHandler: PresenceHandler;
let resultsMessageHandler: MessageHandler;

const mockPresence = {
  join: vi.fn(),
  leave: vi.fn(),
  info: vi.fn().mockResolvedValue({}),
};

function createMockChannel(stream: string) {
  const channel = {
    on: vi.fn((event: string, handler: Function) => {
      if (stream.endsWith(":sync")) {
        if (event === "message") syncMessageHandler = handler as MessageHandler;
        if (event === "presence")
          syncPresenceHandler = handler as PresenceHandler;
      }
      if (stream.endsWith(":results") && event === "message") {
        resultsMessageHandler = handler as MessageHandler;
      }
      // Return an unsub function (matches real @anycable/web API)
      return () => {};
    }),
    presence: mockPresence,
  };
  return channel;
}

const mockCable = {
  streamFrom: vi.fn((stream: string) => createMockChannel(stream)),
  disconnect: vi.fn(),
};

vi.mock("@anycable/web", () => ({
  createCable: vi.fn(() => mockCable),
}));

// ── Import after mocking ──

const anycableWeb = await import("@anycable/web");
const { createCable } = anycableWeb;
const {
  QuizManager,
  PresenterQuizManager,
  ParticipantQuizManager,
  getQuizPresenter,
  getQuizParticipant,
  isValidSyncPayload,
  isValidAnswerPayload,
} = await import("../src/quiz-manager");

// ── Helpers ──

const WS_URL = "wss://test.example/cable";
const GROUP_ID = "test-group";
const SESSION_ID = "test-session-123";

const ANSWER_ENDPOINT = "/.netlify/functions/quiz-answer";
const SYNC_ENDPOINT = "/.netlify/functions/quiz-sync";

function createPresenter(sessionId = SESSION_ID) {
  return new PresenterQuizManager({
    wsUrl: WS_URL,
    quizGroupId: GROUP_ID,
    sessionId,
  });
}

function createParticipant(sessionId = SESSION_ID) {
  return new ParticipantQuizManager({
    wsUrl: WS_URL,
    quizGroupId: GROUP_ID,
    sessionId,
  });
}

function collectStates(manager: InstanceType<typeof QuizManager>) {
  const states: QuizState[] = [];
  manager.subscribe((s) => states.push(s));
  return states;
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish mock implementations after clearAllMocks
  mockPresence.info.mockResolvedValue({});
  mockCable.streamFrom.mockImplementation((stream: string) => createMockChannel(stream));
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("QuizManager — Presenter mode", () => {
  it("creates cable with 5-min history window", () => {
    const { createCable: cc } = anycableWeb;
    const before = Date.now();
    createPresenter();
    const call = vi.mocked(cc).mock.calls.at(-1)!;
    expect(call[0]).toBe(WS_URL);
    const ts = call[1].protocolOptions.historyTimestamp;
    const expected = Math.floor((before - 300_000) / 1000);
    expect(ts).toBeGreaterThanOrEqual(expected - 1);
    expect(ts).toBeLessThanOrEqual(expected + 1);
  });

  it("setActiveQuestion updates state and triggers sync POST", async () => {
    const mgr = createPresenter();
    mgr.setActiveQuestion("q1");

    expect(mgr.getState().activeQuestionId).toBe("q1");
    expect(fetch).toHaveBeenCalledWith(
      SYNC_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("setQuestions stores questions and includes them in sync", () => {
    const mgr = createPresenter();
    const questions = [
      { quizId: "q1", question: "Fav color?", options: [{ label: "A", text: "Red" }] },
    ];
    mgr.setQuestions(questions);
    expect(mgr.getState().questions).toEqual(questions);

    mgr.setActiveQuestion("q1");
    const syncCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes("quiz-sync"),
    )!;
    const body = JSON.parse(syncCall[1].body as string);
    expect(body.questions).toEqual(questions);
  });

  it("ignores duplicate setActiveQuestion for same quizId", () => {
    const mgr = createPresenter();
    mgr.setActiveQuestion("q1");
    vi.mocked(fetch).mockClear();
    mgr.setActiveQuestion("q1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aggregates incoming votes from results stream", () => {
    const mgr = createPresenter();
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: "voter-1",
    });
    resultsMessageHandler({
      quizId: "q1",
      answer: "B",
      sessionId: "voter-2",
    });

    const qs = mgr.getQuizState("q1");
    expect(qs.total).toBe(2);
    expect(qs.votes).toEqual({ A: 1, B: 1 });
  });

  it("deduplicates votes by sessionId", () => {
    const mgr = createPresenter();
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: "voter-1",
    });
    resultsMessageHandler({
      quizId: "q1",
      answer: "B",
      sessionId: "voter-1",
    });

    expect(mgr.getQuizState("q1").total).toBe(1);
    expect(mgr.getQuizState("q1").votes).toEqual({ A: 1 });
  });

  it("ignores echo messages (own sessionId)", () => {
    const mgr = createPresenter();
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: SESSION_ID,
    });

    expect(mgr.getQuizState("q1").total).toBe(0);
  });

  it("subscribe emits current state immediately", () => {
    const mgr = createPresenter();
    mgr.setActiveQuestion("q1");
    const states = collectStates(mgr);
    expect(states).toHaveLength(1);
    expect(states[0].activeQuestionId).toBe("q1");
  });

  it("saves and restores state from sessionStorage", () => {
    const mgr1 = createPresenter();
    mgr1.setActiveQuestion("q1");
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: "voter-1",
    });

    // Create a new presenter — should restore state
    const mgr2 = createPresenter("other-session");
    expect(mgr2.getState().activeQuestionId).toBe("q1");
    expect(mgr2.getQuizState("q1").total).toBe(1);
  });

  it("re-broadcasts sync after restoring state (so late joiners get it)", () => {
    const mgr1 = createPresenter();
    mgr1.setActiveQuestion("q1");
    vi.mocked(fetch).mockClear();

    // Simulate presenter reload — new instance restores from sessionStorage
    const mgr2 = createPresenter("other-session");
    expect(mgr2.getState().activeQuestionId).toBe("q1");

    // Must have sent a sync during construction
    const syncCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    );
    expect(syncCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("re-broadcasts sync when a participant joins (presence change)", async () => {
    const mgr = createPresenter();
    mgr.setActiveQuestion("q1");
    vi.mocked(fetch).mockClear();

    // Simulate presence event (new participant joined)
    mockPresence.info.mockResolvedValueOnce({ "p1": {} });
    await syncPresenceHandler();

    const syncCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    );
    expect(syncCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT broadcast sync on presence if no active quiz", async () => {
    createPresenter();
    vi.mocked(fetch).mockClear();

    mockPresence.info.mockResolvedValueOnce({ "p1": {} });
    await syncPresenceHandler();

    const syncCalls = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    );
    expect(syncCalls).toHaveLength(0);
  });

  it("sendSyncThrottled coalesces rapid calls", async () => {
    vi.useFakeTimers();
    const mgr = createPresenter();

    // First vote triggers immediate sync
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: "v1",
    });
    const countAfterFirst = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    ).length;

    // Rapid subsequent votes should be throttled
    resultsMessageHandler({
      quizId: "q1",
      answer: "B",
      sessionId: "v2",
    });
    resultsMessageHandler({
      quizId: "q1",
      answer: "C",
      sessionId: "v3",
    });

    const countBeforeTimer = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    ).length;
    // Should only have added 1 sync call (the immediate one from v1), not 3
    expect(countBeforeTimer - countAfterFirst).toBeLessThanOrEqual(1);

    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    const countAfterTimer = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    ).length;
    // After timer fires, one more trailing sync
    expect(countAfterTimer).toBeGreaterThan(countBeforeTimer);
  });

  it("uses custom endpoints when provided", async () => {
    const mgr = new PresenterQuizManager({
      wsUrl: WS_URL,
      quizGroupId: GROUP_ID,
      sessionId: SESSION_ID,
      endpoints: { sync: "/api/quiz-sync" },
    });
    mgr.setActiveQuestion("q1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/quiz-sync",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("tracks votes for multiple quizzes independently", () => {
    const mgr = createPresenter();
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q2", answer: "B", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "C", sessionId: "v2" });

    expect(mgr.getQuizState("q1").total).toBe(2);
    expect(mgr.getQuizState("q1").votes).toEqual({ A: 1, C: 1 });
    expect(mgr.getQuizState("q2").total).toBe(1);
    expect(mgr.getQuizState("q2").votes).toEqual({ B: 1 });
  });

  it("sync POST body includes all required fields", () => {
    const mgr = createPresenter();
    mgr.setActiveQuestion("q1");

    const syncCall = vi.mocked(fetch).mock.calls.find(
      (c) => (c[0] as string).includes("quiz-sync"),
    )!;
    const body = JSON.parse(syncCall[1].body as string);
    expect(body).toMatchObject({
      activeQuestionId: "q1",
      sessionId: SESSION_ID,
      quizGroupId: GROUP_ID,
      results: {},
    });
  });

  it("disconnect calls unsubs and does NOT call presence.leave", () => {
    const mgr = createPresenter();
    mgr.disconnect();
    expect(mockPresence.leave).not.toHaveBeenCalled();
    expect(mockCable.disconnect).toHaveBeenCalled();
  });

  it("normalizes text answers (trim + lowercase → same key)", () => {
    const mgr = createPresenter();
    mgr.setQuestions([
      { quizId: "q1", question: "Fav framework?", type: "text", options: [] },
    ]);

    resultsMessageHandler({ quizId: "q1", answer: "React", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "react", sessionId: "v2" });
    resultsMessageHandler({ quizId: "q1", answer: "  REACT  ", sessionId: "v3" });

    const qs = mgr.getQuizState("q1");
    expect(qs.total).toBe(3);
    expect(qs.votes).toEqual({ react: 3 });
  });

  it("does NOT normalize choice answers", () => {
    const mgr = createPresenter();
    mgr.setQuestions([
      { quizId: "q1", question: "Pick one", type: "choice", options: [{ label: "A", text: "Yes" }] },
    ]);

    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "B", sessionId: "v2" });

    expect(mgr.getQuizState("q1").votes).toEqual({ A: 1, B: 1 });
  });

  it("defaults to no normalization for unknown quizId", () => {
    const mgr = createPresenter();
    // No questions set — unknown quizId defaults to "choice" (no normalization)
    resultsMessageHandler({ quizId: "unknown", answer: "React", sessionId: "v1" });

    expect(mgr.getQuizState("unknown").votes).toEqual({ React: 1 });
  });
});

describe("QuizManager — Participant mode", () => {
  it("creates cable with 1-min history window", () => {
    const { createCable: cc } = anycableWeb;
    const before = Date.now();
    createParticipant();
    const call = vi.mocked(cc).mock.calls.at(-1)!;
    const ts = call[1].protocolOptions.historyTimestamp;
    const expected = Math.floor((before - 60_000) / 1000);
    expect(ts).toBeGreaterThanOrEqual(expected - 1);
    expect(ts).toBeLessThanOrEqual(expected + 1);
  });

  it("joins presence on sync channel", () => {
    createParticipant();
    expect(mockPresence.join).toHaveBeenCalledWith(SESSION_ID, {
      id: SESSION_ID,
    });
  });

  it("submitAnswer sends POST, persists answer, returns true", async () => {
    const mgr = createParticipant();
    const ok = await mgr.submitAnswer("q1", "A");
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      ANSWER_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"quizId":"q1"'),
      }),
    );
    expect(mgr.hasVoted("q1")).toBe(true);
    expect(mgr.getVotedAnswer("q1")).toBe("A");
    expect(mgr.getState().submitted).toEqual({ q1: "A" });
  });

  it("submitAnswer returns false if already voted (double-vote prevention)", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    vi.mocked(fetch).mockClear();

    const ok = await mgr.submitAnswer("q1", "B");
    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(mgr.getVotedAnswer("q1")).toBe("A");
  });

  it("hasVoted / getVotedAnswer reflect submitted answers", async () => {
    const mgr = createParticipant();
    expect(mgr.hasVoted("q1")).toBe(false);
    expect(mgr.getVotedAnswer("q1")).toBeNull();

    await mgr.submitAnswer("q1", "C");
    expect(mgr.hasVoted("q1")).toBe(true);
    expect(mgr.getVotedAnswer("q1")).toBe("C");
  });

  it("incoming sync message updates activeQuestionId and results", () => {
    const mgr = createParticipant();
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q2",
      results: { q2: { votes: { A: 3 }, total: 3 } },
    });

    const state = mgr.getState();
    expect(state.activeQuestionId).toBe("q2");
    expect(state.results.q2.total).toBe(3);
  });

  it("receives and exposes questions from sync payload", () => {
    const mgr = createParticipant();
    expect(mgr.getState().questions).toEqual([]);

    const questions = [
      { quizId: "q1", question: "Fav color?", options: [{ label: "A", text: "Red" }] },
      { quizId: "q2", question: "Fav food?", options: [{ label: "A", text: "Pizza" }] },
    ];
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: {},
      questions,
    });

    expect(mgr.getState().questions).toEqual(questions);
  });

  it("incoming sync throttled — burst collapses into single state change", () => {
    vi.useFakeTimers();
    const mgr = createParticipant();
    const states = collectStates(mgr);
    const initialCount = states.length; // 1 from subscribe

    // First message applies immediately
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q1",
      results: {},
    });
    const afterFirst = states.length;
    expect(afterFirst).toBe(initialCount + 1);

    // Burst of messages during throttle window
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q2",
      results: {},
    });
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q3",
      results: {},
    });
    const duringThrottle = states.length;
    // No new state changes during throttle
    expect(duringThrottle).toBe(afterFirst);

    vi.advanceTimersByTime(200);
    const afterTimer = states.length;
    // One trailing state change with the latest data
    expect(afterTimer).toBe(afterFirst + 1);
    expect(states[afterTimer - 1].activeQuestionId).toBe("q3");
  });

  it("reset detection: clears submitted answer when totals drop to 0", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    expect(mgr.hasVoted("q1")).toBe(true);

    // Simulate a sync where q1 totals reset to 0
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: { q1: { votes: {}, total: 0 } },
    });

    expect(mgr.hasVoted("q1")).toBe(false);
    expect(mgr.getVotedAnswer("q1")).toBeNull();
    expect(mgr.getState().submitted).toEqual({});
  });

  it("disconnect leaves presence, calls unsubs, and disconnects cable", () => {
    const mgr = createParticipant();
    mgr.disconnect();
    expect(mockPresence.leave).toHaveBeenCalled();
    expect(mockCable.disconnect).toHaveBeenCalled();
  });

  it("restores submitted answers from sessionStorage on construction", async () => {
    // First participant submits
    const mgr1 = createParticipant();
    await mgr1.submitAnswer("q1", "B");

    // New participant instance restores from sessionStorage
    const mgr2 = createParticipant("other-participant");
    expect(mgr2.hasVoted("q1")).toBe(true);
    expect(mgr2.getVotedAnswer("q1")).toBe("B");
  });

  it("uses custom endpoints when provided", async () => {
    const mgr = new ParticipantQuizManager({
      wsUrl: WS_URL,
      quizGroupId: GROUP_ID,
      sessionId: SESSION_ID,
      endpoints: { answer: "/api/quiz-answer" },
    });
    await mgr.submitAnswer("q1", "A");

    expect(fetch).toHaveBeenCalledWith(
      "/api/quiz-answer",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sync without questions preserves previously received questions", () => {
    const mgr = createParticipant();
    const questions = [
      { quizId: "q1", question: "Fav?", options: [{ label: "A", text: "Yes" }] },
    ];

    // First sync delivers questions
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q1",
      results: {},
      questions,
    });
    expect(mgr.getState().questions).toEqual(questions);

    // Second sync without questions field — should NOT wipe them
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q1",
      results: { q1: { votes: { A: 1 }, total: 1 } },
    });
    expect(mgr.getState().questions).toEqual(questions);
  });

  it("sync without quiz in results does NOT clear submitted answer", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    expect(mgr.hasVoted("q1")).toBe(true);

    // Sync arrives with results for other quizzes but NOT q1 —
    // this is the normal case when no votes have been received yet.
    // Must NOT clear the submitted answer.
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: { q2: { votes: { B: 1 }, total: 1 } },
    });

    expect(mgr.hasVoted("q1")).toBe(true);
    expect(mgr.getVotedAnswer("q1")).toBe("A");
  });

  it("sync with empty results object does NOT clear submitted answer", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");

    // Sync with empty results — quiz hasn't received any votes yet
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: {},
    });

    expect(mgr.hasVoted("q1")).toBe(true);
    expect(mgr.getVotedAnswer("q1")).toBe("A");
  });

  it("submitted answer survives multiple rapid sync messages", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");

    // Simulate rapid sync bursts (the scenario that caused input clearing)
    for (let i = 0; i < 10; i++) {
      syncMessageHandler({
        sessionId: "presenter-123",
        activeQuestionId: "q1",
        results: { q1: { votes: { A: i + 1 }, total: i + 1 } },
      });
    }

    expect(mgr.hasVoted("q1")).toBe(true);
    expect(mgr.getVotedAnswer("q1")).toBe("A");
  });

  it("reset detection only clears the reset quiz, not others", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    await mgr.submitAnswer("q2", "B");
    expect(mgr.hasVoted("q1")).toBe(true);
    expect(mgr.hasVoted("q2")).toBe(true);

    // Sync resets q1 to 0 but q2 still has votes
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: {
        q1: { votes: {}, total: 0 },
        q2: { votes: { B: 5 }, total: 5 },
      },
    });

    expect(mgr.hasVoted("q1")).toBe(false);
    expect(mgr.hasVoted("q2")).toBe(true);
    expect(mgr.getVotedAnswer("q2")).toBe("B");
  });
});

describe("subscribe() returns unsubscribe teardown", () => {
  it("unsubscribe stops notifications", () => {
    const mgr = createPresenter();
    const states: QuizState[] = [];
    const unsub = mgr.subscribe((s) => states.push(s));

    // Initial call from subscribe
    expect(states).toHaveLength(1);

    // Trigger a vote — onResultsMessage calls notifyStateChange
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: "voter-1",
    });
    expect(states).toHaveLength(2);

    unsub();

    resultsMessageHandler({
      quizId: "q1",
      answer: "B",
      sessionId: "voter-2",
    });
    // No new notification after unsubscribe
    expect(states).toHaveLength(2);
  });

  it("double unsubscribe is safe", () => {
    const mgr = createPresenter();
    const unsub = mgr.subscribe(() => {});
    unsub();
    unsub(); // should not throw
  });

  it("multiple subscribers all receive notifications", () => {
    const mgr = createPresenter();
    const statesA: QuizState[] = [];
    const statesB: QuizState[] = [];
    mgr.subscribe((s) => statesA.push(s));
    mgr.subscribe((s) => statesB.push(s));

    // Both got initial state
    expect(statesA).toHaveLength(1);
    expect(statesB).toHaveLength(1);

    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    expect(statesA).toHaveLength(2);
    expect(statesB).toHaveLength(2);
    expect(statesA[1].results.q1.total).toBe(1);
    expect(statesB[1].results.q1.total).toBe(1);
  });
});

describe("Message validation — isValidSyncPayload", () => {
  it("accepts valid sync payload", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: "q1",
        results: { q1: { votes: { A: 1 }, total: 1 } },
      }),
    ).toBe(true);
  });

  it("accepts null activeQuestionId", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: null,
        results: {},
      }),
    ).toBe(true);
  });

  it("accepts sync payload with questions array", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: "q1",
        results: {},
        questions: [
          { quizId: "q1", question: "Fav?", options: [{ label: "A", text: "Yes" }] },
        ],
      }),
    ).toBe(true);
  });

  it("accepts sync payload without questions (backward compat)", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: "q1",
        results: { q1: { votes: { A: 1 }, total: 1 } },
      }),
    ).toBe(true);
  });

  it("rejects missing sessionId", () => {
    expect(
      isValidSyncPayload({
        activeQuestionId: "q1",
        results: {},
      }),
    ).toBe(false);
  });

  it("rejects numeric sessionId", () => {
    expect(
      isValidSyncPayload({
        sessionId: 123,
        activeQuestionId: "q1",
        results: {},
      }),
    ).toBe(false);
  });

  it("rejects null results", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: "q1",
        results: null,
      }),
    ).toBe(false);
  });

  it("rejects missing results", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: "q1",
      }),
    ).toBe(false);
  });
});

describe("Message validation — isValidAnswerPayload", () => {
  it("accepts valid answer payload", () => {
    expect(
      isValidAnswerPayload({
        quizId: "q1",
        answer: "A",
        sessionId: "voter-1",
      }),
    ).toBe(true);
  });

  it("rejects missing quizId", () => {
    expect(
      isValidAnswerPayload({
        answer: "A",
        sessionId: "voter-1",
      }),
    ).toBe(false);
  });

  it("rejects numeric answer", () => {
    expect(
      isValidAnswerPayload({
        quizId: "q1",
        answer: 42,
        sessionId: "voter-1",
      }),
    ).toBe(false);
  });

  it("rejects empty object", () => {
    expect(isValidAnswerPayload({})).toBe(false);
  });
});

describe("Message validation — integration (dev mode)", () => {
  it("presenter ignores malformed results messages in dev", () => {
    const mgr = createPresenter();

    // Missing fields
    resultsMessageHandler({ quizId: "q1" });
    resultsMessageHandler({ answer: "A" });
    resultsMessageHandler({ sessionId: "v1" });
    resultsMessageHandler(null);
    resultsMessageHandler("garbage");
    resultsMessageHandler({ quizId: 42, answer: "A", sessionId: "v1" });

    expect(mgr.getQuizState("q1").total).toBe(0);
  });

  it("participant ignores malformed sync messages in dev", () => {
    const mgr = createParticipant();

    syncMessageHandler({ activeQuestionId: "q1" }); // missing sessionId + results
    syncMessageHandler(null);
    syncMessageHandler("garbage");
    syncMessageHandler({ sessionId: 123, activeQuestionId: "q1", results: {} });

    expect(mgr.getState().activeQuestionId).toBeNull();
  });
});

describe("Singleton — getQuizPresenter", () => {
  it("returns same instance for same quizGroupId", () => {
    const a = getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g1" });
    const b = getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g1" });
    expect(a).toBe(b);
  });

  it("returns different instances for different quizGroupIds", () => {
    const a = getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g2" });
    const b = getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g3" });
    expect(a).not.toBe(b);
  });
});

describe("Singleton — getQuizParticipant", () => {
  it("returns same instance for same quizGroupId", () => {
    const a = getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p1" });
    const b = getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p1" });
    expect(a).toBe(b);
  });

  it("returns different instances for different quizGroupIds", () => {
    const a = getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p2" });
    const b = getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p3" });
    expect(a).not.toBe(b);
  });

  it("participant and presenter singletons are independent", () => {
    const participant = getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "shared" });
    const presenter = getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "shared" });
    expect(participant).not.toBe(presenter);
  });
});

describe("Error paths", () => {
  it("submitAnswer returns false on network failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));
    const mgr = createParticipant();
    const ok = await mgr.submitAnswer("q1", "A");
    expect(ok).toBe(false);
    expect(mgr.hasVoted("q1")).toBe(false);
  });

  it("submitAnswer returns false on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const mgr = createParticipant();
    const ok = await mgr.submitAnswer("q1", "A");
    expect(ok).toBe(false);
    expect(mgr.hasVoted("q1")).toBe(false);
  });

  it("sendSync swallows errors silently", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
    const mgr = createPresenter();
    // setActiveQuestion calls sendSync internally — should not throw
    expect(() => mgr.setActiveQuestion("q1")).not.toThrow();
  });

  it("corrupted sessionStorage does not crash presenter restore", () => {
    sessionStorage.setItem(`quiz-presenter-${GROUP_ID}`, "not-valid-json{{{");
    // Should not throw during construction
    expect(() => createPresenter()).not.toThrow();
  });

  it("corrupted sessionStorage does not crash participant restore", () => {
    sessionStorage.setItem(`quiz-submitted-${GROUP_ID}`, "not-valid-json{{{");
    expect(() => createParticipant()).not.toThrow();
  });

  it("presence info rejection does not crash", async () => {
    mockPresence.info.mockRejectedValueOnce(new Error("Presence error"));
    // Construction triggers presence.info() — should not throw
    expect(() => createPresenter()).not.toThrow();
  });
});
