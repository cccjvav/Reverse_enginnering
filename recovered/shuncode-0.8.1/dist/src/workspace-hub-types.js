"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var workspace_hub_types_exports = {};
__export(workspace_hub_types_exports, {
  HUB_MAX_CHAT_BYTES: () => HUB_MAX_CHAT_BYTES,
  HUB_REQUEST_TTL_MS: () => HUB_REQUEST_TTL_MS,
  HUB_WINDOW_TTL_MS: () => HUB_WINDOW_TTL_MS
});
module.exports = __toCommonJS(workspace_hub_types_exports);
const HUB_WINDOW_TTL_MS = 2e4;
const HUB_REQUEST_TTL_MS = 12e4;
const HUB_MAX_CHAT_BYTES = 32 * 1024 * 1024;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HUB_MAX_CHAT_BYTES,
  HUB_REQUEST_TTL_MS,
  HUB_WINDOW_TTL_MS
});
