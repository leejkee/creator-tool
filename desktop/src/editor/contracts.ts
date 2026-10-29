/** GUI-facing contracts. No document protocol or rendering-engine imports. */
export interface WorkspaceItem {
  name: string;
  directory: string;
  candidates: string[];
  preferred?: string;
}
export interface AppPreferences {
  workspace?: string;
  autosave: boolean;
}
export interface StoredFile {
  sessionId: string;
  path: string;
  directory: string;
  version: number;
  payload: unknown;
  external?: { message: string; reloadable: boolean };
}
export interface EditorIssue {
  severity: "error" | "warning";
  message: string;
  location?: string;
}
export interface FieldOption {
  value: string;
  label: string;
}
export interface EditorField {
  id: string;
  label: string;
  section: string;
  kind: "text" | "number" | "multiline" | "select" | "asset" | "code" | "font";
  value: string;
  placeholder?: string;
  options?: readonly FieldOption[];
  error?: string;
  hint?: string;
}
export type NewModuleKind = "image" | "text" | "rect" | "layout";
export interface NewModuleInput {
  kind: NewModuleKind;
  parentId: string;
  row: string;
  column: string;
  width: string;
  height: string;
  text: string;
}
export interface ModuleChoice {
  id: string;
  label: string;
}
export interface PreviewView {
  surface: HTMLCanvasElement;
  width: number;
  height: number;
  boxes: readonly {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}
export interface PendingMaterial {
  moduleId: string;
  slot: "image" | "background";
  sourcePath: string;
  version: string;
}
export interface EditorView {
  ready: boolean;
  preferences: AppPreferences;
  entries: readonly WorkspaceItem[];
  activeName: string;
  activePath: string;
  activeDirectory: string;
  dirty: boolean;
  draft: boolean;
  selectedId: string;
  selectedName: string;
  selectedKind: string;
  fields: readonly EditorField[];
  parents: readonly ModuleChoice[];
  frame?: PreviewView;
  stale: boolean;
  rendering: boolean;
  busy: string;
  status: string;
  issues: readonly EditorIssue[];
  external?: { message: string; reloadable: boolean };
  fonts: readonly string[];
}
export interface Decision {
  title: string;
  message: string;
  choices: readonly {
    value: string;
    label: string;
    danger?: boolean;
    primary?: boolean;
  }[];
}
export type Ask = (decision: Decision) => Promise<string>;

export interface DesktopPort {
  available(): boolean;
  loadPreferences(): Promise<AppPreferences>;
  savePreferences(value: AppPreferences): Promise<void>;
  scan(workspace: string): Promise<WorkspaceItem[]>;
  choose(
    kind: "directory" | "image" | "json" | "saveAs",
    initial?: string,
  ): Promise<string | undefined>;
  open(path: string): Promise<StoredFile>;
  create(
    workspace: string,
    name: string,
    template?: string,
  ): Promise<StoredFile>;
  save(
    file: StoredFile,
    payload: unknown,
    materials: readonly PendingMaterial[],
    destination?: string,
  ): Promise<StoredFile>;
  reload(file: StoredFile): Promise<StoredFile>;
  close(file: StoredFile): Promise<void>;
  subscribe(
    listener: (file: StoredFile) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void>;
  fonts(): Promise<readonly string[]>;
  resourceVersion(path: string, directory: string): Promise<string | undefined>;
  pngDestination(file: StoredFile): Promise<{ path: string; version?: string }>;
  writePng(
    file: StoredFile,
    bytes: Uint8Array,
    version?: string,
  ): Promise<string>;
}

export interface RenderOutcome {
  frame?: PreviewView;
  empty?: boolean;
  issues: EditorIssue[];
  versions: ReadonlyMap<string, string>;
  /** Parameter errors that can be attributed to the module currently edited. */
  invalidModuleIds: readonly string[];
  encode(): Promise<Uint8Array>;
  hit(x: number, y: number): string | undefined;
  dispose(): void;
}
export interface RendererPort {
  render(
    payload: unknown,
    directory: string,
    signal: AbortSignal,
  ): Promise<RenderOutcome>;
}
