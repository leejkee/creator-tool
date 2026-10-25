import type { ImageDocument } from "./document";
import type { DocumentError } from "./validation";

/** Same internally tagged representation as Rust ExternalChange. */
export type ExternalChange =
  | {
      readonly kind: "modified";
      readonly document: ImageDocument | null;
      readonly error: DocumentError | null;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly error: DocumentError };

/** Serialized Rust Snapshot; session metadata does not belong in the image JSON. */
export interface DocumentSnapshot {
  readonly sessionId: string;
  readonly path: string;
  readonly workingDirectory: string;
  readonly document: ImageDocument;
  /** Session concurrency version, separate from document.revision. */
  readonly version: number;
  readonly dirty: boolean;
  /** Rust serializes None as null, not as an absent member. */
  readonly externalChange: ExternalChange | null;
}

/** Payload types only; this interface does not subscribe to events. */
export interface DocumentEventMap {
  readonly "document-state-changed": DocumentSnapshot;
  readonly "document-closed": string;
}
