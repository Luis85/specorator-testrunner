import type { InjectionKey, Ref } from "vue";
import type { UseCaseId } from "../../../domain/value-objects/identifiers";
import type { UseCaseDetailDeps } from "../../views/use-case-detail-view";

/** The detail leaf's dependency slice, provided into the mounted Vue tree. */
export const USE_CASE_DETAIL_DEPS = Symbol("uc-detail-deps") as InjectionKey<UseCaseDetailDeps>;

/**
 * The target Use Case id as a reactive `Ref` OWNED by the view (ADR-0033). The
 * view writes it from `setState` and reads it from `getState`; the component
 * watches it to reload on re-target. Because the ref holds the value even before
 * the app mounts, the restore-before-`onOpen` gap is handled naturally — the
 * component's initial load reads whatever `setState` already stored.
 */
export const USE_CASE_DETAIL_ID = Symbol("uc-detail-id") as InjectionKey<Ref<UseCaseId | null>>;
