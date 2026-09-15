/** Import completion does not imply a Skill can load or its script is safe. */
import type { CustomToolLog } from './custom-tools.js';
export interface SkillImportResult {
  name: string;
  directory: string;
  renamedFrom: string | undefined;
  generatedRunner: true | undefined;
}
export type SkillRunnerResult =
  | { name: string; dirName: string; generated: false }
  | { name: string; dirName: string; generated: true; runnerRel: string };
export declare function importSkill(root: string, source: string, log?: CustomToolLog): SkillImportResult;
export declare function generateSkillRunner(root: string, name: string, log?: CustomToolLog): SkillRunnerResult;
