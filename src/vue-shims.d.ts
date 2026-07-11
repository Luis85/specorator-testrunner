// Lets `tsc` and the IDE resolve `*.vue` single-file component imports (ADR-0033).
// The components themselves are type-checked by `vue-tsc`/the SFC compiler at
// build time; this shim only gives the plain `tsc --noEmit` typecheck a module
// shape for the import so the presentation layer compiles.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
