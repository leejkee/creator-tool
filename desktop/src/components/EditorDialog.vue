<script setup lang="ts">
import { onMounted, ref, watch, useId } from "vue";
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ cancel: [] }>();
const element = ref<HTMLDialogElement>();
const titleId = useId();
function sync(): void {
  if (props.open && !element.value?.open) {
    element.value?.showModal();
  } else if (!props.open && element.value?.open) {
    element.value.close();
  }
}
watch(() => props.open, sync, { flush: "post" });
onMounted(sync);
</script>

<template>
  <dialog
    ref="element"
    class="editor-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('cancel')"
  >
    <header class="dialog-header">
      <h2 :id="titleId">{{ title }}</h2>
      <button class="icon-button" aria-label="关闭弹窗" @click="emit('cancel')">
        ×
      </button>
    </header>
    <slot />
  </dialog>
</template>
