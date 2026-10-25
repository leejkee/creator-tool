import { invoke } from "@tauri-apps/api/core";
import type {
  DocumentSnapshot,
  ModuleNode,
  StyleNode,
  ValidationReport,
} from "../types";

/** Check without changing the module or any open document. Rules live in Rust. */
export function checkStyleApplicability(
  image: ModuleNode,
  style: StyleNode,
): Promise<ValidationReport> {
  return invoke<ValidationReport>("check_module_style", { image, style });
}

/** Always validates first. Returns a new module; does not commit or save it. */
export function applyStyle(
  image: ModuleNode,
  style: StyleNode,
): Promise<ModuleNode> {
  return invoke<ModuleNode>("apply_module_style", { image, style });
}

/** Validate and commit once to Rust's authoritative session, without saving to disk. */
export function applyDocumentStyle(
  sessionId: string,
  expectedVersion: number,
  moduleId: string,
  style: StyleNode,
): Promise<DocumentSnapshot> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return Promise.reject(new RangeError("expectedVersion must be a nonnegative safe integer"));
  }
  return invoke<DocumentSnapshot>("apply_document_style", {
    sessionId,
    expectedVersion,
    moduleId,
    style,
  });
}
