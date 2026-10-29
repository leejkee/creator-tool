<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
} from "vue";
import EditorDialog from "./components/EditorDialog.vue";
import PreviewPane from "./components/PreviewPane.vue";
import ModuleInspector from "./components/ModuleInspector.vue";
import { createEditor } from "./editor";
import { protectWindowClose } from "./editor/host";
import type { Ask, Decision, NewModuleInput } from "./editor/contracts";
import "./editor.css";

const decision = shallowRef<Decision>();
let resolveDecision: ((value: string) => void) | undefined;
const ask: Ask = (request) =>
  new Promise((resolve) => {
    decision.value = request;
    resolveDecision = resolve;
  });
function answer(value: string): void {
  const resolve = resolveDecision;
  resolveDecision = undefined;
  decision.value = undefined;
  resolve?.(value);
}
const editor = createEditor(ask);
const view = shallowRef(editor.view());
const unsubscribe = editor.subscribe((value) => {
  view.value = value;
});
const modal = ref<"" | "document" | "module" | "move">("");
const name = ref("");
const template = ref("");
const modalError = ref("");
const form = reactive<NewModuleInput>({
  kind: "image",
  parentId: "",
  row: "0",
  column: "0",
  width: "",
  height: "",
  text: "",
});
const locked = computed(
  () => !view.value.ready || !!view.value.busy || !!decision.value,
);
const workspaceName = computed(
  () =>
    view.value.preferences.workspace?.split(/[\\/]/).filter(Boolean).pop() ||
    "未选择工作区",
);
const fileStatus = computed(() =>
  view.value.dirty ? "未保存" : view.value.draft ? "有未应用输入" : "已保存",
);
const errorCount = computed(
  () => view.value.issues.filter((issue) => issue.severity === "error").length,
);
const warningCount = computed(
  () => view.value.issues.length - errorCount.value,
);
let unlistenWindow: (() => void) | undefined;

function showDocument(): void {
  name.value = "";
  template.value = "";
  modalError.value = "";
  modal.value = "document";
}
function showModule(move = false): void {
  const parents = view.value.parents;
  form.parentId = parents.some((p) => p.id === view.value.selectedId)
    ? view.value.selectedId
    : (parents[0]?.id ?? "");
  form.row = form.parentId === "$wrap" ? "1" : "0";
  form.column = "0";
  form.width = "";
  form.height = "";
  form.text = "";
  form.kind = "image";
  modalError.value = "";
  modal.value = move ? "move" : "module";
}
async function chooseTemplate(): Promise<void> {
  try {
    template.value = (await editor.chooseTemplate()) ?? template.value;
  } catch (error) {
    modalError.value = String(error);
  }
}
async function submitModal(): Promise<void> {
  modalError.value = "";
  let done = false;
  if (modal.value === "document") {
    if (!name.value.trim()) {
      modalError.value = "请输入文档名称";
      return;
    }
    done = await editor.create(name.value, template.value || undefined);
  } else if (modal.value === "module") {
    done = await editor.add({ ...form });
  } else if (modal.value === "move") {
    if (!form.row.trim() || !form.column.trim()) {
      modalError.value = "请填写行列位置";
      return;
    }
    done = await editor.move(
      form.parentId,
      Number(form.row),
      Number(form.column),
    );
  }
  if (done) {
    modal.value = "";
  } else {
    modalError.value = view.value.status;
  }
}
function cancelModal(): void {
  if (!locked.value) {
    modal.value = "";
  }
}
function toggleAutosave(event: Event): void {
  void editor.setAutosave((event.target as HTMLInputElement).checked);
}
function shortcut(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!modal.value && !decision.value) {
      if (event.shiftKey) {
        void editor.saveAs();
      } else {
        void editor.save();
      }
    }
  }
}
onMounted(async () => {
  window.addEventListener("keydown", shortcut);
  try {
    unlistenWindow = await protectWindowClose(
      editor,
      () => !modal.value && !decision.value,
    );
  } catch (error) {
    editor.reportError(error);
  }
  await editor.initialize();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", shortcut);
  unlistenWindow?.();
  answer("cancel");
  unsubscribe();
  editor.dispose();
});
</script>

<template>
  <main class="app-shell" :aria-busy="!!view.busy">
    <aside class="workspace-sidebar">
      <div class="brand">
        <span class="brand-mark">▧</span>
        <div><strong>图片创作</strong><small>本地图片工作室</small></div>
      </div>
      <button
        class="new-document primary"
        :disabled="!view.preferences.workspace || locked"
        @click="showDocument"
      >
        <span>＋</span> 新建文档
      </button>
      <div class="sidebar-heading">
        <span class="eyebrow">工作区文档</span
        ><button
          class="icon-button"
          title="刷新文档列表"
          aria-label="刷新文档列表"
          :disabled="!view.preferences.workspace || locked"
          @click="editor.rescan()"
        >
          ↻
        </button>
      </div>
      <nav class="document-list" aria-label="工作区文档">
        <button
          v-for="entry in view.entries"
          :key="entry.directory"
          class="document-entry"
          :class="{ active: entry.directory === view.activeDirectory }"
          :title="entry.directory"
          :disabled="locked"
          @click="editor.open(entry)"
        >
          <span class="document-icon">▤</span
          ><span class="ellipsis">{{ entry.name }}</span
          ><span
            v-if="entry.directory === view.activeDirectory && view.dirty"
            class="dirty-dot"
            aria-label="未保存"
          ></span>
        </button>
        <p v-if="!view.entries.length" class="sidebar-empty">
          {{
            view.preferences.workspace
              ? "这里还没有文档。\n新建一份，开始创作。"
              : "先选择一个工作区，\n集中管理你的图片。"
          }}
        </p>
      </nav>
      <footer class="workspace-footer">
        <button
          class="workspace-button"
          :disabled="locked"
          :title="view.preferences.workspace"
          @click="editor.chooseWorkspace()"
        >
          <span>▱</span
          ><span class="ellipsis"
            ><strong>{{ workspaceName }}</strong
            ><small>点击切换工作区</small></span
          ><span>↗</span>
        </button>
        <label class="autosave-control"
          ><input
            type="checkbox"
            :checked="view.preferences.autosave"
            :disabled="locked || !view.ready"
            @change="toggleAutosave"
          /><span>自动保存</span><span class="muted">应用后 2 秒</span></label
        >
      </footer>
    </aside>

    <section class="main-workspace">
      <header class="document-toolbar">
        <div class="document-heading">
          <span class="eyebrow">{{
            view.activePath ? "当前文档" : "图片编辑器"
          }}</span>
          <div class="document-title">
            <h1 :title="view.activePath">
              {{ view.activeName || "你的下一张图片，从这里开始" }}
            </h1>
            <span
              v-if="view.activePath"
              class="save-indicator"
              :class="{ unsaved: view.dirty || view.draft }"
              >{{ fileStatus }}</span
            >
          </div>
        </div>
        <div v-if="view.activePath" class="toolbar-actions">
          <button
            :disabled="locked"
            title="Ctrl+S；仅保存已应用的修改"
            @click="editor.save()"
          >
            保存</button
          ><button :disabled="locked" @click="editor.saveAs()">另存为</button
          ><button
            class="primary"
            :disabled="
              locked ||
              !view.frame ||
              view.stale ||
              view.rendering ||
              !!view.external
            "
            @click="editor.exportPng()"
          >
            导出 PNG <span>↗</span></button
          ><button
            class="icon-button"
            aria-label="关闭文档"
            title="关闭文档"
            :disabled="locked"
            @click="editor.closeDocument()"
          >
            ×
          </button>
        </div>
      </header>
      <div v-if="view.external" class="external-banner" role="alert">
        <div>
          <strong>磁盘文件发生变化</strong
          ><span>{{ view.external.message }}。本地编辑已保留。</span>
        </div>
        <button
          v-if="view.external.reloadable"
          :disabled="locked"
          @click="editor.reloadExternal()"
        >
          重新加载</button
        ><button :disabled="locked" @click="editor.saveAs()">另存为</button>
      </div>
      <template v-if="view.activePath">
        <div class="editing-toolbar">
          <span class="muted">{{ view.selectedName || "尚未选中模块" }}</span
          ><button :disabled="locked" @click="showModule()">＋ 新增模块</button>
        </div>
        <div class="editor-body">
          <PreviewPane
            :frame="view.frame"
            :selected="view.selectedId"
            :stale="view.stale"
            :rendering="view.rendering"
            :disabled="locked"
            @pick="(x, y) => editor.pick(x, y)"
            ><button :disabled="locked" @click="showModule()">
              ＋ 新增模块
            </button></PreviewPane
          >
          <ModuleInspector
            :view="view"
            @field="(id, value) => editor.updateField(id, value)"
            @asset="(id) => editor.chooseAsset(id)"
            @apply="editor.apply()"
            @discard="editor.discardInput()"
            @remove="editor.removeSelected()"
            @move="showModule(true)"
            @fonts="editor.refreshFonts()"
          />
        </div>
      </template>
      <section v-else class="welcome-panel">
        <span class="welcome-art" aria-hidden="true">▧<i>＋</i></span>
        <span class="eyebrow">内容 · 布局 · 图片</span>
        <h2>把想法排成一张图片</h2>
        <p>
          从左侧打开已有文档，或新建一份。<br />在预览中选择模块，在右侧编辑并应用。
        </p>
        <button
          v-if="!view.preferences.workspace"
          class="primary"
          :disabled="locked || !view.ready"
          @click="editor.chooseWorkspace()"
        >
          选择工作区 <span>↗</span>
        </button>
        <button v-else class="primary" :disabled="locked" @click="showDocument">
          ＋ 新建文档
        </button>
        <p class="welcome-note">所有文档与素材保存在本地工作区</p>
      </section>
      <footer class="status-bar" role="status">
        <span
          class="status-dot"
          :class="{
            'status-error': errorCount > 0,
            'status-working': !!view.busy,
          }"
        ></span
        ><span class="status-message ellipsis">{{
          view.busy || view.status
        }}</span>
        <details v-if="view.issues.length" class="diagnostics">
          <summary>
            {{ errorCount ? `${errorCount} 个错误` : ""
            }}{{ errorCount && warningCount ? " · " : ""
            }}{{ warningCount ? `${warningCount} 个警告` : "" }}
          </summary>
          <div class="diagnostic-list">
            <h3>诊断信息</h3>
            <div
              v-for="(issue, index) in view.issues"
              :key="index"
              class="diagnostic-item"
              :class="issue.severity"
            >
              <strong>{{
                issue.severity === "error" ? "错误" : "警告"
              }}</strong>
              <p>{{ issue.message }}</p>
              <small v-if="issue.location">{{ issue.location }}</small>
            </div>
          </div>
        </details>
        <span v-if="view.draft" class="muted">输入需应用后才会保存、导出</span>
      </footer>
    </section>
  </main>

  <EditorDialog
    :open="!!modal"
    :title="
      modal === 'document'
        ? '新建文档'
        : modal === 'move'
          ? '调整模块位置'
          : '新增模块'
    "
    @cancel="cancelModal"
  >
    <form class="dialog-form" @submit.prevent="submitModal">
      <fieldset :disabled="locked">
        <template v-if="modal === 'document'"
          ><label for="document-name">文档名称</label
          ><input
            id="document-name"
            v-model="name"
            placeholder="例如：角色配装卡片"
            autofocus
            autocomplete="off"
          />
          <p class="field-hint">在工作区创建同名目录和 JSON 文件。</p>
          <label for="document-template">JSON 模板（可选）</label>
          <div class="asset-input">
            <input
              id="document-template"
              :value="template"
              placeholder="从空白布局开始"
              readonly
            /><button type="button" @click="chooseTemplate">选择</button
            ><button v-if="template" type="button" @click="template = ''">
              清除
            </button>
          </div></template
        >
        <template v-else>
          <template v-if="modal === 'module'"
            ><label for="module-kind">模块内容</label
            ><select id="module-kind" v-model="form.kind">
              <option value="image">图片</option>
              <option value="text">文本框</option>
              <option value="rect">矩形</option>
              <option value="layout">布局模块</option>
            </select></template
          >
          <label for="module-parent">父模块</label
          ><select id="module-parent" v-model="form.parentId">
            <option
              v-for="parent in view.parents"
              :key="parent.id"
              :value="parent.id"
            >
              {{ parent.label }}
            </option>
          </select>
          <div v-if="form.parentId" class="input-pair">
            <div>
              <label for="module-row">行（从 0 开始）</label
              ><input id="module-row" v-model="form.row" inputmode="numeric" />
            </div>
            <div>
              <label for="module-column">列（从 0 开始）</label
              ><input
                id="module-column"
                v-model="form.column"
                inputmode="numeric"
              />
            </div>
          </div>
          <p v-if="form.parentId" class="field-hint">
            超出网格时自动扩展；已有模块的位置保持不变。
          </p>
          <div
            v-if="modal === 'module' && form.kind !== 'layout'"
            class="input-pair"
          >
            <div>
              <label for="module-width">宽度（px）</label
              ><input
                id="module-width"
                v-model="form.width"
                inputmode="numeric"
                placeholder="必填"
              />
            </div>
            <div>
              <label for="module-height">高度（px）</label
              ><input
                id="module-height"
                v-model="form.height"
                inputmode="numeric"
                placeholder="必填"
              />
            </div>
          </div>
          <template v-if="modal === 'module' && form.kind === 'text'"
            ><label for="module-text">文字内容</label
            ><textarea
              id="module-text"
              v-model="form.text"
              rows="3"
              placeholder="添加文字"
            ></textarea>
          </template>
        </template>
      </fieldset>
      <p v-if="modalError" class="field-error" role="alert">{{ modalError }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="locked" @click="cancelModal">
          取消</button
        ><button class="primary" type="submit" :disabled="locked">
          {{
            modal === "document"
              ? "创建文档"
              : modal === "move"
                ? "移动并应用"
                : "添加并应用"
          }}
        </button>
      </div>
    </form>
  </EditorDialog>
  <EditorDialog
    :open="!!decision"
    :title="decision?.title || ''"
    @cancel="answer('cancel')"
    ><p class="decision-message">{{ decision?.message }}</p>
    <div class="dialog-actions decision-actions">
      <button
        v-for="choice in decision?.choices"
        :key="choice.value"
        :class="{ primary: choice.primary, danger: choice.danger }"
        @click="answer(choice.value)"
      >
        {{ choice.label }}
      </button>
    </div></EditorDialog
  >
</template>
