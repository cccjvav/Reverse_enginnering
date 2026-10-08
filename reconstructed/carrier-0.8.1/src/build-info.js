// EXTRACTED from src/build-info.ts in extension.js.
// Compiler output, not the author's source: types and most
// comments are gone. Imports are not rewired. See carrier-modules-0-8-1.json.

function injectedBuildInfo() {
  if (typeof define_SHUNCODE_BUILD_INFO_default === "undefined") return {};
  return define_SHUNCODE_BUILD_INFO_default ?? {};
}
function asNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function getBuildInfo() {
  const injected = injectedBuildInfo();
  return {
    version: asNonEmptyString(injected.version) ?? SHUNCODE_BEHAVIOR_VERSION,
    gitSha: asNonEmptyString(injected.gitSha) ?? "unknown",
    builtAt: asNonEmptyString(injected.builtAt) ?? "unknown",
    release: injected.release === true
  };
}
