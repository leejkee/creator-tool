import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocumentSnapshot } from "../types";
import type {
  DesktopPort,
  StoredFile,
  AppPreferences,
  WorkspaceItem,
} from "./contracts";

export function fileRecord(snapshot: DocumentSnapshot): StoredFile {
  if (
    !Number.isSafeInteger(snapshot.version) ||
    !Number.isSafeInteger(snapshot.document.revision)
  ) {
    throw new Error("文档版本超出安全整数范围，不能继续编辑");
  }
  const external = snapshot.externalChange;
  const separator = Math.max(
    snapshot.path.lastIndexOf("/"),
    snapshot.path.lastIndexOf("\\"),
  );
  const parent = snapshot.path.slice(0, separator || 1);
  const directory = parent.endsWith(":")
    ? parent + snapshot.path[separator]
    : parent;
  const message =
    external?.kind === "missing"
      ? "磁盘文件已被删除"
      : external?.kind === "unreadable"
        ? external.error.message
        : external?.kind === "modified"
          ? (external.error?.message ?? "磁盘文件已被其他程序修改")
          : undefined;
  return {
    sessionId: snapshot.sessionId,
    path: snapshot.path,
    directory,
    version: snapshot.version,
    payload: snapshot.document,
    external: message
      ? {
          message,
          reloadable:
            external?.kind === "modified" &&
            !!external.document &&
            !external.error,
        }
      : undefined,
  };
}
export function createDesktopPort(): DesktopPort {
  const snapshot = async (command: string, args: Record<string, unknown>) =>
    fileRecord(await invoke<DocumentSnapshot>(command, args));
  return {
    available: isTauri,
    async loadPreferences() {
      const result = await invoke<{
        workspace: string | null;
        autosave: boolean;
      }>("load_editor_config");
      return {
        workspace: result.workspace ?? undefined,
        autosave: result.autosave,
      };
    },
    savePreferences: (config: AppPreferences) =>
      invoke("save_editor_config", { config }),
    async scan(workspace) {
      const result = await invoke<
        (Omit<WorkspaceItem, "preferred"> & { preferred: string | null })[]
      >("scan_editor_workspace", { workspace });
      return result.map((e) => ({ ...e, preferred: e.preferred ?? undefined }));
    },
    async choose(kind, initial) {
      return (
        (await invoke<string | null>("choose_editor_path", {
          kind,
          initial: initial ?? null,
        })) ?? undefined
      );
    },
    open: (path) => snapshot("open_document", { path }),
    create: (workspace, name, template) =>
      snapshot("create_document", {
        baseDirectory: workspace,
        sourceSessionId: null,
        moduleName: name,
        templatePath: template ?? null,
      }),
    save: (file, payload, assets, destination) =>
      snapshot("save_editor_document", {
        sessionId: file.sessionId,
        expectedVersion: file.version,
        document: payload,
        assets,
        destination: destination ?? null,
      }),
    reload: (file) =>
      snapshot("reload_document", {
        sessionId: file.sessionId,
        expectedVersion: file.version,
        discardChanges: true,
      }),
    close: (file) =>
      invoke("close_document", {
        sessionId: file.sessionId,
        expectedVersion: file.version,
        discardChanges: true,
      }),
    subscribe: (listener, onError) =>
      listen<DocumentSnapshot>("document-state-changed", (e) => {
        try {
          listener(fileRecord(e.payload));
        } catch (error) {
          onError(error);
        }
      }),
    fonts: () => invoke<string[]>("list_local_font_families"),
    async resourceVersion(assetPath, documentDirectory) {
      return (
        (await invoke<string | null>("get_render_asset_version", {
          assetPath,
          documentDirectory,
        })) ?? undefined
      );
    },
    async pngDestination(file) {
      const result = await invoke<{ path: string; version: string | null }>(
        "editor_png_destination",
        { sessionId: file.sessionId },
      );
      return { path: result.path, version: result.version ?? undefined };
    },
    writePng: (file, bytes, version) =>
      invoke("write_editor_png", {
        sessionId: file.sessionId,
        expectedVersion: file.version,
        bytes: Array.from(bytes),
        overwriteVersion: version ?? null,
      }),
  };
}
