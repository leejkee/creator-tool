"""Pillow layout and rendering library. Only this module draws guide content."""
from __future__ import annotations

import copy
import io
import math
import os
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps

from .assets import resolve_asset
from .model import ProjectError, fingerprint, validate_document


def font_path(project: Path, document: dict, bold=False):
    config = document.get("fonts", {})
    explicit = config.get("bold" if bold else "regular") or config.get("regular")
    if explicit:
        path = Path(explicit)
        path = path if path.is_absolute() else project / path
        if not path.is_file():
            raise ProjectError("FONT_NOT_FOUND", f"字体文件不存在：{path}")
        return str(path)
    candidates = (["C:/Windows/Fonts/msyhbd.ttc"] if bold else []) + [
        "C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for value in candidates:
        if Path(value).is_file():
            return value
    raise ProjectError("FONT_NOT_FOUND", "请在 pjt.json 的 fonts.regular 中指定中文字体")


class Renderer:
    def __init__(self, request):
        self.request = request
        self.doc = copy.deepcopy(request["documentSnapshot"])
        self.project = Path(request["project"])
        self.assets = request.get("resources", [])
        self.issues = []
        self.nodes = []
        self.fonts = {}
        self.loaded_images = {}

    def issue(self, code, message, element=None, module=None):
        self.issues.append({"code": code, "message": message, "severity": "error",
                            "elementId": element, "moduleId": module})

    def font(self, style):
        size = int(style.get("fontSize", 28))
        if not 1 <= size <= 512:
            raise ProjectError("INVALID_FONT_SIZE", "字号需在 1–512 之间")
        bold = bool(style.get("bold", False))
        key = (size, bold)
        if key not in self.fonts:
            self.fonts[key] = ImageFont.truetype(font_path(self.project, self.doc, bold), size)
        return self.fonts[key]

    def lines(self, text, width, style):
        font = self.font(style)
        width = max(1, width)
        lines = []
        for paragraph in text.split("\n"):
            current = ""
            for ch in paragraph:
                if current and font.getlength(current + ch) > width:
                    lines.append(current)
                    current = ""
                if font.getlength(ch) > width:
                    self.issue("TEXT_OVERFLOW", "文字框宽度不足以容纳单个字符")
                current += ch
            lines.append(current)
        return lines

    def record(self, node, x, y, w, h, module, **extra):
        entry = {"elementId": node["id"], "moduleId": module, "type": node.get("type", "group"),
                 "x": x, "y": y, "width": w, "height": h, "zIndex": node.get("zIndex", 0),
                 "visible": node.get("visible", True), "locked": node.get("locked", False),
                 "style": copy.deepcopy(node.get("style", {})), **extra}
        self.nodes.append(entry)
        return entry

    def element(self, node, x, y, available, module):
        if not node.get("visible", True):
            return 0
        x += float(node.get("offsetX", 0))
        y += float(node.get("offsetY", 0))
        w = float(node.get("width", available))
        if w <= 0:
            raise ProjectError("INVALID_LAYOUT", "元素宽度必须大于零")
        kind = node["type"]
        style = node.get("style", {})
        if kind == "text":
            lines = self.lines(node.get("text", ""), w, style)
            line_height = float(style.get("lineHeight", math.ceil(style.get("fontSize", 28) * 1.55)))
            natural = line_height * len(lines)
            h = float(node.get("height", natural))
            if h < natural:
                self.issue("TEXT_OVERFLOW", "固定文字高度不足，不能截断导出", node["id"], module)
            self.record(node, x, y, w, h, module, text=node.get("text", ""), lines=lines, lineHeight=line_height)
        elif kind == "image":
            h = float(node.get("height", min(w, 180)))
            self.record(node, x, y, w, h, module, image=copy.deepcopy(node))
        elif kind == "rect":
            h = float(node.get("height", 60))
            self.record(node, x, y, w, h, module)
        elif kind == "itemRow":
            pad = float(style.get("padding", 14))
            gap = float(style.get("gap", 20))
            image = copy.deepcopy(node.get("image", {}))
            image.update({"id": node["id"] + ":image", "type": "image"})
            iw = float(image.get("width", style.get("imageWidth", 110)))
            ih = float(image.get("height", style.get("imageHeight", iw)))
            image.update(width=iw, height=ih)
            text = {"id": node["id"] + ":text", "type": "text", "text": node.get("text", ""), "style": style}
            overrides = copy.deepcopy(node.get("textOverrides", {}))
            text.update({k: v for k, v in overrides.items() if k != "style"})
            text["style"] = {**style, **overrides.get("style", {})}
            # Put background before children, retaining child IDs for editing.
            background = self.record(node, x, y, w, 0, module)
            th = self.element(text, x + pad + iw + gap, y + pad, max(1, w - 2 * pad - iw - gap), module)
            self.element(image, x + pad, y + pad, iw, module)
            h = max(ih, th) + 2 * pad
            background["height"] = h
        elif kind == "group":
            layout = node.get("layout", {})
            pad = float(layout.get("padding", 0))
            gap = float(layout.get("gap", 16))
            background = self.record(node, x, y, w, 0, module)
            children = node.get("elements", [])
            mode = layout.get("type", "column")
            if mode == "row":
                widths = [float(c.get("width", max(1, (w - 2 * pad - gap * (len(children) - 1)) / max(1, len(children))))) for c in children]
                cursor, heights = x + pad, []
                for child, cw in zip(children, widths):
                    heights.append(self.element(child, cursor, y + pad, cw, module))
                    cursor += cw + gap
                h = max(heights, default=0) + 2 * pad
            else:
                cursor, bottom = y + pad, y + pad
                for child in children:
                    cx = x + pad + (float(child.get("x", 0)) if mode == "fixed" else 0)
                    cy = y + pad + float(child.get("y", 0)) if mode == "fixed" else cursor
                    ch = self.element(child, cx, cy, w - 2 * pad, module)
                    bottom = max(bottom, cy + ch + max(0, float(child.get("offsetY", 0))))
                    cursor = bottom + gap
                h = bottom - y + pad
            if "height" in node:
                if float(node["height"]) < h:
                    self.issue("CONTENT_OVERFLOW", "组合容器高度不足", node["id"], module)
                h = float(node["height"])
            background["height"] = h
        else:
            raise ProjectError("UNKNOWN_ELEMENT", f"不支持元素：{kind}")
        return h

    def layout(self):
        comp = self.doc.get("composition", {})
        width = int(comp.get("width", 1200))
        pad, gap = float(comp.get("padding", 32)), float(comp.get("gap", 24))
        y = pad
        module_bounds = []
        modules = {m["id"]: m for m in self.doc.get("modules", [])}
        for mid in comp.get("moduleOrder", list(modules)):
            module = copy.deepcopy(modules[mid])
            children = module.get("elements", [])
            if module.get("title"):
                children = [{"id": mid + ":title", "type": "text", "text": module["title"],
                             "style": {"fontSize": 36, "bold": True, "color": "#C2A0FF", **module.get("titleStyle", {})}}] + children
            module.update(type="group", elements=children)
            module.setdefault("layout", {"type": "column", "padding": 24, "gap": 16})
            module.setdefault("style", {"background": "#1A2132", "radius": 18})
            h = self.element(module, pad, y, width - 2 * pad, mid)
            module_bounds.append({"id": mid, "x": pad, "y": y, "width": width - 2 * pad, "height": h})
            y += h + gap
        natural_height = math.ceil(y - gap + pad) if modules else max(200, int(2 * pad))
        height = comp.get("height", "auto")
        height = natural_height if height == "auto" else int(height)
        if height < natural_height:
            self.issue("CONTENT_OVERFLOW", f"内容需要 {natural_height} 像素，画布只有 {height}")
        if height > 40000 or width * height > 100_000_000:
            raise ProjectError("CANVAS_TOO_LARGE", "画布过大，请减少内容或调整尺寸")
        for n in self.nodes:
            if n["x"] < 0 or n["y"] < 0 or n["x"] + n["width"] > width or n["y"] + n["height"] > height:
                self.issue("CONTENT_OVERFLOW", "元素越出画布边界", n["elementId"], n["moduleId"])
        return {"width": width, "height": height, "modules": module_bounds, "elements": self.nodes}

    def image_tile(self, node, w, h):
        ref = node["image"]
        try:
            asset = resolve_asset(ref, self.assets)
            path = Path(asset["path"])
            key = asset["assetId"]
            if key not in self.loaded_images:
                raw = path.read_bytes()
                if fingerprint(raw) != asset["hash"]:
                    raise ProjectError("RESOURCE_CHANGED", "素材在渲染前被修改")
                self.loaded_images[key] = Image.open(io.BytesIO(raw)).convert("RGBA")
            image = self.loaded_images[key].copy()
            crop = ref.get("crop")
            if crop:
                x, y = int(crop.get("x", 0)), int(crop.get("y", 0))
                cw, ch = int(crop.get("width", image.width - x)), int(crop.get("height", image.height - y))
                if x < 0 or y < 0 or cw <= 0 or ch <= 0 or x + cw > image.width or y + ch > image.height:
                    raise ProjectError("INVALID_CROP", "裁剪范围越出原图边界")
                image = image.crop((x, y, x + cw, y + ch))
            fit = ref.get("fit", "contain")
            if fit == "cover":
                image = ImageOps.fit(image, (w, h), Image.Resampling.LANCZOS)
            elif fit == "stretch":
                image = image.resize((w, h), Image.Resampling.LANCZOS)
            elif fit == "contain":
                fitted = ImageOps.contain(image, (w, h), Image.Resampling.LANCZOS)
                image = Image.new("RGBA", (w, h))
                image.alpha_composite(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
            else:
                raise ProjectError("INVALID_FIT", "fit 必须为 contain/cover/stretch")
            radius = int(ref.get("style", {}).get("radius", 12))
            if radius:
                mask = Image.new("L", (w, h))
                ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius, fill=255)
                from PIL import ImageChops
                image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
            return image
        except (ProjectError, OSError, ValueError) as exc:
            code = exc.code if isinstance(exc, ProjectError) else "IMAGE_READ_FAILED"
            self.issue(code, str(exc), node["elementId"], node["moduleId"])
            tile = Image.new("RGBA", (w, h), "#63353E")
            d = ImageDraw.Draw(tile)
            d.line((0, 0, w, h), fill="#FFC0CB", width=3)
            d.line((w, 0, 0, h), fill="#FFC0CB", width=3)
            return tile

    def render(self):
        validate_document(self.doc)
        layout = self.layout()
        canvas = Image.new("RGBA", (layout["width"], layout["height"]), self.doc.get("composition", {}).get("background", "#101521"))
        draw = ImageDraw.Draw(canvas)
        # Stable z ordering: group backgrounds precede their descendants at equal z.
        for n in sorted(self.nodes, key=lambda n: n["zIndex"]):
            x, y = int(n["x"]), int(n["y"])
            w, h = max(1, int(n["width"])), max(1, int(n["height"]))
            style, kind = n["style"], n["type"]
            background = style.get("background", "#232D43" if kind == "itemRow" else None)
            if kind == "rect":
                background = style.get("color", background or "#232D43")
            if background:
                draw.rounded_rectangle((x, y, x + w - 1, y + h - 1), int(style.get("radius", 12)), fill=background)
            if kind == "text":
                font = self.font(style)
                color = style.get("color", "#F2F0FA")
                for i, line in enumerate(n["lines"]):
                    tx = x
                    if style.get("align") == "center":
                        tx += (w - font.getlength(line)) / 2
                    elif style.get("align") == "right":
                        tx += w - font.getlength(line)
                    draw.text((tx, y + i * n["lineHeight"]), line, font=font, fill=color, anchor="lt")
            elif kind == "image":
                canvas.alpha_composite(self.image_tile(n, w, h), (x, y))
        output = io.BytesIO()
        canvas.save(output, format="PNG")
        # Remove internal style/image payloads from layout before publishing.
        for n in layout["elements"]:
            n.pop("image", None)
            n.pop("style", None)
        return {"pngBytes": output.getvalue(), "layout": layout, "imageWidth": canvas.width,
                "imageHeight": canvas.height, "issues": self.issues, "ok": True,
                "exportable": not any(i["severity"] == "error" for i in self.issues)}


def render_document(request):
    identity = {k: request.get(k) for k in ("jobId", "renderId", "documentId", "revision", "target", "candidateId", "contentFingerprint", "resourceFingerprint")}
    try:
        return {**identity, **Renderer(request).render()}
    except Exception as exc:
        issue = exc.as_dict() if isinstance(exc, ProjectError) else {"code": "RENDER_FAILED", "message": str(exc)}
        return {**identity, "ok": False, "exportable": False, "pngBytes": b"", "layout": {},
                "issues": [{**issue, "severity": "error"}]}

