<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PreviewView } from "../editor/contracts";
const props = defineProps<{
  frame?: PreviewView;
  selected: string;
  stale: boolean;
  rendering: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ pick: [x: number, y: number] }>();
const viewport = ref<HTMLElement>();
const mount = ref<HTMLElement>();
const available = ref({ width: 0, height: 0 });
let observer: ResizeObserver | undefined;
const scale = computed(() =>
  props.frame
    ? Math.max(
        0,
        Math.min(
          available.value.width / props.frame.width,
          available.value.height / props.frame.height,
        ),
      )
    : 0,
);
const size = computed(() => ({
  width: `${(props.frame?.width ?? 0) * scale.value}px`,
  height: `${(props.frame?.height ?? 0) * scale.value}px`,
}));
const selection = computed(() => {
  const box = props.frame?.boxes.find((box) => box.id === props.selected);
  return box
    ? {
        left: `${box.x * scale.value}px`,
        top: `${box.y * scale.value}px`,
        width: `${box.width * scale.value}px`,
        height: `${box.height * scale.value}px`,
      }
    : undefined;
});
function attach(): void {
  mount.value?.replaceChildren(...(props.frame ? [props.frame.surface] : []));
}
watch(() => props.frame, attach, { flush: "post" });
function pick(event: PointerEvent): void {
  if (
    props.disabled ||
    props.stale ||
    props.rendering ||
    !props.frame ||
    !mount.value
  ) {
    return;
  }
  const rect = mount.value.getBoundingClientRect();
  emit(
    "pick",
    ((event.clientX - rect.left) * props.frame.width) / rect.width,
    ((event.clientY - rect.top) * props.frame.height) / rect.height,
  );
}
onMounted(() => {
  attach();
  observer = new ResizeObserver((entries) => {
    const rect = entries[0].contentRect;
    available.value = {
      width: Math.max(0, rect.width - 64),
      height: Math.max(0, rect.height - 64),
    };
  });
  if (viewport.value) {
    observer.observe(viewport.value);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <section class="preview-pane" aria-label="图片预览">
    <div class="pane-toolbar">
      <span class="eyebrow">预览</span>
      <span v-if="frame" class="muted mono"
        >{{ frame.width }} × {{ frame.height }} px</span
      >
      <span v-if="rendering" class="badge">正在渲染…</span>
      <span v-else-if="stale" class="badge warning">上次预览 · 已过期</span>
      <span v-else-if="frame" class="muted">点击选择模块</span>
    </div>
    <div ref="viewport" class="preview-viewport">
      <div
        v-if="frame"
        class="preview-stage checkerboard"
        :style="size"
        @pointerdown="pick"
      >
        <div ref="mount" class="canvas-mount"></div>
        <div
          v-if="selection && !stale"
          class="module-selection"
          :style="selection"
        ></div>
      </div>
      <div v-else class="empty-preview">
        <div class="empty-symbol">▧</div>
        <h3>{{ rendering ? "正在生成预览" : "从一个模块开始" }}</h3>
        <p>
          {{
            rendering
              ? "正在准备图片与布局…"
              : "添加图片、文本框或布局模块，然后应用修改。"
          }}
        </p>
        <slot />
      </div>
    </div>
  </section>
</template>
