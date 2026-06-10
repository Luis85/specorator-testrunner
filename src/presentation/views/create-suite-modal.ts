import { type App, Modal, Notice, Setting } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { FeatureInsightService } from "../../application/services/feature-insight-service";
import type { SuiteService } from "../../application/services/suite-service";
import { tagExpressionPreview } from "./suite-rows";

/** Debounce for the live Tag Expression preview (Wave F). */
const PREVIEW_DEBOUNCE_MS = 400;

export interface CreateSuiteDeps {
  suiteService: SuiteService;
  workspace: WorkspacePort;
  // Wave F insight: powers the live "Matches N scenarios" preview under the
  // tag-expression field. Informational only — creation is never blocked.
  featureInsight: Pick<FeatureInsightService, "countMatchingScenarios">;
}

/**
 * Prompts for a suite name/description and tag expression, then creates it
 * (US-022/US-023, UC-008). Membership is the Cucumber tag expression (AD-4):
 * the suite includes exactly the scenarios that expression matches — never an
 * explicit scenario list. `create` slugifies the name into the suite id.
 */
export class CreateSuiteModal extends Modal {
  private suiteName = "";
  private description = "";
  private tagExpression = "";
  private submitting = false;
  // Debounce timer + monotonic token for the Tag Expression preview: the token
  // discards a slow count that resolves after the user has typed further, so a
  // stale result can never overwrite a newer preview.
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewToken = 0;

  constructor(
    app: App,
    private readonly deps: CreateSuiteDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create Test Suite" });

    // Enter submits in the single-line text inputs (mirrors
    // AddEnvironmentModal) so the keyboard flow doesn't force a mouse trip; the
    // description textarea keeps Enter for newlines and is NOT wired this way.
    const submitOnEnter = (input: HTMLInputElement): void => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
    };

    new Setting(contentEl).setName("Name").addText((text) => {
      text.setPlaceholder("e.g. Checkout Smoke").onChange((value) => (this.suiteName = value));
      submitOnEnter(text.inputEl);
      // Autofocus the first input so the user can start typing immediately
      // instead of tabbing/clicking into the field first.
      text.inputEl.focus();
    });
    new Setting(contentEl)
      .setName("Description")
      .addTextArea((area) =>
        area.setPlaceholder("Optional summary").onChange((value) => (this.description = value)),
      );
    new Setting(contentEl)
      .setName("Tag expression")
      .setDesc("Cucumber tag expression deciding membership (AD-4).")
      .addText((text) => {
        text.setPlaceholder("@smoke and not @wip").onChange((value) => {
          this.tagExpression = value;
          this.schedulePreview(previewEl);
        });
        submitOnEnter(text.inputEl);
      });

    // Wave F insight: a live, debounced "Matches N scenarios" preview under the
    // tag-expression field. aria-live announces updates to assistive tech;
    // the line is informational only (0 matches still creates).
    const previewEl = contentEl.createDiv({
      cls: "e2e-test-hub-suite-tag-preview",
      attr: { "aria-live": "polite" },
    });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Create")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  onClose(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    // Invalidate any in-flight count so it can't write into the emptied modal.
    this.previewToken += 1;
    this.contentEl.empty();
  }

  /**
   * Debounced (~400 ms) live preview of how many scenarios the typed Tag
   * Expression matches, reusing the same insight dep as the suites explorer.
   * Renders via the pure {@link tagExpressionPreview} projection.
   */
  private schedulePreview(previewEl: HTMLElement): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    const token = ++this.previewToken;
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      const expression = this.tagExpression.trim();
      if (expression === "") {
        previewEl.empty();
        delete previewEl.dataset.status;
        return;
      }
      void this.deps.featureInsight.countMatchingScenarios(expression).then((counted) => {
        // A newer keystroke superseded this count, or the modal closed.
        if (token !== this.previewToken || !previewEl.isConnected) return;
        const preview = tagExpressionPreview(counted);
        previewEl.setText(preview.text);
        if (preview.status === null) delete previewEl.dataset.status;
        else previewEl.dataset.status = preview.status;
      });
    }, PREVIEW_DEBOUNCE_MS);
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;

    // Client-side guard so an empty/whitespace name doesn't round-trip to the
    // service (which stays the authoritative validator). Mirrors SlugPromptModal.
    const name = this.suiteName.trim();
    const tagExpression = this.tagExpression.trim();
    if (name === "") {
      new Notice("Please enter a name for the Test Suite.");
      return;
    }
    if (tagExpression === "") {
      new Notice("Please enter a tag expression for the Test Suite.");
      return;
    }

    this.submitting = true;
    const result = await this.deps.suiteService.create({
      name,
      description: this.description.trim(),
      tagExpression,
    });
    this.submitting = false;

    if (!result.ok) {
      new Notice(`Could not create Test Suite: ${result.error.message}`);
      return;
    }
    new Notice(`Created ${result.value.name}.`);
    this.close();
    await this.deps.workspace.openFile(result.value.path);
  }
}
