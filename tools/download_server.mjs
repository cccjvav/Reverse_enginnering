// A tiny download page for the handoff documents.
//
// The author asked to download the payment prompt rather than copy it out of a
// viewer. This serves the handoff docs from .work/downloads with a plain index,
// a copy-to-clipboard button for the prompt, and normal file downloads.
//
// Deliberately minimal and read-only: it serves a fixed allowlist of files from
// one directory, resolves every request against that directory, and refuses
// anything that escapes it. No uploads, no deletion, no shell.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.work', 'downloads');
const PORT = Number(process.env.PORT || 8080);

const TITLES = {
	'支付架构提示词-纯净版.txt': '支付架构提示词（纯净版，可直接粘贴给助手）',
	'PAYMENT_ARCHITECTURE_PROMPT.md': '支付架构提示词（完整版，含给你本人的补充说明）',
	'CHAT_FIELDS_IMPACT.md': '那 5 个 Chat 字段到底影响什么',
	'ANSWERS_FOR_AUTHOR.md': '三个问题的答复（src 目录 / 收费架构）',
	'WHAT_THE_AUTHOR_MUST_SUPPLY.md': '需要你提供什么，以及怎么收尾',
};

const escape = s => s.replace(/[&<>"']/g,
	c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function listFiles() {
	if (!fs.existsSync(DIR)) return [];
	// Explicit order: the paste-ready prompt is what the author actually asked
	// for, so it goes first rather than wherever the filesystem happens to put
	// it. Anything unlisted falls to the end, sorted by name.
	const ORDER = Object.keys(TITLES);
	const rank = name => {
		const index = ORDER.indexOf(name);
		return index < 0 ? ORDER.length : index;
	};
	return fs.readdirSync(DIR)
		.filter(name => fs.statSync(path.join(DIR, name)).isFile())
		.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function indexPage() {
	const rows = listFiles().map(name => {
		const size = (fs.statSync(path.join(DIR, name)).size / 1024).toFixed(1);
		const href = encodeURIComponent(name);
		return `<li>
      <div class="t">${escape(TITLES[name] || name)}</div>
      <div class="f">${escape(name)} · ${size} KB</div>
      <a class="btn" href="/download/${href}">下载</a>
      <a class="btn ghost" href="/view/${href}">在线查看</a>
    </li>`;
	}).join('\n');

	return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShunCode 恢复项目 · 文档下载</title>
<style>
 body{font:15px/1.7 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;max-width:760px;
      margin:0 auto;padding:32px 20px;color:#1a1a1a;background:#fafafa}
 h1{font-size:20px;margin:0 0 6px} p.sub{color:#666;margin:0 0 24px;font-size:14px}
 ul{list-style:none;padding:0;margin:0}
 li{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:14px 16px;margin-bottom:12px}
 .t{font-weight:600;margin-bottom:2px}
 .f{color:#888;font-size:12.5px;margin-bottom:10px;font-family:ui-monospace,Consolas,monospace}
 .btn{display:inline-block;padding:6px 14px;border-radius:6px;background:#1f6feb;color:#fff;
      text-decoration:none;font-size:13.5px;margin-right:8px}
 .btn.ghost{background:#fff;color:#1f6feb;border:1px solid #1f6feb}
 .note{margin-top:26px;padding:12px 14px;background:#fff8e6;border:1px solid #f0d9a0;
       border-radius:8px;font-size:13.5px;color:#5a4a20}
</style></head><body>
<h1>ShunCode 恢复项目 · 文档下载</h1>
<p class="sub">点「下载」保存到本地，点「在线查看」直接读（提示词页面带一键复制）。</p>
<ul>${rows}</ul>
<div class="note"><b>建议</b>：要发给另一个助手的话，用
<b>支付架构提示词（纯净版）</b>——它去掉了给你本人的补充说明，整段就是可直接粘贴的内容。</div>
</body></html>`;
}

function viewPage(name, text) {
	return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(name)}</title>
<style>
 body{font:15px/1.7 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;max-width:900px;
      margin:0 auto;padding:24px 20px;color:#1a1a1a;background:#fafafa}
 .bar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
 a,button{font:inherit}
 .btn{padding:7px 15px;border-radius:6px;background:#1f6feb;color:#fff;border:0;
      text-decoration:none;cursor:pointer;font-size:14px}
 .btn.ghost{background:#fff;color:#1f6feb;border:1px solid #1f6feb}
 pre{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:18px;
     white-space:pre-wrap;word-break:break-word;font:13.5px/1.65 ui-monospace,Consolas,monospace}
 #ok{color:#1a7f37;font-size:13.5px;display:none}
</style></head><body>
<div class="bar">
  <a class="btn ghost" href="/">← 返回</a>
  <button class="btn" id="copy">一键复制全文</button>
  <a class="btn ghost" href="/download/${encodeURIComponent(name)}">下载</a>
  <span id="ok">已复制到剪贴板</span>
</div>
<pre id="body">${escape(text)}</pre>
<script>
document.getElementById('copy').onclick = async () => {
  const text = document.getElementById('body').textContent;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const ok = document.getElementById('ok');
  ok.style.display = 'inline'; setTimeout(() => { ok.style.display = 'none'; }, 2000);
};
</script></body></html>`;
}

// Resolve a request path to a file inside DIR, or null if it escapes.
function safeFile(raw) {
	let name;
	try { name = decodeURIComponent(raw); } catch { return null; }
	const resolved = path.resolve(DIR, name);
	const prefix = DIR + path.sep;
	if (!resolved.startsWith(prefix)) return null;
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
	return resolved;
}

http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	const send = (code, type, body) => {
		res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
		res.end(body);
	};

	if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', indexPage());

	for (const [prefix, download] of [['/view/', false], ['/download/', true]]) {
		if (!url.pathname.startsWith(prefix)) continue;
		const file = safeFile(url.pathname.slice(prefix.length));
		if (!file) return send(404, 'text/plain; charset=utf-8', '文件不存在');
		const name = path.basename(file);
		if (download) {
			res.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition':
					`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
			});
			return fs.createReadStream(file).pipe(res);
		}
		return send(200, 'text/html; charset=utf-8',
			viewPage(name, fs.readFileSync(file, 'utf8')));
	}

	send(404, 'text/plain; charset=utf-8', '未找到');
}).listen(PORT, '0.0.0.0', () => {
	console.log(`Download server listening on 0.0.0.0:${PORT}`);
	console.log(`Serving ${listFiles().length} file(s) from .work/downloads`);
});
