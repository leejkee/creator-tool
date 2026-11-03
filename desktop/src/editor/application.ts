import type {
  AppPreferences,
  Ask,
  DesktopPort,
  EditorIssue,
  EditorView,
  NewModuleInput,
  PathKind,
  RenderOutcome,
  RendererPort,
  StoredFile,
  WorkspaceItem,
  LibraryKind,
  LibraryRecord,
  NewModuleKind,
  ResourceEdit,
} from "./contracts";
import {
  applyStyleResource,
  emptyResource,
  resourceDocument,
  resourcePayload,
  resourcePreview,
  styleResource,
  templateResource,
} from "./library-protocol";
import {
  addModule,
  applyFields,
  documentCopy,
  FieldFailure,
  fieldsFor,
  indexModules,
  kindName,
  materialPaths,
  moveModule,
  nodeName,
  parents,
  removeModule,
} from "./protocol";
import type { WorkingDocument } from "./protocol";
import { thumbnailDataUrl } from "./thumbnail";

const describe = (error: unknown): string =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
const filename = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Owns one editing session. Components never receive the source JSON or Engine result. */
export class EditorApplication {
  private preferences: AppPreferences = { autosave: false };
  private entries: WorkspaceItem[] = [];
  private file?: StoredFile;
  private resource?: ResourceEdit;
  private library?: { directory: string; demoPath: string };
  private libraryRecords: LibraryRecord[] = [];
  private libraryOpen = false;
  private libraryKind: LibraryKind = "template";
  private libraryPoll?: ReturnType<typeof setInterval>;
  private checkingResource = false;
  private resourceObservedVersion?: string;
  private work?: WorkingDocument;
  private baseline = "";
  private baselineAssets = new Map<string, string>();
  private selected = "";
  private draft = new Map<string, string>();
  private errors = new Map<string, string>();
  private pending = new Map<
    string,
    { moduleId: string; slot: "image" | "background"; path: string }
  >();
  private listeners = new Set<(view: EditorView) => void>();
  private observed = new Map<string, StoredFile>();
  private unsubscribe?: () => void;
  private shown?: RenderOutcome;
  private outcome?: RenderOutcome;
  private abort?: AbortController;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private rendering = false;
  private busy = "";
  private ready = false;
  private status = "准备工作区";
  private issues: EditorIssue[] = [];
  private fonts: readonly string[] = [];
  private asking = false;
  private interacting = false;
  private choosingPath = false;
  private autoReloadAttempt = "";
  private readonly ask: Ask;
  constructor(
    private desktop: DesktopPort,
    private renderer: RendererPort,
    ask: Ask,
  ) {
    this.ask = async (decision) => {
      if (this.asking) {
        return "cancel";
      }
      clearTimeout(this.timer);
      this.asking = true;
      try {
        return await ask(decision);
      } finally {
        this.asking = false;
        this.scheduleSave();
      }
    };
  }

  view(): EditorView {
    const module = this.work
      ? indexModules(this.work).get(this.selected)?.module
      : undefined;
    return {
      ready: this.ready,
      preferences: { ...this.preferences },
      entries: this.entries,
      activeName:
        this.resource?.name ?? (this.file ? filename(this.file.path) : ""),
      activePath: this.file?.path ?? "",
      activeDirectory: this.file?.directory ?? "",
      dirty: this.dirty(),
      draft: this.draft.size > 0,
      selectedId: this.selected,
      selectedName: module ? nodeName(module) : "",
      selectedKind: module ? kindName(module) : "",
      fields: this.work
        ? fieldsFor(
            this.work,
            this.selected,
            this.draft,
            this.errors,
            this.fonts,
            this.resource?.kind,
          )
        : [],
      parents: this.work ? parents(this.work) : [],
      frame: this.shown?.frame,
      stale: !!this.shown?.frame && this.shown !== this.outcome,
      rendering: this.rendering,
      choosingPath: this.choosingPath,
      busy: this.busy,
      status: this.status,
      issues: this.issues,
      external: this.file?.external,
      fonts: this.fonts,
      resource: this.resource ? { ...this.resource } : undefined,
      libraryOpen: this.libraryOpen,
      libraryKind: this.libraryKind,
      libraryItems: this.libraryRecords.map(
        ({ payload: _payload, ...item }) => item,
      ),
    };
  }
  subscribe(listener: (view: EditorView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    const view = this.view();
    for (const listener of this.listeners) {
      listener(view);
    }
  }
  private dirty(): boolean {
    return (
      !!this.work &&
      (JSON.stringify(this.work) !== this.baseline ||
        this.pending.size > 0 ||
        (!!this.resource &&
          (!this.resource.id ||
            this.resource.name !== this.resource.savedName)))
    );
  }
  private fail(error: unknown): void {
    this.status = describe(error);
    this.issues = [{ severity: "error", message: this.status }];
    this.emit();
  }
  reportError(error: unknown): void {
    this.fail(error);
  }
  setInteractionPending(pending: boolean): void {
    this.interacting = pending;
    if (!pending) {
      setTimeout(() => {
        this.maybeReload();
      }, 0);
    }
  }
  private async choosePath(
    kind: PathKind,
    initial?: string,
  ): Promise<string | undefined> {
    if (this.choosingPath || this.busy || !this.desktop.available()) {
      return undefined;
    }
    this.choosingPath = true;
    this.emit();
    try {
      const path = await this.desktop.choose(kind, initial);
      // Autosave may finish after the native dialog closes. Keep its result
      // pending until the working copy can safely accept the selected path.
      if (path && this.busy) {
        await new Promise<void>((resolve) => {
          const unsubscribe = this.subscribe((view) => {
            if (!view.busy) {
              unsubscribe();
              resolve();
            }
          });
        });
      }
      return path;
    } finally {
      this.choosingPath = false;
      this.emit();
    }
  }
  private async perform(
    label: string,
    action: () => Promise<void>,
  ): Promise<boolean> {
    if (this.busy) {
      return false;
    }
    this.busy = label;
    this.emit();
    try {
      await action();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.busy = "";
      this.emit();
      this.maybeReload();
    }
  }

  async initialize(): Promise<void> {
    if (!this.desktop.available()) {
      this.ready = true;
      this.status = "请从桌面应用打开，以选择本地工作区";
      this.emit();
      return;
    }
    try {
      this.unsubscribe = await this.desktop.subscribe(
        (file) => {
          this.observe(file);
        },
        (error) => {
          this.fail(error);
        },
      );
      this.preferences = await this.desktop.loadPreferences();
      const workspace = this.preferences.workspace;
      if (workspace) {
        try {
          const validatedWorkspace =
            await this.desktop.validateWorkspace(workspace);
          this.entries = await this.desktop.scan(validatedWorkspace);
          this.preferences = {
            ...this.preferences,
            workspace: validatedWorkspace,
          };
          this.status = "选择文档开始编辑";
        } catch (error) {
          this.preferences = { ...this.preferences, workspace: undefined };
          this.entries = [];
          this.status = "已保存的工作区无法恢复，请重新选择工作区";
          this.issues = [
            {
              severity: "error",
              message: `工作区恢复失败：${describe(error)}`,
              location: workspace,
            },
          ];
        }
      } else {
        this.status = "请选择工作区开始创作";
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.ready = true;
      this.emit();
    }
    void this.refreshFonts();
    if (!this.preferences.workspace) {
      await this.chooseWorkspace();
    }
    await this.refreshLibrary();
    this.libraryPoll = setInterval(() => {
      void this.checkResource();
    }, 2500);
  }
  async refreshFonts(): Promise<void> {
    if (!this.desktop.available()) {
      return;
    }
    try {
      this.fonts = await this.desktop.fonts();
      this.emit();
    } catch (error) {
      this.fail(error);
    }
  }
  async chooseWorkspace(): Promise<void> {
    if (this.busy || !this.desktop.available()) {
      return;
    }
    try {
      const workspace = await this.choosePath(
        "directory",
        this.preferences.workspace,
      );
      if (!workspace || !(await this.prepareLeave())) {
        return;
      }
      await this.perform("正在打开工作区…", async () => {
        const entries = await this.desktop.scan(workspace);
        const next = { ...this.preferences, workspace };
        await this.desktop.savePreferences(next);
        if (this.file && !this.resource) {
          await this.desktop.close(this.file);
        }
        this.reset();
        this.entries = entries;
        this.preferences = next;
        this.status = "选择文档开始编辑";
      });
    } catch (error) {
      this.fail(error);
    }
  }
  async rescan(): Promise<void> {
    if (!this.preferences.workspace) {
      return;
    }
    await this.perform("正在刷新列表…", async () => {
      this.entries = await this.desktop.scan(this.preferences.workspace!);
      this.status = "文档列表已刷新";
    });
  }
  async setAutosave(enabled: boolean): Promise<void> {
    await this.perform("正在保存设置…", async () => {
      const next = { ...this.preferences, autosave: enabled };
      await this.desktop.savePreferences(next);
      this.preferences = next;
      if (enabled) {
        this.scheduleSave();
      } else {
        clearTimeout(this.timer);
      }
      this.status = enabled
        ? "自动保存已开启：应用修改后 2 秒保存"
        : "自动保存已关闭";
    });
  }
  async open(entry: WorkspaceItem): Promise<void> {
    if (entry.path === this.file?.path && !this.resource) {
      this.hideLibrary();
      return;
    }
    const workspace = this.preferences.workspace;
    if (
      this.busy ||
      !workspace ||
      entry.path === this.file?.path ||
      !(await this.prepareLeave())
    ) {
      return;
    }
    await this.perform("正在打开文档…", async () => {
      const next = await this.desktop.open(workspace, entry.directory);
      if (
        this.file &&
        !this.resource &&
        this.file.sessionId !== next.sessionId
      ) {
        try {
          await this.desktop.close(this.file);
        } catch (error) {
          await this.desktop.close(next);
          throw error;
        }
      }
      this.load(next);
      await this.refreshPreview();
    });
  }
  async create(name: string, template?: string): Promise<boolean> {
    if (
      !this.preferences.workspace ||
      !name.trim() ||
      !(await this.prepareLeave())
    ) {
      return false;
    }
    return this.perform("正在新建文档…", async () => {
      const next = await this.desktop.create(
        this.preferences.workspace!,
        name,
        template,
      );
      if (this.file && !this.resource) {
        await this.desktop.close(this.file);
      }
      this.load(next);
      this.entries = await this.desktop.scan(this.preferences.workspace!);
      await this.refreshPreview();
    });
  }
  async chooseTemplate(): Promise<string | undefined> {
    return this.choosePath("json", this.preferences.workspace);
  }
  private async fetchLibrary(): Promise<void> {
    this.library ??= await this.desktop.libraryContext();
    this.libraryRecords = await this.desktop.libraryList();
  }
  async refreshLibrary(): Promise<boolean> {
    if (!this.desktop.available()) {
      return false;
    }
    return this.perform("正在读取本地资源库…", () => this.fetchLibrary());
  }
  async showLibrary(kind: LibraryKind): Promise<void> {
    if (await this.refreshLibrary()) {
      this.libraryKind = kind;
      this.libraryOpen = true;
      this.emit();
    }
  }
  hideLibrary(): void {
    this.libraryOpen = false;
    this.emit();
  }
  private loadResource(record: {
    id?: string;
    name: string;
    kind: LibraryKind;
    payload: unknown;
    version?: string;
    builtIn: boolean;
  }): void {
    const work = resourceDocument(record.kind, record.payload);
    this.reset();
    const name = record.builtIn ? `${record.name}（副本）` : record.name;
    this.resource = {
      id: record.id,
      name,
      savedName: name,
      kind: record.kind,
      version: record.version,
      builtIn: record.builtIn,
    };
    this.resourceObservedVersion = record.version;
    this.file = {
      sessionId: `$library:${record.id ?? "new"}`,
      path: `${this.library!.directory}/users/${record.id ?? "new"}.json`,
      directory: this.library!.directory,
      version: 0,
      payload: record.payload,
    };
    this.work = work;
    this.baseline = JSON.stringify(work);
    this.selected = work.modules[0]?.id ?? "";
    this.status = record.builtIn
      ? "正在编辑内置资源副本，保存后出现在“我的”资源中"
      : "在右侧编辑参数，应用后保存到本地资源库";
    this.emit();
  }
  private async detachDocument(): Promise<void> {
    if (this.file && !this.resource) {
      await this.desktop.close(this.file);
    }
  }
  async editResource(id: string): Promise<boolean> {
    if (this.busy || !(await this.prepareLeave())) {
      return false;
    }
    return this.perform("正在打开资源…", async () => {
      this.library ??= await this.desktop.libraryContext();
      const record = await this.desktop.libraryRead(id);
      resourceDocument(record.kind, record.payload);
      await this.detachDocument();
      this.loadResource(record);
      await this.refreshPreview();
    });
  }
  async newResource(
    kind: LibraryKind,
    name: string,
    moduleKind: NewModuleKind,
  ): Promise<boolean> {
    if (!name.trim() || !(await this.prepareLeave())) {
      return false;
    }
    return this.perform("正在创建资源…", async () => {
      this.library ??= await this.desktop.libraryContext();
      const work = emptyResource(kind, moduleKind);
      await this.detachDocument();
      this.loadResource({
        name: name.trim(),
        kind,
        payload: resourcePayload(kind, work),
        builtIn: false,
      });
      await this.refreshPreview();
    });
  }
  async extractResource(
    kind: LibraryKind,
    name: string,
    selected = true,
  ): Promise<boolean> {
    if (
      !this.work ||
      !name.trim() ||
      this.busy ||
      !(await this.settleDraft())
    ) {
      return false;
    }
    const source = selected
      ? indexModules(this.work).get(this.selected)?.module
      : this.work.modules[0];
    if (!source) {
      this.fail("请选择一个模块");
      return false;
    }
    const payload =
      kind === "style"
        ? styleResource(source)
        : templateResource(this.work, selected ? this.selected : undefined);
    if (!(await this.prepareLeave())) {
      return false;
    }
    return this.perform("正在提取资源…", async () => {
      this.library ??= await this.desktop.libraryContext();
      await this.detachDocument();
      this.loadResource({ name: name.trim(), kind, payload, builtIn: false });
      await this.refreshPreview();
    });
  }
  async useResource(id: string, name?: string): Promise<boolean> {
    const item = this.libraryRecords.find((item) => item.id === id);
    if (!item) {
      return false;
    }
    if (item.kind === "style") {
      if (
        !this.work ||
        this.resource?.kind === "style" ||
        !(await this.settleDraft())
      ) {
        this.status = "请先打开作品并选择要应用 Style 的模块";
        this.emit();
        return false;
      }
      return this.perform("正在应用 Style…", async () => {
        const record = await this.desktop.libraryRead(id);
        this.commit(
          applyStyleResource(this.work!, this.selected, record.payload),
        );
        this.libraryOpen = false;
        await this.refreshPreview();
        this.scheduleSave();
        this.status = "Style 已应用；未提供的参数保持原样";
      });
    }
    if (
      !name?.trim() ||
      !this.preferences.workspace ||
      !(await this.prepareLeave())
    ) {
      return false;
    }
    return this.perform("正在从模板创建作品…", async () => {
      const record = await this.desktop.libraryRead(id);
      const work = resourcePreview(
        "template",
        resourceDocument("template", record.payload),
        this.library!.demoPath,
      );
      const created = await this.desktop.createFromLibrary(
        this.preferences.workspace!,
        name.trim(),
        work,
      );
      await this.detachDocument();
      this.load(created);
      this.entries = await this.desktop.scan(this.preferences.workspace!);
      await this.refreshPreview();
    });
  }
  private async resourceThumbnail(
    kind: LibraryKind,
    work: WorkingDocument,
  ): Promise<{ thumbnail?: string; previewError?: string }> {
    let result: RenderOutcome | undefined;
    try {
      result = await this.renderer.render(
        resourcePreview(kind, work, this.library!.demoPath),
        this.library!.directory,
        new AbortController().signal,
      );
      if (!result.frame) {
        return {
          previewError:
            result.issues.map((issue) => issue.message).join("；") ||
            "无可渲染内容",
        };
      }
      return { thumbnail: thumbnailDataUrl(result.frame) };
    } catch (error) {
      return { previewError: describe(error) };
    } finally {
      result?.dispose();
    }
  }
  async saveResource(copyName?: string): Promise<boolean> {
    if (!this.resource || !this.work) {
      return false;
    }
    clearTimeout(this.timer);
    return this.perform("正在保存资源及缩略图…", async () => {
      const edit = this.resource!;
      const copy = !!copyName || edit.builtIn;
      const preview = await this.resourceThumbnail(edit.kind, this.work!);
      const saved = await this.desktop.librarySave({
        id: copy ? undefined : edit.id,
        name: copyName?.trim() || edit.name,
        kind: edit.kind,
        payload: resourcePayload(edit.kind, this.work!),
        expectedVersion: copy ? undefined : edit.version,
        ...preview,
      });
      this.resource = {
        id: saved.id,
        name: saved.name,
        savedName: saved.name,
        kind: saved.kind,
        version: saved.version,
        builtIn: false,
      };
      this.resourceObservedVersion = saved.version;
      this.file = {
        ...this.file!,
        sessionId: `$library:${saved.id}`,
        path: `${this.library!.directory}/users/${saved.id}.json`,
        external: undefined,
      };
      this.baseline = JSON.stringify(this.work);
      await this.fetchLibrary();
      this.status = preview.previewError
        ? `资源已保存，预览不可用：${preview.previewError}`
        : "资源和缩略图已保存到“我的”资源库";
    });
  }
  nameResource(name: string): boolean {
    if (!this.resource || !name.trim() || this.busy) {
      return false;
    }
    this.resource.name = name.trim();
    this.scheduleSave();
    this.emit();
    return true;
  }
  async renameResource(id: string, name: string): Promise<boolean> {
    const record = this.libraryRecords.find((item) => item.id === id);
    if (!record || record.builtIn || !name.trim()) {
      return false;
    }
    return this.perform("正在重命名资源…", async () => {
      const saved = await this.desktop.librarySave({
        id,
        name: name.trim(),
        kind: record.kind,
        payload: record.payload,
        thumbnail: record.thumbnail,
        previewError: record.previewError,
        expectedVersion: record.version,
      });
      if (this.resource?.id === id) {
        this.resource.name = saved.name;
        this.resource.savedName = saved.name;
        this.resource.version = saved.version;
      }
      await this.fetchLibrary();
      this.status = "资源名称已更新";
    });
  }
  async copyResource(id: string, name: string): Promise<boolean> {
    return this.perform("正在复制资源…", async () => {
      const record = await this.desktop.libraryRead(id);
      const work = resourceDocument(record.kind, record.payload);
      const preview = await this.resourceThumbnail(record.kind, work);
      await this.desktop.librarySave({
        name: name.trim(),
        kind: record.kind,
        payload: resourcePayload(record.kind, work),
        ...preview,
      });
      await this.fetchLibrary();
      this.status = "资源副本已保存到“我的”资源库";
    });
  }
  async deleteResource(id: string): Promise<void> {
    const record = this.libraryRecords.find((item) => item.id === id);
    if (!record || record.builtIn || this.busy) {
      return;
    }
    if (this.resource?.id === id && !(await this.prepareLeave())) {
      return;
    }
    const answer = await this.ask({
      title: "删除本地资源？",
      message: `删除“${record.name}”不会改变已经创建或应用的作品。`,
      choices: [
        { value: "delete", label: "删除", danger: true },
        { value: "cancel", label: "取消" },
      ],
    });
    if (answer !== "delete") {
      return;
    }
    await this.perform("正在删除资源…", async () => {
      const latest = this.libraryRecords.find((item) => item.id === id)!;
      await this.desktop.libraryDelete(id, latest.version);
      if (this.resource?.id === id) {
        this.reset();
        this.libraryOpen = true;
      }
      await this.fetchLibrary();
      this.status = "资源已删除，已有作品不受影响";
    });
  }
  async regenerateResource(id: string): Promise<void> {
    await this.perform("正在重新生成缩略图…", async () => {
      const record = await this.desktop.libraryRead(id);
      const preview = await this.resourceThumbnail(
        record.kind,
        resourceDocument(record.kind, record.payload),
      );
      if (record.builtIn) {
        this.libraryRecords = this.libraryRecords.map((item) =>
          item.id === id
            ? {
                ...record,
                thumbnail: undefined,
                previewError: undefined,
                ...preview,
              }
            : item,
        );
      } else {
        const saved = await this.desktop.librarySave({
          id,
          name: record.name,
          kind: record.kind,
          payload: record.payload,
          expectedVersion: record.version,
          ...preview,
        });
        if (
          this.resource?.id === id &&
          this.resource.version === record.version
        ) {
          this.resource.version = saved.version;
          this.resourceObservedVersion = saved.version;
        }
        await this.fetchLibrary();
      }
      this.status = preview.previewError
        ? `预览不可用：${preview.previewError}`
        : "缩略预览已更新";
    });
  }
  private async checkResource(): Promise<void> {
    const resource = this.resource;
    if (
      !resource?.id ||
      resource.builtIn ||
      this.busy ||
      this.checkingResource ||
      this.asking ||
      this.interacting
    ) {
      return;
    }
    this.checkingResource = true;
    try {
      const version = await this.desktop.libraryVersion(resource.id);
      if (this.resource !== resource || !this.file) {
        return;
      }
      if (version === resource.version) {
        this.resourceObservedVersion = version;
        if (this.file.external) {
          this.file.external = undefined;
          this.emit();
        }
        return;
      }
      if (version !== this.resourceObservedVersion) {
        this.resourceObservedVersion = version;
        this.file.version++;
        this.file.external = {
          message: version ? "资源已被其他程序修改" : "资源文件已被删除",
          reloadable: !!version,
        };
        this.emit();
        this.maybeReload();
      }
    } catch (error) {
      if (this.resource === resource && this.file && !this.file.external) {
        this.file.external = {
          message: `无法读取资源：${describe(error)}`,
          reloadable: false,
        };
        this.emit();
      }
    } finally {
      this.checkingResource = false;
    }
  }
  private load(file: StoredFile): void {
    this.reset();
    this.file = file;
    this.work = documentCopy(file.payload);
    this.baseline = JSON.stringify(this.work);
    this.baselineAssets = new Map(
      [...materialPaths(this.work)].map(([key, asset]) => [key, asset.path]),
    );
    this.selected = this.work.modules[0]?.id ?? "";
    this.status = "文档已打开";
    const observed = this.observed.get(file.sessionId);
    if (observed && observed.version > file.version) {
      this.file = {
        ...file,
        version: observed.version,
        external: observed.external,
      };
    }
    this.emit();
  }
  private reset(): void {
    clearTimeout(this.timer);
    this.abort?.abort();
    this.generation++;
    this.shown?.dispose();
    if (this.outcome !== this.shown) {
      this.outcome?.dispose();
    }
    this.shown = undefined;
    this.outcome = undefined;
    this.file = undefined;
    this.resource = undefined;
    this.resourceObservedVersion = undefined;
    this.autoReloadAttempt = "";
    this.libraryOpen = false;
    this.work = undefined;
    this.selected = "";
    this.draft.clear();
    this.errors.clear();
    this.pending.clear();
    this.issues = [];
    this.rendering = false;
  }
  private async settleDraft(): Promise<boolean> {
    if (this.asking) {
      return false;
    }
    if (!this.draft.size) {
      return true;
    }
    const answer = await this.ask({
      title: "还有未应用的输入",
      message: "离开当前模块前，请处理右侧尚未应用的内容。",
      choices: [
        { value: "apply", label: "应用并继续", primary: true },
        { value: "discard", label: "放弃输入并继续", danger: true },
        { value: "cancel", label: "取消" },
      ],
    });
    if (answer === "apply") {
      return this.apply();
    }
    if (answer === "discard") {
      this.draft.clear();
      this.errors.clear();
      this.emit();
      return true;
    }
    return false;
  }
  async prepareLeave(): Promise<boolean> {
    if (this.busy || this.asking || !(await this.settleDraft())) {
      return false;
    }
    if (!this.dirty()) {
      return true;
    }
    const answer = await this.ask({
      title: this.resource ? "资源尚未保存" : "文档尚未保存",
      message: "保存成功后才能继续。放弃修改不会更改磁盘上的 JSON。",
      choices: [
        { value: "save", label: "保存并继续", primary: true },
        { value: "discard", label: "放弃修改并继续", danger: true },
        { value: "cancel", label: "取消" },
      ],
    });
    if (answer === "save") {
      return this.save();
    }
    if (answer === "discard") {
      clearTimeout(this.timer);
    }
    return answer === "discard";
  }
  async closeDocument(): Promise<void> {
    if (!(await this.prepareLeave())) {
      return;
    }
    await this.perform("正在关闭文档…", async () => {
      if (this.file && !this.resource) {
        await this.desktop.close(this.file);
      }
      this.reset();
      this.status = "选择文档开始编辑";
    });
  }
  updateField(id: string, value: string): void {
    if (!this.work || this.busy) {
      return;
    }
    const original = fieldsFor(
      this.work,
      this.selected,
      new Map(),
      new Map(),
      this.fonts,
      this.resource?.kind,
    ).find((f) => f.id === id);
    if (original?.value === value) {
      this.draft.delete(id);
    } else {
      this.draft.set(id, value);
    }
    this.errors.delete(id);
    this.emit();
  }
  discardInput(): void {
    if (!this.busy) {
      this.draft.clear();
      this.errors.clear();
      this.emit();
    }
  }
  async chooseAsset(id: string): Promise<void> {
    try {
      const path = await this.choosePath("image", this.file?.directory);
      if (path) {
        this.updateField(id, path);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  async apply(): Promise<boolean> {
    if (!this.work || !this.file || this.busy) {
      return false;
    }
    if (!this.draft.size) {
      await this.perform("正在更新预览…", () => this.refreshPreview());
      return true;
    }
    let next: WorkingDocument;
    try {
      next = applyFields(this.work, this.selected, this.draft, {
        mode: this.resource?.kind,
        preview:
          this.resource && this.library
            ? (doc) =>
                resourcePreview(
                  this.resource!.kind,
                  doc,
                  this.library!.demoPath,
                )
            : undefined,
      });
    } catch (error) {
      if (error instanceof FieldFailure) {
        this.errors = error.errors;
      }
      this.fail(error);
      return false;
    }
    let applied = false;
    await this.perform("正在应用修改…", async () => {
      const result = await this.render(next);
      if (result.invalidModuleIds.includes(this.selected)) {
        this.errors.set(
          "image.processors",
          result.issues.find((i) => i.severity === "error")?.message ??
            "图片处理参数非法",
        );
        this.issues = result.issues;
        this.status = "值非法，修改未应用";
        result.dispose();
        return;
      }
      this.commit(next);
      this.draft.clear();
      this.errors.clear();
      this.acceptPreview(result);
      this.status = result.frame ? "修改已应用" : "修改已应用，预览存在问题";
      this.scheduleSave();
      applied = true;
    });
    return applied;
  }
  private commit(next: WorkingDocument): void {
    if (this.resource) {
      this.work =
        this.resource.kind === "template" ? templateResource(next) : next;
      this.pending.clear();
      return;
    }
    const before = this.work ? materialPaths(this.work) : new Map();
    const after = materialPaths(next);
    for (const key of this.pending.keys()) {
      if (!after.has(key)) {
        this.pending.delete(key);
      }
    }
    for (const [key, asset] of after) {
      if (this.baselineAssets.get(key) === asset.path) {
        this.pending.delete(key);
      } else if (before.get(key)?.path !== asset.path) {
        this.pending.set(key, asset);
      }
    }
    this.work = next;
  }
  async select(id: string): Promise<void> {
    if (this.busy || id === this.selected || !(await this.settleDraft())) {
      return;
    }
    if (this.work && indexModules(this.work).has(id)) {
      this.selected = id;
      this.errors.clear();
      this.emit();
    }
  }
  async pick(x: number, y: number): Promise<void> {
    if (this.shown !== this.outcome || this.rendering) {
      return;
    }
    const id = this.shown?.hit(x, y);
    if (id) {
      await this.select(id);
    }
  }
  async add(input: NewModuleInput): Promise<boolean> {
    if (!this.work || this.busy || !(await this.settleDraft())) {
      return false;
    }
    return this.perform("正在新增模块…", async () => {
      const result = addModule(this.work!, input);
      this.commit(result.document);
      this.selected = result.id;
      await this.refreshPreview();
      this.scheduleSave();
      this.status = "模块已新增，尚未保存";
    });
  }
  async removeSelected(): Promise<void> {
    if (
      !this.work ||
      !this.selected ||
      this.busy ||
      !(await this.settleDraft())
    ) {
      return;
    }
    const result = removeModule(this.work, this.selected);
    const answer = await this.ask({
      title: "删除模块",
      message: `将删除当前模块及其子模块，共 ${result.count} 个模块。保存前不会写入文件。`,
      choices: [
        { value: "delete", label: "删除", danger: true },
        { value: "cancel", label: "取消" },
      ],
    });
    if (answer !== "delete") {
      return;
    }
    await this.perform("正在删除模块…", async () => {
      this.commit(result.document);
      this.selected = result.parentId ?? "";
      await this.refreshPreview();
      this.scheduleSave();
      this.status = "模块已删除，尚未保存";
    });
  }
  async move(parentId: string, row: number, column: number): Promise<boolean> {
    if (!this.work || this.busy || !(await this.settleDraft())) {
      return false;
    }
    return this.perform("正在移动模块…", async () => {
      this.commit(moveModule(this.work!, this.selected, parentId, row, column));
      await this.refreshPreview();
      this.scheduleSave();
      this.status = "模块位置已修改";
    });
  }
  private async render(doc: WorkingDocument): Promise<RenderOutcome> {
    this.abort?.abort();
    this.abort = new AbortController();
    this.rendering = true;
    this.emit();
    try {
      return await this.renderer.render(
        this.resource && this.library
          ? resourcePreview(this.resource.kind, doc, this.library.demoPath)
          : documentCopy(doc),
        this.file!.directory,
        this.abort.signal,
      );
    } finally {
      this.rendering = false;
      this.emit();
    }
  }
  private async refreshPreview(): Promise<void> {
    if (!this.work || !this.file) {
      return;
    }
    const generation = this.generation;
    const result = await this.render(this.work);
    if (generation !== this.generation) {
      result.dispose();
      return;
    }
    this.acceptPreview(result);
  }
  private acceptPreview(result: RenderOutcome): void {
    if (this.outcome !== this.shown) {
      this.outcome?.dispose();
    }
    if (result.frame || result.empty || !this.work?.modules.length) {
      this.shown?.dispose();
      this.shown = result.frame ? result : undefined;
    }
    this.outcome = result;
    this.issues = result.issues;
    this.emit();
  }
  private scheduleSave(): void {
    clearTimeout(this.timer);
    if (!this.preferences.autosave || !this.dirty() || this.file?.external) {
      return;
    }
    this.timer = setTimeout(() => {
      if (this.busy || this.asking) {
        this.scheduleSave();
      } else {
        void this.save();
      }
    }, 2000);
  }
  async save(destination?: string): Promise<boolean> {
    if (this.resource) {
      return this.saveResource();
    }
    if (!this.file || !this.work) {
      return false;
    }
    clearTimeout(this.timer);
    return this.perform("正在保存文档与素材…", async () => {
      if (this.file!.external && !destination) {
        throw new Error("磁盘文件已发生变化，请重新加载或另存为后再保存");
      }
      const materials = [];
      for (const asset of this.pending.values()) {
        const version =
          this.outcome?.versions.get(asset.path) ??
          (await this.desktop.resourceVersion(
            asset.path,
            this.file!.directory,
          ));
        if (!version) {
          throw new Error(`无法读取待复制素材：${asset.path}`);
        }
        materials.push({
          moduleId: asset.moduleId,
          slot: asset.slot,
          sourcePath: asset.path,
          version,
        });
      }
      const saved = await this.desktop.save(
        this.file!,
        documentCopy(this.work!),
        materials,
        destination,
      );
      this.file = saved;
      this.work = documentCopy(saved.payload);
      this.baseline = JSON.stringify(this.work);
      this.baselineAssets = new Map(
        [...materialPaths(this.work)].map(([key, asset]) => [key, asset.path]),
      );
      this.pending.clear();
      const latest = this.observed.get(saved.sessionId);
      if (latest && latest.version > saved.version) {
        this.file = {
          ...saved,
          version: latest.version,
          external: latest.external,
        };
      }
      this.status = this.draft.size
        ? "已应用内容已保存，右侧仍有未应用输入"
        : "文档与素材已保存";
      if (destination && this.preferences.workspace) {
        this.entries = await this.desktop.scan(this.preferences.workspace);
      }
    });
  }
  async saveAs(): Promise<void> {
    if (this.resource) {
      this.status = "使用资源编辑器上方的“另存副本”保存新资源";
      this.emit();
      return;
    }
    if (this.busy || !this.file) {
      return;
    }
    try {
      const destination = await this.choosePath("saveAs", this.file.directory);
      if (destination) {
        await this.save(destination);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  async exportPng(): Promise<void> {
    if (!this.file || this.busy || this.resource) {
      return;
    }
    if (this.dirty() && !(await this.save())) {
      return;
    }
    await this.perform("正在导出 PNG…", async () => {
      if (this.file!.external) {
        throw new Error("请先处理外部文件变化");
      }
      if (
        !this.outcome?.frame ||
        this.shown !== this.outcome ||
        this.rendering
      ) {
        throw new Error("当前版本没有成功预览，请修正并应用后再导出");
      }
      const target = await this.desktop.pngDestination(this.file!);
      if (target.version) {
        const answer = await this.ask({
          title: "覆盖已有 PNG？",
          message: target.path,
          choices: [
            { value: "overwrite", label: "覆盖", danger: true },
            { value: "cancel", label: "取消" },
          ],
        });
        if (answer !== "overwrite") {
          return;
        }
      }
      const bytes = await this.outcome.encode();
      const path = await this.desktop.writePng(
        this.file!,
        bytes,
        target.version,
      );
      this.status = `PNG 已保存至 ${path}`;
    });
  }
  private observe(file: StoredFile): void {
    const previous = this.observed.get(file.sessionId);
    if (previous && previous.version > file.version) {
      return;
    }
    this.observed.set(file.sessionId, file);
    if (
      this.file?.sessionId !== file.sessionId ||
      this.file.version > file.version
    ) {
      return;
    }
    this.file = {
      ...this.file,
      version: file.version,
      external: file.external,
    };
    this.emit();
    this.maybeReload();
  }
  private maybeReload(): void {
    if (
      !this.file?.external?.reloadable ||
      this.busy ||
      this.asking ||
      this.interacting ||
      this.dirty() ||
      this.draft.size
    ) {
      return;
    }
    const key = `${this.file.sessionId}:${this.file.version}`;
    if (key === this.autoReloadAttempt) {
      return;
    }
    this.autoReloadAttempt = key;
    void this.reloadExternal();
  }
  async reloadExternal(): Promise<void> {
    if (!this.file?.external?.reloadable || this.busy) {
      return;
    }
    if (this.dirty() || this.draft.size) {
      const answer = await this.ask({
        title: "重新加载磁盘文件？",
        message: "这会放弃当前未保存修改及未应用输入。",
        choices: [
          { value: "reload", label: "放弃本地编辑并加载", danger: true },
          { value: "cancel", label: "取消" },
        ],
      });
      if (answer !== "reload") {
        return;
      }
    }
    await this.perform("正在重新加载…", async () => {
      if (this.resource?.id) {
        const record = await this.desktop.libraryRead(this.resource.id);
        this.loadResource(record);
        await this.refreshPreview();
        return;
      }
      const file = await this.desktop.reload(this.file!);
      this.load(file);
      await this.refreshPreview();
    });
  }
  dispose(): void {
    clearInterval(this.libraryPoll);
    this.unsubscribe?.();
    this.reset();
    this.listeners.clear();
  }
}
