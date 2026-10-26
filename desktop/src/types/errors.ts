/** Rust I/O/session error payload, distinct from Tauri argument decoding errors. */
export interface DocumentError {
  readonly code: string;
  readonly message: string;
}
