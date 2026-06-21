import { Notice, setIcon } from "obsidian";
import type { WorkspacePort } from "../../application/ports/workspace-port";
import type { StoryMapService } from "../../application/services/story-map-service";
import type { StoryMap } from "../../domain/entities/story-map";
import { renderListHeader } from "./list-header";
import { openOrNotice, renderEmptyState, renderLoadError } from "./modal-helpers";

/**
 * The deps the Story Maps body needs to load + render, independent of the leaf:
 * the service it reads, the workspace port for note access, the open/settings
 * callbacks, and a `refresh` it wires to the load-error retry + post-delete
 * re-render (the standalone leaf passes `this.live.schedule`, the later Test Hub
 * its own section re-render).
 */
export interface StoryMapExplorerBodyDeps {
  storyMapService: StoryMapService;
  workspace: WorkspacePort;
  /** Opens the Story Map Builder. */
  openStoryMapBuilder: () => void;
  /** Opens the map-settings modal (edit title/status/product). */
  openMapSettings: (map: StoryMap) => void;
  /** Opens the read-only board for a given map in the main workspace view. */
  openStoryMapBoard: (storyMapId: string) => void;
  /** Re-renders the body (load-error retry + after a delete settles). */
  refresh: () => void;
}

/**
 * Renders the "Story Maps" body into `el` (host-agnostic, ADR-0031): the header
 * bar, then the flat list of Story Maps (product anchor + count chips + actions),
 * or the empty/error state. Builds entirely into the passed element via the
 * shared {@link renderListHeader}, so the standalone leaf and the (later) hub
 * render it identically. Loads its own data so the hub calls it the same way.
 */
export const renderStoryMapExplorerBody = async (
  el: HTMLElement,
  deps: StoryMapExplorerBodyDeps,
): Promise<void> => {
  renderListHeader(el, {
    headerCls: "e2e-test-hub-story-map-header",
    title: "Story Maps",
    actionLabel: "New Story Map",
    onAction: () => deps.openStoryMapBuilder(),
  });

  const maps = await deps.storyMapService.findAll();
  if (!maps.ok) {
    renderLoadError(
      el,
      `Could not load Story Maps: ${maps.error.message}`,
      "Retry loading the Story Maps",
      () => deps.refresh(),
    );
    return;
  }

  if (maps.value.length === 0) {
    renderEmptyState(el, "No Story Maps yet. Create one to shape the product journey across PRDs.");
    return;
  }

  const list = el.createEl("ul", { cls: "e2e-test-hub-story-map-list" });
  for (const map of maps.value) renderRow(list, map, deps);
};

const renderRow = (parent: HTMLElement, map: StoryMap, deps: StoryMapExplorerBodyDeps): void => {
  const li = parent.createEl("li", { cls: "e2e-test-hub-story-map-node" });
  const card = li.createDiv({ cls: "spec-panel e2e-test-hub-story-map-card" });

  // Title row: prominent title (opens the board) + status pill.
  const titleRow = card.createDiv({ cls: "e2e-test-hub-story-map-card-title-row" });
  const open = titleRow.createEl("button", {
    text: map.title,
    cls: "e2e-test-hub-story-map-card-title",
    attr: { "aria-label": `Open the board for ${map.id} ${map.title}` },
  });
  // The board is the primary working surface — the card's title opens it.
  open.addEventListener("click", () => deps.openStoryMapBoard(map.id));

  titleRow.createEl("span", {
    text: map.status,
    cls: "spec-pill",
    attr: { "data-status": map.status, title: `Map status: ${map.status}` },
  });

  // Meta row: id + product anchor + count chips.
  const metaRow = card.createDiv({ cls: "e2e-test-hub-story-map-card-meta" });
  metaRow.createEl("span", {
    text: map.id,
    cls: "e2e-test-hub-story-map-card-id",
  });
  metaRow.createEl("span", {
    text: map.product,
    cls: "e2e-test-hub-story-map-card-product",
    attr: { title: `Anchored to ${map.product}` },
  });
  const chips = metaRow.createDiv({ cls: "e2e-test-hub-story-map-card-chips" });
  const count = (n: number, singular: string, plural = `${singular}s`): string =>
    `${n} ${n === 1 ? singular : plural}`;
  const chip = (text: string): void => {
    chips.createEl("span", { text, cls: "e2e-test-hub-story-map-chip" });
  };
  chip(count(map.users.length, "user"));
  chip(count(map.activities.length, "activity", "activities"));
  chip(count(map.steps.length, "step"));
  chip(count(map.slices.length, "slice"));
  chip(count(map.cards.length, "card"));

  // Action bar: compact icon buttons.
  const actions = card.createDiv({ cls: "e2e-test-hub-story-map-card-actions" });
  addIconAction(actions, "settings", "Settings", `Edit settings for ${map.id}`, () =>
    deps.openMapSettings(map),
  );
  addIconAction(actions, "file-text", "Open note", `Open the ${map.id} note`, () => {
    void openOrNotice(deps.workspace, map.path);
  });
  addIconAction(
    actions,
    "refresh-cw",
    "Refresh tables",
    `Refresh the Markdown tables for ${map.id}`,
    () => {
      void rebuildGrid(map, deps);
    },
  );
  addIconAction(
    actions,
    "trash-2",
    "Delete",
    `Delete Story Map ${map.id}`,
    () => {
      void deleteStoryMap(map, deps);
    },
    "e2e-test-hub-story-map-action-danger",
  );
};

const addIconAction = (
  parent: HTMLElement,
  icon: string,
  label: string,
  ariaLabel: string,
  onClick: () => void,
  extraCls?: string,
): void => {
  const cls = extraCls
    ? `e2e-test-hub-story-map-action ${extraCls}`
    : "e2e-test-hub-story-map-action";
  const button = parent.createEl("button", {
    cls,
    attr: { "aria-label": ariaLabel, title: label },
  });
  setIcon(button, icon);
  button.addEventListener("click", onClick);
};

const rebuildGrid = async (map: StoryMap, deps: StoryMapExplorerBodyDeps): Promise<void> => {
  const result = await deps.storyMapService.rebuildGrid(map.id);
  new Notice(
    result.ok
      ? `Refreshed the tables for ${map.id}.`
      : `Could not refresh ${map.id}: ${result.error.message}`,
  );
};

const deleteStoryMap = async (map: StoryMap, deps: StoryMapExplorerBodyDeps): Promise<void> => {
  const result = await deps.storyMapService.deleteStoryMap(map.id);
  if (!result.ok) {
    new Notice(`Could not delete ${map.id}: ${result.error.message}`);
    return;
  }
  const preserved = result.value.preservedFiles;
  const suffix =
    preserved > 0 ? ` (kept ${preserved} other file${preserved === 1 ? "" : "s"})` : "";
  new Notice(`Deleted ${map.id}${suffix}.`);
  deps.refresh();
};
