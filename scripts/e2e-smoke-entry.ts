/**
 * Bundle entry for scripts/e2e-smoke.mjs: re-exports the REAL template builder
 * + demo content from src/, so the smoke run exercises exactly what the plugin
 * ships (no copies to drift). esbuild bundles this on the fly; it is never
 * part of the plugin build.
 */
export {
  DEMO_FEATURE_CONTENT,
  DEMO_FEATURE_FILE_NAME,
} from "../src/application/content/demo-content";
export { DEFAULT_SETTINGS } from "../src/domain/settings/settings";
export { buildRunnerTemplates } from "../src/infrastructure/runner/templates/runner-templates";
