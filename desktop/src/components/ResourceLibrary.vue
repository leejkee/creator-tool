<script setup lang="ts">
import { computed, ref } from "vue";
import type { LibraryItem, LibraryKind } from "../editor/contracts";
const props = defineProps<{
  items: readonly LibraryItem[];
  kind: LibraryKind;
  disabled: boolean;
  canApply: boolean;
  canCreate: boolean;
}>();
const emit = defineEmits<{
  use: [item: LibraryItem];
  edit: [item: LibraryItem];
  copy: [item: LibraryItem];
  rename: [item: LibraryItem];
  remove: [item: LibraryItem];
  regenerate: [item: LibraryItem];
  create: [];
  refresh: [];
  close: [];
}>();
const query = ref("");
const source = ref("all");
const broken = ref(new Set<string>());
const items = computed(() =>
  props.items.filter(
    (item) =>
      item.kind === props.kind &&
      item.name.toLowerCase().includes(query.value.toLowerCase()) &&
      (source.value === "all" || item.builtIn === (source.value === "builtin")),
  ),
);
function imageFailed(id: string): void {
  broken.value = new Set([...broken.value, id]);
}
</script>

<template>
  <section class="resource-library" aria-label="本地资源库">
    <header class="resource-library-heading">
      <div>
        <span class="eyebrow">跨工作区共用 · 本地保存</span>
        <h2>{{ kind === "template" ? "模板" : "Style" }}资源库</h2>
      </div>
      <div class="resource-actions">
        <button :disabled="disabled" @click="emit('create')">
          ＋ 新建{{ kind === "template" ? "模板" : "Style" }}</button
        ><button :disabled="disabled" @click="emit('refresh')">刷新</button
        ><button :disabled="disabled" @click="emit('close')">返回编辑器</button>
      </div>
    </header>
    <div class="resource-filters">
      <input
        v-model="query"
        aria-label="搜索资源"
        placeholder="按名称搜索…"
        :disabled="disabled"
      />
      <button
        v-for="filter in [
          { id: 'all', label: '全部' },
          { id: 'builtin', label: '内置' },
          { id: 'mine', label: '我的' },
        ]"
        :key="filter.id"
        :class="{ primary: source === filter.id }"
        :disabled="disabled"
        @click="source = filter.id"
      >
        {{ filter.label }}
      </button>
    </div>
    <div class="resource-grid">
      <article
        v-for="item in items"
        :key="`${item.id}:${item.version}`"
        class="resource-card"
      >
        <div class="resource-thumbnail checkerboard">
          <img
            v-if="item.thumbnail && !broken.has(item.thumbnail)"
            :src="item.thumbnail"
            :alt="`${item.name}缩略预览`"
            @error="imageFailed(item.thumbnail || item.id)"
          />
          <div v-else class="resource-no-preview">
            <span>▧</span>
            <p>{{ item.previewError || "缩略图尚未生成" }}</p>
          </div>
        </div>
        <header>
          <h3>{{ item.name }}</h3>
          <span class="badge">{{ item.builtIn ? "内置" : "我的" }}</span>
        </header>
        <p v-if="item.previewError" class="field-hint">
          预览不可用，仍可编辑资源。
        </p>
        <div class="resource-actions">
          <button
            class="primary"
            :disabled="disabled || (kind === 'style' ? !canApply : !canCreate)"
            @click="emit('use', item)"
          >
            {{ kind === "template" ? "创建作品" : "应用到当前模块" }}
          </button>
          <button :disabled="disabled" @click="emit('edit', item)">
            {{ item.builtIn ? "编辑副本" : "编辑" }}
          </button>
          <button :disabled="disabled" @click="emit('copy', item)">复制</button>
          <button :disabled="disabled" @click="emit('regenerate', item)">
            更新预览
          </button>
          <button
            v-if="!item.builtIn"
            :disabled="disabled"
            @click="emit('rename', item)"
          >
            重命名
          </button>
          <button
            v-if="!item.builtIn"
            class="danger-text"
            :disabled="disabled"
            @click="emit('remove', item)"
          >
            删除
          </button>
        </div>
      </article>
      <p v-if="!items.length" class="muted">
        没有匹配的资源。可以新建，或从编辑器中的模块提取。
      </p>
    </div>
  </section>
</template>
