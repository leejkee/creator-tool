<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import InformationChoice from "./InformationChoice.vue";
import { displayPath } from "./pathDisplay";
import type {
  ChooseOption,
  EditorView,
  NewModuleInput,
  NewModuleKind,
} from "../editor/contracts";
const props = defineProps<{
  mode: "document" | "module" | "move";
  view: EditorView;
  choose: ChooseOption;
  template: string;
  error: string;
}>();
const emit = defineEmits<{
  cancel: [];
  template: [];
  clearTemplate: [];
  create: [name: string];
  add: [input: NewModuleInput];
  move: [parent: string, row: number, column: number];
}>();
const name = ref("");
const localError = ref("");
const parent = props.view.parents.some((p) => p.id === props.view.selectedId)
  ? props.view.selectedId
  : (props.view.parents[0]?.id ?? "");
const form = reactive<NewModuleInput>({
  kind: "image",
  parentId: parent,
  row: parent === "$wrap" ? "1" : "0",
  column: "0",
  width: "",
  height: "",
  text: "",
});
const kinds: { value: NewModuleKind; label: string }[] = [
  { value: "image", label: "图片" },
  { value: "text", label: "文本框" },
  { value: "rect", label: "矩形" },
  { value: "layout", label: "布局模块" },
];
const parents = computed(() =>
  props.view.parents.map((p) => ({ value: p.id, label: p.label })),
);
const heading = computed(
  () =>
    ({ document: "新建文档", module: "新增模块", move: "调整模块位置" })[
      props.mode
    ],
);
function submit(): void {
  localError.value = "";
  if (props.mode === "document") {
    if (!name.value.trim()) {
      localError.value = "请输入文档名称";
      return;
    }
    emit("create", name.value);
  } else if (props.mode === "module") {
    emit("add", { ...form });
  } else {
    if (!form.row.trim() || !form.column.trim()) {
      localError.value = "请填写行列位置";
      return;
    }
    emit("move", form.parentId, Number(form.row), Number(form.column));
  }
}
</script>

<template>
  <section class="information-task">
    <header class="information-heading">
      <h2>{{ heading }}</h2>
      <button type="button" :disabled="!!view.busy" @click="emit('cancel')">
        取消
      </button>
    </header>
    <form @submit.prevent="submit">
      <fieldset class="bottom-form-grid" :disabled="!!view.busy">
        <template v-if="mode === 'document'"
          ><div>
            <label for="new-name">文档名称</label
            ><input
              id="new-name"
              v-model="name"
              placeholder="例如：角色配装卡片"
              autocomplete="off"
            />
            <p class="field-hint">在当前工作区创建同名目录和 JSON 文件。</p>
          </div>
          <div>
            <label for="new-template">JSON 模板（可选）</label>
            <div class="asset-input">
              <input
                id="new-template"
                :value="displayPath(template)"
                placeholder="从空白布局开始"
                readonly
              /><button type="button" @click="emit('template')">选择</button
              ><button
                v-if="template"
                type="button"
                @click="emit('clearTemplate')"
              >
                清除
              </button>
            </div>
          </div></template
        >
        <template v-else>
          <div v-if="mode === 'module'">
            <label>模块内容</label
            ><InformationChoice
              :model-value="form.kind"
              :options="kinds"
              label="模块内容"
              :choose="choose"
              :disabled="!!view.busy"
              @update:model-value="
                (value) => (form.kind = value as NewModuleKind)
              "
            />
          </div>
          <div>
            <label>父模块</label
            ><InformationChoice
              v-model="form.parentId"
              :options="parents"
              label="父模块"
              :choose="choose"
              :disabled="!!view.busy"
            />
          </div>
          <template v-if="form.parentId"
            ><div>
              <label for="new-row">行（从 0 开始）</label
              ><input id="new-row" v-model="form.row" inputmode="numeric" />
            </div>
            <div>
              <label for="new-column">列（从 0 开始）</label
              ><input
                id="new-column"
                v-model="form.column"
                inputmode="numeric"
              /></div
          ></template>
          <template v-if="mode === 'module' && form.kind !== 'layout'"
            ><div>
              <label for="new-width">宽度（px）</label
              ><input
                id="new-width"
                v-model="form.width"
                inputmode="numeric"
                placeholder="必填"
              />
            </div>
            <div>
              <label for="new-height">高度（px）</label
              ><input
                id="new-height"
                v-model="form.height"
                inputmode="numeric"
                placeholder="必填"
              /></div
          ></template>
          <div
            v-if="mode === 'module' && form.kind === 'text'"
            class="wide-field"
          >
            <label for="new-text">文字内容</label
            ><textarea
              id="new-text"
              v-model="form.text"
              rows="2"
              placeholder="添加文字"
            ></textarea>
          </div>
        </template>
      </fieldset>
      <p v-if="mode !== 'document' && form.parentId" class="field-hint">
        超出网格时自动扩展；已有模块的位置保持不变。
      </p>
      <p v-if="localError || error" class="field-error" role="alert">
        {{ displayPath(localError || error) }}
      </p>
      <div class="information-actions">
        <button class="primary" type="submit" :disabled="!!view.busy">
          {{
            mode === "document"
              ? "创建文档"
              : mode === "move"
                ? "移动并应用"
                : "添加并应用"
          }}
        </button>
      </div>
    </form>
  </section>
</template>
