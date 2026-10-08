import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { WorkspaceHubStore, hubChatKey } from "../src/workspace-hub-store.js";
import { HUB_WINDOW_TTL_MS, type HubChatFrame, type HubWindow, type HubWorkspace } from "../src/workspace-hub-types.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
// Literal file: hrefs: pathToFileURL("/projects/a") is not portable to win32,
// and the store only requires the file: scheme.
const workspace = (name: string): HubWorkspace => ({ id: hash(name), name, uri: `file:///projects/${name}`, kind: "folder", folders: [] });
const uri = (id: string) => `vscode-chat-session://local/${Buffer.from(id).toString("base64url")}`;
function frame(id = "chat-1", sequence = 1, text = "reply", generation?: string): HubChatFrame {
  return { sessionId: id, sessionResource: uri(id), sequence, generation, serialized: JSON.stringify({ version: 3, sessionId: id, creationDate: 100, inputState: { text: "UNSENT_DRAFT" }, pendingRequests: [{ prompt: "NEVER_REPLAY" }], requests: [{ requestId: "request-1", message: { text: "hello" }, response: [{ kind: "markdownContent", content: { value: text } }], timestamp: 100, responseTimestamp: 101 }] }) };
}
async function setup(t: TestContext, sameWorkspace = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shuncode-hub-test-"));
  const clock = { now: 100_000 };
  const a = new WorkspaceHubStore(root, randomUUID(), workspace("a"), () => clock.now);
  const b = new WorkspaceHubStore(root, randomUUID(), workspace(sameWorkspace ? "a" : "b"), () => clock.now);
  await Promise.all([a.initialize(), b.initialize()]);
  t.after(async () => { await Promise.all([a.dispose(), b.dispose()]); await fs.rm(root, { recursive: true, force: true }); });
  const publish = async (store: WorkspaceHubStore) => store.publishWindow({ version: 1, windowId: store.windowId, workspace: store.workspace, updatedAt: clock.now,
    bridge: { state: "running", provider: "cloudflare", domain: "example.trycloudflare.com", connected: true, todos: [] }, activeChats: [] });
  await Promise.all([publish(a), publish(b)]);
  return { root, clock, a, b, publish };
}

test("window catalog identifies both projects and expires stale windows", async t => {
  const { a, b, clock, publish } = await setup(t);
  assert.equal((await a.listWindows()).length, 2);
  clock.now += HUB_WINDOW_TTL_MS + 1;
  await publish(a);
  assert.deepEqual((await b.listWindows()).map(w => w.workspace.name), ["a"]);
});

test("window snapshots whitelist fields and never persist an endpoint token", async t => {
  const { a, root } = await setup(t);
  const token = "1".repeat(32);
  const unsafe = { version: 1, windowId: a.windowId, workspace: a.workspace, updatedAt: Date.now(),
    bridge: { state: "running", provider: "cloudflare", domain: "example.trycloudflare.com", connected: true, publicUrl: `https://example.trycloudflare.com/mcp/${token}`, routeToken: token, todos: [{ id: "one", title: `/mcp/${token}`, status: "in_progress" }] }, activeChats: [] };
  await a.publishWindow(unsafe as HubWindow);
  const file = path.join(root, "windows", `${a.windowId}.json`);
  assert.ok(!(await fs.readFile(file, "utf8")).includes(token));
  // POSIX permission bits are emulated on win32; the lease directory there is a
  // per-user temp dir and named pipes leave no filesystem entry behind.
  if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o077, 0);
});

test("identical native IDs in different workspaces do not overwrite each other", async t => {
  const { a, b } = await setup(t);
  await Promise.all([a.publishChat(frame("same", 1, "project A")), b.publishChat(frame("same", 1, "project B"))]);
  const all = await a.listChats(); assert.equal(all.length, 2);
  assert.notEqual(hubChatKey(a.workspace.id, uri("same")), hubChatKey(b.workspace.id, uri("same")));
  assert.ok(JSON.stringify((await b.readChat(hubChatKey(a.workspace.id, uri("same"))))?.data).includes("project A"));
});

test("other windows read incremental replies and out-of-order frames cannot roll them back", async t => {
  const { a, b } = await setup(t);
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  const generation = await a.beginGeneration(frame());
  await a.publishChat(frame("chat-1", 3, "latest streamed reply", generation));
  assert.equal(await a.publishChat(frame("chat-1", 2, "old reply", generation)), false);
  const value = await b.readChat(key);
  assert.equal(value?.sourceSequence, 3);
  assert.ok(JSON.stringify(value?.data).includes("latest streamed reply"));
  await a.finishGeneration(frame("chat-1", 4, "finished reply", generation));
  assert.equal((await b.readChat(key))?.active, false);
});

test("one chat has one generating owner even across independent store instances", async t => {
  const { a, b, publish } = await setup(t, true);
  const generation = await a.beginGeneration(frame()); await publish(a);
  await assert.rejects(b.beginGeneration(frame()), /另一个窗口/);
  await assert.rejects(b.prepareContinuation(hubChatKey(a.workspace.id, uri("chat-1"))), /仍在生成/);
  await a.finishGeneration(frame("chat-1", 2, "done", generation));
  await assert.rejects(b.beginGeneration(frame()), /属于另一个窗口/);
});

test("a wrong generation cannot finish or release the current owner's work", async t => {
  const { a, b } = await setup(t, true);
  const generation = await a.beginGeneration(frame());
  await a.finishGeneration(frame("chat-1", 9, "wrong", randomUUID()));
  await assert.rejects(b.beginGeneration(frame()), /另一个窗口/);
  await a.finishGeneration(frame("chat-1", 10, "right", generation));
  assert.ok(JSON.stringify((await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))?.data).includes("right"));
});

test("a foreign workspace can view but never adopt a continuation", async t => {
  const { a, b } = await setup(t);
  await a.publishChat(frame());
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  assert.ok(await b.readChat(key));
  await assert.rejects(b.prepareContinuation(key), /所属的工作区/);
});

test("closed-owner recovery claims only the original workspace, strips drafts and queues", async t => {
  const { a, b } = await setup(t, true);
  await a.publishChat(frame());
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  await a.dispose();
  const resumed = await b.prepareContinuation(key);
  assert.equal(resumed.ownerWindowId, b.windowId);
  assert.ok(!JSON.stringify(resumed.data).includes("UNSENT_DRAFT"));
  assert.ok(!JSON.stringify(resumed.data).includes("NEVER_REPLAY"));
});

test("a closed owner leaves an interrupted record rather than pretending completion", async t => {
  const { a, b, publish } = await setup(t, true);
  await a.beginGeneration(frame()); await publish(a);
  assert.equal((await b.listChats())[0].status, "running");
  await a.dispose();
  assert.equal((await b.listChats())[0].status, "interrupted");
  await b.prepareContinuation(hubChatKey(a.workspace.id, uri("chat-1")));
});

test("deletion cannot race a foreign generation before its heartbeat is published", async t => {
  const { a, b } = await setup(t, true);
  const generation = await a.beginGeneration(frame());
  await assert.rejects(b.deleteChat(uri("chat-1")), /先在原窗口停止生成/);
  assert.equal((await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))?.deleted, false);
  await a.finishGeneration(frame("chat-1", 2, "done", generation));
});

test("tombstones erase shared contents and prevent stale history imports resurrecting them", async t => {
  const { a, b } = await setup(t, true);
  await a.publishChat(frame()); await a.deleteChat(uri("chat-1"));
  assert.equal(await b.publishChat(frame(), true), false);
  assert.equal((await a.listChats()).length, 0);
  assert.equal((await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))?.data, null);
});

test("continuation requests are consumed once, by the intended original window", async t => {
  const { a, b } = await setup(t, true);
  await a.publishChat(frame());
  const value = (await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))!;
  await b.requestContinuation(value, a.windowId);
  const openedA: string[] = [], openedB: string[] = [];
  await Promise.all([a.consumeRequests(async key => { openedA.push(key); }), b.consumeRequests(async key => { openedB.push(key); })]);
  await a.consumeRequests(async key => { openedA.push(key); });
  assert.deepEqual(openedA, [value.key]); assert.deepEqual(openedB, []);
});

test("concurrent imports of the same archive never lose or duplicate its record", async t => {
  const { a, b } = await setup(t, true);
  const results = await Promise.all([a.publishChat(frame(), true), b.publishChat(frame(), true)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await a.listChats()).length, 1);
});

test("resource identity and record keys are validated before storage access", async t => {
  const { a, root } = await setup(t);
  await assert.rejects(a.readChat("../../private"), /Invalid hub record key/);
  await assert.rejects(a.publishChat({ ...frame(), sessionResource: uri("different") }), /does not match/);
  await assert.rejects(a.publishChat({ ...frame(), serialized: '{"sessionId":"other","requests":[]}' }), /Invalid serialized/);
  assert.equal((await fs.readdir(path.join(root, "chats"))).length, 0);
});

test("one corrupt catalog record does not hide valid chats", async t => {
  const { a, root } = await setup(t); await a.publishChat(frame());
  await fs.writeFile(path.join(root, "chats", `${"f".repeat(64)}.json`), "broken JSON");
  assert.equal((await a.listChats()).length, 1);
});

test("a late finish cannot roll back a newer final snapshot", async t => {
  const { a } = await setup(t);
  const generation = await a.beginGeneration(frame());
  await a.publishChat(frame("chat-1", 9, "newer metadata and reply", generation));
  await a.finishGeneration(frame("chat-1", 8, "older captured finish", generation));
  const value = await a.readChat(hubChatKey(a.workspace.id, uri("chat-1")));
  assert.equal(value?.active, false);
  assert.equal(value?.sourceSequence, 9);
  assert.ok(JSON.stringify(value?.data).includes("newer metadata and reply"));
});

test("catalog cache observes atomic replacements even with equal size and mtime", async t => {
  const { a, root } = await setup(t);
  await a.publishChat(frame("chat-1", 1, "same size"));
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  const file = path.join(root, "chats", `${key}.json`);
  const stamp = new Date(Math.floor((await fs.stat(file)).mtimeMs / 1000) * 1000);
  await fs.utimes(file, stamp, stamp);
  const before = await fs.stat(file);
  await a.listChats();
  const value = (await a.readChat(key))!;
  value.title = "world"; value.revision++;
  const temporary = file + ".test-replacement";
  await fs.writeFile(temporary, JSON.stringify(value)); await fs.utimes(temporary, before.atime, before.mtime); await fs.rename(temporary, file);
  assert.equal((await fs.stat(file)).size, before.size);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await a.listChats())[0].title, "world");
});

test("disposed stores cannot recreate their window or write late snapshots", async t => {
  const { a, publish } = await setup(t); await a.dispose();
  await assert.rejects(publish(a), /closing/);
  await assert.rejects(a.publishChat(frame()), /closing/);
});

// ---- multi-instance additions (macOS + Windows) ---------------------------

test("window snapshots carry the instance registry fields and reject malformed ones", async t => {
  const { a, b, clock, root } = await setup(t);
  await a.publishWindow({ version: 1, windowId: a.windowId, workspace: a.workspace, updatedAt: clock.now,
    bridge: { state: "stopped", provider: "cloudflare", domain: "", connected: false, todos: [] }, activeChats: [],
    instanceId: "instance-a", userDataDir: "/Users/me/Library/Application Support/ShunCode-2", pid: 4242 });
  const seen = (await b.listWindows()).find(w => w.windowId === a.windowId)!;
  assert.equal(seen.instanceId, "instance-a");
  assert.equal(seen.userDataDir, "/Users/me/Library/Application Support/ShunCode-2");
  assert.equal(seen.pid, 4242);
  // A record with a malformed pid is ignored rather than trusted.
  const file = path.join(root, "windows", `${a.windowId}.json`);
  const broken = { ...JSON.parse(await fs.readFile(file, "utf8")), pid: "4242" };
  await fs.writeFile(file, JSON.stringify(broken));
  assert.equal((await b.listWindows()).some(w => w.windowId === a.windowId), false);
});

test("window actions are delivered only to the addressed live window and never open a chat", async t => {
  const { a, b } = await setup(t, true);
  const [windowA] = (await a.listWindows()).filter(w => w.windowId === a.windowId);
  await b.requestWindowAction(windowA, "focus");
  await b.requestWindowAction(windowA, "copy-address");
  const openedA: string[] = [], actsA: string[] = [], openedB: string[] = [], actsB: string[] = [];
  await b.consumeRequests(async key => { openedB.push(key); }, async kind => { actsB.push(kind); });
  await a.consumeRequests(async key => { openedA.push(key); }, async kind => { actsA.push(kind); });
  await a.consumeRequests(async key => { openedA.push(key); }, async kind => { actsA.push(kind); });
  assert.deepEqual(openedA, []); assert.deepEqual(openedB, []); assert.deepEqual(actsB, []);
  assert.deepEqual(actsA.sort(), ["copy-address", "focus"]);
});

test("an untargeted continuation waits for any window of the owning workspace (cold-started instance)", async t => {
  const { a, b, clock } = await setup(t);
  await a.publishChat(frame());
  const value = (await a.readChat(hubChatKey(a.workspace.id, uri("chat-1"))))!;
  await b.requestContinuation(value); // no target: the instance for this folder may not exist yet
  const openedB: string[] = [];
  await b.consumeRequests(async key => { openedB.push(key); });
  assert.deepEqual(openedB, [], "a foreign workspace must not consume it");
  clock.now += 60_000; // still inside the 120 s TTL when the new instance comes up
  const late = new WorkspaceHubStore(a.root, randomUUID(), workspace("a"), () => clock.now);
  await late.initialize(); t.after(() => late.dispose());
  const openedLate: string[] = [];
  await late.consumeRequests(async key => { openedLate.push(key); });
  assert.deepEqual(openedLate, [value.key]);
});

// ---- management delete + workspace-identity migration ---------------------

test("management delete tombstones one record by key while a foreign generation blocks it", async t => {
  const { a, b } = await setup(t, true);
  const key = hubChatKey(a.workspace.id, uri("chat-1"));
  const generation = await a.beginGeneration(frame());
  await assert.rejects(b.deleteChatByKey(key), /先在原窗口停止生成/);
  await a.finishGeneration(frame("chat-1", 2, "done", generation));
  await assert.rejects(b.deleteChatByKey("../../private"), /Invalid chat key/);
  await b.deleteChatByKey(key); // no-op on a missing key must not throw either
  await b.deleteChatByKey("e".repeat(64));
  const tombstone = await a.readChat(key);
  assert.equal(tombstone?.deleted, true);
  assert.equal(tombstone?.data, null);
  assert.equal((await a.listChats()).length, 0);
});

test("startup sweep keeps the newest record per native session and skips live generations", async t => {
  const { root, clock } = await setup(t);
  // Simulate the old per-window identity: the same native session keyed under
  // two different workspace ids, plus a live generation elsewhere.
  const oldA = new WorkspaceHubStore(root, randomUUID(), workspace("old-window-1"), () => clock.now);
  const oldB = new WorkspaceHubStore(root, randomUUID(), workspace("old-window-2"), () => clock.now);
  await Promise.all([oldA.initialize(), oldB.initialize()]);
  t.after(async () => { await Promise.all([oldA.dispose(), oldB.dispose()]); });
  await oldA.publishChat(frame("dup", 1, "stale incarnation"));
  clock.now += 1000;
  await oldB.publishChat(frame("dup", 1, "newest incarnation"));
  // A duplicate whose older incarnation is still generating elsewhere: the
  // sweep must skip it (retried on a later start) instead of failing.
  const live = new WorkspaceHubStore(root, randomUUID(), workspace("old-window-3"), () => clock.now);
  const newer = new WorkspaceHubStore(root, randomUUID(), workspace("old-window-4"), () => clock.now);
  await Promise.all([live.initialize(), newer.initialize()]);
  t.after(async () => { await Promise.all([live.dispose(), newer.dispose()]); });
  const liveGeneration = await live.beginGeneration(frame("livedup", 1, "still generating"));
  clock.now += 1000;
  await newer.publishChat(frame("livedup", 1, "newer incarnation"));
  const before = await oldA.listChats();
  assert.equal(before.filter(c => c.sessionResource === uri("dup")).length, 2);
  const swept = await oldA.sweepSupersededChatRecords();
  assert.equal(swept, 1);
  const after = await oldA.listChats();
  const survivors = after.filter(c => c.sessionResource === uri("dup"));
  assert.equal(survivors.length, 1);
  assert.ok(JSON.stringify((await oldA.readChat(survivors[0].key))?.data).includes("newest incarnation"));
  assert.equal((await oldA.readChat(hubChatKey(oldA.workspace.id, uri("dup"))))?.deleted, true);
  // The live duplicate is untouched: both incarnations are still listed.
  assert.equal((await oldA.listChats()).filter(c => c.sessionResource === uri("livedup")).length, 2);
  // Idempotent: a second sweep finds nothing left to do.
  assert.equal(await oldA.sweepSupersededChatRecords(), 0);
  await live.finishGeneration(frame("livedup", 2, "done", liveGeneration));
});
