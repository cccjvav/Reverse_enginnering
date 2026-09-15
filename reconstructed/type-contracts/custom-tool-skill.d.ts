/** Candidate consumer-facing Skill API; unknown is an actual fallback reason. */
import type { CustomToolLog, CustomToolManifest, CustomToolLoadOptions } from './custom-tools.js';
export type SkillLoadReason = 'skills-disabled' | 'no-skill-md' | 'skill-md-too-large' | 'invalid-frontmatter'
  | 'invalid-name' | 'reserved-name' | 'description-too-short' | 'entry-configured-missing' | 'entry-missing'
  | 'entry-escapes-workspace' | 'entry-unsupported' | 'over-cap' | 'duplicate-name' | 'unknown';
export type SkillLoadFix = 'enable-skills' | 'open-folder' | 'open-skill-md' | 'generate-runner';
export type SkillLoadDiagnosis =
  | { dirName: string; loaded: true; name: string }
  | { dirName: string; loaded: false; name?: string; reasonCode: SkillLoadReason; reason: string; fix: SkillLoadFix };
export declare const MAX_SKILLS_PER_ROOT: 32;
export declare const MAX_SKILL_BYTES: 65536;
export declare const SKILL_SIDECAR_FILE: 'skill-tool.json';
export declare function loadSkillTools(root: string, log?: CustomToolLog): CustomToolManifest[];
export declare function diagnoseSkillTools(root: string, log?: CustomToolLog, options?: CustomToolLoadOptions): SkillLoadDiagnosis[];
export declare function findSkillEntryScript(skillDir: string, configured?: string): string | undefined;
export declare function resolveSkillDir(root: string, name: string): string | undefined;
export declare function failSkill(dirName: string, reasonCode: SkillLoadReason): Extract<SkillLoadDiagnosis, {loaded: false}>;
