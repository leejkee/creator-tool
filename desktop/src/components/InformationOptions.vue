<script setup lang="ts">
import { computed, ref } from "vue";
import type { OptionRequest } from "../editor/contracts";
const props = defineProps<{ request: OptionRequest; disabled?: boolean }>();
const emit = defineEmits<{ select: [value: string]; cancel: [] }>();
const search = ref("");
const visible = computed(() =>
  props.request.options.filter((option) =>
    `${option.label} ${option.value}`
      .toLocaleLowerCase()
      .includes(search.value.toLocaleLowerCase()),
  ),
);
</script>
<template>
  <section class="information-task" aria-label="参数选择">
    <header class="information-heading">
      <h2>选择{{ request.label }}</h2>
      <button type="button" @click="emit('cancel')">取消</button>
    </header>
    <input
      v-model="search"
      class="option-search"
      :disabled="disabled"
      aria-label="筛选选项"
      placeholder="输入名称筛选"
      autocomplete="off"
    />
    <div class="option-list" role="group" :aria-label="request.label">
      <button
        v-for="option in visible"
        :disabled="disabled"
        :key="option.value"
        type="button"
        :class="{ selected: option.value === request.value }"
        :aria-pressed="option.value === request.value"
        @click="emit('select', option.value)"
      >
        {{ option.label }}
      </button>
      <p v-if="!visible.length" class="muted">没有匹配的选项。</p>
    </div>
  </section>
</template>
