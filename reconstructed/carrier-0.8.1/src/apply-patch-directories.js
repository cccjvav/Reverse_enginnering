// EXTRACTED from src/apply-patch-directories.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_promises2 = require("node:fs/promises");
var import_node_path3 = __toESM(require("node:path"), 1);
function inside(root, target) {
  const relative = import_node_path3.default.relative(root, target);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${import_node_path3.default.sep}`) && !import_node_path3.default.isAbsolute(relative);
}
var samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
var codeOf = (error2) => error2.code;
async function resolvePatchDestination(requestedPath, roots2, fail2) {
  const candidates = import_node_path3.default.isAbsolute(requestedPath) ? [import_node_path3.default.resolve(requestedPath)] : roots2.map((root) => import_node_path3.default.resolve(root, requestedPath));
  let fallback;
  for (const candidate of candidates) {
    let ancestor = import_node_path3.default.dirname(candidate);
    const missing2 = [];
    while (true) {
      let info;
      try {
        info = await (0, import_promises2.lstat)(ancestor);
      } catch (error2) {
        if (codeOf(error2) !== "ENOENT") {
          if (codeOf(error2) === "ENOTDIR") throw fail2("NOT_A_DIRECTORY", `A parent component of ${requestedPath} is a file, not a directory.`);
          throw error2;
        }
        const parent = import_node_path3.default.dirname(ancestor);
        if (parent === ancestor) break;
        missing2.unshift(import_node_path3.default.basename(ancestor));
        ancestor = parent;
        continue;
      }
      let realAncestor;
      try {
        realAncestor = await (0, import_promises2.realpath)(ancestor);
      } catch (error2) {
        if (info.isSymbolicLink()) throw fail2("PATH_OUTSIDE_WORKSPACE", `Cannot safely resolve the parent symlink of ${requestedPath}.`);
        throw error2;
      }
      const root = roots2.find((root2) => inside(root2, realAncestor));
      if (!root) break;
      if (!(await (0, import_promises2.stat)(realAncestor)).isDirectory()) throw fail2("NOT_A_DIRECTORY", `A parent component of ${requestedPath} is not a directory.`);
      const absolutePath = import_node_path3.default.join(realAncestor, ...missing2, import_node_path3.default.basename(candidate));
      if (!inside(root, absolutePath)) break;
      const missingDirectories = missing2.map((_, index) => import_node_path3.default.join(realAncestor, ...missing2.slice(0, index + 1)));
      const resolved = { requestedPath, absolutePath, root, missingDirectories };
      if (!missing2.length) return resolved;
      fallback ??= resolved;
      break;
    }
  }
  if (fallback) return fallback;
  throw fail2("PATH_OUTSIDE_WORKSPACE", `${requestedPath} is not inside a usable allowed workspace root. Missing parent directories inside an allowed root are supported.`);
}
function patchParentPaths(file, root) {
  const parents = [];
  for (let current = import_node_path3.default.dirname(file); current !== root && inside(root, current); current = import_node_path3.default.dirname(current)) parents.push(current);
  return parents;
}
async function assertPatchParent(file, root, fail2) {
  const parent = import_node_path3.default.dirname(file);
  if (!inside(root, parent) || !samePath(await (0, import_promises2.realpath)(root), root) || !samePath(await (0, import_promises2.realpath)(parent), parent)) {
    throw fail2("PATH_CHANGED", `Parent path changed after validation for ${file}; re-read before retrying.`);
  }
  if (!(await (0, import_promises2.stat)(parent)).isDirectory()) throw fail2("NOT_A_DIRECTORY", `Parent of ${file} is not a directory.`);
}
var PatchDirectoryTransaction = class {
  constructor(fail2, signal) {
    this.fail = fail2;
    this.signal = signal;
  }
  fail;
  signal;
  created = [];
  /** Called only after the whole patch has passed preflight and acquired its locks. */
  async ensureParents(file, root, checkPermission) {
    const parents = patchParentPaths(file, root).reverse();
    for (const directory of parents) {
      if (this.signal?.aborted) throw new DOMException("Patch application was cancelled.", "AbortError");
      await assertPatchParent(directory, root, this.fail);
      let info;
      try {
        info = await (0, import_promises2.lstat)(directory);
      } catch (error2) {
        if (codeOf(error2) !== "ENOENT") throw error2;
      }
      if (!info) {
        if (checkPermission && !await checkPermission(directory)) throw this.fail("PERMISSION_DENIED", `Creating directory ${directory} is not permitted by the current policy.`);
        await assertPatchParent(directory, root, this.fail);
        if (this.signal?.aborted) throw new DOMException("Patch application was cancelled.", "AbortError");
        try {
          await (0, import_promises2.mkdir)(directory);
          const made = await (0, import_promises2.lstat)(directory);
          this.created.push({ directory, root, ino: made.ino, dev: made.dev });
          info = made;
        } catch (error2) {
          if (codeOf(error2) !== "EEXIST") throw error2;
          info = await (0, import_promises2.lstat)(directory);
        }
      }
      if (info.isSymbolicLink()) throw this.fail("PATH_CHANGED", `Parent ${directory} became a symlink; no file was installed through it.`);
      if (!info.isDirectory()) throw this.fail("NOT_A_DIRECTORY", `${directory} is not a directory.`);
    }
    await assertPatchParent(file, root, this.fail);
  }
  /** Remove only our unchanged, empty directories, deepest first. Preserve all other data. */
  async rollback() {
    const failures = [];
    for (const entry of [...this.created].reverse()) {
      try {
        await assertPatchParent(entry.directory, entry.root, this.fail);
        const current = await (0, import_promises2.lstat)(entry.directory);
        if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== entry.ino || current.dev !== entry.dev) {
          throw this.fail("PATH_CHANGED", `${entry.directory} was replaced; left untouched.`);
        }
        await (0, import_promises2.rmdir)(entry.directory);
      } catch (error2) {
        if (codeOf(error2) !== "ENOENT") failures.push(`${entry.directory}: ${error2.message}`);
      }
    }
    if (failures.length) throw this.fail("ROLLBACK_FAILED", `Created directories could not be safely removed: ${failures.join("; ")}`);
  }
};
