<script setup lang="ts">
import { computed } from "vue";
import InformationChoice from "./InformationChoice.vue";
import { displayPath } from "./pathDisplay";
import type {
  ChooseOption,
  EditorField,
  EditorView,
} from "../editor/contracts";
const props = defineProps<{
  view: EditorView;
  choose: ChooseOption;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  field: [id: string, value: string];
  asset: [id: string];
  apply: [];
  discard: [];
  remove: [];
  move: [];
  fonts: [];
}>();
const sections = computed(() => {
  const sections = new Map<string, EditorField[]>();
  for (const field of props.view.fields) {
    if (!sections.has(field.section)) {
      sections.set(field.section, []);
    }
    sections.get(field.section)!.push(field);
  }
  return [...sections].map(([name, fields]) => ({ name, fields }));
});
function input(field: EditorField, event: Event): void {
  emit("field", field.id, (event.target as HTMLInputElement).value);
}
async function chooseFont(field: EditorField): Promise<void> {
  const value = await props.choose({
    label: field.label,
    value: field.value,
    options: [
      { value: "", label: field.placeholder || "系统默认" },
      ...(field.options ?? []),
    ],
  });
  if (value !== undefined) {
    emit("field", field.id, value);
  }
}
</script>

<template>
  <aside class="inspector" aria-label="当前模块属性">
    <header class="inspector-header">
      <span class="eyebrow">模块属性</span>
      <span v-if="view.draft" class="badge warning">未应用</span>
      <h2>{{ view.selectedName || "未选中模块" }}</h2>
      <p
        v-if="view.selectedId"
        :data-hint="view.selectedId"
        class="muted ellipsis"
      >
        {{ view.selectedKind }} · {{ view.selectedId }}
      </p>
      <p v-else class="muted">在预览中点击要编辑的模块。</p>
    </header>
    <form
      v-if="view.selectedId"
      class="inspector-form"
      @submit.prevent="emit('apply')"
    >
      <div class="inspector-scroll">
        <fieldset
          v-for="section in sections"
          :key="section.name"
          :disabled="!!view.busy || disabled"
          class="property-section"
        >
          <legend>{{ section.name }}</legend>
          <div
            v-for="field in section.fields"
            :key="field.id"
            class="property-field"
            :class="{ invalid: !!field.error }"
          >
            <label :for="`property-${field.id}`">{{ field.label }}</label>
            <InformationChoice
              v-if="field.kind === 'select'"
              :id="`property-${field.id}`"
              :model-value="field.value"
              :label="field.label"
              :invalid="!!field.error"
              :disabled="!!view.busy || disabled"
              :choose="choose"
              :options="[
                { value: '', label: field.placeholder || '未设置' },
                ...(field.options ?? []),
              ]"
              @update:model-value="(value) => emit('field', field.id, value)"
            />
            <textarea
              v-else-if="field.kind === 'multiline' || field.kind === 'code'"
              :id="`property-${field.id}`"
              :class="{ 'code-input': field.kind === 'code' }"
              :rows="field.kind === 'code' ? 7 : 4"
              :value="field.value"
              :placeholder="field.placeholder"
              :aria-invalid="!!field.error"
              spellcheck="false"
              @input="input(field, $event)"
            ></textarea>
            <div
              v-else
              :class="{
                'asset-input': field.kind === 'asset' || field.kind === 'font',
              }"
            >
              <input
                :id="`property-${field.id}`"
                :value="
                  field.kind === 'asset'
                    ? displayPath(field.value)
                    : field.value
                "
                :placeholder="field.placeholder"
                :inputmode="field.kind === 'number' ? 'decimal' : 'text'"
                :aria-invalid="!!field.error"
                autocomplete="off"
                @input="input(field, $event)"
              />
              <button
                v-if="field.kind === 'asset'"
                type="button"
                @click="emit('asset', field.id)"
              >
                选择
              </button>
              <button
                v-if="field.kind === 'font'"
                type="button"
                @click="chooseFont(field)"
              >
                选择
              </button>
            </div>
            <p v-if="field.hint" class="field-hint">{{ field.hint }}</p>
            <button
              v-if="field.kind === 'font'"
              type="button"
              class="refresh-fonts"
              @click="emit('fonts')"
            >
              刷新本机字体列表
            </button>
            <p v-if="field.error" class="field-error" role="alert">
              {{ displayPath(field.error) }}
            </p>
          </div>
        </fieldset>
        <div class="module-actions">
          <button
            type="button"
            :disabled="!!view.busy || disabled"
            @click="emit('move')"
          >
            调整位置
          </button>
          <button
            type="button"
            class="danger-text"
            :disabled="!!view.busy || disabled"
            @click="emit('remove')"
          >
            删除模块
          </button>
        </div>
      </div>
      <footer class="inspector-footer">
        <button
          type="button"
          :disabled="!view.draft || !!view.busy || disabled"
          @click="emit('discard')"
        >
          放弃输入
        </button>
        <button
          type="submit"
          class="primary"
          :disabled="!!view.busy || disabled"
        >
          {{ view.draft ? "应用修改" : "刷新预览" }}
        </button>
      </footer>
    </form>
  </aside>
</template>
