import type { ExtensionFields } from "./json";

/** 图片相对内容区域的缩放方式；对齐位置单独配置。 */
export type ImageFit =
  /** 等比完整显示，比例不同时留空。 */
  | "contain"
  /** 等比铺满，裁剪超出部分。 */
  | "cover"
  /** 分别适配宽高，可能变形。 */
  | "stretch"
  /** 等比适配高度，宽度可能留空或超出。 */
  | "height"
  /** 等比适配宽度，高度可能留空或超出。 */
  | "width";
export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "center" | "bottom";

/** Omit to disable the border; an empty object enables a 1px black solid border. */
export interface BorderStyle extends ExtensionFields {
  readonly width?: number;
  readonly color?: string;
}

export type BackgroundStyle =
  | (ExtensionFields & { readonly type: "color"; readonly color: string })
  | (ExtensionFields & {
      readonly type: "image";
      readonly assetPath?: string;
      readonly fit?: ImageFit;
      readonly align?: HorizontalAlign;
      readonly verticalAlign?: VerticalAlign;
    });

export interface ModuleStyle extends ExtensionFields {
  readonly radius?: number;
  readonly opacity?: number;
  readonly border?: BorderStyle;
  readonly background?: BackgroundStyle;
}

export interface ContentStyle extends ModuleStyle {
  readonly align?: HorizontalAlign;
  readonly verticalAlign?: VerticalAlign;
  readonly padding?: number;
}

export interface TextStyle extends ContentStyle {
  readonly fontSize?: number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly lineHeight?: number;
  readonly wrap?: boolean;
  readonly fontFamily?: string;
}
