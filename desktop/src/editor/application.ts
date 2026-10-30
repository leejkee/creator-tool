import type {
  AppPreferences,
  Ask,
  DesktopPort,
  EditorIssue,
  EditorView,
  NewModuleInput,
  RenderOutcome,
  RendererPort,
  StoredFile,
  WorkspaceItem,
} from "./contracts";
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
      activeName: this.file ? filename(this.file.path) : "",
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
          )
        : [],
      parents: this.work ? parents(this.work) : [],
      frame: this.shown?.frame,
      stale: !!this.shown?.frame && this.shown !== this.outcome,
      rendering: this.rendering,
      busy: this.busy,
      status: this.status,
      issues: this.issues,
      external: this.file?.external,
      fonts: this.fonts,
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
      (JSON.stringify(this.work) !== this.baseline || this.pending.size > 0)
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
      if (this.preferences.workspace) {
        this.entries = await this.desktop.scan(this.preferences.workspace);
      }
      this.status = "选择文档开始编辑";
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
      const workspace = await this.desktop.choose(
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
        if (this.file) {
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
    if (this.busy) {
      return;
    }
    let path = entry.preferred;
    if (!path) {
      path = await this.ask({
        title: "选择要打开的 JSON",
        message: `“${entry.name}”中有多个 JSON，且没有同名文件。`,
        choices: [
          ...entry.candidates.map((value) => ({
            value,
            label: filename(value),
          })),
          { value: "cancel", label: "取消" },
        ],
      });
    }
    if (
      !path ||
      path === "cancel" ||
      path === this.file?.path ||
      !(await this.prepareLeave())
    ) {
      return;
    }
    await this.perform("正在打开文档…", async () => {
      const next = await this.desktop.open(path!);
      if (this.file && this.file.sessionId !== next.sessionId) {
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
      if (this.file) {
        await this.desktop.close(this.file);
      }
      this.load(next);
      this.entries = await this.desktop.scan(this.preferences.workspace!);
      await this.refreshPreview();
    });
  }
  async chooseTemplate(): Promise<string | undefined> {
    return this.desktop.choose("json", this.preferences.workspace);
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
      title: "文档尚未保存",
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
      if (this.file) {
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
      const path = await this.desktop.choose("image", this.file?.directory);
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
      next = applyFields(this.work, this.selected, this.draft);
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
        documentCopy(doc),
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
    if (this.busy || !this.file) {
      return;
    }
    try {
      const destination = await this.desktop.choose(
        "saveAs",
        this.file.directory,
      );
      if (destination) {
        await this.save(destination);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  async exportPng(): Promise<void> {
    if (!this.file || this.busy) {
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
      const file = await this.desktop.reload(this.file!);
      this.load(file);
      await this.refreshPreview();
    });
  }
  dispose(): void {
    this.unsubscribe?.();
    this.reset();
    this.listeners.clear();
  }
}
