import { defineStore } from "pinia";
import { ref } from "vue";
import type { UseCaseKpiFilter } from "../../views/dashboard-rows";
import { EVIDENCE_PAGE_SIZE, type EvidenceStatusFilter } from "../../views/evidence-explorer-rows";

/**
 * The hub's EPHEMERAL view-state (ADR-0033) — the fields that lived as mutable
 * class members on the hand-rolled HubView: the Evidence filter + page limit, the
 * Use Cases KPI funnel filter, and the onboarding rail's collapse. Presentation
 * state only: none of it is a domain source of truth, and none is persisted in
 * getState (it resets on a workspace reload, exactly as before). A per-leaf Pinia
 * store (one `createPinia` per mounted hub app) so two hub leaves never share it —
 * though the hub is a singleton home, this keeps the contract honest.
 */
export const useHubStore = defineStore("hub", () => {
  const evidenceFilter = ref<EvidenceStatusFilter>("all");
  const evidenceVisibleLimit = ref(EVIDENCE_PAGE_SIZE);
  const useCaseFilter = ref<UseCaseKpiFilter>("all");
  const onboardingCollapsed = ref(false);

  const setEvidenceFilter = (filter: EvidenceStatusFilter): void => {
    evidenceFilter.value = filter;
  };
  const loadOlderEvidence = (): void => {
    evidenceVisibleLimit.value += EVIDENCE_PAGE_SIZE;
  };
  const setUseCaseFilter = (filter: UseCaseKpiFilter): void => {
    useCaseFilter.value = filter;
  };
  const clearUseCaseFilter = (): void => {
    useCaseFilter.value = "all";
  };
  const toggleOnboardingCollapsed = (): void => {
    onboardingCollapsed.value = !onboardingCollapsed.value;
  };

  return {
    evidenceFilter,
    evidenceVisibleLimit,
    useCaseFilter,
    onboardingCollapsed,
    setEvidenceFilter,
    loadOlderEvidence,
    setUseCaseFilter,
    clearUseCaseFilter,
    toggleOnboardingCollapsed,
  };
});
