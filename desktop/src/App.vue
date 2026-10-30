<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import PreviewPane from "./components/PreviewPane.vue";
import ModuleInspector from "./components/ModuleInspector.vue";
import InformationEditorForm from "./components/InformationEditorForm.vue";
import InformationFileBrowser from "./components/InformationFileBrowser.vue";
import InformationOptions from "./components/InformationOptions.vue";
import { displayPath } from "./components/pathDisplay";
import { useInformationArea } from "./components/useInformationArea";
import { createEditor, createFileBrowserPort } from "./editor";
import { protectWindowClose } from "./editor/host";
import type { NewModuleInput } from "./editor/contracts";
import "./editor.css";

const {
  decision,
  path,
  options,
  pending,
  ask,
  choosePath,
  chooseOption,
  answer,
  selectPath,
  selectOption,
  cancel: cancelRequest,
} = useInformationArea();
const editor = createEditor(ask, choosePath);
const browser = createFileBrowserPort();
const view = shallowRef(editor.view());
const unsubscribe = editor.subscribe((value) => {
  view.value = value;
});
const formMode = ref<"" | "document" | "module" | "move">("");
const template = ref("");
const formError = ref("");
const expanded = ref(false);
const hint = ref("");
const lastHint = ref("");
const information = ref<HTMLElement>();
const hasTask = computed(() => !!formMode.value || pending.value);
const locked = computed(
  () => !view.value.ready || !!view.value.busy || hasTask.value,
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
  template.value = "";
  formError.value = "";
  formMode.value = "document";
}
function showModule(move = false): void {
  formError.value = "";
  formMode.value = move ? "move" : "module";
}
function cancelForm(): void {
  if (!view.value.busy && !pending.value) {
    formMode.value = "";
    formError.value = "";
  }
}
async function chooseTemplate(): Promise<void> {
  try {
    template.value = (await editor.chooseTemplate()) ?? template.value;
  } catch (error) {
    editor.reportError(error);
  }
}
async function finishForm(action: () => Promise<boolean>): Promise<void> {
  const previousError = formError.value;
  formError.value = "";
  const previousStatus = view.value.status;
  if (await action()) {
    formMode.value = "";
  } else if (
    view.value.status !== previousStatus ||
    previousError === view.value.status
  ) {
    formError.value = view.value.status;
  }
}
function createDocument(name: string): Promise<void> {
  return finishForm(() => editor.create(name, template.value || undefined));
}
function addModule(input: NewModuleInput): Promise<void> {
  return finishForm(() => editor.add(input));
}
function moveModule(
  parent: string,
  row: number,
  column: number,
): Promise<void> {
  return finishForm(() => editor.move(parent, row, column));
}
function toggleAutosave(event: Event): void {
  void editor.setAutosave((event.target as HTMLInputElement).checked);
}
function showHint(event: Event): void {
  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-hint]")
      : undefined;
  hint.value = target?.dataset.hint ?? "";
  if (hint.value) {
    lastHint.value = hint.value;
  }
}
function clearHint(event: Event): void {
  const target = (event as FocusEvent | PointerEvent).relatedTarget;
  hint.value =
    target instanceof Element
      ? (target.closest<HTMLElement>("[data-hint]")?.dataset.hint ?? "")
      : "";
}
async function focusInformation(): Promise<void> {
  await nextTick();
  const tasks =
    information.value?.querySelectorAll<HTMLElement>(".information-task");
  const active = tasks
    ? [...tasks].find(
        (task) => task.getClientRects().length && !task.closest("[inert]"),
      )
    : undefined;
  const first =
    active?.querySelector<HTMLElement>(
      "input:not([disabled]):not([readonly]), textarea:not([disabled])",
    ) ??
    active?.querySelector<HTMLElement>("button[data-cancel-choice]") ??
    active?.querySelector<HTMLElement>("button:not([disabled])");
  (first ?? information.value)?.focus();
}
watch(
  hasTask,
  (value) => {
    editor.setInteractionPending(value);
  },
  { flush: "sync" },
);
watch(
  () =>
    options.value
      ? "options"
      : path.value
        ? "path"
        : decision.value
          ? "decision"
          : formMode.value,
  () => {
    hint.value = "";
    lastHint.value = "";
    if (hasTask.value) {
      expanded.value = true;
      void focusInformation();
    }
  },
);
watch(
  () => view.value.issues,
  (issues) => {
    if (issues.some((issue) => issue.severity === "error")) {
      expanded.value = true;
    }
  },
);
watch(
  () => view.value.external,
  (external) => {
    if (external) {
      expanded.value = true;
    }
  },
);
function shortcut(event: KeyboardEvent): void {
  if (event.key === "Escape" && hasTask.value) {
    event.preventDefault();
    if (pending.value) {
      cancelRequest();
    } else {
      cancelForm();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!hasTask.value) {
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
    unlistenWindow = await protectWindowClose(editor, () => {
      if (hasTask.value) {
        void focusInformation();
        return false;
      }
      return true;
    });
  } catch (error) {
    editor.reportError(error);
  }
  await editor.initialize();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", shortcut);
  unlistenWindow?.();
  cancelRequest();
  unsubscribe();
  editor.dispose();
});
</script>

<template>
  <main
    class="app-shell"
    :aria-busy="!!view.busy"
    @pointerover="showHint"
    @pointerout="clearHint"
    @focusin="showHint"
    @focusout="clearHint"
  >
    <aside class="workspace-sidebar" :inert="hasTask">
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
          data-hint="刷新文档列表"
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
          :data-hint="displayPath(entry.directory)"
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
          :data-hint="displayPath(view.preferences.workspace)"
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
      <div class="workspace-content" :inert="hasTask">
        <header class="document-toolbar">
          <div class="document-heading">
            <span class="eyebrow">{{
              view.activePath ? "当前文档" : "图片编辑器"
            }}</span>
            <div class="document-title">
              <h1 :data-hint="displayPath(view.activePath)">
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
              data-hint="Ctrl+S；仅保存已应用的修改"
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
              data-hint="关闭文档"
              :disabled="locked"
              @click="editor.closeDocument()"
            >
              ×
            </button>
          </div>
        </header>
        <template v-if="view.activePath">
          <div class="editing-toolbar">
            <span class="muted">{{ view.selectedName || "尚未选中模块" }}</span
            ><button :disabled="locked" @click="showModule()">
              ＋ 新增模块
            </button>
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
              :disabled="hasTask"
              :choose="chooseOption"
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
          <button
            v-else
            class="primary"
            :disabled="locked"
            @click="showDocument"
          >
            ＋ 新建文档
          </button>
          <p class="welcome-note">所有文档与素材保存在本地工作区</p>
        </section>
      </div>
      <section
        ref="information"
        class="information-area"
        aria-label="底部信息区域"
        tabindex="-1"
      >
        <div class="information-summary">
          <button
            type="button"
            class="information-toggle"
            :aria-expanded="expanded || hasTask"
            :disabled="hasTask"
            @click="expanded = !expanded"
          >
            {{
              hasTask ? "底部操作" : expanded ? "收起信息" : "展开信息"
            }}</button
          ><span
            class="status-dot"
            :class="{
              'status-error': errorCount > 0,
              'status-working': !!view.busy,
            }"
          ></span
          ><span class="status-message ellipsis" role="status">{{
            displayPath(hint || view.busy || view.status)
          }}</span
          ><button
            v-if="view.issues.length"
            type="button"
            class="issue-count"
            @click="expanded = true"
          >
            {{ errorCount }} 个错误 · {{ warningCount }} 个警告</button
          ><span v-if="hasTask" class="badge">请先完成或取消底部操作</span>
        </div>
        <div v-show="expanded || hasTask" class="information-content">
          <InformationOptions
            v-if="options"
            :key="options.label"
            :request="options"
            :disabled="!!view.busy"
            @select="selectOption"
            @cancel="cancelRequest"
          />
          <InformationFileBrowser
            v-else-if="path"
            :request="path"
            :browser="browser"
            :blocked="!!view.busy"
            @select="selectPath"
            @cancel="cancelRequest"
          />
          <section
            v-else-if="decision"
            class="information-task"
            aria-label="待确认操作"
          >
            <header class="information-heading">
              <h2>{{ decision.title }}</h2>
            </header>
            <p class="decision-message">{{ displayPath(decision.message) }}</p>
            <div class="information-actions">
              <button
                v-for="choice in decision.choices"
                :key="choice.value"
                type="button"
                :class="{ primary: choice.primary, danger: choice.danger }"
                :data-cancel-choice="choice.value === 'cancel' ? '' : undefined"
                @click="answer(choice.value)"
              >
                {{ choice.label }}
              </button>
            </div>
          </section>
          <InformationEditorForm
            v-if="formMode"
            v-show="!pending"
            :key="formMode"
            :mode="formMode"
            :view="view"
            :choose="chooseOption"
            :template="template"
            :error="formError"
            @cancel="cancelForm"
            @template="chooseTemplate"
            @clear-template="template = ''"
            @create="createDocument"
            @add="addModule"
            @move="moveModule"
          />
          <section v-if="!hasTask" class="information-messages">
            <p v-if="hint || lastHint" class="information-hint">
              {{ displayPath(hint || lastHint) }}
            </p>
            <p class="information-status">
              {{ displayPath(view.busy || view.status) }}
            </p>
            <div v-if="view.external" class="external-information" role="alert">
              <strong>磁盘文件发生变化</strong>
              <p>{{ displayPath(view.external.message) }}。本地编辑已保留。</p>
              <div class="information-actions">
                <button
                  v-if="view.external.reloadable"
                  :disabled="locked"
                  @click="editor.reloadExternal()"
                >
                  重新加载</button
                ><button :disabled="locked" @click="editor.saveAs()">
                  另存为
                </button>
              </div>
            </div>
            <div
              v-for="(issue, index) in view.issues"
              :key="index"
              class="diagnostic-item"
              :class="issue.severity"
            >
              <strong>{{
                issue.severity === "error" ? "错误" : "警告"
              }}</strong>
              <p>{{ displayPath(issue.message) }}</p>
              <small v-if="issue.location">{{
                displayPath(issue.location)
              }}</small>
            </div>
            <p v-if="view.draft" class="field-hint">
              右侧仍有未应用输入；保存和导出只使用已应用内容。
            </p>
          </section>
        </div>
      </section>
    </section>
  </main>
</template>
