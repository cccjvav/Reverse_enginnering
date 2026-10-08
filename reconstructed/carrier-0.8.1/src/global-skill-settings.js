// EXTRACTED from src/global-skill-settings.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

var import_node_fs2 = require("node:fs");
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_crypto = require("node:crypto");
var GlobalSkillSettings = class {
  constructor(file, defaultDirectory) {
    this.file = file;
    this.defaultDirectory = defaultDirectory;
  }
  file;
  defaultDirectory;
  getDirectory() {
    if (!(0, import_node_fs2.existsSync)(this.file)) return this.defaultDirectory;
    const value = JSON.parse((0, import_node_fs2.readFileSync)(this.file, "utf8"));
    if (!value || typeof value !== "object" || !("directory" in value) || typeof value.directory !== "string" || !import_node_path2.default.isAbsolute(value.directory)) throw new Error(`\u5168\u5C40 Skill \u914D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u5728\u6280\u80FD\u4E2D\u5FC3\u91CD\u65B0\u9009\u62E9\u4F4D\u7F6E\uFF1A${this.file}`);
    return import_node_path2.default.resolve(value.directory);
  }
  setDirectory(directory) {
    if (!import_node_path2.default.isAbsolute(directory)) throw new Error("\u5168\u5C40 Skill \u76EE\u5F55\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002");
    (0, import_node_fs2.mkdirSync)(import_node_path2.default.dirname(this.file), { recursive: true, mode: 448 });
    const temporary = this.file + "." + (0, import_node_crypto.randomUUID)() + ".tmp";
    try {
      (0, import_node_fs2.writeFileSync)(temporary, JSON.stringify({ version: 1, directory: import_node_path2.default.resolve(directory) }, null, 2) + "\n", { flag: "wx", mode: 384 });
      (0, import_node_fs2.renameSync)(temporary, this.file);
    } finally {
      (0, import_node_fs2.rmSync)(temporary, { force: true });
    }
  }
};
