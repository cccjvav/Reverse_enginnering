# 逐行教程覆盖清单

**这是进度清单，不是完成声明。** 自动核验可以防止“源码变了、教程仍拿旧行号解释”，不能自动证明教学质量。

当前：6/134 个纳入范围的文件完整逐行解释；363/26955 行已解释。

统计包含注释、结构行和空行；不同原件/重建/维护文件分别计数，不把重复代码算成独立功能。分母随工程变化更新。

## 统计边界

- Third-party node_modules and mixed original dist bundles (reference evidence, not counted as self-authored curriculum)
- Generated lesson documents/annotation data, images, binary installers, JSON configs and lockfiles; configuration reading is tracked separately in the curriculum

配置、锁文件和完整 Code OSS 的阅读任务见 [课程总目录](README.md)，不在这里被冒充为已讲解。

| 文件 | 总行数 | 已解释 | 状态 |
|---|---:|---:|---|
| [.github/workflows/bridge-core-tests.yml](../../.github/workflows/bridge-core-tests.yml) | 97 | 0 | 待逐行讲解 |
| [.github/workflows/installer-forensics.yml](../../.github/workflows/installer-forensics.yml) | 107 | 0 | 待逐行讲解 |
| [.github/workflows/windows-static-probe.yml](../../.github/workflows/windows-static-probe.yml) | 47 | 0 | 待逐行讲解 |
| [community/bridge-core/concurrency.mjs](../../community/bridge-core/concurrency.mjs) | 101 | 0 | 待逐行讲解 |
| [community/bridge-core/read-files.mjs](../../community/bridge-core/read-files.mjs) | 412 | 0 | 待逐行讲解 |
| [community/extension/src/bridge-access-controller.ts](../../community/extension/src/bridge-access-controller.ts) | 30 | 30 | 本组已逐行解释 |
| [community/extension/src/bridge-license-service.ts](../../community/extension/src/bridge-license-service.ts) | 73 | 73 | 本组已逐行解释 |
| [community/ui/access-card.js.txt](../../community/ui/access-card.js.txt) | 8 | 0 | 待逐行讲解 |
| [community/ui/access-methods.mjs](../../community/ui/access-methods.mjs) | 20 | 20 | 本组已逐行解释 |
| [reconstructed/bridge-core/src/adaptive-concurrency.js](../../reconstructed/bridge-core/src/adaptive-concurrency.js) | 68 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/apply-patch.js](../../reconstructed/bridge-core/src/apply-patch.js) | 787 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-activity-tracker.js](../../reconstructed/bridge-core/src/bridge-activity-tracker.js) | 102 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-coordination-validation.js](../../reconstructed/bridge-core/src/bridge-coordination-validation.js) | 90 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-event-store.js](../../reconstructed/bridge-core/src/bridge-event-store.js) | 44 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-http-router.js](../../reconstructed/bridge-core/src/bridge-http-router.js) | 130 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-session-registry.js](../../reconstructed/bridge-core/src/bridge-session-registry.js) | 74 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-tool-name.js](../../reconstructed/bridge-core/src/bridge-tool-name.js) | 23 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/bridge-usage-counter.js](../../reconstructed/bridge-core/src/bridge-usage-counter.js) | 27 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/build-info.js](../../reconstructed/bridge-core/src/build-info.js) | 25 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/canonical-diff.js](../../reconstructed/bridge-core/src/canonical-diff.js) | 172 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/concurrency.js](../../reconstructed/bridge-core/src/concurrency.js) | 102 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/file-tool-input-compat.js](../../reconstructed/bridge-core/src/file-tool-input-compat.js) | 160 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/file-tool-registry.js](../../reconstructed/bridge-core/src/file-tool-registry.js) | 644 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/ide-tool-definitions.js](../../reconstructed/bridge-core/src/ide-tool-definitions.js) | 185 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/jsonrpc-request-id-registry.js](../../reconstructed/bridge-core/src/jsonrpc-request-id-registry.js) | 43 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/managed-command-cancellation.js](../../reconstructed/bridge-core/src/managed-command-cancellation.js) | 223 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/managed-command-id.js](../../reconstructed/bridge-core/src/managed-command-id.js) | 30 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/managed-command-retention.js](../../reconstructed/bridge-core/src/managed-command-retention.js) | 29 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/managed-command-risk.js](../../reconstructed/bridge-core/src/managed-command-risk.js) | 179 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/managed-terminal-lifecycle.js](../../reconstructed/bridge-core/src/managed-terminal-lifecycle.js) | 15 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/mcp-protocol.js](../../reconstructed/bridge-core/src/mcp-protocol.js) | 41 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/read-files.js](../../reconstructed/bridge-core/src/read-files.js) | 403 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/snapshot-build-metadata.js](../../reconstructed/bridge-core/src/snapshot-build-metadata.js) | 7 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/snapshot-sdk-versions.js](../../reconstructed/bridge-core/src/snapshot-sdk-versions.js) | 15 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/tool-input-validation.js](../../reconstructed/bridge-core/src/tool-input-validation.js) | 112 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/version.js](../../reconstructed/bridge-core/src/version.js) | 7 | 0 | 待逐行讲解 |
| [reconstructed/bridge-core/src/workspace-paths.js](../../reconstructed/bridge-core/src/workspace-paths.js) | 39 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-1.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-1.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-10.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-10.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-2.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-2.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-3.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-3.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-4.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-4.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-5.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-5.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-6.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-6.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-7.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-7.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-8.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-8.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-constants-9.js.txt](../../recovered/bridge-ui-sessions/bridge-constants-9.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui-sessions/bridge-ui-1.js.txt](../../recovered/bridge-ui-sessions/bridge-ui-1.js.txt) | 1846 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-1.js.txt](../../recovered/bridge-ui/bridge-constants-1.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-10.js.txt](../../recovered/bridge-ui/bridge-constants-10.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-2.js.txt](../../recovered/bridge-ui/bridge-constants-2.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-3.js.txt](../../recovered/bridge-ui/bridge-constants-3.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-4.js.txt](../../recovered/bridge-ui/bridge-constants-4.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-5.js.txt](../../recovered/bridge-ui/bridge-constants-5.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-6.js.txt](../../recovered/bridge-ui/bridge-constants-6.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-7.js.txt](../../recovered/bridge-ui/bridge-constants-7.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-8.js.txt](../../recovered/bridge-ui/bridge-constants-8.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-constants-9.js.txt](../../recovered/bridge-ui/bridge-constants-9.js.txt) | 1 | 0 | 待逐行讲解 |
| [recovered/bridge-ui/bridge-ui-1.js.txt](../../recovered/bridge-ui/bridge-ui-1.js.txt) | 1846 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/agent-checkpoint-store.ts](../../recovered/shuncode-extension/src/agent-checkpoint-store.ts) | 164 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/branch-state.ts](../../recovered/shuncode-extension/src/branch-state.ts) | 121 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-access-controller.ts](../../recovered/shuncode-extension/src/bridge-access-controller.ts) | 132 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-constants.ts](../../recovered/shuncode-extension/src/bridge-constants.ts) | 366 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-license-config.ts](../../recovered/shuncode-extension/src/bridge-license-config.ts) | 23 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-license-service.ts](../../recovered/shuncode-extension/src/bridge-license-service.ts) | 958 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-mcp-modern.ts](../../recovered/shuncode-extension/src/bridge-mcp-modern.ts) | 158 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-mcp-transport.ts](../../recovered/shuncode-extension/src/bridge-mcp-transport.ts) | 703 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-server.ts](../../recovered/shuncode-extension/src/bridge-server.ts) | 1617 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-tool-dispatcher.ts](../../recovered/shuncode-extension/src/bridge-tool-dispatcher.ts) | 481 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-tunnel-lease.ts](../../recovered/shuncode-extension/src/bridge-tunnel-lease.ts) | 511 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/bridge-utils.ts](../../recovered/shuncode-extension/src/bridge-utils.ts) | 369 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/chat-history.mts](../../recovered/shuncode-extension/src/chat-history.mts) | 217 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/codex-account-view.ts](../../recovered/shuncode-extension/src/codex-account-view.ts) | 398 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/codex-auth.ts](../../recovered/shuncode-extension/src/codex-auth.ts) | 495 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/config.ts](../../recovered/shuncode-extension/src/config.ts) | 73 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/custom-agents.ts](../../recovered/shuncode-extension/src/custom-agents.ts) | 15 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/deepseek-compat.mts](../../recovered/shuncode-extension/src/deepseek-compat.mts) | 32 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/extension-host-proxy.mts](../../recovered/shuncode-extension/src/extension-host-proxy.mts) | 291 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/extension.ts](../../recovered/shuncode-extension/src/extension.ts) | 512 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/ide-tool-broker.ts](../../recovered/shuncode-extension/src/ide-tool-broker.ts) | 2170 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/instance-launcher.ts](../../recovered/shuncode-extension/src/instance-launcher.ts) | 197 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/lsp-tool.ts](../../recovered/shuncode-extension/src/lsp-tool.ts) | 515 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/merge-contract.ts](../../recovered/shuncode-extension/src/merge-contract.ts) | 57 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/model-defaults.mts](../../recovered/shuncode-extension/src/model-defaults.mts) | 18 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/model-provider-identifiers.mts](../../recovered/shuncode-extension/src/model-provider-identifiers.mts) | 32 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/model-provider.ts](../../recovered/shuncode-extension/src/model-provider.ts) | 1793 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/model-reasoning.mts](../../recovered/shuncode-extension/src/model-reasoning.mts) | 70 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/native-chat.ts](../../recovered/shuncode-extension/src/native-chat.ts) | 939 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/runtime-client.ts](../../recovered/shuncode-extension/src/runtime-client.ts) | 484 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/tool-presentation.ts](../../recovered/shuncode-extension/src/tool-presentation.ts) | 457 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/workspace-hub-store.ts](../../recovered/shuncode-extension/src/workspace-hub-store.ts) | 301 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/workspace-hub-types.ts](../../recovered/shuncode-extension/src/workspace-hub-types.ts) | 74 | 0 | 待逐行讲解 |
| [recovered/shuncode-extension/src/workspace-hub.ts](../../recovered/shuncode-extension/src/workspace-hub.ts) | 333 | 0 | 待逐行讲解 |
| [tests/bridge-core-boundary.test.mjs](../../tests/bridge-core-boundary.test.mjs) | 25 | 0 | 待逐行讲解 |
| [tests/bridge-core-files.test.mjs](../../tests/bridge-core-files.test.mjs) | 245 | 0 | 待逐行讲解 |
| [tests/bridge-core-http.test.mjs](../../tests/bridge-core-http.test.mjs) | 63 | 0 | 待逐行讲解 |
| [tests/bridge-core-learning.test.mjs](../../tests/bridge-core-learning.test.mjs) | 40 | 0 | 待逐行讲解 |
| [tests/bridge-core-patch.test.mjs](../../tests/bridge-core-patch.test.mjs) | 136 | 0 | 待逐行讲解 |
| [tests/bridge-core-reconstruction.test.mjs](../../tests/bridge-core-reconstruction.test.mjs) | 103 | 0 | 待逐行讲解 |
| [tests/bridge-core-state.test.mjs](../../tests/bridge-core-state.test.mjs) | 113 | 0 | 待逐行讲解 |
| [tests/community-policy.test.mjs](../../tests/community-policy.test.mjs) | 98 | 0 | 待逐行讲解 |
| [tests/community-ui-hardening.test.mjs](../../tests/community-ui-hardening.test.mjs) | 56 | 0 | 待逐行讲解 |
| [tests/community-ui.test.mjs](../../tests/community-ui.test.mjs) | 64 | 0 | 待逐行讲解 |
| [tests/helpers/bridge-core-baseline.mjs](../../tests/helpers/bridge-core-baseline.mjs) | 30 | 0 | 待逐行讲解 |
| [tests/test_apply_community.py](../../tests/test_apply_community.py) | 86 | 0 | 待逐行讲解 |
| [tests/test_ci_windows_probe.py](../../tests/test_ci_windows_probe.py) | 33 | 0 | 待逐行讲解 |
| [tests/test_cmd_environment.py](../../tests/test_cmd_environment.py) | 125 | 0 | 待逐行讲解 |
| [tests/test_custom_recovery.py](../../tests/test_custom_recovery.py) | 56 | 0 | 待逐行讲解 |
| [tests/test_installer_forensics.py](../../tests/test_installer_forensics.py) | 53 | 0 | 待逐行讲解 |
| [tests/test_recover.py](../../tests/test_recover.py) | 47 | 0 | 待逐行讲解 |
| [tests/test_windows_inspect.py](../../tests/test_windows_inspect.py) | 71 | 0 | 待逐行讲解 |
| [tools/apply-community.cmd](../../tools/apply-community.cmd) | 31 | 0 | 待逐行讲解 |
| [tools/apply_community.py](../../tools/apply_community.py) | 196 | 0 | 待逐行讲解 |
| [tools/audit_custom_boundary.mjs](../../tools/audit_custom_boundary.mjs) | 54 | 0 | 待逐行讲解 |
| [tools/audit_recovered_extension.py](../../tools/audit_recovered_extension.py) | 79 | 0 | 待逐行讲解 |
| [tools/build_community.mjs](../../tools/build_community.mjs) | 137 | 137 | 本组已逐行解释 |
| [tools/build_extractor.py](../../tools/build_extractor.py) | 25 | 0 | 待逐行讲解 |
| [tools/build_learning.mjs](../../tools/build_learning.mjs) | 62 | 0 | 待逐行讲解 |
| [tools/capture_bridge_ui.mjs](../../tools/capture_bridge_ui.mjs) | 82 | 0 | 待逐行讲解 |
| [tools/check_cmd_environment.py](../../tools/check_cmd_environment.py) | 87 | 0 | 待逐行讲解 |
| [tools/ci_windows_probe.py](../../tools/ci_windows_probe.py) | 82 | 0 | 待逐行讲解 |
| [tools/inspect-windows.cmd](../../tools/inspect-windows.cmd) | 18 | 0 | 待逐行讲解 |
| [tools/installer_forensics.py](../../tools/installer_forensics.py) | 172 | 0 | 待逐行讲解 |
| [tools/learning_lab.mjs](../../tools/learning_lab.mjs) | 40 | 0 | 待逐行讲解 |
| [tools/learning_ui_lab.mjs](../../tools/learning_ui_lab.mjs) | 23 | 0 | 待逐行讲解 |
| [tools/package_community.py](../../tools/package_community.py) | 53 | 0 | 待逐行讲解 |
| [tools/patch_bridge_ui.mjs](../../tools/patch_bridge_ui.mjs) | 72 | 72 | 本组已逐行解释 |
| [tools/patch_utils.mjs](../../tools/patch_utils.mjs) | 31 | 31 | 本组已逐行解释 |
| [tools/reconstruct_bridge_core.mjs](../../tools/reconstruct_bridge_core.mjs) | 189 | 0 | 待逐行讲解 |
| [tools/recover.py](../../tools/recover.py) | 135 | 0 | 待逐行讲解 |
| [tools/recover_custom_extension.py](../../tools/recover_custom_extension.py) | 154 | 0 | 待逐行讲解 |
| [tools/run-learning.cmd](../../tools/run-learning.cmd) | 27 | 0 | 待逐行讲解 |
| [tools/validate_community.py](../../tools/validate_community.py) | 40 | 0 | 待逐行讲解 |
| [tools/windows_inspect.py](../../tools/windows_inspect.py) | 263 | 0 | 待逐行讲解 |
