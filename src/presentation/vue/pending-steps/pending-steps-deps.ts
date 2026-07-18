import type { InjectionKey, Ref } from "vue";
import type { VaultFileSystem } from "../../../application/ports/vault-file-system";
import type { WorkspacePort } from "../../../application/ports/workspace-port";
import type { SpecificationService } from "../../../application/services/specification-service";
import type { StepDefinitionService } from "../../../application/services/step-definition-service";
import type { UseCaseService } from "../../../application/services/use-case-service";
import type { EventBus } from "../../../shared/event-bus/event-bus";
import type { PendingStepsTarget } from "../../views/pending-steps-rows";

/**
 * The composition-root slice the Pending Steps companion needs (WS1/C2): the
 * spec/step services for detect/generate, the Use Case lookup to resolve a
 * use-case target to its Feature files, the vault fs for the read-only stub
 * viewer, and the workspace port's system-editor jump. Narrow `Pick`s keep the
 * leaf honest about what it touches (ADR-0033) and let the component test stand
 * in tiny fakes.
 */
export interface PendingStepsDeps {
  specificationService: Pick<
    SpecificationService,
    "listFeatures" | "listStepPatterns" | "detectMissingSteps"
  >;
  stepDefinitionService: Pick<StepDefinitionService, "generate">;
  useCaseService: Pick<UseCaseService, "findById">;
  fs: Pick<VaultFileSystem, "readFile">;
  workspace: Pick<WorkspacePort, "openInSystemEditor">;
  eventBus: EventBus;
}

export const PENDING_STEPS_DEPS = Symbol("pending-steps-deps") as InjectionKey<PendingStepsDeps>;

/**
 * The target as a reactive Ref OWNED by the view (the USE_CASE_DETAIL_ID
 * pattern): setState writes it, getState reads it, the app watches it — so the
 * restore-before-onOpen gap is handled naturally (the app's first load reads
 * whatever setState already stored).
 */
export const PENDING_STEPS_TARGET = Symbol("pending-steps-target") as InjectionKey<
  Ref<PendingStepsTarget>
>;
