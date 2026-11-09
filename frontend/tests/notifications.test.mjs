import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// 기존 TypeScript만 사용해 순수 상태/이동 로직을 테스트한다. 추가 패키지 설치 없음.
function sourceUrl(name, dependencies = {}) {
  const source = readFileSync(new URL(`../src/features/notifications/${name}.ts`, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  for (const [path, url] of Object.entries(dependencies)) outputText = outputText.replaceAll(`from "${path}"`, `from "${url}"`);
  return "data:text/javascript;base64," + Buffer.from(outputText).toString("base64");
}
const typesUrl = sourceUrl("types");
const { notificationDestination } = await import(typesUrl);
const { navigateFromNotification } = await import(sourceUrl("navigate", { "./types": typesUrl }));
const { createNotificationApi } = await import(sourceUrl("api"));
const { createNotificationStore } = await import(sourceUrl("store"));
const { notificationDate, notificationText } = await import(sourceUrl("text"));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const row = (id = 1, kind = "message_created") => ({
  id, kind, match_id: 14, message_id: id, created_at: "2026-11-09T00:00:00", read_at: null,
});

function harness(t, rows = [row()]) {
  const calls = { list: [], count: [], read: [] };
  const api = {
    list: async (uid, signal, before) => {
      calls.list.push({ uid, signal, before });
      return rows.filter((r) => before === undefined || r.id < before).slice(0, 50).map((r) => ({ ...r }));
    },
    count: async (uid, signal) => {
      calls.count.push({ uid, signal });
      return rows.filter((r) => r.read_at === null).length;
    },
    read: async (uid, id, signal) => {
      calls.read.push({ uid, id, signal });
      rows.find((r) => r.id === id).read_at = "2026-11-09T00:01:00";
    },
  };
  const store = createNotificationStore(27, api, 60_000);
  t.after(() => store.stop());
  return { api, store, calls, rows };
}

test("API fixes the account header, forwards cancellation and uses cursor pagination", async () => {
  const calls = [];
  const api = createNotificationApi(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.includes("unread-count") ? { count: 7 } : url.includes("/read") ? { ok: true } : [row()]));
  });
  const controller = new AbortController();
  await api.list(27, controller.signal, 101);
  assert.equal(await api.count(27, controller.signal), 7);
  await api.read(27, 101, controller.signal);
  assert.equal(calls[0].url, "/api/notifications?limit=50&before_id=101");
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[2].url, "/api/notifications/101/read");
  for (const call of calls) {
    assert.equal(call.init.headers["X-User-Id"], "27");
    assert.equal(call.init.signal, controller.signal);
  }
});

test("API failures are errors rather than empty notification lists", async () => {
  const api = createNotificationApi(async () => new Response("failed", { status: 503 }));
  await assert.rejects(api.list(1, new AbortController().signal), /503/);
});

test("chat events open only the matching confirmed conversation", () => {
  for (const kind of ["message_created", "match_confirmed"]) {
    assert.deepEqual(notificationDestination(row(1, kind), [{ id: 14, status: "confirmed" }]), { tab: "chat", matchId: 14 });
    for (const matches of [[], [{ id: 14, status: "proposed" }], [{ id: 99, status: "confirmed" }]]) {
      assert.deepEqual(notificationDestination(row(1, kind), matches), { tab: "rec", unavailable: true });
    }
  }
  for (const kind of ["match_proposed", "match_accepted", "match_rejected", "match_cancelled", "match_expired", "future_event"]) {
    assert.deepEqual(notificationDestination(row(1, kind), [{ id: 14, status: "confirmed" }]), { tab: "rec", unavailable: false });
  }
});

function navigationContext() {
  const actions = [];
  const context = {
    userId: 27, currentUserId: () => 27,
    loadMatches: async () => [{ id: 14, status: "confirmed" }],
    onMatches: (matches) => actions.push(["matches", matches]),
    onChat: (id) => actions.push(["chat", id]),
    onRecommendations: () => actions.push(["rec"]),
    onUnavailable: () => actions.push(["unavailable"]),
  };
  return { actions, context };
}

test("navigation refreshes server state before opening the requested chat", async () => {
  const { actions, context } = navigationContext();
  await navigateFromNotification(row(), context);
  assert.deepEqual(actions.map((action) => action[0]), ["matches", "chat"]);
  assert.equal(actions[1][1], 14);
});

test("an ended conversation returns to recommendations and reports unavailability", async () => {
  const { actions, context } = navigationContext();
  context.loadMatches = async () => [];
  await navigateFromNotification(row(), context);
  assert.deepEqual(actions.map((action) => action[0]), ["matches", "rec", "unavailable"]);
});

test("navigation started for the previous user never updates the new user's screen", async () => {
  const { actions, context } = navigationContext();
  const pending = deferred();
  let uid = 27;
  context.currentUserId = () => uid;
  context.loadMatches = () => pending.promise;
  const navigating = navigateFromNotification(row(), context);
  uid = 1;
  pending.resolve([{ id: 14, status: "confirmed" }]);
  await navigating;
  assert.deepEqual(actions, []);
  let fetched = false;
  context.loadMatches = async () => { fetched = true; return []; };
  await navigateFromNotification(row(), context);
  assert.equal(fetched, false);
});

test("navigation errors propagate so the panel can stay open for retry", async () => {
  const { actions, context } = navigationContext();
  context.loadMatches = async () => { throw new Error("offline"); };
  await assert.rejects(navigateFromNotification(row(), context), /offline/);
  assert.deepEqual(actions, []);
});

test("initial polling requests only count; opening fetches list without marking read", async (t) => {
  const { store, calls } = harness(t);
  store.start();
  await tick();
  assert.equal(store.getSnapshot().unreadCount, 1);
  assert.equal(calls.list.length, 0);
  store.setOpen(true);
  await tick();
  assert.equal(store.getSnapshot().items.length, 1);
  store.setOpen(false);
  assert.equal(calls.read.length, 0);
  assert.equal(store.getSnapshot().unreadCount, 1);
});

test("read changes apply after success and an old item cannot decrement the badge twice", async (t) => {
  const { store, calls } = harness(t);
  store.start(); store.setOpen(true);
  await tick();
  const original = store.getSnapshot().items[0];
  assert.equal(await store.markRead(original), true);
  await tick();
  assert.equal(store.getSnapshot().unreadCount, 0);
  assert.ok(store.getSnapshot().items[0].read_at);
  assert.equal(await store.markRead(original), true);
  assert.equal(calls.read.length, 1);
  assert.equal(store.getSnapshot().unreadCount, 0);
});

test("failed read keeps unread state and permits retry", async (t) => {
  const { store, api } = harness(t);
  store.start(); store.setOpen(true);
  await tick();
  api.read = async () => { throw new Error("offline"); };
  assert.equal(await store.markRead(row()), false);
  assert.equal(store.getSnapshot().unreadCount, 1);
  assert.equal(store.getSnapshot().items[0].read_at, null);
  assert.equal(store.getSnapshot().pendingId, null);
  assert.equal(store.getSnapshot().error, "read");
});

test("overlapping read actions issue one server write", async (t) => {
  const { store, api } = harness(t);
  store.start(); store.setOpen(true);
  await tick();
  const pending = deferred();
  let writes = 0;
  api.read = () => { writes += 1; return pending.promise; };
  const first = store.markRead(row());
  assert.equal(await store.markRead(row()), false);
  pending.resolve();
  assert.equal(await first, true);
  assert.equal(writes, 1);
});

test("stopping cancels old user requests and ignores even noncooperative late responses", async (t) => {
  const { store, api } = harness(t);
  const pending = deferred();
  let signal;
  api.count = async (_uid, controllerSignal) => { signal = controllerSignal; return pending.promise; };
  store.start();
  store.stop();
  assert.equal(signal.aborted, true);
  pending.resolve(99);
  await tick();
  assert.equal(store.getSnapshot().unreadCount, null);
});

test("read finishing after user switch cannot trigger navigation", async (t) => {
  const { store, api } = harness(t);
  store.start(); store.setOpen(true);
  await tick();
  const pending = deferred();
  let signal;
  api.read = (_uid, _id, controllerSignal) => { signal = controllerSignal; return pending.promise; };
  const reading = store.markRead(row());
  store.stop();
  pending.resolve();
  assert.equal(await reading, false);
  assert.equal(signal.aborted, true);
});

test("a stale refresh cannot overwrite the result of a read", async (t) => {
  const { store, api } = harness(t);
  store.start(); store.setOpen(true);
  await tick();
  const pending = deferred();
  const realList = api.list;
  api.list = () => pending.promise;
  const refreshing = store.refresh();
  api.list = realList;
  await store.markRead(row());
  pending.resolve([row()]);
  await refreshing;
  await tick();
  assert.ok(store.getSnapshot().items[0].read_at);
  assert.equal(store.getSnapshot().unreadCount, 0);
});

test("pagination deduplicates and refreshes all opened pages including chat-read changes", async (t) => {
  const rows = Array.from({ length: 55 }, (_, index) => row(55 - index));
  const { store, calls } = harness(t, rows);
  store.start(); store.setOpen(true);
  await tick();
  assert.equal(store.getSnapshot().items.length, 50);
  assert.equal(store.getSnapshot().hasMore, true);
  await store.loadMore();
  assert.equal(calls.list.at(-1).before, 6);
  assert.equal(store.getSnapshot().items.length, 55);
  assert.equal(new Set(store.getSnapshot().items.map((r) => r.id)).size, 55);
  assert.equal(store.getSnapshot().hasMore, false);
  rows.at(-1).read_at = "2026-11-09T01:00:00";
  await store.refresh();
  assert.equal(store.getSnapshot().items.length, 55);
  assert.ok(store.getSnapshot().items.at(-1).read_at);
  assert.equal(store.getSnapshot().unreadCount, 54);
});

test("refresh failure keeps the current list and supports a successful retry", async (t) => {
  const { store, api } = harness(t);
  store.start(); store.setOpen(true);
  await tick();
  const realList = api.list;
  api.list = async () => { throw new Error("offline"); };
  await store.refresh();
  assert.equal(store.getSnapshot().items.length, 1);
  assert.equal(store.getSnapshot().error, "refresh");
  api.list = realList;
  await store.refresh();
  assert.equal(store.getSnapshot().error, null);
});

test("StrictMode stop/start discards stale requests and resumes with clean state", async (t) => {
  const { store } = harness(t);
  store.start(); store.stop(); store.start();
  await tick();
  assert.equal(store.getSnapshot().unreadCount, 1);
  assert.equal(store.getSnapshot().loading, false);
});

test("UTC timestamps with and without a timezone suffix format identically", () => {
  for (const lang of ["ko", "en", "ja", "zh", "vi"]) {
    assert.equal(notificationDate("2026-11-09T00:00:00", lang), notificationDate("2026-11-09T00:00:00Z", lang));
    assert.equal(notificationDate("2026-11-09T09:00:00+09:00", lang), notificationDate("2026-11-09T00:00:00Z", lang));
    assert.equal(notificationDate("invalid", lang), "");
    assert.ok(notificationText(lang, "count", 12).includes("12"));
    assert.ok(notificationText(lang, "future_event"));
  }
});
