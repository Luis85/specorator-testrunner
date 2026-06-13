import { describe, expect, it, vi } from "vitest";
import {
  EditUseCaseModal,
  prdDropdownOptions,
  type EditUseCaseDeps,
} from "../src/presentation/views/edit-use-case-modal";
import { unsafeVaultPath } from "../src/domain/value-objects/vault-path";
import type { App } from "obsidian";

describe("prdDropdownOptions", () => {
  it("prepends a none option and orders PRDs by id", () => {
    expect(
      prdDropdownOptions([
        { id: "PRD-002", title: "Reporting" },
        { id: "PRD-001", title: "Dashboard" },
      ]),
    ).toEqual([
      { value: "", label: "— None —" },
      { value: "PRD-001", label: "PRD-001: Dashboard" },
      { value: "PRD-002", label: "PRD-002: Reporting" },
    ]);
  });
});

type ModalWithPrivates = Record<string, unknown>;

const makeModal = (prdId: string | undefined) => {
  const updateMetadata = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { id: "UC-001", title: "A" } });
  const assignUseCaseToPrd = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const findAll = vi.fn().mockResolvedValue({ ok: true, value: [] });
  const deps: EditUseCaseDeps = {
    useCaseService: { updateMetadata },
    prdService: { findAll, assignUseCaseToPrd },
    useCase: {
      id: "UC-001",
      title: "A",
      status: "specified",
      path: unsafeVaultPath("Use Cases/UC-001.md"),
      prdId,
    },
  };
  const app = {} as App;
  const modal = new EditUseCaseModal(app, deps);
  vi.spyOn(modal, "close").mockImplementation(() => {});
  return { modal, updateMetadata, assignUseCaseToPrd };
};

const submit = (modal: EditUseCaseModal): Promise<void> =>
  ((modal as unknown as ModalWithPrivates).submit as () => Promise<void>).call(modal);

const setSelected = (modal: EditUseCaseModal, prdId: string): void => {
  (modal as unknown as ModalWithPrivates).selectedPrdId = prdId;
};

describe("EditUseCaseModal PRD linking", () => {
  it("links the Use Case to the newly selected PRD on save", async () => {
    const { modal, assignUseCaseToPrd } = makeModal(undefined);
    setSelected(modal, "PRD-003");
    await submit(modal);
    expect(assignUseCaseToPrd).toHaveBeenCalledWith("Use Cases/UC-001.md", "PRD-003");
  });

  it("does not re-link when the selection is unchanged", async () => {
    const { modal, assignUseCaseToPrd } = makeModal("PRD-003");
    await submit(modal); // selection stays PRD-003
    expect(assignUseCaseToPrd).not.toHaveBeenCalled();
  });

  it("does not assign when the selection is cleared to none", async () => {
    const { modal, assignUseCaseToPrd } = makeModal("PRD-003");
    setSelected(modal, "");
    await submit(modal);
    expect(assignUseCaseToPrd).not.toHaveBeenCalled();
  });
});
