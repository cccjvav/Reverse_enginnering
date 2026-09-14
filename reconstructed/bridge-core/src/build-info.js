// RECONSTRUCTED from src/build-info.ts; see ../provenance.json.
// Original function/class bodies retained; ESM wiring was reconstructed.
import { define_SHUNCODE_BUILD_INFO_default } from './snapshot-build-metadata.js';
import { SHUNCODE_BEHAVIOR_VERSION } from './version.js';

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

export { asNonEmptyString, getBuildInfo, injectedBuildInfo };
