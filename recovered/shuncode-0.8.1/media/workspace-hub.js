(() => {
  'use strict';
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const send = (type, args = {}) => api.postMessage({ type, ...args });
  const saved = api.getState() || {};
  let snapshot = { windows: [], chats: [] }, selected = saved.selected, currentChat, tab = saved.tab || 'workspaces';
  let windowsSignature = '', chatsSignature = '', showing = 100;
  // Window ids whose address row is revealed. Mirror the Bridge page: masked by
  // default, explicit click to reveal, the route token is never shown.
  const revealed = {};
  const maskText = '•'.repeat(24);
  function persist() { api.setState({ tab, selected, search: $('search').value }); }
  function node(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; }
  function clear(e) { e.replaceChildren(); }
  function button(text, action, disabled = false, title = '') { const b = node('button', '', text); b.disabled = disabled; if (title) b.title = title; b.addEventListener('click', action); return b; }
  function relative(at) { const mins = Math.max(0, Math.floor((Date.now() - at) / 60000)); return mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : new Date(at).toLocaleDateString(); }
  function pathText(workspace) { try { return workspace.uri ? decodeURIComponent(new URL(workspace.uri).pathname) : '未保存的工作区'; } catch { return '工作区路径不可用'; } }
  function switchTab(value) {
    tab = value === 'chats' ? 'chats' : 'workspaces';
    for (const id of ['workspaces', 'chats']) { $(`${id}-page`).hidden = id !== tab; $(`tab-${id}`).classList.toggle('selected', id === tab); $(`tab-${id}`).setAttribute('aria-selected', String(id === tab)); }
    if (tab === 'chats' && !selected && snapshot.chats.length) selectChat(snapshot.chats[0].key);
    persist();
  }
  function selectChat(key) { selected = key; showing = 100; currentChat = undefined; chatsSignature = ''; renderChats(); send('selectChat', { key }); $('chat-title').textContent = '正在读取共享记录…'; persist(); }
  function renderWindows() {
    const signature = JSON.stringify({ windows: snapshot.windows.map(({ updatedAt, ...rest }) => rest), instance: snapshot.currentInstanceId, active: snapshot.chats.filter(c => c.status === 'running').map(c => [c.key, c.title]) });
    if (signature === windowsSignature) return; windowsSignature = signature;
    clear($('windows'));
    if (!snapshot.windows.length) { $('windows').append(node('div', 'empty', '暂无活动窗口。打开一个项目或新开实例后，它会出现在这里。')); return; }
    const states = { running: 'Bridge 已启动', stopped: 'Bridge 未启动', starting: 'Bridge 正在启动', error: 'Bridge 连接异常' };
    const providers = { cloudflare: 'Cloudflare Quick', 'cloudflare-named': 'Cloudflare Named', ngrok: 'ngrok' };
    const windows = [...snapshot.windows].sort((a, b) => Number(b.windowId === snapshot.currentWindowId) - Number(a.windowId === snapshot.currentWindowId));
    for (const item of windows) {
      const current = item.windowId === snapshot.currentWindowId;
      const sameInstance = !snapshot.currentInstanceId || !item.instanceId || item.instanceId === snapshot.currentInstanceId;
      const card = node('article', `window-card${current ? ' current' : ''}`);
      const top = node('div', 'card-top'); top.append(node('div', 'project-name', item.workspace.name), node('span', 'badge', current ? '本窗口' : sameInstance ? '本实例 · 其他窗口' : '其他实例'));
      if (item.instanceId) top.append(node('span', 'badge instance', `实例 ${item.instanceId.slice(0, 8)}${item.pid ? ` · PID ${item.pid}` : ''}`));
      const state = node('div', 'bridge-status'); state.append(node('i', `status-dot ${item.bridge.state}`), node('span', '', `${states[item.bridge.state] || '状态未知'} · ${providers[item.bridge.provider] || ''}${item.bridge.connected ? ' · 已连接' : ''}`));
      const hasAddress = item.bridge.state === 'running' && !!item.bridge.domain;
      const addrRow = node('div', 'address-row');
      const addrInput = node('input', 'address-input');
      addrInput.readOnly = true; addrInput.spellcheck = false;
      const shown = revealed[item.windowId] && hasAddress;
      // Only the owning window knows its full URL (with token); every other
      // card reveals at most the domain, exactly like the Bridge page masking.
      const full = current && snapshot.ownPublicUrl ? snapshot.ownPublicUrl : (item.bridge.domain ? `https://${item.bridge.domain}/mcp/••••••••` : '');
      addrInput.value = shown ? full : hasAddress ? maskText : '启动此工作区的 Bridge 后显示地址';
      addrInput.title = shown ? full : hasAddress ? 'MCP 地址已隐藏，点击“查看”显示' : '';
      addrInput.setAttribute('aria-label', shown ? 'MCP 地址' : 'MCP 地址已隐藏');
      const eye = button(revealed[item.windowId] ? '隐藏' : '查看', () => { revealed[item.windowId] = !revealed[item.windowId]; windowsSignature = ''; renderWindows(); }, !hasAddress, hasAddress ? (revealed[item.windowId] ? '隐藏 MCP 地址' : '显示 MCP 地址（Token 永不显示）') : '启动 Bridge 后可查看');
      eye.className = 'reveal';
      addrRow.append(addrInput, eye);
      const todos = item.bridge.todos || [], active = todos.find(t => t.status === 'in_progress'), done = todos.filter(t => t.status === 'completed').length;
      const activeChats = snapshot.chats.filter(c => item.activeChats.includes(c.key));
      const task = node('div', 'task'); task.append(node('div', 'task-label', '当前任务'));
      const titles = [active ? `Bridge · ${active.title}` : '', ...activeChats.map(c => `Chat · ${c.title}`)].filter(Boolean);
      task.append(node('div', 'task-title', titles.join('\n') || (todos.length && done === todos.length ? '最近的 Bridge 任务已完成' : '暂无进行中的任务')));
      const meta = node('div', 'task-meta'); meta.append(node('span', '', `Bridge 步骤 ${done}/${todos.length}`), node('span', '', activeChats.length ? `${activeChats.length} 段聊天生成中` : 'Chat 空闲'));
      task.append(meta); if (todos.length) { const p = node('progress'); p.max = todos.length; p.value = done; task.append(p); }
      const canCopy = !!item.bridge.domain && item.bridge.state === 'running';
      const canOpen = !!item.workspace.uri && (item.workspace.kind === 'folder' || item.workspace.kind === 'workspace');
      const actions = node('div', 'card-actions');
      actions.append(
        button('复制连接地址', () => send('copyAddress', { windowId: item.windowId }), !canCopy, canCopy ? (current ? '复制本窗口的完整连接地址' : '请所属窗口把完整地址写入剪贴板') : '启动 Bridge 后可复制'),
        button('切换到该窗口', () => send('focusWindow', { windowId: item.windowId }), current, current ? '这就是当前窗口' : '把该窗口带到前台'),
        button('在新实例打开', () => send('openWorkspace', { windowId: item.windowId }), !canOpen, canOpen ? '以独立实例打开该项目' : '仅支持已保存的单文件夹或工作区文件'),
      );
      card.append(top, node('div', 'project-path', pathText(item.workspace)), state, addrRow, task, actions);
      if (item.syncError) card.append(node('div', 'muted', item.syncError));
      $('windows').append(card);
    }
  }
  function renderChats() {
    const query = $('search').value.trim().toLowerCase();
    const rows = snapshot.chats.filter(c => `${c.title} ${c.workspace.name}`.toLowerCase().includes(query));
    const sig = JSON.stringify({ selected, query, rows: rows.map(c => [c.key, c.title, c.workspace.name, c.status, Math.floor(c.lastMessageAt / 60000)]) });
    if (sig === chatsSignature) return; chatsSignature = sig;
    const scroll = $('chats').scrollTop; clear($('chats'));
    if (!rows.length) $('chats').append(node('div', 'empty', query ? '没有匹配的记录' : '还没有共享记录\n在任意项目中打开 Chat 后，会自动导入该项目历史。'));
    for (const chat of rows) {
      const entry = button('', () => selectChat(chat.key)); entry.className = `chat-item${selected === chat.key ? ' selected' : ''}`;
      entry.append(node('div', 'title', chat.title));
      const meta = node('div', 'meta'); meta.append(node('span', '', chat.workspace.name), node('span', '', chat.status === 'running' ? '● 生成中' : chat.status === 'interrupted' ? '生成已中断' : relative(chat.lastMessageAt)));
      entry.append(meta); $('chats').append(entry);
    }
    $('chats').scrollTop = scroll;
    updateHeader();
  }
  function updateHeader() {
    const meta = snapshot.chats.find(c => c.key === selected);
    $('continue').disabled = snapshot.syncEnabled === false || !currentChat || !meta || meta.status === 'running';
    $('delete-chat').disabled = snapshot.syncEnabled === false || !currentChat || !meta || meta.status === 'running';
    if (!meta) return;
    $('chat-project').textContent = `${meta.workspace.name} · ${pathText(meta.workspace)}`;
    $('chat-title').textContent = meta.title;
    $('chat-status').textContent = meta.status === 'running' ? '正在接收原窗口的回复 · 此处只读，完成后可继续' : meta.status === 'interrupted' ? '原窗口已离线或生成中断 · 可从最后同步的记录恢复' : '记录已同步 · 继续时回到所属工作区，不会自动发送消息';
  }
  function markdown(parent, text) {
    // Text nodes only: no HTML, command links, scripts or tool actions are executed.
    const chunks = String(text).split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/gm);
    for (const chunk of chunks) {
      if (chunk.startsWith('```')) { const p = node('pre'); p.append(node('code', '', chunk.replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, ''))); parent.append(p); }
      else if (chunk) parent.append(document.createTextNode(chunk));
    }
  }
  function stringValue(value) { return typeof value === 'string' ? value : value && typeof value.value === 'string' ? value.value : ''; }
  function renderResponse(parent, response) {
    if (typeof response === 'string') { markdown(parent, response); return; }
    for (const part of Array.isArray(response) ? response : []) {
      if (typeof part === 'string') { markdown(parent, part); continue; }
      if (!part || typeof part !== 'object') continue;
      const text = stringValue(part.content) || (part.kind === 'markdownContent' || !part.kind ? stringValue(part) : '');
      if (text) { markdown(parent, text); continue; }
      if (part.kind === 'thinking') { const box = node('details'); box.append(node('summary', '', '思考过程')); const body = node('div'); markdown(body, stringValue(part.value) || stringValue(part.text)); box.append(body); parent.append(box); }
      else if (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') parent.append(node('div', 'tool', stringValue(part.invocationMessage) || part.toolId || part.toolName || '工具调用'));
      else if (part.kind === 'progressMessage') parent.append(node('div', 'tool', stringValue(part.content) || '处理中'));
    }
  }
  function renderConversation(chat) {
    currentChat = chat;
    const area = $('messages'), oldTop = area.scrollTop, bottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
    clear(area);
    if (!chat || !chat.data) { area.append(node('div', 'empty', '这条共享记录已删除或暂时不可用。')); $('continue').disabled = true; $('delete-chat').disabled = true; return; }
    const rows = Array.isArray(chat.data.requests) ? chat.data.requests : [];
    if (rows.length > showing) area.append(button(`显示更早的消息（还有 ${rows.length - showing} 条）`, () => { showing += 100; renderConversation(currentChat); }));
    for (const request of rows.slice(-showing)) {
      const user = node('section', 'turn user'), ub = node('div', 'bubble'); markdown(ub, typeof request.message === 'string' ? request.message : request.message?.text || ''); user.append(node('div', 'role', '你'), ub);
      const assistant = node('section', 'turn assistant'), ab = node('div', 'bubble'); renderResponse(ab, request.response); if (!ab.childNodes.length) ab.append(document.createTextNode(chat.active ? '正在生成…' : '（暂无回复内容）'));
      assistant.append(node('div', 'role', request.agent?.fullName || request.agent?.name || 'ShunCode'), ab); area.append(user, assistant);
    }
    if (!rows.length) area.append(node('div', 'empty', '这段对话还没有消息。'));
    updateHeader();
    requestAnimationFrame(() => { area.scrollTop = bottom ? area.scrollHeight : oldTop; });
  }
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'snapshot') {
      snapshot = msg.value; $('window-count').textContent = snapshot.windows.length; $('chat-count').textContent = snapshot.chats.length; $('folder-path').textContent = snapshot.dataFolder;
      $('sync-state').textContent = snapshot.syncEnabled === false ? '同步已关闭' : '实时同步';
      renderWindows(); renderChats();
      if (selected && !snapshot.chats.some(c => c.key === selected)) { selected = undefined; currentChat = undefined; renderConversation(undefined); }
      if (!selected && tab === 'chats' && snapshot.chats.length) selectChat(snapshot.chats[0].key);
      else if (selected && !currentChat) send('selectChat', { key: selected });
    } else if (msg.type === 'chat') { if (msg.key === selected) renderConversation(msg.value); }
    else if (msg.type === 'tab') switchTab(msg.value);
    else if (msg.type === 'notice' || msg.type === 'error') { $('notice').hidden = false; $('notice').classList.toggle('error', msg.type === 'error'); $('notice').textContent = msg.text; }
  });
  $('tab-workspaces').addEventListener('click', () => switchTab('workspaces'));
  $('tab-chats').addEventListener('click', () => switchTab('chats'));
  $('choose').addEventListener('click', () => send('chooseWorkspace'));
  $('new-instance').addEventListener('click', () => send('newInstance'));
  $('continue').addEventListener('click', () => { if (selected) send('continueChat', { key: selected }); });
  $('delete-chat').addEventListener('click', () => { if (selected) send('deleteChat', { key: selected }); });
  $('data-folder').addEventListener('click', () => send('openDataFolder'));
  $('search').value = saved.search || ''; $('search').addEventListener('input', () => { renderChats(); persist(); });
  switchTab(tab); send('ready');
})();
