import {
  buildDocumentation,
  documentationFileName,
  type OpenableDocumentType,
} from "../content/documentation-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { WorkspacePort } from "../ports/workspace-port";
import type { SettingsService } from "./settings-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

/** Documentation generation + access contract (TIS §8.5, FEAT-024/025). */
export interface DocumentationGenerationService {
  generate(): Promise<Result<GeneratedDocumentation>>;
  /** Opens a generated doc and emits `documentation.opened` (US-046). */
  open(documentType?: OpenableDocumentType): Promise<Result<OpenedDocumentation>>;
}

export interface GeneratedDocumentation {
  documents: VaultPath[]; // index, Getting Started, User Manual, Troubleshooting (per G5)
}

export interface OpenedDocumentation {
  path: VaultPath;
  documentType: OpenableDocumentType;
}

export class DefaultDocumentationGenerationService
  implements DocumentationGenerationService
{
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly workspace?: WorkspacePort,
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

  // FEAT-025 / US-046 (UC-021/022/023): open a generated doc in the workspace
  // and record the access. Defaults to the navigational `index` hub — the entry
  // point whose Contents links out to every other generated doc — so the generic
  // "Open Documentation" command lands users on the overview, not a single guide.
  async open(
    documentType: OpenableDocumentType = "index",
  ): Promise<Result<OpenedDocumentation>> {
    if (!this.workspace) {
      return err(
        appError("INIT_FAILED", "Documentation access requires a workspace."),
      );
    }
    const settings = await this.settingsService.load();
    const path = joinVaultPath(
      settings.paths.documentationPath,
      documentationFileName(settings, documentType),
    );
    // Ensure the WHOLE doc set exists WITHOUT emitting documentation.generated —
    // opening docs is access, not generation (Event Catalog / UC-021..023). We
    // write every doc (not just the requested one) so the entry point's links to
    // the index hub / manual / troubleshooting resolve even when the user opens
    // docs before ever running Generate Documentation.
    for (const doc of buildDocumentation(settings)) {
      const docPath = joinVaultPath(settings.paths.documentationPath, doc.fileName);
      const ensured = await this.writeIfAbsent(docPath, doc.content);
      if (!ensured.ok) return err(ensured.error);
    }
    const opened = await this.workspace.openFile(path);
    if (!opened.ok) {
      return err(
        appError("INIT_FAILED", `Could not open documentation "${path}".`, {
          cause: opened.error,
        }),
      );
    }
    // TIS §12: `documentation.opened` carries the path + the document type.
    await this.eventBus.publish(
      createEvent("documentation.opened", { path, documentType }),
    );
    return ok({ path, documentType });
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
