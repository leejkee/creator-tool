<script setup lang="ts">
import { computed } from "vue";
import type { ChooseOption, FieldOption } from "../editor/contracts";
const props = defineProps<{
  modelValue: string;
  label: string;
  options: readonly FieldOption[];
  choose: ChooseOption;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const text = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue)?.label ??
    (props.modelValue || props.placeholder || "请选择"),
);
async function select(): Promise<void> {
  const value = await props.choose({
    label: props.label,
    value: props.modelValue,
    options: props.options,
  });
  if (value !== undefined) {
    emit("update:modelValue", value);
  }
}
</script>
<template>
  <button
    :id="id"
    type="button"
    class="information-choice"
    :disabled="disabled"
    :aria-label="`${label}：${text}，在底部选择`"
    :aria-invalid="invalid"
    :data-hint="`${label}：${text}；点击后在底部信息区域选择`"
    @click="select"
  >
    <span class="ellipsis">{{ text }}</span
    ><small>选择</small>
  </button>
</template>
