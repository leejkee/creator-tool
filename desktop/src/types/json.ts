/** JSON data received over IPC. Optional DTO members represent absent fields. */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Rust flattens its extension maps into the containing object; there is no
 * `properties` member on the wire. Unknown members survive snapshots and spreads.
 * Their shape must be narrowed before use, without assuming rendering semantics.
 */
export interface ExtensionFields {
  readonly [key: string]: unknown;
}
