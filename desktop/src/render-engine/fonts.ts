import type { RenderTextModule } from "../render-input";
import { EngineFailure, failure, located, messageOf, waitFor } from "./control";
import type { Control } from "./control";
import type { EngineIssue } from "./types";

let nextFontId = 0;

interface ResolvedFont {
  readonly family: string;
  readonly unavailable?: string;
}

export class FontScope {
  private readonly families = new Map<string, ResolvedFont>();
  private readonly faces: FontFace[] = [];

  constructor(
    private readonly control: Control,
    private readonly warnings: EngineIssue[],
  ) {}

  async font(module: RenderTextModule): Promise<string> {
    const requested = module.style.fontFamily;
    let resolved = this.families.get(requested);
    const location = {
      moduleId: module.id,
      path: `${module.path}.style.fontFamily`,
    };
    if (!resolved) {
      resolved = { family: "sans-serif" };
      if (requested !== "sans-serif") {
        if (typeof FontFace === "undefined" || !document.fonts) {
          throw failure(
            "CANVAS_UNAVAILABLE",
            "当前环境不支持本地字体加载",
            location,
          );
        }
        try {
          // Private aliases avoid CSS fonts from the future GUI changing Engine output.
          const alias = `CreatorEngineFont_${nextFontId++}`;
          const face = new FontFace(
            alias,
            `local(${JSON.stringify(requested)})`,
          );
          await waitFor(() => face.load(), this.control);
          document.fonts.add(face);
          this.faces.push(face);
          resolved = { family: `${JSON.stringify(alias)}, sans-serif` };
        } catch (error) {
          if (error instanceof EngineFailure) {
            throw located(error, location);
          }
          resolved = { family: "sans-serif", unavailable: messageOf(error) };
        }
      }
      this.families.set(requested, resolved);
    }
    if (resolved.unavailable !== undefined) {
      this.warnings.push({
        code: "FONT_UNAVAILABLE",
        ...location,
        message: `字体 ${requested} 不可用，已回退系统默认字体，请重新选择：${resolved.unavailable}`,
      });
    }
    const font = `${module.style.bold ? "700" : "400"} ${module.style.fontSize}px ${resolved.family}`;
    if (document.fonts) {
      try {
        await waitFor(
          () => document.fonts.load(font, module.text),
          this.control,
        );
      } catch (error) {
        throw located(error, location);
      }
    }
    return font;
  }

  dispose(): void {
    for (const face of this.faces) {
      document.fonts.delete(face);
    }
    this.faces.length = 0;
    this.families.clear();
  }
}
