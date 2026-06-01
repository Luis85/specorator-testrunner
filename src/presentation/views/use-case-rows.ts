import type { UseCase } from "../../domain/entities/use-case";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/** A Use Case projected to the columns US-017 displays. */
export interface UseCaseRow {
  id: string;
  title: string;
  status: string;
  automationStatus: string;
  path: VaultPath;
}

/** Pure projection so the dashboard's row shaping is unit-testable. */
export const projectUseCaseRows = (useCases: UseCase[]): UseCaseRow[] =>
  useCases.map((useCase) => ({
    id: useCase.id,
    title: useCase.title,
    status: useCase.status,
    automationStatus: useCase.automationStatus,
    path: useCase.path,
  }));
