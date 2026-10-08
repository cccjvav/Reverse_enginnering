"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/skill-archive-worker.ts
var skill_archive_worker_exports = {};
__export(skill_archive_worker_exports, {
  runSkillArchiveJob: () => runSkillArchiveJob
});
module.exports = __toCommonJS(skill_archive_worker_exports);
var import_node_crypto = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_worker_threads = require("node:worker_threads");

// src/skill-archive-detect.ts
var import_node_path2 = __toESM(require("node:path"), 1);

// src/skill-archive-limits.ts
var import_node_path = __toESM(require("node:path"), 1);
var SKILL_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;
var SKILL_ARCHIVE_TOO_LARGE_HINT = "\u538B\u7F29\u5305\u8D85\u8FC7 2 GB\uFF0C\u8D85\u51FA\u5355\u6587\u4EF6\u4E00\u6B21\u8BFB\u5165\u7684\u6280\u672F\u4E0A\u9650\uFF08\u4E0D\u662F Skill \u5927\u5C0F\u9650\u5236\uFF09\u3002\u8BF7\u89E3\u538B\u540E\u76F4\u63A5\u5BFC\u5165 Skill \u6587\u4EF6\u5939\uFF0C\u6587\u4EF6\u5939\u5BFC\u5165\u6CA1\u6709\u5927\u5C0F\u9650\u5236\u3002";
var SKILL_ARCHIVE_ENTRY_RATIO = 100;
var SKILL_ARCHIVE_ENTRY_RATIO_FLOOR = 1024 * 1024;
var SKILL_ARCHIVE_TOTAL_RATIO = 100;
var SKILL_ARCHIVE_TOTAL_RATIO_FLOOR = 8 * 1024 * 1024;
var SKILL_ARCHIVE_MAX_NAME_BYTES = 255;
var SKILL_ARCHIVE_MAX_PATH_BYTES = 1024;
var REPACK_HINT = "\u8BF7\u91CD\u65B0\u6253\u5305\u4E3A zip\u3002";
var NON_UTF8_HINT = "\u538B\u7F29\u5305\u91CC\u7684\u6587\u4EF6\u540D\u7F16\u7801\u4E0D\u662F UTF-8\uFF08\u5E38\u89C1\u4E8E\u7CFB\u7EDF\u81EA\u5E26\u7684\u538B\u7F29\u5DE5\u5177\uFF09\u3002\u8BF7\u7528 7-Zip \u6216 Bandizip \u4EE5 UTF-8 \u91CD\u65B0\u6253\u5305\u3002";
var SkillArchiveError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SkillArchiveError";
  }
  code;
};
var shown = (value) => {
  const clean = value.replace(/[\x00-\x1f\x7f]/g, "?");
  return clean.length > 120 ? `${clean.slice(0, 117)}\u2026` : clean;
};
function safeArchiveParts(raw) {
  const name = raw.replace(/\\/g, "/");
  const directory = name.endsWith("/");
  const parts = (directory ? name.slice(0, -1) : name).split("/");
  const unsafe = !name || parts.some((part) => !part || part === "." || part === ".." || /[\x00-\x1f\x7f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || Buffer.byteLength(part, "utf8") > SKILL_ARCHIVE_MAX_NAME_BYTES);
  if (unsafe) throw new SkillArchiveError("unsafe-path", `\u538B\u7F29\u5305\u5305\u542B\u4E0D\u5B89\u5168\u7684\u8DEF\u5F84\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\uFF1A${shown(raw)}`);
  return { parts, directory };
}
function isJunkArchiveEntry(parts) {
  const last = parts[parts.length - 1] ?? "";
  return parts.includes("__MACOSX") || last.startsWith("._") || [".ds_store", "thumbs.db", "desktop.ini"].includes(last.toLowerCase());
}
function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  return (crc ^ 4294967295) >>> 0;
}
var ArchiveEntryBudget = class {
  constructor(destination) {
    this.destination = destination;
  }
  destination;
  files = /* @__PURE__ */ new Set();
  directories = /* @__PURE__ */ new Set();
  declared = /* @__PURE__ */ new Set();
  entries = 0;
  total = 0;
  admit(parts, directory, size) {
    if (!Number.isSafeInteger(size) || size < 0 || directory && size !== 0) throw new SkillArchiveError("corrupt", "\u538B\u7F29\u5305\u6761\u76EE\u5927\u5C0F\u4E0D\u5408\u6CD5\u3002");
    this.total += size;
    if (Buffer.byteLength(import_node_path.default.join(this.destination, ...parts), "utf8") > SKILL_ARCHIVE_MAX_PATH_BYTES) {
      throw new SkillArchiveError("unsafe-path", `\u538B\u7F29\u5305\u4E2D\u7684\u8DEF\u5F84\u8FC7\u957F\uFF1A${shown(parts.join("/"))}`);
    }
    const keys = parts.map((_, index) => parts.slice(0, index + 1).join("/").normalize("NFC").toLowerCase());
    const key = keys.pop();
    for (const parent of keys) {
      if (this.files.has(parent)) throw new SkillArchiveError("duplicate-path", `\u538B\u7F29\u5305\u4E2D\u6587\u4EF6\u4E0E\u76EE\u5F55\u540C\u540D\uFF1A${shown(parent)}`);
      this.directories.add(parent);
    }
    const clash = directory ? this.files.has(key) || this.declared.has(key) : this.files.has(key) || this.directories.has(key);
    if (clash) throw new SkillArchiveError("duplicate-path", `\u538B\u7F29\u5305\u5305\u542B\u91CD\u590D\u8DEF\u5F84\uFF08\u542B\u5927\u5C0F\u5199\u6216 Unicode \u89C4\u8303\u5316\u540E\u76F8\u540C\u7684\u540D\u79F0\uFF09\uFF1A${shown(parts.join("/"))}`);
    if (directory) {
      this.directories.add(key);
      this.declared.add(key);
    } else this.files.add(key);
  }
};

// src/skill-archive-detect.ts
var SKILL_ARCHIVE_EXTENSIONS = [".zip", ".tar.gz", ".tgz"];
function archiveKindFromName(file) {
  const name = import_node_path2.default.basename(file).toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "tar.gz";
  return void 0;
}
function displayExtension(file) {
  const name = import_node_path2.default.basename(file).toLowerCase();
  const known = SKILL_ARCHIVE_EXTENSIONS.find((extension) => name.endsWith(extension));
  return known ?? (/\.tar\.[a-z0-9]+$/.exec(name)?.[0] ?? import_node_path2.default.extname(name));
}
var LABELS = { zip: "ZIP", gzip: "gzip", "7z": "7z", rar: "RAR", xz: "xz", bzip2: "bzip2", zstd: "zstd", tar: "\u672A\u538B\u7F29\u7684 tar" };
function sniffArchive(head) {
  const starts = (bytes) => head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte);
  if (starts([80, 75, 3, 4]) || starts([80, 75, 5, 6])) return "zip";
  if (starts([31, 139])) return "gzip";
  if (starts([55, 122, 188, 175, 39, 28])) return "7z";
  if (starts([82, 97, 114, 33, 26, 7])) return "rar";
  if (starts([253, 55, 122, 88, 90, 0])) return "xz";
  if (starts([66, 90, 104])) return "bzip2";
  if (starts([40, 181, 47, 253])) return "zstd";
  if (head.length >= 262 && head.subarray(257, 262).toString("latin1") === "ustar") return "tar";
  return void 0;
}
function unsupportedArchiveMessage(file) {
  const extension = displayExtension(file);
  return `\u4E0D\u652F\u6301${extension ? ` ${extension} ` : "\u8FD9\u79CD"}\u683C\u5F0F\u7684 Skill \u5305\uFF08\u652F\u6301 Skill \u6587\u4EF6\u5939\u6216 .zip\u3001.tar.gz\u3001.tgz\uFF09\u3002${REPACK_HINT}`;
}
function detectArchive(file, head) {
  const declared = archiveKindFromName(file);
  if (!declared) throw new SkillArchiveError("repack-required", unsupportedArchiveMessage(file));
  const content = sniffArchive(head);
  if (content !== (declared === "zip" ? "zip" : "gzip")) {
    const label = content ? LABELS[content] : "\u65E0\u6CD5\u8BC6\u522B\u7684\u5185\u5BB9";
    throw new SkillArchiveError("extension-mismatch", `\u6269\u5C55\u540D\u4E3A ${displayExtension(file)}\uFF0C\u5185\u5BB9\u5374\u662F ${label}\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002${REPACK_HINT}`);
  }
  return declared;
}

// src/skill-safe-zip.ts
var import_node_fs = require("node:fs");
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_zlib = require("node:zlib");
function entryName(raw, flags, extra) {
  const text = raw.toString("utf8");
  if (flags & 2048 || Buffer.from(text, "utf8").equals(raw)) {
    if (!Buffer.from(text, "utf8").equals(raw)) throw new SkillArchiveError("non-utf8-name", NON_UTF8_HINT);
    return text;
  }
  for (let offset = 0; offset + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(offset), size = extra.readUInt16LE(offset + 2), body = extra.subarray(offset + 4, offset + 4 + size);
    if (id === 28789 && body.length >= 5 && body[0] === 1 && body.readUInt32LE(1) === crc32(raw)) {
      const unicode = body.subarray(5), name = unicode.toString("utf8");
      if (Buffer.from(name, "utf8").equals(unicode)) return name;
    }
    offset += 4 + size;
  }
  throw new SkillArchiveError("non-utf8-name", NON_UTF8_HINT);
}
function extractSafeSkillZipBuffer(zip, destination) {
  if (zip.length > SKILL_ARCHIVE_MAX_BYTES) throw new SkillArchiveError("too-large", SKILL_ARCHIVE_TOO_LARGE_HINT);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 101010256 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SkillArchiveError("corrupt", "ZIP \u76EE\u5F55\u635F\u574F\u3002");
  const count = zip.readUInt16LE(end + 10), centralSize = zip.readUInt32LE(end + 12), central = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== count || count === 65535 || central === 4294967295 || central + centralSize !== end) {
    throw new SkillArchiveError("encrypted", `\u4E0D\u652F\u6301\u5206\u5377\u6216 ZIP64 \u683C\u5F0F\u7684 ZIP\u3002${REPACK_HINT}`);
  }
  const entries = [];
  const budget = new ArchiveEntryBudget(destination);
  let cursor = central;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 33639248) throw new SkillArchiveError("corrupt", "ZIP \u4E2D\u592E\u76EE\u5F55\u635F\u574F\u3002");
    const flags = zip.readUInt16LE(cursor + 8), method = zip.readUInt16LE(cursor + 10);
    const compressed = zip.readUInt32LE(cursor + 20), size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28), extraLength = zip.readUInt16LE(cursor + 30), commentLength = zip.readUInt16LE(cursor + 32);
    const mode = zip.readUInt32LE(cursor + 38) >>> 16 & 61440, offset = zip.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new SkillArchiveError("corrupt", "ZIP \u4E2D\u592E\u76EE\u5F55\u635F\u574F\u3002");
    if (flags & 1 || flags & 64) throw new SkillArchiveError("encrypted", `ZIP \u5DF2\u52A0\u5BC6\uFF0C\u65E0\u6CD5\u5BFC\u5165\u3002${REPACK_HINT}`);
    if (zip.readUInt16LE(cursor + 34)) throw new SkillArchiveError("encrypted", `\u4E0D\u652F\u6301\u5206\u5377 ZIP\u3002${REPACK_HINT}`);
    if (method !== 0 && method !== 8) throw new SkillArchiveError("repack-required", `ZIP \u4F7F\u7528\u4E86\u4E0D\u652F\u6301\u7684\u538B\u7F29\u65B9\u5F0F\uFF08\u4EC5\u652F\u6301\u5B58\u50A8\u4E0E Deflate\uFF09\u3002${REPACK_HINT}`);
    if (mode !== 0 && mode !== 32768 && mode !== 16384) throw new SkillArchiveError("link-or-special", "ZIP \u5305\u542B\u7B26\u53F7\u94FE\u63A5\u6216\u7279\u6B8A\u6587\u4EF6\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002");
    const rawName = zip.subarray(cursor + 46, cursor + 46 + nameLength);
    const { parts, directory } = safeArchiveParts(entryName(rawName, flags, zip.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength)));
    budget.admit(parts, directory, size);
    if (size > SKILL_ARCHIVE_ENTRY_RATIO_FLOOR && size > SKILL_ARCHIVE_ENTRY_RATIO * Math.max(1, compressed)) {
      throw new SkillArchiveError("ratio", `\u538B\u7F29\u6BD4\u5F02\u5E38\uFF08${parts.join("/")} \u8D85\u8FC7 ${SKILL_ARCHIVE_ENTRY_RATIO} \u500D\uFF09\uFF0C\u7591\u4F3C\u538B\u7F29\u70B8\u5F39\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002`);
    }
    if (offset + 30 > central || zip.readUInt32LE(offset) !== 67324752 || zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method) throw new SkillArchiveError("corrupt", "ZIP \u672C\u5730\u6587\u4EF6\u5934\u635F\u574F\u3002");
    const localNameLength = zip.readUInt16LE(offset + 26), localExtraLength = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > central || !zip.subarray(offset + 30, offset + 30 + localNameLength).equals(rawName)) throw new SkillArchiveError("corrupt", "ZIP \u6587\u4EF6\u6570\u636E\u8D8A\u754C\u3002");
    entries.push({ parts, directory, start, compressed, size, method, crc: zip.readUInt32LE(cursor + 16) });
    cursor = next;
  }
  if (cursor !== end) throw new SkillArchiveError("corrupt", "ZIP \u76EE\u5F55\u957F\u5EA6\u4E0D\u4E00\u81F4\u3002");
  if (budget.total > SKILL_ARCHIVE_TOTAL_RATIO_FLOOR && budget.total > SKILL_ARCHIVE_TOTAL_RATIO * zip.length) {
    throw new SkillArchiveError("ratio", `\u538B\u7F29\u6BD4\u5F02\u5E38\uFF08\u6574\u4F53\u8D85\u8FC7 ${SKILL_ARCHIVE_TOTAL_RATIO} \u500D\uFF09\uFF0C\u7591\u4F3C\u538B\u7F29\u70B8\u5F39\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002`);
  }
  let written = 0;
  for (const entry of entries) {
    if (isJunkArchiveEntry(entry.parts)) continue;
    const target = import_node_path3.default.join(destination, ...entry.parts);
    if (entry.directory) {
      (0, import_node_fs.mkdirSync)(target, { recursive: true });
      continue;
    }
    const packed = zip.subarray(entry.start, entry.start + entry.compressed);
    let content;
    try {
      content = entry.method === 0 ? packed : (0, import_node_zlib.inflateRawSync)(packed, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw new SkillArchiveError("corrupt", "ZIP \u6587\u4EF6\u6821\u9A8C\u5931\u8D25\u3002");
    }
    if (content.length !== entry.size || crc32(content) !== entry.crc) throw new SkillArchiveError("corrupt", "ZIP \u6587\u4EF6\u6821\u9A8C\u5931\u8D25\u3002");
    (0, import_node_fs.mkdirSync)(import_node_path3.default.dirname(target), { recursive: true });
    (0, import_node_fs.writeFileSync)(target, content, { flag: "wx", mode: 384 });
    written++;
  }
  return { entries: written, bytes: budget.total };
}

// src/skill-safe-targz.ts
var import_node_fs2 = require("node:fs");
var import_node_path4 = __toESM(require("node:path"), 1);
var import_node_zlib2 = require("node:zlib");
var BLOCK = 512;
var corrupt = (detail) => new SkillArchiveError("corrupt", `tar.gz \u635F\u574F\u6216\u4E0D\u662F\u6709\u6548\u7684 tar \u5305\uFF08${detail}\uFF09\u3002`);
function utf8(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new SkillArchiveError("non-utf8-name", NON_UTF8_HINT);
  return text;
}
function field(header, offset, length) {
  const bytes = header.subarray(offset, offset + length), nul = bytes.indexOf(0);
  return nul < 0 ? bytes : bytes.subarray(0, nul);
}
function octal(header, offset, length) {
  if (header[offset] & 128) throw new SkillArchiveError("corrupt", "tar \u4F7F\u7528\u4E86 base-256 \u6570\u5B57\u5B57\u6BB5\uFF08\u8D85\u5927\u6587\u4EF6\u6216\u7279\u6B8A\u5F52\u6863\uFF09\uFF0C\u4E0D\u652F\u6301\u3002");
  const text = field(header, offset, length).toString("latin1").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw corrupt("\u6570\u5B57\u5B57\u6BB5\u65E0\u6548");
  return parseInt(text, 8);
}
function checksumOk(header) {
  let unsigned = 0, signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const byte = i >= 148 && i < 156 ? 32 : header[i];
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  const expected = octal(header, 148, 8);
  return expected === unsigned || expected === signed;
}
var isZero = (tar, offset) => offset + BLOCK <= tar.length && tar.subarray(offset, offset + BLOCK).every((byte) => byte === 0);
function paxRecords(data) {
  const records = /* @__PURE__ */ new Map();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    const length = space > offset ? Number(data.subarray(offset, space).toString("latin1")) : NaN;
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length || data[offset + length - 1] !== 10) throw corrupt("PAX \u6269\u5C55\u5934\u65E0\u6548");
    const record = data.subarray(space + 1, offset + length - 1), equals = record.indexOf(61);
    if (equals <= 0) throw corrupt("PAX \u6269\u5C55\u5934\u65E0\u6548");
    records.set(record.subarray(0, equals).toString("latin1"), utf8(record.subarray(equals + 1)));
    offset += length;
  }
  return records;
}
function extractSafeSkillTarGzBuffer(gz, destination) {
  if (gz.length > SKILL_ARCHIVE_MAX_BYTES) throw new SkillArchiveError("too-large", SKILL_ARCHIVE_TOO_LARGE_HINT);
  let tar;
  try {
    tar = (0, import_node_zlib2.gunzipSync)(gz);
  } catch (error) {
    if (error instanceof RangeError || error.code === "ERR_BUFFER_TOO_LARGE") throw new SkillArchiveError("too-large", "tar.gz \u89E3\u538B\u540E\u8D85\u8FC7\u5355\u6B21\u5185\u5B58\u89E3\u7801\u7684\u6280\u672F\u4E0A\u9650\uFF08\u4E0D\u662F Skill \u5927\u5C0F\u9650\u5236\uFF09\u3002\u8BF7\u89E3\u538B\u540E\u76F4\u63A5\u5BFC\u5165 Skill \u6587\u4EF6\u5939\uFF0C\u6587\u4EF6\u5939\u5BFC\u5165\u6CA1\u6709\u5927\u5C0F\u9650\u5236\u3002");
    throw corrupt("gzip \u6570\u636E\u65E0\u6CD5\u89E3\u538B");
  }
  if (tar.length > SKILL_ARCHIVE_TOTAL_RATIO_FLOOR && tar.length > SKILL_ARCHIVE_TOTAL_RATIO * gz.length) {
    throw new SkillArchiveError("ratio", `\u538B\u7F29\u6BD4\u5F02\u5E38\uFF08\u6574\u4F53\u8D85\u8FC7 ${SKILL_ARCHIVE_TOTAL_RATIO} \u500D\uFF09\uFF0C\u7591\u4F3C\u538B\u7F29\u70B8\u5F39\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002`);
  }
  const budget = new ArchiveEntryBudget(destination);
  const entries = [];
  let pax = /* @__PURE__ */ new Map(), longName, offset = 0, headers = 0;
  for (; ; ) {
    if (offset === tar.length) break;
    if (offset + BLOCK > tar.length) throw corrupt("\u6570\u636E\u610F\u5916\u7ED3\u675F");
    if (isZero(tar, offset)) break;
    ++headers;
    const header = tar.subarray(offset, offset + BLOCK);
    if (!checksumOk(header)) throw corrupt("\u5934\u90E8\u6821\u9A8C\u548C\u4E0D\u7B26");
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const paxSize = pax.get("size");
    if (paxSize !== void 0 && !/^\d+$/.test(paxSize)) throw corrupt("PAX size \u65E0\u6548");
    const size = paxSize !== void 0 && type !== "x" && type !== "g" ? Number(paxSize) : octal(header, 124, 12);
    const start = offset + BLOCK, next = start + Math.ceil(size / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(size) || start + size > tar.length) throw corrupt("\u6761\u76EE\u6570\u636E\u8D8A\u754C");
    if (type === "x" || type === "g" || type === "L") {
      if (size > 64 * 1024) throw corrupt("\u6269\u5C55\u5934\u8FC7\u5927");
      const data = tar.subarray(start, start + size);
      if (type === "x") pax = paxRecords(data);
      else if (type === "L") longName = utf8(field(data, 0, data.length));
      offset = next;
      continue;
    }
    if ([...pax.keys()].some((key) => key.startsWith("GNU.sparse."))) throw new SkillArchiveError("link-or-special", "tar \u5305\u542B\u7A00\u758F\u6587\u4EF6\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002");
    if ("12346K".includes(type)) throw new SkillArchiveError("link-or-special", "tar \u5305\u542B\u7B26\u53F7\u94FE\u63A5\u3001\u786C\u94FE\u63A5\u6216\u8BBE\u5907\u7B49\u7279\u6B8A\u6587\u4EF6\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002");
    if (type !== "0" && type !== "7" && type !== "5") throw new SkillArchiveError("link-or-special", `tar \u5305\u542B\u4E0D\u652F\u6301\u7684\u6761\u76EE\u7C7B\u578B\uFF08${type}\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u5BFC\u5165\u3002`);
    const posix = header.subarray(257, 263).toString("latin1") === "ustar\0";
    const prefix = posix ? utf8(field(header, 345, 155)) : "";
    const ownName = utf8(field(header, 0, 100));
    const name = pax.get("path") ?? longName ?? (prefix ? `${prefix}/${ownName}` : ownName);
    const directory = type === "5" || name.endsWith("/");
    const safe = safeArchiveParts(directory && !name.endsWith("/") ? `${name}/` : name);
    budget.admit(safe.parts, safe.directory, safe.directory ? 0 : size);
    entries.push({ parts: safe.parts, directory: safe.directory, start, size });
    pax = /* @__PURE__ */ new Map();
    longName = void 0;
    offset = next;
  }
  let written = 0;
  for (const entry of entries) {
    if (isJunkArchiveEntry(entry.parts)) continue;
    const target = import_node_path4.default.join(destination, ...entry.parts);
    if (entry.directory) {
      (0, import_node_fs2.mkdirSync)(target, { recursive: true });
      continue;
    }
    (0, import_node_fs2.mkdirSync)(import_node_path4.default.dirname(target), { recursive: true });
    (0, import_node_fs2.writeFileSync)(target, tar.subarray(entry.start, entry.start + entry.size), { flag: "wx", mode: 384 });
    written++;
  }
  return { entries: written, bytes: budget.total };
}

// src/skill-archive-worker.ts
function runSkillArchiveJob(job) {
  try {
    const data = (0, import_node_fs3.readFileSync)(job.file);
    if (data.length > SKILL_ARCHIVE_MAX_BYTES) throw new SkillArchiveError("too-large", "\u538B\u7F29\u5305\u8D85\u8FC7 2 GB\uFF0C\u8D85\u51FA\u5355\u6587\u4EF6\u4E00\u6B21\u8BFB\u5165\u7684\u6280\u672F\u4E0A\u9650\uFF08\u4E0D\u662F Skill \u5927\u5C0F\u9650\u5236\uFF09\u3002\u8BF7\u89E3\u538B\u540E\u76F4\u63A5\u5BFC\u5165 Skill \u6587\u4EF6\u5939\uFF0C\u6587\u4EF6\u5939\u5BFC\u5165\u6CA1\u6709\u5927\u5C0F\u9650\u5236\u3002");
    const kind = detectArchive(job.file, data.subarray(0, 512));
    const summary = kind === "zip" ? extractSafeSkillZipBuffer(data, job.destination) : extractSafeSkillTarGzBuffer(data, job.destination);
    return { ok: true, kind, digest: (0, import_node_crypto.createHash)("sha256").update(data).digest("hex"), ...summary, thread: import_node_worker_threads.threadId };
  } catch (error) {
    if (error instanceof SkillArchiveError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "corrupt", message: `\u65E0\u6CD5\u8BFB\u53D6 Skill \u538B\u7F29\u5305\uFF1A${error instanceof Error ? error.message : String(error)}` };
  }
}
if (import_node_worker_threads.parentPort && import_node_worker_threads.workerData) import_node_worker_threads.parentPort.postMessage(runSkillArchiveJob(import_node_worker_threads.workerData));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runSkillArchiveJob
});
//# sourceMappingURL=skill-archive-worker.js.map
