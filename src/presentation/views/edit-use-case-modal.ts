import { type App, Modal, Notice, Setting } from "obsidian";
import type { UseCaseService } from "../../application/services/use-case-service";
import type { PrdService } from "../../application/services/prd-service";
import {
  USE_CASE_STATUSES,
  type UseCase,
  type UseCaseStatus,
} from "../../domain/entities/use-case";
import { submitOnEnter } from "./modal-helpers";

export interface EditUseCaseDeps {
  // updateMetadata edits title/status; assignToPrd persists a PRD re-link
  // (Task 16c) through the Use Case note's own write queue.
  useCaseService: Pick<UseCaseService, "updateMetadata" | "assignToPrd">;
  // Lists PRDs for the Parent PRD dropdown (Task 16c).
  prdService: Pick<PrdService, "findAll">;
  /** The Use Case being edited (prefills the fields). */
  useCase: Pick<UseCase, "id" | "title" | "status" | "prdId">;
}

/**
 * The Parent PRD dropdown options: a leading "none" plus every PRD ordered by
 * id. Pure so it can be unit-tested without the modal DOM.
 */
export const prdDropdownOptions = (
  prds: { id: string; title: string }[],
): { value: string; label: string }[] => [
  { value: "", label: "— None —" },
  ...[...prds]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ value: p.id, label: `${p.id}: ${p.title}` })),
];

/**
 * Quick-edit modal for a Use Case's title and business status (Wave G §3,
 * UC-005), opened from the Use Case detail header — so a Product Owner never
 * has to hand-edit YAML frontmatter. Mirrors {@link AddEnvironmentModal}: an
 * autofocused prefilled text input (Enter submits), a status dropdown over the
 * {@link USE_CASE_STATUSES} union, inline validation, and a Save CTA.
 *
 * Deliberately NOT editable here: the id (immutable identity) and the
 * automation status — `automationStatus` is owned by the
 * UseCaseAutomationPolicy (ADR-0017), derived from the UC's Features + last
 * run, so a hand-set value would be silently overwritten on the next roll-up.
 *
 * The detail view refreshes itself via its existing `usecase.updated`
 * subscription once the service publishes, so no callback is threaded through.
 */
export class EditUseCaseModal extends Modal {
  private useCaseTitle: string;
  private status: UseCaseStatus;
  private readonly originalPrdId: string;
  private selectedPrdId: string;
  private errorEl: HTMLElement | null = null;
  private submitting = false;

  constructor(
    app: App,
    private readonly deps: EditUseCaseDeps,
  ) {
    super(app);
    this.useCaseTitle = deps.useCase.title;
    this.status = deps.useCase.status;
    this.originalPrdId = deps.useCase.prdId ?? "";
    this.selectedPrdId = this.originalPrdId;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Edit ${this.deps.useCase.id}` });

    new Setting(contentEl).setName("Title").addText((text) => {
      text.setValue(this.useCaseTitle).onChange((value) => (this.useCaseTitle = value));
      // Enter submits (shared helper) so the keyboard flow doesn't force a
      // mouse trip.
      submitOnEnter(text.inputEl, () => void this.submit());
      // Autofocus the title so the user can start editing immediately.
      text.inputEl.focus();
    });

    new Setting(contentEl).setName("Status").addDropdown((dropdown) => {
      for (const status of USE_CASE_STATUSES) dropdown.addOption(status, status);
      dropdown.setValue(this.status).onChange((value) => {
        // The dropdown only offers USE_CASE_STATUSES values; the service still
        // re-validates at runtime as the authoritative gate.
        this.status = value as UseCaseStatus;
      });
    });

    // Populated asynchronously so the modal opens immediately; the dropdown
    // appears once the PRD list resolves.
    const prdSetting = new Setting(contentEl)
      .setName("Parent prd")
      .setDesc("Link this Use Case to a prd (clearing a link is not supported here).");
    void this.renderPrdDropdown(prdSetting);

    this.errorEl = contentEl.createDiv({ cls: "e2e-test-hub-settings-errors" });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Save")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async renderPrdDropdown(setting: Setting): Promise<void> {
    const prds = await this.deps.prdService.findAll();
    if (!prds.ok) return; // a missing PRD list just hides the optional control
    setting.addDropdown((dropdown) => {
      for (const option of prdDropdownOptions(prds.value)) {
        dropdown.addOption(option.value, option.label);
      }
      dropdown.setValue(this.selectedPrdId).onChange((value) => {
        this.selectedPrdId = value;
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.errorEl = null;
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;

    // Client-side guard so an empty/whitespace title doesn't round-trip to the
    // service (which stays the authoritative validator).
    const title = this.useCaseTitle.trim();
    if (title === "") {
      this.showError("A Use Case title is required.");
      return;
    }

    this.submitting = true;
    const result = await this.deps.useCaseService.updateMetadata(this.deps.useCase.id, {
      title,
      status: this.status,
    });
    this.submitting = false;

    if (!result.ok) {
      this.showError(result.error.message);
      return;
    }

    // Persist a PRD re-link if the user picked a different (non-empty) parent.
    // Clearing to "none" is intentionally a no-op for V1 (a required link
    // shouldn't be silently dropped from the editor).
    if (this.selectedPrdId !== "" && this.selectedPrdId !== this.originalPrdId) {
      const linked = await this.deps.useCaseService.assignToPrd(
        this.deps.useCase.id,
        this.selectedPrdId,
      );
      if (!linked.ok) {
        this.showError(
          `Saved, but could not link to ${this.selectedPrdId}: ${linked.error.message}`,
        );
        return;
      }
    }

    new Notice(`Updated ${result.value.id}.`);
    this.close();
  }

  /** Inline (not a Notice): the message belongs next to the fields it's about. */
  private showError(message: string): void {
    this.errorEl?.empty();
    this.errorEl?.createDiv({ cls: "e2e-test-hub-settings-error-row", text: `✗ ${message}` });
  }
}
