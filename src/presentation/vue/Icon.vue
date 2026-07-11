<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { setIcon } from "obsidian";

/**
 * Renders an Obsidian Lucide icon into a span via `setIcon` (ADR-0033). A thin
 * wrapper so migrated chrome (the hub rail/identity) keeps the exact icon markup
 * Obsidian produces. Any class/attr passed by the parent falls through onto the
 * span (single root), so callers still set `spec-hub-rail-icon` etc.
 */
const props = defineProps<{ name: string }>();
const host = ref<HTMLElement | null>(null);

const paint = (): void => {
  if (host.value !== null) setIcon(host.value, props.name);
};

onMounted(paint);
watch(() => props.name, paint);
</script>

<template>
  <span ref="host" aria-hidden="true"></span>
</template>
