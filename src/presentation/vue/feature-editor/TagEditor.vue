<script setup lang="ts">
/**
 * Tag chips + a datalist-backed input (ADR-0033): click a chip to remove its tag,
 * type + Enter/blur to add one. The Vue twin of `renderTagEditor` — same classes,
 * ARIA, and the shared normalizeTag rule. Mutates the passed reactive `tags` array
 * and commits through the injected controller.
 */
import { inject, ref } from "vue";
import { FEATURE_EDITOR } from "./feature-editor-controller";
import { TAG_DATALIST_ID } from "./datalist-ids";
import { normalizeTag } from "../../views/feature-editor-format";

const props = defineProps<{ tags: string[]; label: string }>();
const ctrl = inject(FEATURE_EDITOR)!;
const draft = ref("");

const addTag = (): void => {
  const tag = normalizeTag(draft.value);
  draft.value = "";
  if (tag === null || props.tags.includes(tag)) return;
  props.tags.push(tag);
  ctrl.commit();
};
const removeTag = (index: number): void => {
  props.tags.splice(index, 1);
  ctrl.commit();
};
</script>

<template>
  <div class="e2e-test-hub-feature-editor-tags">
    <div class="e2e-test-hub-feature-editor-tag-chips">
      <button
        v-for="(tag, index) in tags"
        :key="tag"
        class="e2e-test-hub-feature-editor-tag-chip"
        :aria-label="`Remove ${tag}`"
        @click="removeTag(index)"
      >
        {{ tag }} ×
      </button>
    </div>
    <input
      v-model="draft"
      type="text"
      placeholder="Add tag…"
      :list="TAG_DATALIST_ID"
      :aria-label="label"
      @change="addTag"
      @keydown.enter.prevent="addTag"
    />
  </div>
</template>
