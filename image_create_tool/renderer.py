"""Snapshot-only Pillow measurement, arrangement, clipped painting and PNG encoding."""
from __future__ import annotations

import copy
import io
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

from .assets import resolve_asset
from .contracts import RenderRequest, RenderResult
from .model import ProjectError, find_element, fingerprint, normalize
from .preprocessing import process_image
from .styles import effective_style, DEFAULT_TITLE_STYLE
from .typography import font_path

LOGGER = logging.getLogger(__name__)
MAX_CANVAS_PIXELS = 100_000_000
MAX_CANVAS_HEIGHT = 40_000


@dataclass
class Box:
    node: dict
    x: float
    y: float
    width: float
    height: float
    available: float
    module_id: str
    children: list[Box] = field(default_factory=list)


class Renderer:
    def __init__(self, request: RenderRequest) -> None:
        self.request = request
        self.doc = normalize(request["documentSnapshot"])
        self.directory = Path(request.get("baseDir", request.get("project", ".")))
        self.assets = request.get("resources", [])
        self.extras = request.get("extraResources", [])
        self.scripts_dir = Path(request.get("scriptsDir", self.directory / "scripts"))
        self.issues = []
        self._issue_keys = set()
        self.fonts = {}
        self.loaded_images = {}
        self.boxes = []
        self.root = None

    def issue(self, code: str, message: str, node: dict, severity: str = "error") -> None:
        key = (code, node.get("id"), message)
        if key not in self._issue_keys:
            self._issue_keys.add(key)
            self.issues.append({"code": code, "message": message, "severity": severity,
                                "elementId": node.get("id")})

    def _read(self, path: Path, catalog: list[dict]) -> bytes:
        raw = path.read_bytes()
        expected = next((entry["hash"] for entry in catalog if entry["path"] == str(path)), None)
        if expected is not None and fingerprint(raw) != expected:
            raise ProjectError("RESOURCE_CHANGED", f"资源在渲染前被修改：{path}")
        return raw

    def font(self, style: dict) -> ImageFont.FreeTypeFont:
        size = style.get("fontSize", 28)
        if not 1 <= size <= 512:
            raise ProjectError("INVALID_FONT_SIZE", "字号需在 1–512 之间")
        path = font_path(self.directory, self.doc, style)
        key = (str(path), int(size))
        if key not in self.fonts:
            try:
                self.fonts[key] = ImageFont.truetype(io.BytesIO(self._read(path, self.extras)), int(size))
            except OSError as exc:
                raise ProjectError("FONT_LOAD_FAILED", f"无法加载字体：{path}") from exc
        return self.fonts[key]

    def lines(self, text: str, width: float, style: dict) -> list[str]:
        font = self.font(style)
        result = []
        for paragraph in text.split("\n"):
            current = ""
            for character in paragraph:
                if current and font.getlength(current + character) > width:
                    result.append(current)
                    current = ""
                current += character
            result.append(current)
        return result

    def _children(self, node: dict) -> list[dict]:
        children = list(node.get("elements", []))
        if node.get("title"):
            children.insert(0, {"id": node["id"] + ":title", "type": "text", "text": node["title"],
                                "style": {**DEFAULT_TITLE_STYLE, **node.get("titleStyle", {})}})
        return [child for child in children if child.get("visible", True)]

    def _layout(self, node: dict) -> tuple[str, int, int, float, float, float]:
        children = self._children(node)
        layout = node.get("layout", {"type": "column"})
        if isinstance(layout, list):
            return "grid", layout[0], layout[1], 0, 0, 0
        mode = layout.get("type", "column")
        rows = layout.get("rows", 1 if mode == "row" else max(1, len(children)))
        columns = layout.get("columns", max(1, len(children)) if mode == "row" else 1)
        gap = float(layout.get("gap", 0))
        return mode, rows, columns, float(layout.get("padding", 0)), float(layout.get("rowGap", gap)), float(layout.get("columnGap", gap))

    @staticmethod
    def _fixed(node: dict, axis: str) -> bool:
        return axis in node and node[axis] != "auto"

    def _image(self, reference: dict) -> Image.Image:
        key = fingerprint(reference)
        if key in self.loaded_images:
            return self.loaded_images[key]
        if reference.get("assetPath"):
            path = Path(reference["assetPath"])
            path = (path if path.is_absolute() else self.directory / path).resolve()
            raw = self._read(path, self.extras)
        else:
            asset = resolve_asset(reference, self.assets)
            raw = self._read(Path(asset["path"]), self.assets)
        with Image.open(io.BytesIO(raw)) as decoded:
            if decoded.width * decoded.height > MAX_CANVAS_PIXELS:
                raise ProjectError("IMAGE_TOO_LARGE", "素材图片过大")
            image = decoded.convert("RGBA")
        image = process_image(image, reference, self.scripts_dir, self.extras)
        crop = reference.get("crop")
        if crop:
            x, y = crop.get("x", 0), crop.get("y", 0)
            width, height = crop.get("width", image.width - x), crop.get("height", image.height - y)
            if any(type(value) is not int for value in (x, y, width, height)) or x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image.width or y + height > image.height:
                raise ProjectError("INVALID_CROP", "裁剪范围无效或越出预处理后的图片边界")
            image = image.crop((x, y, x + width, y + height))
        self.loaded_images[key] = image
        return image

    @staticmethod
    def _image_size(image: Image.Image, width: float, height: float, fit: str) -> tuple[float, float]:
        if fit == "stretch":
            return width, height
        if fit == "height":
            ratio = height / image.height
        elif fit == "width":
            ratio = width / image.width
        elif fit == "cover":
            ratio = max(width / image.width, height / image.height)
        elif fit == "contain":
            ratio = min(width / image.width, height / image.height)
        else:
            raise ProjectError("INVALID_FIT", f"未知图片适配方式：{fit}")
        return image.width * ratio, image.height * ratio

    def _image_width(self, node: dict, available: float, height: float) -> float:
        scale = float(node.get("contentScale", 1))
        if scale == 1 or self._fixed(node, "width"):
            return float(node["width"]) if self._fixed(node, "width") else available
        try:
            image = self._image(node)
            width, _ = self._image_size(image, available, height, node.get("fit", "contain"))
            return width * scale
        except (ProjectError, OSError, ValueError) as exc:
            self.issue(getattr(exc, "code", "IMAGE_READ_FAILED"), str(exc), node)
            return available * scale

    def _rows(self, node: dict, available: float) -> list[list[tuple[dict, float, float, float]]]:
        mode, row_count, columns, padding, _, column_gap = self._layout(node)
        inner = max(1, available - 2 * padding)
        rows = [[] for _ in range(row_count)]
        original_positions = {child["id"]: index for index, child in enumerate(node.get("elements", []))}
        for index, child in enumerate(self._children(node)):
            slot = original_positions.get(child["id"], index) if mode == "grid" else index
            row, column = child.get("position", [slot // columns, slot % columns]) if mode == "grid" else (slot // columns, slot % columns)
            if row >= row_count or column >= columns:
                raise ProjectError("INVALID_POSITION", "子模块位置超出布局范围", elementId=child["id"])
            rows[row].append((column, child))
        arranged = []
        for row in rows:
            fixed = sum(float(child["width"]) for _, child in row if self._fixed(child, "width"))
            fixed_count = sum(self._fixed(child, "width") for _, child in row)
            flexible_count = columns - fixed_count
            remaining = inner - column_gap * (columns - 1) - fixed
            if remaining < 0:
                self.issue("CONTENT_OVERFLOW", "固定列宽与间距超过容器宽度", node)
            unit = max(1, remaining / flexible_count) if flexible_count else 0
            shrinking = {}
            for column, child in row:
                if child.get("type") == "image" and not self._fixed(child, "width") and child.get("contentScale", 1) < 1:
                    child_width, child_height = self.measure(child, unit)
                    shrinking[column] = (child_width, child_height, unit)
            remaining -= sum(value[0] for value in shrinking.values())
            flexible_count -= len(shrinking)
            flexible_unit = max(1, remaining / flexible_count) if flexible_count else 0
            by_column = dict(row)
            cursor = padding
            entries = []
            for column in range(columns):
                child = by_column.get(column)
                if child is None:
                    width = flexible_unit
                elif column in shrinking:
                    width, height, base = shrinking[column]
                    entries.append((child, cursor, base, height))
                else:
                    base = float(child["width"]) if self._fixed(child, "width") else flexible_unit
                    width, height = self.measure(child, base)
                    entries.append((child, cursor, base, height))
                cursor += width + column_gap
            arranged.append(entries)
        return arranged

    def measure(self, node: dict, available: float) -> tuple[float, float]:
        width = float(node["width"]) if self._fixed(node, "width") else max(1, available)
        kind = node.get("type", "group")
        if kind == "text":
            style = effective_style(node)
            lines = self.lines(node.get("text", ""), width, style)
            height = len(lines) * float(style.get("lineHeight", math.ceil(style["fontSize"] * 1.55)))
        elif kind == "image":
            height = float(node["height"]) if self._fixed(node, "height") else min(width, 180)
            width = self._image_width(node, width, height)
        elif kind == "rect":
            height = 60
        elif kind == "group":
            mode, _, _, padding, row_gap, _ = self._layout(node)
            if mode == "fixed":
                height = 2 * padding
                for child in self._children(node):
                    _, child_height = self.measure(child, max(1, width - 2 * padding))
                    height = max(height, padding + float(child.get("y", 0)) + child_height + padding)
            else:
                rows = self._rows(node, width)
                height = 2 * padding + sum(max((entry[3] for entry in row), default=0) for row in rows) + row_gap * max(0, len(rows) - 1)
        else:
            raise ProjectError("UNKNOWN_ELEMENT", f"未知模块类型：{kind}")
        if self._fixed(node, "height"):
            height = float(node["height"])
        return width, max(1, height)

    def arrange(self, node: dict, x: float, y: float, available: float, module_id: str, row_height: float | None = None) -> Box:
        width, height = self.measure(node, available)
        if row_height is not None and not self._fixed(node, "height"):
            height = row_height
        box = Box(node, x + node.get("offsetX", 0), y + node.get("offsetY", 0), width, height, available, module_id)
        self.boxes.append(box)
        if node.get("type", "group") == "group":
            mode, _, _, padding, row_gap, _ = self._layout(node)
            if mode == "fixed":
                for child in self._children(node):
                    box.children.append(self.arrange(child, box.x + padding + child.get("x", 0), box.y + padding + child.get("y", 0), max(1, width - 2 * padding), module_id))
            else:
                rows = self._rows(node, width)
                natural = sum(max((entry[3] for entry in row), default=0) for row in rows) + row_gap * max(0, len(rows) - 1)
                cursor = padding + max(0, (height - 2 * padding - natural) / 2)
                for row in rows:
                    common_height = max((entry[3] for entry in row), default=0)
                    used = max((offset + self.measure(child, base)[0] for child, offset, base, _ in row), default=padding) - padding
                    spare = max(0, width - 2 * padding - used)
                    horizontal = {"left": 0, "center": spare / 2, "right": spare}.get(effective_style(node).get("align", "left"), 0)
                    for child, offset, base, child_height in row:
                        cy = box.y + cursor + (common_height - child_height) / 2 if self._fixed(child, "height") else box.y + cursor
                        box.children.append(self.arrange(child, box.x + offset + horizontal, cy, base, module_id, common_height))
                    cursor += common_height + row_gap
                if natural + 2 * padding > height + 0.01:
                    self.issue("CONTENT_OVERFLOW", "子模块所需高度超过固定容器", node)
            for child in box.children:
                if child.x < box.x or child.y < box.y or child.x + child.width > box.x + width + 0.01 or child.y + child.height > box.y + height + 0.01:
                    self.issue("CONTENT_OVERFLOW", "子模块越出所属容器", child.node)
        return box

    def layout(self) -> dict:
        if self.root is None:
            composition = self.doc.get("composition", {})
            modules = {module["id"]: module for module in self.doc["modules"]}
            ordered = [modules[identity] for identity in composition.get("moduleOrder", list(modules))]
            selected = self.request.get("elementId")
            if selected:
                node = copy.deepcopy(find_element(self.doc, selected))
                node.pop("offsetX", None)
                node.pop("offsetY", None)
                ordered = [node]
                composition = {"width": node.get("width", composition.get("width", 1200)), "height": "auto", "padding": 0, "gap": 0}
                if composition["width"] == "auto":
                    composition["width"] = self.doc.get("composition", {}).get("width", 1200)
            root_node = {"id": "__canvas__", "type": "group", "width": composition.get("width", 1200),
                         "layout": {"type": "column", "padding": composition.get("padding", 32), "gap": composition.get("gap", 24)},
                         "elements": ordered, "style": {}}
            if "background" in composition:
                root_node["style"]["background"] = composition["background"]
            if composition.get("height", "auto") != "auto":
                root_node["height"] = composition["height"]
            # Reject oversized allocations before constructing any full-size layers.
            width, height = self.measure(root_node, root_node["width"])
            if height > MAX_CANVAS_HEIGHT or width * height > MAX_CANVAS_PIXELS:
                raise ProjectError("CANVAS_TOO_LARGE", "画布过大")
            self.root = self.arrange(root_node, 0, 0, width, "")
            for child in self.root.children:
                def tag(box):
                    box.module_id = child.node["id"]
                    for descendant in box.children:
                        tag(descendant)
                tag(child)
        return {"width": math.ceil(self.root.width), "height": math.ceil(self.root.height),
                "modules": [{"id": box.node["id"], "x": box.x, "y": box.y, "width": box.width, "height": box.height} for box in self.root.children],
                "elements": [{"elementId": box.node["id"], "moduleId": box.module_id, "type": box.node.get("type", "group"),
                              "x": box.x, "y": box.y, "width": box.width, "height": box.height,
                              "zIndex": box.node.get("zIndex", 0), "visible": True, "locked": box.node.get("locked", False)}
                             for box in self.boxes if box is not self.root]}

    def _fit(self, image: Image.Image, width: int, height: int, mode: str, scale: float = 1) -> Image.Image:
        content_width, content_height = self._image_size(image, width, height, mode)
        target = (max(1, round(content_width * scale)), max(1, round(content_height * scale)))
        if target[0] * target[1] > MAX_CANVAS_PIXELS:
            raise ProjectError("IMAGE_TOO_LARGE", "缩放后的图片过大")
        resized = image.resize(target, Image.Resampling.LANCZOS)
        layer = Image.new("RGBA", (width, height))
        layer.alpha_composite(resized, ((width - target[0]) // 2, (height - target[1]) // 2))
        return layer

    @staticmethod
    def _opacity(image: Image.Image, opacity: float) -> Image.Image:
        if opacity != 1:
            image = image.copy()
            image.putalpha(image.getchannel("A").point(lambda alpha: round(alpha * opacity)))
        return image

    def _background(self, background, size: tuple[int, int], backdrop: Image.Image) -> Image.Image:
        if isinstance(background, str):
            return Image.new("RGBA", size, background)
        if not isinstance(background, dict):
            return Image.new("RGBA", size)
        mode = background.get("type", "solid")
        if mode == "solid":
            image = Image.new("RGBA", size, background.get("color", "#00000000"))
        elif mode in {"image", "blur"}:
            if background.get("assetId") or background.get("assetQuery") or background.get("assetPath"):
                image = self._fit(self._image(background), *size, background.get("fit", "cover"))
            elif mode == "blur":
                image = backdrop.copy()
            else:
                raise ProjectError("ASSET_NOT_FOUND", "图片背景未指定素材")
            if mode == "blur":
                image = image.filter(ImageFilter.GaussianBlur(background.get("blurRadius", 12)))
            if background.get("color"):
                image.alpha_composite(Image.new("RGBA", size, background["color"]))
        else:
            raise ProjectError("INVALID_BACKGROUND", f"未知背景类型：{mode}")
        return self._opacity(image, float(background.get("opacity", 1)))

    def _paint(self, box: Box, backdrop: Image.Image | None = None) -> Image.Image:
        width, height = max(1, math.ceil(box.width)), max(1, math.ceil(box.height))
        if width * height > MAX_CANVAS_PIXELS or height > MAX_CANVAS_HEIGHT:
            raise ProjectError("CANVAS_TOO_LARGE", "模块绘制区域过大")
        size = (width, height)
        node = box.node
        style = effective_style(node)
        canvas = Image.new("RGBA", size)
        backdrop = backdrop if backdrop is not None else Image.new("RGBA", size)
        try:
            canvas.alpha_composite(self._background(style.get("background"), size, backdrop))
            kind = node.get("type", "group")
            if kind == "rect":
                canvas.alpha_composite(Image.new("RGBA", size, style.get("color", "#232D43")))
            elif kind == "text":
                font = self.font(style)
                lines = self.lines(node.get("text", ""), width, style)
                line_height = float(style.get("lineHeight", math.ceil(style["fontSize"] * 1.55)))
                natural = len(lines) * line_height
                y = (height - natural) / 2
                draw = ImageDraw.Draw(canvas)
                for index, line in enumerate(lines):
                    text_width = font.getlength(line)
                    x = {"left": 0, "center": (width - text_width) / 2, "right": width - text_width}[style["align"]]
                    draw.text((x, y + index * line_height), line, font=font, fill=style["color"], anchor="lt")
                if natural > height or any(font.getlength(line) > width for line in lines):
                    self.issue("TEXT_CLIPPED", "文字按模块边界裁剪，请按需要调整字号或模块尺寸", node, "warning")
            elif kind == "image":
                image = self._image(node)
                scale = float(node.get("contentScale", 1))
                # Auto width already follows displayed content; retain the pre-scale fitting region.
                base_width = width if self._fixed(node, "width") or scale == 1 else max(1, round(box.available))
                base_height = float(node["height"]) if self._fixed(node, "height") else min(box.available, 180)
                fitted = self._fit(image, base_width, max(1, round(base_height)), node.get("fit", "contain"), scale)
                cropped = Image.new("RGBA", size)
                cropped.alpha_composite(fitted, ((width - base_width) // 2, (height - fitted.height) // 2))
                fitted = cropped
                canvas.alpha_composite(fitted)
            else:
                for child in sorted(box.children, key=lambda current: current.node.get("zIndex", 0)):
                    x, y = round(child.x - box.x), round(child.y - box.y)
                    behind = backdrop.copy()
                    behind.alpha_composite(canvas)
                    region = behind.crop((x, y, x + max(1, math.ceil(child.width)), y + max(1, math.ceil(child.height))))
                    canvas.alpha_composite(self._paint(child, region), (x, y))
            radius = round(style.get("radius", 0))
            if radius:
                mask = Image.new("L", size)
                ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius, fill=255)
                canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), mask))
            border = style.get("border", {})
            border_width = round(border.get("width", 0))
            if border.get("visible", border_width > 0) and border_width > 0:
                ImageDraw.Draw(canvas).rounded_rectangle((0, 0, width - 1, height - 1), radius,
                                                         outline=border.get("color", "#FFFFFF"), width=border_width)
            return self._opacity(canvas, float(style.get("opacity", 1)))
        except (ProjectError, OSError, ValueError, TypeError) as exc:
            self.issue(getattr(exc, "code", "DRAW_FAILED"), str(exc), node)
            ImageDraw.Draw(canvas).rectangle((0, 0, width - 1, height - 1), outline="#FF5060", width=2)
            return canvas

    def render(self) -> RenderResult:
        layout = self.layout()
        canvas = self._paint(self.root)
        stream = io.BytesIO()
        canvas.save(stream, format="PNG")
        return {"ok": True, "exportable": not any(issue["severity"] == "error" for issue in self.issues),
                "pngBytes": stream.getvalue(), "layout": layout, "imageWidth": canvas.width,
                "imageHeight": canvas.height, "issues": self.issues}


def render_document(request: RenderRequest) -> RenderResult:
    identity = {key: request.get(key) for key in ("jobId", "renderId", "documentId", "revision", "target", "candidateId", "contentFingerprint", "resourceFingerprint")}
    try:
        return {**identity, **Renderer(request).render()}
    except Exception as exc:
        LOGGER.exception("Render failed: %s", request.get("renderId"))
        issue = exc.as_dict() if isinstance(exc, ProjectError) else {"code": "RENDER_FAILED", "message": str(exc)}
        return {**identity, "ok": False, "exportable": False, "pngBytes": b"", "layout": {},
                "issues": [{**issue, "severity": "error"}]}
