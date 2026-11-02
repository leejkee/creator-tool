/** Engine-specific results and resource details never reach GUI components. */
import {
  renderDocument,
  encodePng,
  createTauriRenderResources,
} from "../render-engine";
import type { RendererPort, RenderOutcome, EditorIssue } from "./contracts";
import { documentCopy, indexModules } from "./protocol";

function within(
  x: number,
  y: number,
  box: { x: number; y: number; width: number; height: number },
  radius: number,
): boolean {
  if (
    x < box.x ||
    y < box.y ||
    x > box.x + box.width ||
    y > box.y + box.height
  ) {
    return false;
  }
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const cx = Math.max(box.x + r, Math.min(x, box.x + box.width - r));
  const cy = Math.max(box.y + r, Math.min(y, box.y + box.height - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}
export function createRenderer(): RendererPort {
  const resources = createTauriRenderResources();
  return {
    async render(payload, directory, signal): Promise<RenderOutcome> {
      const versions = new Map<string, string>();
      const result = await renderDocument(payload, {
        documentDirectory: directory,
        signal,
        resources: {
          async readAsset(path, base) {
            const asset = await resources.readAsset(path, base);
            versions.set(path, asset.version);
            return asset;
          },
          assetVersion: resources.assetVersion,
        },
      });
      const issues: EditorIssue[] = result.warnings.map((i) => ({
        severity: "warning",
        message: i.message,
        location: i.moduleId ?? i.path,
      }));
      if (!result.ok) {
        const raw = documentCopy(payload);
        const empty = result.errors.every(
          (i) =>
            i.code === "NO_RENDERABLE_CONTENT" ||
            (!raw.modules.length && i.path === "$.modules"),
        );
        issues.unshift(
          ...result.errors
            .filter(() => !empty)
            .map((i) => ({
              severity: "error" as const,
              message: i.message,
              location: i.moduleId ?? i.path,
            })),
        );
        return {
          empty,
          issues,
          versions,
          invalidModuleIds: result.errors
            .filter((i) =>
              [
                "INVALID_IMAGE_ARGUMENT",
                "CROP_OUT_OF_BOUNDS",
                "INVALID_PROCESSOR_DECLARATION",
                "PROCESSOR_FUNCTION_NOT_FOUND",
                "PROCESSOR_EXECUTION_FAILED",
                "INVALID_PROCESSOR_OUTPUT",
              ].includes(i.code),
            )
            .flatMap((i) => (i.moduleId ? [i.moduleId] : [])),
          async encode() {
            throw new Error("本次预览未成功，不能导出");
          },
          hit() {
            return undefined;
          },
          dispose() {},
        };
      }
      const image = result.image;
      const index = indexModules(documentCopy(payload));
      const layouts = new Map(image.layout.map((l) => [l.moduleId, l]));
      return {
        frame: {
          surface: image.canvas,
          width: image.width,
          height: image.height,
          boxes: image.layout.map((l) => ({ id: l.moduleId, ...l.box })),
        },
        issues,
        versions,
        invalidModuleIds: [],
        async encode() {
          const encoded = await encodePng(image);
          if (!encoded.ok) {
            throw new Error(encoded.errors.map((i) => i.message).join("；"));
          }
          return encoded.png.bytes;
        },
        hit(x, y) {
          for (const layout of [...image.layout].reverse()) {
            const entry = index.get(layout.moduleId);
            if (!entry) {
              continue;
            }
            const chain = [...entry.ancestors, layout.moduleId];
            if (
              chain.every((id) => {
                const ancestor = layouts.get(id);
                return ancestor && index.get(id)?.module.style !== undefined
                  ? (index.get(id)!.module.style as { opacity?: unknown })
                      .opacity !== 0 &&
                      within(x, y, ancestor.box, ancestor.radius)
                  : !!ancestor && within(x, y, ancestor.box, ancestor.radius);
              })
            ) {
              return layout.moduleId;
            }
          }
          return undefined;
        },
        dispose() {
          image.canvas.width = 0;
          image.canvas.height = 0;
        },
      };
    },
  };
}
