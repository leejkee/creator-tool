<script setup lang="ts">
import { ref } from "vue";
import InformationChoice from "./InformationChoice.vue";
import type { ChooseOption, NewModuleKind } from "../editor/contracts";
const props = defineProps<{
  title: string;
  initialName: string;
  allowKind?: boolean;
  defaultKind?: NewModuleKind;
  disabled: boolean;
  choose: ChooseOption;
  error?: string;
}>();
const emit = defineEmits<{
  submit: [name: string, kind: NewModuleKind];
  cancel: [];
}>();
const name = ref(props.initialName);
const kind = ref<NewModuleKind>(props.defaultKind ?? "text");
</script>

<template>
  <form
    class="information-task resource-form"
    @submit.prevent="emit('submit', name, kind)"
  >
    <header class="information-heading">
      <h2>{{ title }}</h2>
    </header>
    <label
      >名称<input
        v-model="name"
        :disabled="disabled"
        maxlength="80"
        required
        autocomplete="off"
    /></label>
    <label v-if="allowKind"
      >起始模块<InformationChoice
        :model-value="kind"
        label="起始模块"
        :disabled="disabled"
        :choose="choose"
        :options="[
          { value: 'text', label: '文字' },
          { value: 'image', label: '图片' },
          { value: 'rect', label: '矩形' },
          { value: 'layout', label: '布局' },
        ]"
        @update:model-value="(value) => (kind = value as NewModuleKind)"
    /></label>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="information-actions">
      <button
        type="submit"
        class="primary"
        :disabled="disabled || !name.trim()"
      >
        确认</button
      ><button type="button" :disabled="disabled" @click="emit('cancel')">
        取消
      </button>
    </div>
  </form>
</template>
