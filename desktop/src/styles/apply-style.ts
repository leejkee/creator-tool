import { invoke } from "@tauri-apps/api/core";
import type { DocumentSnapshot, ModuleNode, StyleNode } from "../types";

/** Returns a new module without business validation; does not commit or save it. */
export function applyStyle(
  image: ModuleNode,
  style: StyleNode,
): Promise<ModuleNode> {
  return invoke<ModuleNode>("apply_module_style", { image, style });
}

/** Apply and commit once to Rust's authoritative session, without saving to disk. */
export function applyDocumentStyle(
  sessionId: string,
  expectedVersion: number,
  moduleId: string,
  style: StyleNode,
): Promise<DocumentSnapshot> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return Promise.reject(
      new RangeError("expectedVersion must be a nonnegative safe integer"),
    );
  }
  return invoke<DocumentSnapshot>("apply_document_style", {
    sessionId,
    expectedVersion,
    moduleId,
    style,
  });
}
