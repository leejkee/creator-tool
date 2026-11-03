import type {
  GridLayout,
  ModuleNode,
  ModuleType,
  PlacedModule,
} from "./document";
import type { ExtensionFields, JsonObject } from "./json";
import type { ImageProcessor } from "./processors";

/** One-shot Style parameters and child positions, without required content or IDs. */
export interface StyleNode extends ExtensionFields {
  /** Omitted for layout or decoration-only recipes. */
  readonly type?: ModuleType;
  /** Optional for decoration-only styles; required when matching child recipes. */
  readonly layout?: GridLayout;
  readonly children?: readonly PlacedModule<StyleNode>[];
  readonly style?: JsonObject;
  /** Omitted preserves the target chain; an explicit array replaces it, including []. */
  readonly processors?: readonly ImageProcessor[];
}

/** Matches Rust's tagged ModuleResource envelope exactly. */
export type ModuleResource =
  | { readonly resourceKind: "image"; readonly module: ModuleNode }
  | { readonly resourceKind: "style"; readonly module: StyleNode };

/** Derived from the envelope to keep the tag names in one place. */
export type ResourceKind = ModuleResource["resourceKind"];
