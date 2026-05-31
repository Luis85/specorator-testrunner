import type { VaultPath } from "../../domain/value-objects/identifiers";
import type { Result } from "../../shared/result/result";

/**
 * Writes a set of template files beneath a target path (TIS §9.6). Used to
 * materialise the `.testrunner` runtime; honours per-file `overwrite` so a
 * repair never clobbers user-authored steps/pages.
 */
export interface TemplateWriter {
  writeTemplates(request: TemplateWriteRequest): Promise<Result<TemplateWriteResult>>;
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
