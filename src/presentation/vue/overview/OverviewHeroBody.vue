<script setup lang="ts">
/**
 * The Overview hero body (ADR-0033 Phase 3) in intent order: the health hero
 * (pass-rate ring + verdict + last-run line) → the primary actions (New Use Case
 * / Run all) → the KPI funnel bars. Keeps the Initialize CTA gate and the
 * retryable snapshot load-error. Self-loads and stays live via useEventBus,
 * reusing the pure projections (projectHealthHero / projectLastRun /
 * projectDashboard). The Vue twin of `renderOverviewHeroBody`.
 */
import { useOverviewSnapshot } from "./use-overview-snapshot";
import { projectDashboard, type KpiTile } from "../../views/dashboard-rows";
import {
  formatLastRunAge,
  projectHealthHero,
  projectLastRun,
  type HealthHero,
  type HealthLastRun,
} from "../../views/health-hero-rows";
import type { HeroBodyDeps } from "./overview-body-deps";

const props = defineProps<{ deps: HeroBodyDeps }>();

interface HeroLoaded {
  hero: HealthHero;
  lastRun: HealthLastRun | null;
  kpis: KpiTile[];
}

// The shared Overview snapshot loader; the hero additionally reads the durable
// execution log for the last-run line. `hidden` (an un-scaffolded vault) draws
// the Initialize CTA here (recent-runs draws nothing) — same state, different
// render.
const { state, refresh } = useOverviewSnapshot(
  props.deps,
  async (snapshot): Promise<HeroLoaded> => ({
    hero: projectHealthHero(snapshot),
    lastRun: projectLastRun(await props.deps.executionLogService.latest()),
    kpis: projectDashboard(snapshot).kpis,
  }),
);

// The last-run recency label — log-driven, formatted against the current clock.
const lastRunLine = (lastRun: HealthLastRun): string => {
  const when = formatLastRunAge(lastRun.finishedAt, Date.now());
  return `Last run: ${lastRun.statusLabel}${when === null ? "" : ` · ${when}`}`;
};
</script>

<template>
  <div>
    <div v-if="state.kind === 'hidden'" class="spec-panel e2e-test-hub-init-cta">
      <p class="e2e-test-hub-init-cta-text">
        Set up your Test Hub to create Use Cases, write specifications, and run tests in this vault.
      </p>
      <button class="mod-cta" aria-label="Initialize the Test Hub" @click="deps.openWizard()">
        Initialize Test Hub
      </button>
    </div>

    <template v-else-if="state.kind === 'error'">
      <p>Could not load the health summary: {{ state.message }}</p>
      <button class="mod-cta" aria-label="Retry loading the health summary" @click="refresh">
        Retry
      </button>
    </template>

    <template v-else-if="state.kind === 'loaded'">
      <div class="spec-hub-hero" role="group" :aria-label="state.data.hero.ariaLabel">
        <div v-if="state.data.hero.kind === 'no-rate'" class="spec-hub-hero-empty">
          {{ state.data.hero.message }}
        </div>
        <template v-else>
          <div
            class="spec-hub-hero-ring"
            aria-hidden="true"
            :style="{ '--spec-hero-rate': state.data.hero.ratePercent }"
          >
            <div class="spec-hub-hero-percent">{{ state.data.hero.ratePercent }}%</div>
          </div>
          <div class="spec-hub-hero-verdict">{{ state.data.hero.verdict }}</div>
        </template>

        <div
          v-if="state.data.lastRun !== null"
          class="spec-hub-hero-last-run"
          :data-tone="state.data.lastRun.tone"
        >
          {{ lastRunLine(state.data.lastRun) }}
        </div>
      </div>

      <div class="spec-hub-hero-actions">
        <button
          class="spec-hub-hero-action mod-cta"
          aria-label="Create a new Use Case"
          @click="deps.openCreateUseCase()"
        >
          New Use Case
        </button>
        <button class="spec-hub-hero-action" aria-label="Run all tests" @click="deps.runAll()">
          Run all tests
        </button>
      </div>

      <div class="spec-hub-funnel" role="group" aria-label="Use Case funnel">
        <button
          v-for="tile in state.data.kpis"
          :key="tile.label"
          class="spec-hub-funnel-tile"
          :data-tone="tile.tone"
          :aria-label="tile.ariaLabel"
          :style="{ '--spec-funnel-fill': tile.percent ?? 100 }"
          @click="deps.navigate(tile.navigateTo)"
        >
          <div class="spec-hub-funnel-value">{{ tile.value }}</div>
          <div class="spec-hub-funnel-label">{{ tile.label }}</div>
          <div v-if="tile.percent !== null" class="spec-hub-funnel-percent">
            {{ tile.percent }}%
          </div>
        </button>
      </div>
    </template>
  </div>
</template>
