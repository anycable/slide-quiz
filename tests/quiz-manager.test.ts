import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock @anycable/web ──

type MessageHandler = (msg: unknown) => void;
type PresenceHandler = (ev?: { type?: string; id?: string }) => Promise<void> | void;

let syncMessageHandler: MessageHandler;
let syncPresenceHandler: PresenceHandler;
let resultsMessageHandler: MessageHandler;

const mockPresence = {
  join: vi.fn().mockResolvedValue(undefined),
  leave: vi.fn().mockResolvedValue(undefined),
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
    whisper: vi.fn(),
  };
  return channel;
}

type CableHandler = (ev?: unknown) => void;
const cableHandlers: Record<string, CableHandler[]> = {};

const mockCable = {
  streamFrom: vi.fn((stream: string) => createMockChannel(stream)),
  disconnect: vi.fn(),
  on: vi.fn((event: string, handler: CableHandler) => {
    (cableHandlers[event] ??= []).push(handler);
    return () => {
      cableHandlers[event] = (cableHandlers[event] ?? []).filter((h) => h !== handler);
    };
  }),
};

function emitCable(event: string, ev?: unknown) {
  for (const h of cableHandlers[event] ?? []) h(ev);
}

vi.mock("@anycable/web", () => ({
  createCable: vi.fn(() => mockCable),
}));

// ── Import after mocking ──

const anycableWeb = await import("@anycable/web");
const { createCable } = anycableWeb;
const {
  PresenterQuizManager,
  ParticipantQuizManager,
  getQuizPresenter,
  getQuizParticipant,
  isValidSyncPayload,
  isValidAnswerPayload,
  syncFailureHint,
} = await import("../src/quiz-manager");

// ── Helpers ──

const WS_URL = "wss://test.example/cable";
const GROUP_ID = "test-group";
const SESSION_ID = "test-session-123";

const ANSWER_ENDPOINT = "/.netlify/functions/quiz-answer";
const SYNC_ENDPOINT = "/.netlify/functions/quiz-sync";

// Every manager created in a test is disconnected afterwards, so no throttle
// or keepalive timer can fire into a torn-down fetch mock (a CI-only race).
const managers: { disconnect(): void }[] = [];
function track<T extends { disconnect(): void }>(m: T): T {
  managers.push(m);
  return m;
}

function createPresenter(sessionId = SESSION_ID) {
  return track(new PresenterQuizManager({
    wsUrl: WS_URL,
    quizGroupId: GROUP_ID,
    sessionId,
  }));
}

function createParticipant(sessionId = SESSION_ID) {
  return track(new ParticipantQuizManager({
    wsUrl: WS_URL,
    quizGroupId: GROUP_ID,
    sessionId,
  }));
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish mock implementations after clearAllMocks
  mockPresence.info.mockResolvedValue({});
  mockPresence.join.mockResolvedValue(undefined);
  mockPresence.leave.mockResolvedValue(undefined);
  mockCable.streamFrom.mockImplementation((stream: string) => createMockChannel(stream));
  for (const k of Object.keys(cableHandlers)) delete cableHandlers[k];
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true }),
  );
});

afterEach(() => {
  for (const m of managers.splice(0)) {
    try { m.disconnect(); } catch { /* already disconnected */ }
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("QuizManager — Presenter mode", () => {
  it("creates cable with no history (current timestamp)", () => {
    const { createCable: cc } = anycableWeb;
    const before = Date.now();
    createPresenter();
    const call = vi.mocked(cc).mock.calls.at(-1)!;
    expect(call[0]).toBe(WS_URL);
    const ts = call[1].protocolOptions.historyTimestamp;
    const expected = Math.floor(before / 1000);
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

  it("setQuestions stores questions and sends current question in sync", async () => {
    vi.useFakeTimers();
    const mgr = createPresenter();
    const questions = [
      { quizId: "q1", question: "Fav color?", options: [{ label: "A", text: "Red" }] },
    ];
    mgr.setQuestions(questions);
    expect(mgr.getState().questions).toEqual(questions);

    mgr.setActiveQuestion("q1");
    await vi.advanceTimersByTimeAsync(300);
    const syncCall = vi.mocked(fetch).mock.calls.findLast(
      (c) => (c[0] as string).includes("quiz-sync"),
    )!;
    const body = JSON.parse(syncCall[1].body as string);
    expect(body.question).toEqual(questions[0]);
    expect(body.questionIndex).toBe(0);
    expect(body.totalCount).toBe(1);
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

  it("handles changed votes (decrements old, increments new)", () => {
    const mgr = createPresenter();
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "voter-1" });
    resultsMessageHandler({ quizId: "q1", answer: "B", sessionId: "voter-2" });
    expect(mgr.getQuizState("q1")).toEqual({ votes: { A: 1, B: 1 }, total: 2 });

    // voter-1 changes from A to C
    resultsMessageHandler({ quizId: "q1", answer: "C", sessionId: "voter-1" });
    expect(mgr.getQuizState("q1")).toEqual({ votes: { B: 1, C: 1 }, total: 2 });
  });

  it("ignores duplicate vote from same session", () => {
    const mgr = createPresenter();
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "voter-1" });
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "voter-1" });
    expect(mgr.getQuizState("q1")).toEqual({ votes: { A: 1 }, total: 1 });
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

    // setQuestions triggers sync for restored active question (matches plugin init flow)
    mgr2.setQuestions([{ quizId: "q1", question: "", options: [] }]);

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

  it("sendSync throttles rapid calls", async () => {
    vi.useFakeTimers();
    const mgr = createPresenter();

    // setActiveQuestion triggers the first sendSync (firstRun)
    mgr.setActiveQuestion("q1");
    const countAfterSetActive = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    ).length;
    expect(countAfterSetActive).toBeGreaterThanOrEqual(1);

    // Rapid votes — each triggers saveState → sendSync, but throttled
    resultsMessageHandler({
      quizId: "q1",
      answer: "A",
      sessionId: "v1",
    });
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
    // Should NOT have 3 more sync calls — they're throttled
    expect(countBeforeTimer - countAfterSetActive).toBeLessThanOrEqual(1);

    // Only advance past the throttle window: the keepalive timer reschedules
    // itself forever, so runAllTimers would never terminate.
    await vi.advanceTimersByTimeAsync(200);

    const countAfterTimer = vi.mocked(fetch).mock.calls.filter(
      (c) => (c[0] as string).includes("quiz-sync"),
    ).length;
    // After timer fires, one more trailing sync
    expect(countAfterTimer).toBeGreaterThan(countBeforeTimer);
  });

  it("uses custom endpoints when provided", async () => {
    const mgr = track(new PresenterQuizManager({
      wsUrl: WS_URL,
      quizGroupId: GROUP_ID,
      sessionId: SESSION_ID,
      endpoints: { sync: "/api/quiz-sync" },
    }));
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

  describe("multi-select questions", () => {
    function multiPresenter() {
      const mgr = createPresenter();
      mgr.setQuestions([
        {
          quizId: "m1",
          question: "Which have you seen?",
          type: "multi",
          options: [
            { label: "A", text: "N+1" },
            { label: "B", text: "SSRF" },
            { label: "C", text: "Rollback" },
          ],
        },
      ]);
      return mgr;
    }

    it("counts every selected option once and total as respondents", () => {
      const mgr = multiPresenter();
      resultsMessageHandler({ quizId: "m1", answer: '["A","C"]', sessionId: "v1" });
      resultsMessageHandler({ quizId: "m1", answer: '["A"]', sessionId: "v2" });

      expect(mgr.getQuizState("m1")).toEqual({ votes: { A: 2, C: 1 }, total: 2 });
    });

    it("replaces a respondent's previous selection when they resubmit", () => {
      const mgr = multiPresenter();
      resultsMessageHandler({ quizId: "m1", answer: '["A","C"]', sessionId: "v1" });
      resultsMessageHandler({ quizId: "m1", answer: '["B","C"]', sessionId: "v1" });

      expect(mgr.getQuizState("m1")).toEqual({ votes: { B: 1, C: 1 }, total: 1 });
    });

    it("treats the same selection in another order as a duplicate", () => {
      const mgr = multiPresenter();
      resultsMessageHandler({ quizId: "m1", answer: '["C","A"]', sessionId: "v1" });
      resultsMessageHandler({ quizId: "m1", answer: '["A","C","A"]', sessionId: "v1" });

      expect(mgr.getQuizState("m1")).toEqual({ votes: { A: 1, C: 1 }, total: 1 });
    });

    it("counts a bare label from an older audience page as a one-option pick", () => {
      const mgr = multiPresenter();
      resultsMessageHandler({ quizId: "m1", answer: "B", sessionId: "v1" });

      expect(mgr.getQuizState("m1")).toEqual({ votes: { B: 1 }, total: 1 });
    });

    it("warns the presenter once that an audience page is outdated", () => {
      const onError = vi.fn();
      const mgr = multiPresenter();
      mgr.onError(onError);
      resultsMessageHandler({ quizId: "m1", answer: "B", sessionId: "v1" });
      resultsMessageHandler({ quizId: "m1", answer: "A", sessionId: "v2" });

      expect(mgr.store.audienceWarning.get()).toContain("quiz.html");
      expect(onError.mock.calls.filter(([e]) => e.kind === "outdated-audience-page")).toHaveLength(1);
    });

    it("does not warn about current audience pages", () => {
      const mgr = multiPresenter();
      resultsMessageHandler({ quizId: "m1", answer: '["A"]', sessionId: "v1" });

      expect(mgr.store.audienceWarning.get()).toBeNull();
    });

    it("counts only the question's own options", () => {
      const mgr = multiPresenter();
      resultsMessageHandler({ quizId: "m1", answer: '["A","Z","<script>"]', sessionId: "v1" });

      expect(mgr.getQuizState("m1")).toEqual({ votes: { A: 1 }, total: 1 });
    });

    it("drops an answer that names none of the options and reports it", () => {
      const onError = vi.fn();
      const mgr = multiPresenter();
      mgr.onError(onError);
      resultsMessageHandler({ quizId: "m1", answer: '["Z"]', sessionId: "v1" });
      resultsMessageHandler({ quizId: "m1", answer: "[]", sessionId: "v2" });

      expect(mgr.getQuizState("m1")).toEqual({ votes: {}, total: 0 });
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls[0][0].kind).toBe("invalid-payload");
    });
  });

  describe("presenter refresh", () => {
    const questions = [{
      quizId: "q1",
      question: "?",
      type: "choice" as const,
      options: [{ label: "A", text: "a" }, { label: "B", text: "b" }],
    }];

    it("still knows who voted what, so a changed vote is not counted twice", () => {
      const before = createPresenter();
      before.setQuestions(questions);
      for (const id of ["v1", "v2", "v3"]) {
        resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: id });
      }
      before.disconnect();

      const after = createPresenter();
      after.setQuestions(questions);
      expect(after.getQuizState("q1")).toEqual({ votes: { A: 3 }, total: 3 });

      resultsMessageHandler({ quizId: "q1", answer: "B", sessionId: "v1" });
      resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v4" });
      expect(after.getQuizState("q1")).toEqual({ votes: { A: 3, B: 1 }, total: 4 });
    });
  });

  describe("answers that arrive before their question", () => {
    it("recounts a text answer once the question is known", () => {
      const mgr = createPresenter();
      resultsMessageHandler({ quizId: "t1", answer: " Rails ", sessionId: "v1" });
      mgr.setQuestions([{ quizId: "t1", question: "?", type: "text", options: [] }]);
      resultsMessageHandler({ quizId: "t1", answer: "rails", sessionId: "v2" });

      expect(mgr.getQuizState("t1")).toEqual({ votes: { rails: 2 }, total: 2 });
    });

    it("recounts a multi-select answer once the question is known", () => {
      const mgr = createPresenter();
      resultsMessageHandler({ quizId: "m1", answer: '["A","B"]', sessionId: "v1" });
      resultsMessageHandler({ quizId: "m1", answer: '["Z"]', sessionId: "v2" });
      mgr.setQuestions([{
        quizId: "m1",
        question: "?",
        type: "multi",
        options: [{ label: "A", text: "a" }, { label: "B", text: "b" }],
      }]);

      expect(mgr.getQuizState("m1")).toEqual({ votes: { A: 1, B: 1 }, total: 1 });
    });

    it("recounts when a question's type changes", () => {
      const mgr = createPresenter();
      const options = [{ label: "A", text: "a" }, { label: "B", text: "b" }];
      mgr.setQuestions([{ quizId: "m1", question: "?", type: "choice", options }]);
      resultsMessageHandler({ quizId: "m1", answer: '["A","B"]', sessionId: "v1" });
      mgr.setQuestions([{ quizId: "m1", question: "?", type: "multi", options }]);

      expect(mgr.getQuizState("m1")).toEqual({ votes: { A: 1, B: 1 }, total: 1 });
    });
  });

  it("defaults to no normalization for unknown quizId", () => {
    const mgr = createPresenter();
    // No questions set — unknown quizId defaults to "choice" (no normalization)
    resultsMessageHandler({ quizId: "unknown", answer: "React", sessionId: "v1" });

    expect(mgr.getQuizState("unknown").votes).toEqual({ React: 1 });
  });
});

describe("QuizManager — Participant mode", () => {
  it("creates cable with 5-min history window", () => {
    const { createCable: cc } = anycableWeb;
    const before = Date.now();
    createParticipant();
    const call = vi.mocked(cc).mock.calls.at(-1)!;
    const ts = call[1].protocolOptions.historyTimestamp;
    const expected = Math.floor((before - 5 * 60_000) / 1000);
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

  it("submitAnswer allows changing to a different answer", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    vi.mocked(fetch).mockClear();

    const ok = await mgr.submitAnswer("q1", "B");
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalled();
    expect(mgr.getVotedAnswer("q1")).toBe("B");
  });

  it("submitAnswer returns false if submitting same answer", async () => {
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    vi.mocked(fetch).mockClear();

    const ok = await mgr.submitAnswer("q1", "A");
    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
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
    vi.useFakeTimers();
    const mgr = createParticipant();
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q2",
      results: { q2: { votes: { A: 3 }, total: 3 } },
    });
    vi.advanceTimersByTime(100);

    const state = mgr.getState();
    expect(state.activeQuestionId).toBe("q2");
    expect(state.results.q2.total).toBe(3);
  });

  it("accumulates questions from sync payloads", () => {
    vi.useFakeTimers();
    const mgr = createParticipant();
    expect(mgr.getState().questions).toEqual([]);

    const q1 = { quizId: "q1", question: "Fav color?", options: [{ label: "A", text: "Red" }] };
    const q2 = { quizId: "q2", question: "Fav food?", options: [{ label: "A", text: "Pizza" }] };

    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: {},
      question: q1,
      questionIndex: 0,
      totalCount: 2,
    });
    vi.advanceTimersByTime(100);
    expect(mgr.getState().questions).toEqual([q1]);
    expect(mgr.getState().questionIndex).toBe(0);
    expect(mgr.getState().totalCount).toBe(2);

    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q2",
      results: {},
      question: q2,
      questionIndex: 1,
      totalCount: 2,
    });
    vi.advanceTimersByTime(200);

    expect(mgr.getState().questions).toEqual([q1, q2]);
    expect(mgr.getState().questionIndex).toBe(1);
  });

  it("a burst of sync messages (such as a history replay) applies only its last one", () => {
    vi.useFakeTimers();
    const mgr = createParticipant();
    const ids: (string | null)[] = [];
    mgr.store.activeQuestionId.subscribe(id => ids.push(id));

    // History replays oldest first; none of the older states may show
    for (const id of ["q1", "q2", "q3"]) {
      syncMessageHandler({ sessionId: "p", activeQuestionId: id, results: {} });
    }
    expect(ids).toEqual([null]);

    vi.advanceTimersByTime(100);
    expect(ids).toEqual([null, "q3"]);
  });

  it("reset detection: clears submitted answer when totals drop to 0", async () => {
    vi.useFakeTimers();
    const mgr = createParticipant();
    await mgr.submitAnswer("q1", "A");
    expect(mgr.hasVoted("q1")).toBe(true);

    // Simulate a sync where q1 totals reset to 0
    syncMessageHandler({
      sessionId: "presenter-123",
      activeQuestionId: "q1",
      results: { q1: { votes: {}, total: 0 } },
    });
    vi.advanceTimersByTime(100);

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
    const mgr = track(new ParticipantQuizManager({
      wsUrl: WS_URL,
      quizGroupId: GROUP_ID,
      sessionId: SESSION_ID,
      endpoints: { answer: "/api/quiz-answer" },
    }));
    await mgr.submitAnswer("q1", "A");

    expect(fetch).toHaveBeenCalledWith(
      "/api/quiz-answer",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sync without question preserves previously received questions", () => {
    vi.useFakeTimers();
    const mgr = createParticipant();
    const q1 = { quizId: "q1", question: "Fav?", options: [{ label: "A", text: "Yes" }] };

    // First sync delivers question
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q1",
      results: {},
      question: q1,
      questionIndex: 0,
      totalCount: 1,
    });
    vi.advanceTimersByTime(100);
    expect(mgr.getState().questions).toEqual([q1]);

    // Second sync without question field — should NOT wipe it
    syncMessageHandler({
      sessionId: "p",
      activeQuestionId: "q1",
      results: { q1: { votes: { A: 1 }, total: 1 } },
    });
    vi.advanceTimersByTime(100);
    expect(mgr.getState().questions).toEqual([q1]);
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
    vi.useFakeTimers();
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
    vi.advanceTimersByTime(100);

    expect(mgr.hasVoted("q1")).toBe(false);
    expect(mgr.hasVoted("q2")).toBe(true);
    expect(mgr.getVotedAnswer("q2")).toBe("B");
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

  it("accepts sync payload with question", () => {
    expect(
      isValidSyncPayload({
        sessionId: "abc",
        activeQuestionId: "q1",
        results: {},
        question: { quizId: "q1", question: "Fav?", options: [{ label: "A", text: "Yes" }] },
        questionIndex: 0,
        totalCount: 1,
      }),
    ).toBe(true);
  });

  it("accepts sync payload without question", () => {
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
    const a = track(getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g1" }));
    const b = track(getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g1" }));
    expect(a).toBe(b);
  });

  it("returns different instances for different quizGroupIds", () => {
    const a = track(getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g2" }));
    const b = track(getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "g3" }));
    expect(a).not.toBe(b);
  });
});

describe("Singleton — getQuizParticipant", () => {
  it("returns same instance for same quizGroupId", () => {
    const a = track(getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p1" }));
    const b = track(getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p1" }));
    expect(a).toBe(b);
  });

  it("returns different instances for different quizGroupIds", () => {
    const a = track(getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p2" }));
    const b = track(getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "p3" }));
    expect(a).not.toBe(b);
  });

  it("participant and presenter singletons are independent", () => {
    const participant = track(getQuizParticipant({ wsUrl: WS_URL, quizGroupId: "shared" }));
    const presenter = track(getQuizPresenter({ wsUrl: WS_URL, quizGroupId: "shared" }));
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

describe("Error reporting — onError hook", () => {
  it("config.onError receives answer failures with context", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));
    const onError = vi.fn();
    const mgr = track(new ParticipantQuizManager({
      wsUrl: WS_URL,
      quizGroupId: GROUP_ID,
      sessionId: SESSION_ID,
      onError,
    }));
    await mgr.submitAnswer("q1", "A");

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0];
    expect(err.kind).toBe("answer");
    expect(err.context).toMatchObject({ quizId: "q1", quizGroupId: GROUP_ID });
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("reports non-ok answer responses with the status as cause", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const onError = vi.fn();
    const mgr = createParticipant();
    mgr.onError(onError);
    await mgr.submitAnswer("q1", "A");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "answer", cause: 500 }),
    );
  });

  it("manager.onError returns an unsubscribe function", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
    const onError = vi.fn();
    const mgr = createParticipant();
    const off = mgr.onError(onError);
    off();
    await mgr.submitAnswer("q1", "A");
    expect(onError).not.toHaveBeenCalled();
  });

  it("presenter reports every sync failure, banner appears after the second", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    const onError = vi.fn();
    const mgr = createPresenter();
    mgr.onError(onError);

    mgr.setActiveQuestion("q1");
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].kind).toBe("sync");
    expect(onError.mock.calls[0][0].cause).toBe(404);
    expect(mgr.store.syncError.get()).toBeNull();

    // While the endpoint fails, attempts are at least a second apart
    mgr.setActiveQuestion("q2");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(mgr.store.syncError.get()).toContain("not found");
  });

  it("a throwing handler does not break other handlers", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => { throw new Error("boom"); });
    const good = vi.fn();
    const mgr = createParticipant();
    mgr.onError(bad);
    mgr.onError(good);
    await mgr.submitAnswer("q1", "A");
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it("reports invalid payloads in dev builds", () => {
    const onError = vi.fn();
    const mgr = createPresenter();
    mgr.onError(onError);
    resultsMessageHandler({ garbage: true });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "invalid-payload" }),
    );
    expect(mgr.getQuizState("q1").total).toBe(0);
  });
});

describe("Connection monitoring", () => {
  it("starts as connecting and flips to connected on the connect event", () => {
    const mgr = createPresenter();
    expect(mgr.store.connection.get()).toBe("connecting");
    emitCable("connect");
    expect(mgr.store.connection.get()).toBe("connected");
    expect(mgr.store.connectionError.get()).toBeNull();
  });

  it("short disconnects stay invisible", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const mgr = createPresenter();
    mgr.onError(onError);

    emitCable("disconnect", { reason: "network" });
    expect(mgr.store.connection.get()).toBe("disconnected");
    vi.advanceTimersByTime(2000);
    emitCable("connect");
    vi.advanceTimersByTime(10_000);

    expect(mgr.store.connectionError.get()).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces a connection error after the grace period", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const mgr = createPresenter();
    mgr.onError(onError);

    emitCable("disconnect", { reason: "dns_failure" });
    vi.advanceTimersByTime(5000);

    expect(mgr.store.connectionError.get()).toContain(WS_URL);
    expect(mgr.store.connectionError.get()).toContain("dns_failure");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "connection",
        context: expect.objectContaining({ wsUrl: WS_URL, status: "disconnected" }),
      }),
    );
  });

  it("close (server refused) uses the closed wording and clears on reconnect", () => {
    vi.useFakeTimers();
    const mgr = createParticipant();

    emitCable("close", { reason: "unauthorized" });
    vi.advanceTimersByTime(5000);
    expect(mgr.store.connection.get()).toBe("closed");
    expect(mgr.store.connectionError.get()).toContain("closed the connection");

    emitCable("connect");
    expect(mgr.store.connectionError.get()).toBeNull();
    expect(mgr.store.connection.get()).toBe("connected");
  });

  it("disconnect() cancels a pending grace timer", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const mgr = createPresenter();
    mgr.onError(onError);
    emitCable("disconnect", { reason: "network" });
    mgr.disconnect();
    vi.advanceTimersByTime(10_000);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("syncFailureHint", () => {
  it("points Netlify-default endpoints at the Vercel config on 404", () => {
    expect(syncFailureHint(404, "/.netlify/functions/quiz-sync")).toContain("/api/quiz-sync");
    expect(syncFailureHint(404, "/api/quiz-sync")).not.toContain("On Vercel");
  });

  it("names the cause for 400 and 502", () => {
    expect(syncFailureHint(400, "/api/quiz-sync")).toContain("older than the deck");
    expect(syncFailureHint(502, "/api/quiz-sync")).toContain("ANYCABLE_BROADCAST_URL");
  });
});

describe("Sync delivery and recovery", () => {
  // Stands in for the sync function plus AnyCable: a successful POST delivers
  // the fields the deployed function forwards to the phone's sync handler.
  // Each request takes the next behavior from `plan`, then `fallback`.
  type Behavior = "ok" | "drop" | "reject" | "502" | "hang" | "slow";
  function relay(fallback: Behavior = "ok") {
    const plan: Behavior[] = [];
    const sent: Record<string, unknown>[] = [];
    let deliver: MessageHandler | undefined;
    let inFlight = 0;
    let maxInFlight = 0;
    const late: (() => void)[] = [];
    const forward = (body: Record<string, unknown>) => {
      const { quizGroupId: _, ...broadcast } = body;
      deliver?.(broadcast);
    };
    vi.mocked(fetch).mockImplementation((async (url: string, init: RequestInit) => {
      if (!url.includes("quiz-sync")) return { ok: true } as Response;
      const body = JSON.parse(init.body as string);
      sent.push(body);
      const behavior = plan.shift() ?? fallback;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        switch (behavior) {
          case "ok": forward(body); return { ok: true } as Response;
          case "drop": return { ok: true } as Response; // accepted, never reaches the phone
          case "502": return { ok: false, status: 502 } as Response;
          case "reject": throw new TypeError("Failed to fetch");
          case "slow": await new Promise((r) => setTimeout(r, 1_000)); forward(body); return { ok: true } as Response;
          case "hang":
            // The client gives up; the function keeps running and may broadcast later
            late.push(() => forward(body));
            return await new Promise<Response>((_, reject) => {
              init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            });
        }
      } finally {
        inFlight--;
      }
    }) as typeof fetch);
    return {
      plan,
      sent,
      connect(handler: MessageHandler) { deliver = handler; },
      get maxInFlight() { return maxInFlight; },
      finishHungRequests() { for (const f of late.splice(0)) f(); },
    };
  }

  const Q1 = { quizId: "q1", question: "Fav color?", options: [{ label: "A", text: "Red" }, { label: "B", text: "Blue" }] };
  const Q2 = { quizId: "q2", question: "Fav food?", options: [{ label: "A", text: "Pizza" }] };

  function presenterOnResultsSlide() {
    const presenter = createPresenter("presenter-tab");
    const presenterPresence = syncPresenceHandler;
    presenter.setQuestions([Q1, Q2]);
    presenter.setActiveQuestion("q1");
    return { presenter, presenterPresence };
  }

  function phone(sessionId = "phone") {
    const p = createParticipant(sessionId);
    return { participant: p, handler: syncMessageHandler };
  }

  beforeEach(() => vi.useFakeTimers());

  it("a late phone that receives no history gets the open question from presence, without new votes", async () => {
    const net = relay();
    const { presenter, presenterPresence } = presenterOnResultsSlide();
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "B", sessionId: "v2" });
    await vi.advanceTimersByTimeAsync(1_000);

    const { participant, handler } = phone();
    net.connect(handler);
    expect(participant.store.activeQuestionId.get()).toBeNull();

    mockPresence.info.mockResolvedValue({ phone: { id: "phone" } });
    await presenterPresence({ type: "join", id: "phone" });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(participant.store.activeQuestionId.get()).toBe("q1");
    expect(participant.getQuizState("q1").total).toBe(2);
    expect(presenter.getQuizState("q1").total).toBe(2);
  });

  it("a phone that misses history and presence still gets the question while the presenter stays put", async () => {
    const net = relay();
    presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);

    const { participant, handler } = phone();
    net.connect(handler);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(participant.store.activeQuestionId.get()).toBe("q1");
  });

  it("keeps re-sending through several quiet minutes on a results slide", async () => {
    const net = relay();
    presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);
    const before = net.sent.length;

    // Stream history lasts five minutes; a send every minute keeps it fresh
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(net.sent.length - before).toBeGreaterThanOrEqual(4);
    expect(net.sent.slice(before).every((p) => p.activeQuestionId === "q1")).toBe(true);

    // A phone joining at minute four, with no history, still catches up
    const { participant, handler } = phone();
    net.connect(handler);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(participant.store.activeQuestionId.get()).toBe("q1");
  });

  it("recovers after the sync endpoint fails from startup, without navigation", async () => {
    const net = relay("reject");
    const { participant, handler } = phone();
    net.connect(handler);
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(participant.store.activeQuestionId.get()).toBeNull();
    expect(presenter.store.syncError.get()).not.toBeNull();

    // HTTP comes back; nobody touches the deck
    vi.mocked(fetch).mockClear();
    const healthy = relay("ok");
    healthy.connect(handler);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(participant.store.activeQuestionId.get()).toBe("q1");
    expect(presenter.store.syncError.get()).toBeNull();
  });

  it("retries a failed (non-2xx) broadcast of leaving the question until the phone is back on Waiting", async () => {
    const net = relay();
    const { participant, handler } = phone();
    net.connect(handler);
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(participant.store.activeQuestionId.get()).toBe("q1");

    net.plan.push("502", "502");
    presenter.clearActiveQuestion();
    await vi.advanceTimersByTimeAsync(500);
    expect(participant.store.activeQuestionId.get()).toBe("q1");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(participant.store.activeQuestionId.get()).toBeNull();
  });

  it("a retry sends the latest state, never the question the presenter already left", async () => {
    const net = relay();
    const { participant, handler } = phone();
    net.connect(handler);
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);

    net.plan.push("reject");
    presenter.setActiveQuestion("q2");
    await vi.advanceTimersByTimeAsync(10);
    presenter.clearActiveQuestion();
    await vi.advanceTimersByTimeAsync(5_000);

    const afterFailure = net.sent.slice(net.sent.findIndex((p) => p.activeQuestionId === "q2") + 1);
    expect(afterFailure.length).toBeGreaterThan(0);
    expect(afterFailure.every((p) => p.activeQuestionId === null)).toBe(true);
    expect(participant.store.activeQuestionId.get()).toBeNull();
  });

  it("aborts a hung request, retries with fresh state, and ignores the hung broadcast when it lands late", async () => {
    const net = relay();
    const { participant, handler } = phone();
    net.connect(handler);
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);

    net.plan.push("hang");
    presenter.setActiveQuestion("q2");
    await vi.advanceTimersByTimeAsync(10);
    presenter.clearActiveQuestion();
    // Nothing else is sent while the request hangs
    await vi.advanceTimersByTimeAsync(5_000);
    expect(net.sent.at(-1)!.activeQuestionId).toBe("q2");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(net.sent.at(-1)!.activeQuestionId).toBeNull();
    expect(participant.store.activeQuestionId.get()).toBeNull();

    // The hung function finally broadcasts its stale "q2"
    net.finishHungRequests();
    await vi.advanceTimersByTimeAsync(500);
    expect(participant.store.activeQuestionId.get()).toBeNull();
    expect(net.maxInFlight).toBe(1);
  });

  it("never overlaps requests, and sustained votes cannot starve the broadcast", async () => {
    const net = relay("slow");
    const { participant, handler } = phone();
    net.connect(handler);
    presenterOnResultsSlide();

    // A vote every 100ms for 10 seconds
    for (let i = 0; i < 100; i++) {
      resultsMessageHandler({ quizId: "q1", answer: i % 2 ? "A" : "B", sessionId: `v${i}` });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(net.maxInFlight).toBe(1);
    // Roughly one broadcast per 1.2s round trip, not one at the end
    expect(net.sent.length).toBeGreaterThanOrEqual(7);
    expect(participant.getQuizState("q1").total).toBeGreaterThanOrEqual(75);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(participant.getQuizState("q1").total).toBe(100);
  });

  it("resends the current state when the presenter's connection comes back", async () => {
    const net = relay();
    presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);
    const { participant, handler } = phone();
    net.connect(handler);

    emitCable("disconnect");
    emitCable("connect");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(participant.store.activeQuestionId.get()).toBe("q1");
  });

  it("a room of phones joining at once shares one resend, and phones leaving trigger none", async () => {
    const net = relay();
    const { presenterPresence } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(5_000);
    const before = net.sent.length;

    // One now, and one more for the phones that joined while it was in flight
    for (let i = 0; i < 50; i++) await presenterPresence({ type: "join", id: `p${i}` });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(net.sent.length - before).toBe(2);

    for (let i = 0; i < 50; i++) await presenterPresence({ type: "leave", id: `p${i}` });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(net.sent.length - before).toBe(2);
  });

  it("broadcast numbers keep increasing after the presenter reloads, whatever the clock does", async () => {
    const net = relay();
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);
    const lastSeq = net.sent.at(-1)!.seq as number;
    presenter.disconnect();

    vi.setSystemTime(Date.now() - 10 * 60_000); // the laptop clock jumped back
    const reloaded = createPresenter("presenter-tab");
    reloaded.setQuestions([Q1, Q2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(net.sent.at(-1)!.activeQuestionId).toBe("q1");
    expect(net.sent.at(-1)!.seq as number).toBeGreaterThan(lastSeq);
  });

  it("a phone that was offline when the presenter left the question returns to Waiting after it reconnects", async () => {
    const net = relay();
    const { participant, handler } = phone();
    net.connect(handler);
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(participant.store.activeQuestionId.get()).toBe("q1");

    // The leave broadcast never reaches this phone, and its presence does not change
    net.plan.push("drop");
    presenter.clearActiveQuestion();
    await vi.advanceTimersByTimeAsync(500);
    expect(participant.store.activeQuestionId.get()).toBe("q1");

    await vi.advanceTimersByTimeAsync(65_000);
    expect(participant.store.activeQuestionId.get()).toBeNull();
  });

  it("disconnect cancels the keepalive, pending retries and the request in flight", async () => {
    const net = relay("hang");
    const { presenter } = presenterOnResultsSlide();
    await vi.advanceTimersByTimeAsync(100);
    const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
    const sentBefore = net.sent.length;

    presenter.disconnect();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(net.sent.length).toBe(sentBefore);
  });

  it("vote deduplication and changed answers survive the new delivery path", async () => {
    const net = relay();
    const { participant, handler } = phone();
    net.connect(handler);
    presenterOnResultsSlide();
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "B", sessionId: "v1" });
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v2" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(participant.getQuizState("q1")).toEqual({ votes: { A: 1, B: 1 }, total: 2 });
  });
});

describe("Participant — broadcast ordering", () => {
  beforeEach(() => vi.useFakeTimers());

  it("drops a broadcast older than one already applied from the same presenter tab", async () => {
    const mgr = createParticipant();
    syncMessageHandler({ sessionId: "p", activeQuestionId: null, results: {}, seq: 2 });
    syncMessageHandler({ sessionId: "p", activeQuestionId: "q1", results: {}, seq: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(mgr.store.activeQuestionId.get()).toBeNull();
  });

  it("accepts broadcasts without seq (older functions) and from another presenter tab", async () => {
    const mgr = createParticipant();
    syncMessageHandler({ sessionId: "p", activeQuestionId: null, results: {}, seq: 5 });
    await vi.advanceTimersByTimeAsync(500);
    syncMessageHandler({ sessionId: "p", activeQuestionId: "q1", results: {} });
    await vi.advanceTimersByTimeAsync(500);
    expect(mgr.store.activeQuestionId.get()).toBe("q1");
    syncMessageHandler({ sessionId: "other", activeQuestionId: "q2", results: {}, seq: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(mgr.store.activeQuestionId.get()).toBe("q2");
  });

  it("a steady stream of broadcasts is applied while it continues", async () => {
    const mgr = createParticipant();
    for (let i = 1; i <= 50; i++) {
      syncMessageHandler({ sessionId: "p", activeQuestionId: `q${i}`, results: {}, seq: i });
      await vi.advanceTimersByTimeAsync(150);
    }
    // Throttled, but never more than one window behind
    expect(Number(mgr.store.activeQuestionId.get()!.slice(1))).toBeGreaterThanOrEqual(49);
  });
});

describe("Deck windows that never showed a question", () => {
  it("never broadcast, so a second tab or an attendee reading the slides cannot send phones back to Waiting", async () => {
    vi.useFakeTimers();
    const syncCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("quiz-sync"));
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    const reader = createPresenter("reader-tab");
    const readerPresence = syncPresenceHandler;
    reader.setQuestions([{ quizId: "q1", question: "Fav color?", options: [{ label: "A", text: "Red" }] }]);
    resultsMessageHandler({ quizId: "q1", answer: "A", sessionId: "v1" });
    await readerPresence({ type: "join", id: "phone" });
    emitCable("connect");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(syncCalls()).toHaveLength(0);

    // Once it shows a question it is the presenter, and keeps phones current
    reader.setActiveQuestion("q1");
    reader.clearActiveQuestion();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(syncCalls().at(-1)?.[1]?.body).toContain('"activeQuestionId":null');
    expect(syncCalls().length).toBeGreaterThanOrEqual(2);
  });
});

describe("Reconnect backoff", () => {
  it("both roles retry within a second at first and never wait more than 3 seconds", () => {
    createPresenter();
    createParticipant("phone");
    for (const call of vi.mocked(createCable).mock.calls.slice(-2)) {
      const strategy = call[1]!.reconnectStrategy!;
      for (let attempt = 0; attempt < 20; attempt++) {
        const delay = strategy(attempt);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(3_000);
      }
      expect(strategy(0)).toBeLessThanOrEqual(1_000);
      // Jittered, so a room of phones does not reconnect in lockstep
      expect(strategy(10)).toBeGreaterThanOrEqual(1_500);
    }
  });
});

describe("Connection log", () => {
  it("tells a phone's connection story in one prefixed line per event", async () => {
    vi.useFakeTimers();
    const logged: string[] = [];
    const record = (line: unknown) => { logged.push(String(line)); };
    vi.spyOn(console, "info").mockImplementation(record);
    vi.spyOn(console, "warn").mockImplementation(record);
    createParticipant("phone");
    const strategy = vi.mocked(createCable).mock.calls.at(-1)![1]!.reconnectStrategy!;
    const lines = () => logged.filter((l) => l.startsWith("[slide-quiz:connection]"));

    emitCable("connect", { reconnect: false, restored: false });
    // The client asks for the delay before it reports the disconnect
    strategy(0);
    emitCable("disconnect", { reason: "stale_connection" });
    await Promise.resolve();
    vi.advanceTimersByTime(2_500);
    emitCable("connect", { reconnect: true, restored: false });

    expect(lines()).toEqual([
      expect.stringMatching(/connected in /),
      "[slide-quiz:connection] lost (stale_connection)",
      expect.stringMatching(/^\[slide-quiz:connection\] reconnect attempt 1 in 0\.\d+s$/),
      "[slide-quiz:connection] reconnected after 2.5s offline (new session)",
    ]);
  });
});
