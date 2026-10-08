export interface MergeVariantInput {
  label: string;
  content: string;
}

/** When no explicit merge model is set, the model that gave the first answer
 * is the primary model, not whichever branch model is currently selected. */
export interface MergeModelReference { vendor: string; modelId: string }
export function resolveMergeModelReference(configured: MergeModelReference | undefined, primary: unknown): MergeModelReference | undefined {
  if (configured) return configured;
  if (!primary || typeof primary !== "object") return undefined;
  const record = primary as Record<string, unknown>;
  // The displayed modelId may be a bare name shared by several API providers.
  // Prefer the exact catalog key captured from the first answer.
  const modelId = typeof record.catalogModelId === "string" && record.catalogModelId.trim()
    ? record.catalogModelId : record.modelId;
  if (typeof record.vendor !== "string" || !record.vendor.trim()
      || typeof modelId !== "string" || !modelId.trim()) return undefined;
  return { vendor: record.vendor.trim(), modelId: modelId.trim() };
}

const MERGE_CONTRACT = [
  "You are the merge and verification model for a multi-model planning round in ShunCode.",
  "",
  "# Input",
  "You receive one user question and several independent answers produced by different models from the same starting context. Every answer is labeled with its model name. Answers may contain tool traces and file evidence.",
  "",
  "# Verification",
  "- When branches disagree about workspace facts (files, code paths, APIs, configuration, runtime behavior), verify the disputed facts yourself by reading files with the available read-only tools instead of guessing.",
  "- Only read files when opinions differ or a claim lacks evidence. Do not re-verify facts that all branches agree on.",
  "- Record which files you read and what you verified.",
  "",
  "# Output format (fixed, in the language of the user question)",
  "## 共识要点 (Consensus)",
  "Points every branch agrees on.",
  "",
  "## 分歧点 (Disagreements)",
  "Points where branches disagree, with your verified conclusion for each.",
  "",
  "## 最终方案 (Final Plan)",
  "The single actionable plan going forward, led by the primary merge model. Begin with the primary answer, incorporate justified improvements, resolve verified disagreements, and explain any correction to the original answer.",
  "",
  "## 验证依据 (Verification Evidence)",
  "Files read and facts verified, or 'no file verification needed' when the branches agreed on all facts.",
  "",
  "# Rules",
  "- Prefer consensus; do not manufacture disagreement.",
  "- The first answer is the primary model’s baseline. Produce the final judgment as the primary merge model: synthesize useful, evidenced suggestions from later branches, but never decide by branch majority vote. If verified facts contradict the baseline, correct them explicitly instead of preserving a known error.",
  "- The final plan must be concrete enough to execute.",
  "- List remaining risks briefly at the end of the final plan.",
  "- Do not invent file paths, line numbers, or facts you did not verify.",
].join("\n");

export function buildMergePrompt(question: string, variants: readonly MergeVariantInput[], allowReadTools: boolean): string {
  const sections: string[] = [];
  for (const [index, variant] of variants.entries()) {
    const bounded = variant.content.length > 40_000
      ? variant.content.slice(0, 24_000) + "\n\n…[branch output truncated: omitted middle content]\n\n" + variant.content.slice(-16_000)
      : variant.content;
    sections.push(index === 0
      ? `### 主模型原始答案（模型：${variant.label}）\n${bounded}`
      : `### 参考分支 ${index + 1}（模型：${variant.label}）\n${bounded}`);
  }
  return [
    MERGE_CONTRACT,
    allowReadTools
      ? ""
      : "File verification tools are disabled for this merge. Resolve factual disagreements from the provided answers only and mark unverifiable facts as such.",
    "",
    "# User question",
    question.trim() || "(empty question)",
    "",
    "# Branch answers",
    ...sections,
  ].filter((line, index, all) => line !== "" || index === 0 || all[index - 1] !== "").join("\n");
}
