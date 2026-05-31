import { buildDocumentation } from "../content/documentation-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** Documentation generation contract (TIS §8.5). */
export interface DocumentationGenerationService {
  generate(): Promise<Result<GeneratedDocumentation>>;
}

export interface GeneratedDocumentation {
  documents: VaultPath[]; // Getting Started, User Manual, Troubleshooting (per G5)
}

export class DefaultDocumentationGenerationService
  implements DocumentationGenerationService
{
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
  ) {}

  async generate(): Promise<Result<GeneratedDocumentation>> {
    const settings = await this.settingsService.load();
    const documents: VaultPath[] = [];

    for (const doc of buildDocumentation(settings)) {
      const path = joinVaultPath(settings.paths.documentationPath, doc.fileName);
      const written = await this.writeIfAbsent(path, doc.content);
      if (!written.ok) return err(written.error);
      documents.push(path);
    }

    await this.eventBus.publish(createEvent("documentation.generated", { documents }));
    return ok({ documents });
  }

  private async writeIfAbsent(path: VaultPath, content: string): Promise<Result<void>> {
    if (await this.fs.exists(path)) return ok(undefined);
    const created = await this.fs.createFile(path, content);
    if (!created.ok) {
      return err(
        appError("INIT_FAILED", `Could not write documentation "${path}".`, {
          cause: created.error,
        }),
      );
    }
    return ok(undefined);
  }
}
