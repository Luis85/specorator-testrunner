<script setup lang="ts">
/**
 * The list-explorer header bar shared by the PRDs / Use Cases / Test Suites /
 * Story Maps bodies (ADR-0033) — the Vue twin of `renderListHeader`: a `headerCls`
 * bar with an `<h2>` title and a primary "New …" `mod-cta` action button.
 */
defineProps<{ headerCls: string; title: string; actionLabel: string }>();
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div :class="headerCls">
    <h2>{{ title }}</h2>
    <button class="mod-cta" @click="emit('action')">{{ actionLabel }}</button>
  </div>
</template>
