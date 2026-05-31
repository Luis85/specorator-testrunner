import type { AbsoluteFileSystem } from "../../application/ports/absolute-file-system";
import type {
  TemplateWriteRequest,
  TemplateWriteResult,
  TemplateWriter,
} from "../../application/ports/template-writer";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

/**
 * Writes runner template files via the {@link AbsoluteFileSystem} so the
 * `.testrunner` project stays out of the Obsidian index (BBV §7
 * `RunnerTemplateWriter`). Honours per-file `overwrite` to preserve
 * user-authored automation on repair.
 */
export class RunnerTemplateWriter implements TemplateWriter {
  constructor(private readonly absoluteFs: AbsoluteFileSystem) {}

  async writeTemplates(request: TemplateWriteRequest): Promise<Result<TemplateWriteResult>> {
    const base = await this.absoluteFs.getVaultBasePath();
    if (!base.ok) return err(base.error);
    const root = base.value.replace(/[/\\]$/, "");

    const writtenFiles: VaultPath[] = [];
    const skippedFiles: VaultPath[] = [];

    for (const template of request.templates) {
      const relative = joinVaultPath(request.targetPath, template.path);
      const absolute = `${root}/${relative}`;

      if (!template.overwrite && (await this.absoluteFs.existsAbsolute(absolute))) {
        skippedFiles.push(relative);
        continue;
      }

      const written = await this.absoluteFs.writeAbsolute(absolute, template.content);
      if (!written.ok) return err(written.error);
      writtenFiles.push(relative);
    }

    return ok({ writtenFiles, skippedFiles });
  }
}
