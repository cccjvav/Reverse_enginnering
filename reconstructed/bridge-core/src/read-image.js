// RECONSTRUCTED from src/read-image.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.


import * as import_promises5 from "node:fs/promises";

import * as import_node_path4 from "node:path";

var DEFAULT_READ_IMAGE_CONFIG = {
  maxBytes: 25 * 1024 * 1024
};

var ReadImageToolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function formatAspectRatio(width, height) {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const divisor = gcd(width, height);
  const ratioX = width / divisor;
  const ratioY = height / divisor;
  const decimal = (width / height).toFixed(2);
  if (ratioX < 100 && ratioY < 100) {
    return `${ratioX}:${ratioY} (${decimal})`;
  }
  return `${decimal}:1 (${decimal})`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isInsideRoot4(root, target) {
  const relative = import_node_path4.default.relative(root, target);
  return relative === "" || !relative.startsWith(`..${import_node_path4.default.sep}`) && relative !== ".." && !import_node_path4.default.isAbsolute(relative);
}

async function resolveSafePath2(requestedPath, roots) {
  if (roots.length === 0) {
    throw new ReadImageToolError("PATH_OUTSIDE_WORKSPACE", "No workspace root is configured.");
  }
  const canonicalRoots4 = await Promise.all(roots.map((root) => (0, import_promises5.realpath)(root)));
  const candidates = import_node_path4.default.isAbsolute(requestedPath) ? [requestedPath] : canonicalRoots4.map((root) => import_node_path4.default.resolve(root, requestedPath));
  let lastNotFound;
  for (const candidate of candidates) {
    try {
      const canonicalTarget = await (0, import_promises5.realpath)(candidate);
      if (canonicalRoots4.some((root) => isInsideRoot4(root, canonicalTarget))) return canonicalTarget;
    } catch (error2) {
      const code = error2.code;
      if (code === "ENOENT") {
        lastNotFound = error2;
        continue;
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new ReadImageToolError("PERMISSION_DENIED", "Permission denied while resolving the requested path.");
      }
      throw error2;
    }
  }
  if (lastNotFound) throw new ReadImageToolError("FILE_NOT_FOUND", "File does not exist.");
  throw new ReadImageToolError("PATH_OUTSIDE_WORKSPACE", "Requested path resolves outside the allowed workspace roots.");
}

function parsePngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 2303741511 || buffer.readUInt32BE(4) !== 218765834) return null;
  return { format: "png", mimeType: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseGifDimensions(buffer) {
  if (buffer.length < 10) return null;
  const sig = buffer.toString("ascii", 0, 6);
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  return { format: "gif", mimeType: "image/gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function parseBmpDimensions(buffer) {
  if (buffer.length < 26 || buffer.toString("ascii", 0, 2) !== "BM") return null;
  const headerSize = buffer.readUInt32LE(14);
  const width = headerSize === 12 ? buffer.readUInt16LE(18) : Math.abs(buffer.readInt32LE(18));
  const height = headerSize === 12 ? buffer.readUInt16LE(20) : Math.abs(buffer.readInt32LE(22));
  return { format: "bmp", mimeType: "image/bmp", width, height };
}

function parseJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 255) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 255) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 217 || marker === 218) break;
    if (offset + 2 > buffer.length) break;
    const len = buffer.readUInt16BE(offset);
    const isSof = marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207;
    if (isSof && offset + 7 <= buffer.length) {
      return {
        format: "jpeg",
        mimeType: "image/jpeg",
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += len;
  }
  return { format: "jpeg", mimeType: "image/jpeg", width: null, height: null };
}

function parseWebPDimensions(buffer) {
  if (buffer.length < 16) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (buffer.length >= 30 && buffer[23] === 157 && buffer[24] === 1 && buffer[25] === 42) {
      return {
        format: "webp",
        mimeType: "image/webp",
        width: buffer.readUInt16LE(26) & 16383,
        height: buffer.readUInt16LE(28) & 16383
      };
    }
  } else if (chunk === "VP8L") {
    if (buffer.length >= 25 && buffer[20] === 47) {
      const b1 = buffer[21];
      const b2 = buffer[22];
      const b3 = buffer[23];
      const b4 = buffer[24];
      return {
        format: "webp",
        mimeType: "image/webp",
        width: 1 + ((b2 & 63) << 8 | b1),
        height: 1 + ((b4 & 15) << 10 | b3 << 2 | (b2 & 192) >> 6)
      };
    }
  } else if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      format: "webp",
      mimeType: "image/webp",
      width: 1 + (buffer[24] | buffer[25] << 8 | buffer[26] << 16),
      height: 1 + (buffer[27] | buffer[28] << 8 | buffer[29] << 16)
    };
  }
  return { format: "webp", mimeType: "image/webp", width: null, height: null };
}

function parseSvgDimensions(buffer) {
  const str = buffer.toString("utf8", 0, Math.min(buffer.length, 8192));
  if (!/<svg[\s\S]*?>/i.test(str)) return null;
  const widthMatch = str.match(/\bwidth\s*=\s*["']?([\d.]+)(?:px)?["']?/i);
  const heightMatch = str.match(/\bheight\s*=\s*["']?([\d.]+)(?:px)?["']?/i);
  const viewBoxMatch = str.match(/\bviewBox\s*=\s*["']?([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)["']?/i);
  let width = widthMatch ? Math.round(Number.parseFloat(widthMatch[1])) : null;
  let height = heightMatch ? Math.round(Number.parseFloat(heightMatch[1])) : null;
  if ((width === null || height === null) && viewBoxMatch) {
    width = width ?? Math.round(Number.parseFloat(viewBoxMatch[3]));
    height = height ?? Math.round(Number.parseFloat(viewBoxMatch[4]));
  }
  return { format: "svg", mimeType: "image/svg+xml", width, height };
}

function parseIcoDimensions(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = buffer.readUInt16LE(4);
  if (count < 1 || buffer.length < 22) return { format: "ico", mimeType: "image/x-icon", width: null, height: null };
  let width = buffer[6];
  let height = buffer[7];
  if (width === 0) width = 256;
  if (height === 0) height = 256;
  return { format: "ico", mimeType: "image/x-icon", width, height };
}

function detectImageFormat(buffer, filePath) {
  const parsed = parsePngDimensions(buffer) ?? parseJpegDimensions(buffer) ?? parseGifDimensions(buffer) ?? parseWebPDimensions(buffer) ?? parseBmpDimensions(buffer) ?? parseSvgDimensions(buffer) ?? parseIcoDimensions(buffer);
  if (parsed) return parsed;
  const ext = import_node_path4.default.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return { format: "png", mimeType: "image/png", width: null, height: null };
    case ".jpg":
    case ".jpeg":
      return { format: "jpeg", mimeType: "image/jpeg", width: null, height: null };
    case ".gif":
      return { format: "gif", mimeType: "image/gif", width: null, height: null };
    case ".webp":
      return { format: "webp", mimeType: "image/webp", width: null, height: null };
    case ".bmp":
      return { format: "bmp", mimeType: "image/bmp", width: null, height: null };
    case ".svg":
      return { format: "svg", mimeType: "image/svg+xml", width: null, height: null };
    case ".ico":
      return { format: "ico", mimeType: "image/x-icon", width: null, height: null };
    case ".avif":
      return { format: "avif", mimeType: "image/avif", width: null, height: null };
    case ".tif":
    case ".tiff":
      return { format: "tiff", mimeType: "image/tiff", width: null, height: null };
    default:
      throw new ReadImageToolError("NOT_AN_IMAGE", `File does not appear to be a supported image format (${ext || "unknown extension"}).`);
  }
}

function normalizeError4(requestPath, error2) {
  if (error2 instanceof ReadImageToolError) {
    return { path: requestPath, status: "error", error: { code: error2.code, message: error2.message } };
  }
  const code = error2?.code;
  if (code === "ENOENT") return { path: requestPath, status: "error", error: { code: "FILE_NOT_FOUND", message: "File does not exist." } };
  if (code === "EACCES" || code === "EPERM") {
    return { path: requestPath, status: "error", error: { code: "PERMISSION_DENIED", message: "Permission denied while reading image." } };
  }
  if (error2?.name === "AbortError") {
    return { path: requestPath, status: "error", error: { code: "ABORTED", message: "Image read was cancelled." } };
  }
  return {
    path: requestPath,
    status: "error",
    error: { code: "IO_ERROR", message: error2?.message || "Unexpected file I/O error." }
  };
}

async function readImage(input, context) {
  const config2 = { ...DEFAULT_READ_IMAGE_CONFIG, ...context.config };
  const requestedPath = typeof input.path === "string" ? input.path.trim() : "";
  if (!requestedPath) {
    return { path: requestedPath, status: "error", error: { code: "FILE_NOT_FOUND", message: "path must be a non-empty string." } };
  }
  try {
    const safePath = await resolveSafePath2(requestedPath, context.workspaceRoots);
    if (context.checkPermission && !await context.checkPermission(safePath)) {
      throw new ReadImageToolError("PERMISSION_DENIED", "Reading this file is not permitted by the current policy.");
    }
    if (context.signal?.aborted) throw new DOMException("Image read was cancelled.", "AbortError");
    const fileStat = await (0, import_promises5.stat)(safePath);
    if (!fileStat.isFile()) throw new ReadImageToolError("NOT_A_FILE", "Requested path is not a regular file.");
    if (fileStat.size > config2.maxBytes) {
      throw new ReadImageToolError(
        "FILE_TOO_LARGE",
        `Image size (${formatBytes(fileStat.size)}) exceeds the maximum allowed limit of ${formatBytes(config2.maxBytes)}.`
      );
    }
    const fileHandle = await (0, import_promises5.open)(safePath, "r");
    let buffer;
    try {
      buffer = await fileHandle.readFile();
    } finally {
      await fileHandle.close();
    }
    if (context.signal?.aborted) throw new DOMException("Image read was cancelled.", "AbortError");
    const detected = detectImageFormat(buffer, safePath);
    const includeDataUri = input.include_data_uri !== false;
    const base642 = buffer.toString("base64");
    return {
      path: requestedPath,
      status: "success",
      format: detected.format,
      mime_type: detected.mimeType,
      width: detected.width,
      height: detected.height,
      aspect_ratio: formatAspectRatio(detected.width, detected.height),
      size_bytes: fileStat.size,
      size_formatted: formatBytes(fileStat.size),
      data_uri: includeDataUri ? `data:${detected.mimeType};base64,${base642}` : void 0,
      base64: base642
    };
  } catch (error2) {
    return normalizeError4(requestedPath, error2);
  }
}

function formatReadImageForModel(result) {
  const parts = ["=== READ_IMAGE BEGIN ===", `path: ${JSON.stringify(result.path)}`, `status: ${result.status}`];
  if (result.status === "error") {
    parts.push(`error_code: ${result.error.code}`, `message: ${result.error.message}`, "=== READ_IMAGE END ===");
    return parts.join("\n");
  }
  parts.push(
    `format: ${JSON.stringify(result.format)}`,
    `mime_type: ${JSON.stringify(result.mime_type)}`,
    `width: ${result.width ?? "null"}`,
    `height: ${result.height ?? "null"}`,
    `aspect_ratio: ${result.aspect_ratio ? JSON.stringify(result.aspect_ratio) : "null"}`,
    `size_bytes: ${result.size_bytes}`,
    `size_formatted: ${JSON.stringify(result.size_formatted)}`
  );
  parts.push("=== READ_IMAGE END ===");
  return parts.join("\n");
}

export { DEFAULT_READ_IMAGE_CONFIG, ReadImageToolError, detectImageFormat, formatAspectRatio, formatBytes, formatReadImageForModel, gcd, import_node_path4, import_promises5, isInsideRoot4, normalizeError4, parseBmpDimensions, parseGifDimensions, parseIcoDimensions, parseJpegDimensions, parsePngDimensions, parseSvgDimensions, parseWebPDimensions, readImage, resolveSafePath2 };
