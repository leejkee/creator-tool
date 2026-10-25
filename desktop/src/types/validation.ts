/** Serialized creator_document_core::validation::Violation names. */
export type ValidationViolation =
  | "missingField"
  | "nullNotAllowed"
  | "invalidType"
  | "emptyValue"
  | "invalidEnum"
  | "duplicateId"
  | "leafHasChildren"
  | "invalidLayout"
  | "invalidJson"
  | "invalidPosition"
  | "positionOutOfBounds"
  | "duplicatePosition"
  | "unsupportedField";

export interface ValidationIssue {
  /** Domain codes remain open so Rust can introduce more specific failures. */
  readonly code: string;
  readonly rule: ValidationViolation;
  /** RFC 6901 JSON Pointer; "" denotes the document root. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

/** Rust domain error payload, distinct from Tauri transport/invocation errors. */
export interface DocumentError {
  readonly code: string;
  readonly message: string;
  /** Rust omits this member when there are no field diagnostics. */
  readonly issues?: readonly ValidationIssue[];
}
