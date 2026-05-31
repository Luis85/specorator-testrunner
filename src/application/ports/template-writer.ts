import type { TestHubSettings } from "../../domain/settings/settings";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/**
 * Writes a set of template files beneath a target path (TIS §9.6). Used to
 * materialise the `.testrunner` runtime; honours per-file `overwrite` so a
 * repair never clobbers user-authored steps/pages.
 *
 * `buildRunnerTemplates` is the seam (P3-7) that keeps the runtime-technology
 * SOURCE in infrastructure: the application services call this port to obtain
 * the `.testrunner` template set for the given settings instead of importing
 * the Playwright/Cucumber content module (which now lives under
 * `infrastructure/runner/templates/`). The infra adapter produces them; the
 * application never depends on infrastructure.
 */
export interface TemplateWriter {
  writeTemplates(request: TemplateWriteRequest): Promise<Result<TemplateWriteResult>>;
  /** The `.testrunner` template set for `settings` (runtime-tech source). */
  buildRunnerTemplates(settings: TestHubSettings): TemplateFile[];
}

export interface TemplateWriteRequest {
  targetPath: VaultPath;
  templates: TemplateFile[];
}

export interface TemplateFile {
  path: VaultPath; // relative to targetPath
  content: string;
  overwrite: boolean;
}

export interface TemplateWriteResult {
  writtenFiles: VaultPath[];
  skippedFiles: VaultPath[];
}
