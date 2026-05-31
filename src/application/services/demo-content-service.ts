import {
  buildDemoUseCaseNote,
  DEMO_FEATURE_CONTENT,
  DEMO_FEATURE_FILE_NAME,
  DEMO_USE_CASE_FILE_NAME,
  DEMO_USE_CASE_ID,
  DEMO_USE_CASE_TITLE,
} from "../content/demo-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

export interface DemoContentResult {
  useCasePath: VaultPath;
  featurePath: VaultPath;
}

/**
 * Generates the demo Use Case + Feature shipped by the Initialization Wizard
 * (FEAT-005, US-006/US-007). The demo is the first-run smoke check; it is NOT
 * auto-executed (AD-1).
 */
export interface DemoContentService {
  generate(): Promise<Result<DemoContentResult>>;
}

export class DefaultDemoContentService implements DemoContentService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
  ) {}

  async generate(): Promise<Result<DemoContentResult>> {
    const settings = await this.settingsService.load();
    const featurePath = joinVaultPath(settings.paths.featureFilesPath, DEMO_FEATURE_FILE_NAME);
    const useCasePath = joinVaultPath(settings.paths.useCasesPath, DEMO_USE_CASE_FILE_NAME);

    const feature = await this.writeIfAbsent(featurePath, DEMO_FEATURE_CONTENT);
    if (!feature.ok) return err(feature.error);

    const useCase = await this.writeIfAbsent(useCasePath, buildDemoUseCaseNote(featurePath));
    if (!useCase.ok) return err(useCase.error);

    await this.eventBus.publish(
      // §4 payload { useCaseId, title, path }; §19 correlationId = useCaseId.
      createEvent(
        "usecase.created",
        { useCaseId: DEMO_USE_CASE_ID, title: DEMO_USE_CASE_TITLE, path: useCasePath },
        { correlationId: DEMO_USE_CASE_ID },
      ),
    );
    await this.eventBus.publish(
      // §5 payload key is `featurePath` (matches specification-service), not `path`.
      createEvent("specification.created", {
        useCaseId: DEMO_USE_CASE_ID,
        featurePath,
      }),
    );
    await this.eventBus.publish(
      createEvent("specification.linkedToUseCase", {
        useCaseId: DEMO_USE_CASE_ID,
        featurePath,
      }),
    );

    return ok({ useCasePath, featurePath });
  }

  private async writeIfAbsent(path: VaultPath, content: string): Promise<Result<void>> {
    if (await this.fs.exists(path)) return ok(undefined);
    const created = await this.fs.createFile(path, content);
    if (!created.ok) {
      return err(
        appError("INIT_FAILED", `Could not write demo content "${path}".`, {
          cause: created.error,
        }),
      );
    }
    return ok(undefined);
  }
}
