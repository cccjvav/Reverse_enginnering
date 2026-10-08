const test = require('node:test');
const assert = require('node:assert/strict');
let chromium;
try {
  ({ chromium } = require('../../../vscode-main/node_modules/playwright'));
} catch {
  chromium = undefined;
}
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
// Tests live at extensions/shuncode/test/ on every platform: three levels up is the repo root.
const root = path.resolve(__dirname, '..', '..', '..');
const media = path.join(root, 'extensions/shuncode/media');

// Two browser pages stand in for two webviews; persistence, ownership, request
// routing and archive reads use the real store in an isolated temporary folder.
test('two workspace webviews show live shared replies, route continuation and reject transcript HTML', { timeout: 45000 }, async t => {
  if (!chromium) { t.skip('Playwright module is not installed in vscode-main; run npm ci in vscode-main'); return; }
  const { WorkspaceHubStore, hubChatKey } = await import('../dist/src/workspace-hub-store.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shuncode-hub-ui-'));
  const workspace = name => ({ id: createHash('sha256').update(name).digest('hex'), name: '项目 ' + name, kind: 'folder', uri: `file:///projects/${name}`, folders: [] });
  const a = new WorkspaceHubStore(directory, randomUUID(), workspace('Alpha'));
  const b = new WorkspaceHubStore(directory, randomUUID(), workspace('Beta'));
  await Promise.all([a.initialize(), b.initialize()]);
  const sessionId = 'chat-ui';
  const resource = `vscode-chat-session://local/${Buffer.from(sessionId).toString('base64url')}`;
  const frame = (sequence, text, generation) => ({ sessionId, sessionResource: resource, sequence, generation, serialized: JSON.stringify({ version: 3, sessionId, creationDate: Date.now(), requests: [{ requestId: 'request-1', message: { text: '请检查两个项目的工作区隔离与实时同步' }, response: [{ kind: 'markdownContent', content: { value: text } }] }] }) });
  const instanceOf = store => store.workspace.name.endsWith('Alpha') ? 'instance-alpha-0001' : 'instance-beta-0002';
  const window = async store => store.publishWindow({ version: 1, windowId: store.windowId, workspace: store.workspace, updatedAt: Date.now(), bridge: { state: 'running', provider: 'cloudflare', domain: `${store.workspace.name.endsWith('Alpha') ? 'alpha' : 'beta'}.trycloudflare.com`, connected: true, todos: [{ id: 'review', title: '检查工作区配置与测试结果', status: 'in_progress' }] }, activeChats: [], instanceId: instanceOf(store), userDataDir: `/Users/me/Library/Application Support/ShunCode-${store.workspace.name.endsWith('Alpha') ? '' : '2'}`, pid: 1000 });
  const generation = await a.beginGeneration(frame(1, '第一段：正在检查 Alpha。'));
  await Promise.all([window(a), window(b)]);
  const server = http.createServer(async (req, res) => {
    try {
      const name = req.url === '/' ? 'workspace-hub.html' : req.url?.slice(1);
      if (!['workspace-hub.html', 'workspace-hub.css', 'workspace-hub.js'].includes(name)) { res.writeHead(404).end(); return; }
      let data = await fs.readFile(path.join(media, name), 'utf8');
      if (name.endsWith('.html')) data = data.replaceAll('{{cspSource}}', origin).replaceAll('{{nonce}}', 'test-webview-nonce').replaceAll('{{styleUri}}', origin + '/workspace-hub.css').replaceAll('{{scriptUri}}', origin + '/workspace-hub.js');
      res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(data);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await Promise.all([a.dispose(), b.dispose()]); await fs.rm(directory, { recursive: true, force: true });
  });
  const executablePath = process.env.SHUNCODE_TEST_BROWSER || chromium.executablePath();
  if (!existsSync(executablePath)) { t.skip(`Playwright Chromium is not installed (${executablePath}); run npx playwright install chromium in vscode-main`); return; }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'], timeout: 20000 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 940 }, colorScheme: 'dark' });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const errors = [], continued = [], opened = [], pages = [];
  const push = (page, message) => page.evaluate(message => window.postMessage(message, '*'), message);
  const snapshot = async store => { const windows = await store.listWindows(); return { currentWindowId: store.windowId, currentInstanceId: instanceOf(store), workspaceId: store.workspace.id, dataFolder: directory, windows, chats: await store.listChats(windows) }; };
  async function makePage(store) {
    const page = await context.newPage(); const state = { page, store, selected: undefined }; pages.push(state);
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('hubPost', async message => {
      if (message.type === 'ready') await push(page, { type: 'snapshot', value: await snapshot(store) });
      if (message.type === 'selectChat') { state.selected = message.key; await push(page, { type: 'chat', key: message.key, value: await store.readChat(message.key) }); }
      if (message.type === 'openWorkspace') opened.push(message.windowId);
      if (message.type === 'continueChat') {
        const chat = await store.readChat(message.key);
        const owner = (await store.listWindows()).find(w => w.windowId === chat.ownerWindowId);
        assert.ok(!owner.activeChats.includes(chat.key));
        await store.requestContinuation(chat, owner.windowId);
        await a.consumeRequests(async key => { await a.prepareContinuation(key); continued.push({ key, workspace: a.workspace.id }); });
      }
    });
    await page.addInitScript(() => { let state; window.acquireVsCodeApi = () => ({ postMessage: message => { void window.hubPost(message); }, getState: () => state, setState: value => { state = value; } }); });
    await page.goto(origin);
    await page.waitForSelector('.window-card');
    return page;
  }
  const pa = await makePage(a), pb = await makePage(b);
  assert.equal(await pa.locator('.window-card').count(), 2);
  assert.equal(await pb.locator('.window-card.current .project-name').textContent(), '项目 Beta');
  assert.equal(await pb.locator('.window-card').filter({ hasText: '项目 Alpha' }).locator('.badge').first().textContent(), '其他实例');
  assert.match(await pb.locator('.window-card').filter({ hasText: '项目 Alpha' }).locator('.badge.instance').textContent(), /实例 instance/);
  await pb.getByRole('button', { name: /^共享聊天/ }).click();
  await pb.waitForFunction(() => document.getElementById('messages').textContent.includes('第一段'));
  assert.equal(await pb.locator('#continue').isDisabled(), true);
  async function broadcast() {
    for (const state of pages) {
      await push(state.page, { type: 'snapshot', value: await snapshot(state.store) });
      if (state.selected) await push(state.page, { type: 'chat', key: state.selected, value: await state.store.readChat(state.selected) });
    }
  }
  await a.publishChat(frame(2, '实时新增：这是从 Alpha 同步到 Beta 的第二段。', generation));
  await broadcast();
  await pb.waitForFunction(() => document.getElementById('messages').textContent.includes('实时新增'));
  await a.finishGeneration(frame(3, '检查已完成，可以在 Alpha 原工作区继续。', generation));
  await window(a); await broadcast();
  await pb.waitForFunction(() => !document.getElementById('continue').disabled);
  await pb.locator('#continue').click();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(continued.length, 1); assert.equal(continued[0].workspace, a.workspace.id);
  assert.notEqual(continued[0].workspace, b.workspace.id);
  assert.equal((await a.readChat(hubChatKey(a.workspace.id, resource))).data.requests.length, 1, 'opening a continuation must not send a new prompt');
  await a.publishChat(frame(4, '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>\n```bash\nshuncode -n /projects/Alpha\n```', generation));
  await broadcast();
  assert.equal(await pb.locator('#messages img, #messages script').count(), 0);
  assert.equal(await pb.evaluate(() => window.__pwn), undefined);
  assert.equal(await pb.locator('#messages pre').count(), 1);
  await a.publishChat(frame(5, '已完成两个工作区的检查。\n\n项目 Alpha 和 Beta 保持各自的连接与任务。你现在可以回到 Alpha 继续这段对话，不会在 Beta 执行操作。\n\n```bash\nshuncode -n /projects/Alpha\n```', generation));
  await broadcast();
  await pb.screenshot({ path: path.join(os.tmpdir(), 'shuncode-workspace-hub-chat-ui.png'), fullPage: true });
  await b.publishChat(frame(1, 'Beta 的独立对话。'));
  await broadcast();
  const betaKey = hubChatKey(b.workspace.id, resource);
  await pb.locator('.chat-item').filter({ hasText: '项目 Beta' }).click();
  await pb.waitForFunction(() => document.getElementById('messages').textContent.includes('Beta 的独立对话'));
  await push(pb, { type: 'chat', key: hubChatKey(a.workspace.id, resource), value: await a.readChat(hubChatKey(a.workspace.id, resource)) });
  assert.ok((await pb.locator('#messages').textContent()).includes('Beta 的独立对话'), 'late response from old selection must be ignored');
  await pb.getByRole('button', { name: /^工作区/ }).click();
  await pb.locator('.window-card').filter({ hasText: '项目 Alpha' }).getByRole('button', { name: '在新实例打开' }).click();
  assert.equal(opened[0], a.windowId);
  await pb.setViewportSize({ width: 680, height: 1000 });
  assert.ok(await pb.evaluate(() => document.body.scrollWidth <= window.innerWidth + 2));
  await pb.setViewportSize({ width: 1400, height: 940 });
  await pb.screenshot({ path: path.join(os.tmpdir(), 'shuncode-workspace-hub-ui.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
