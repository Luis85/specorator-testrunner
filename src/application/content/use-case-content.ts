import type { UseCase } from "../../domain/entities/use-case";
import type { UseCaseId } from "../../domain/value-objects/identifiers";
import { buildNote } from "../../shared/utils/frontmatter";

/** Strips characters Obsidian/OSes disallow in filenames, collapsing spaces. */
const sanitizeTitle = (title: string): string =>
  title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** `UC-002 My Title.md` — mirrors the demo Use Case naming. */
export const useCaseFileName = (id: UseCaseId, title: string): string => {
  const clean = sanitizeTitle(title);
  return clean ? `${id} ${clean}.md` : `${id}.md`;
};

/**
 * Renders a Use Case note (frontmatter schema TIS §10.1). The frontmatter is
 * the source of truth the {@link UseCaseRepository} reads back; the body is
 * human-facing and regenerated only on create.
 */
export const buildUseCaseNote = (useCase: UseCase): string => {
  const featureLinks =
    useCase.featureFiles.length > 0
      ? useCase.featureFiles.map((path) => `- [[${path}]]`).join("\n")
      : "_No Feature Specification linked yet._";
  const suiteLines =
    useCase.suites.length > 0
      ? useCase.suites.map((suite) => `- \`${suite}\``).join("\n")
      : "_Not assigned to a suite yet._";

  return buildNote(
    {
      type: "use-case",
      id: useCase.id,
      title: useCase.title,
      status: useCase.status,
      automation_status: useCase.automationStatus,
      description: useCase.description,
      feature_files: useCase.featureFiles.length > 0 ? useCase.featureFiles : undefined,
      suites: useCase.suites.length > 0 ? useCase.suites : undefined,
    },
    `# ${useCase.id} ${useCase.title}

${useCase.description ? `> ${useCase.description}\n` : ""}
## Feature Specifications

${featureLinks}

## Suites

${suiteLines}
`,
  );
};
