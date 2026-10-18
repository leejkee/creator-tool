"""Plain data contracts; neither Qt nor Pillow is imported here."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from pathlib import Path
from typing import Any

MARKER = "image-create-tool-version"
VERSION = "v0.1.0"
SUPPORTED_VERSIONS = frozenset({"v0.0.1", VERSION})
TYPES = frozenset({"text", "image", "rect", "group", "itemRow"})
MAX_DOCUMENT_NODES = 10000
MAX_LAYOUT_CELLS = 10000
STYLE_FIELDS = frozenset({
    "fontSize", "font", "bold", "color", "align", "lineHeight", "background",
    "radius", "border", "opacity",
})


class ProjectError(Exception):
    def __init__(self, code: str, message: str, **details) -> None:
        super().__init__(message)
        self.code, self.details = code, details

    def as_dict(self) -> dict:
        return {"code": self.code, "message": str(self), **self.details}


def fingerprint(value: Any) -> str:
    data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(data).hexdigest()


def encode_document(document: dict) -> bytes:
    return (json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def empty_document() -> dict:
    return {MARKER: VERSION, "assetsDir": "assets/",
            "documentId": uuid.uuid4().hex, "revision": 0, "title": "新攻略",
            "sourceNotes": "", "modules": [],
            "composition": {"width": 1200, "height": "auto",
                            "padding": 32, "gap": 24}}


def normalize(document: dict) -> dict:
    validate_document(document)
    result = copy.deepcopy(document)
    defaults = empty_document()
    for key, value in defaults.items():
        result.setdefault(key, value)
    def expand(node):
        if node.get("type") == "itemRow":
            style = copy.deepcopy(node.get("style", {}))
            image = copy.deepcopy(node.get("image", {}))
            image.update(id=node["id"] + ":image", type="image")
            image.setdefault("width", style.get("imageWidth", 110))
            image.setdefault("height", style.get("imageHeight", image["width"]))
            overrides = copy.deepcopy(node.get("textOverrides", {}))
            text = {"id": node["id"] + ":text", "type": "text", "text": node.get("text", ""),
                    **{key: value for key, value in overrides.items() if key != "style"},
                    "style": {**{key: value for key, value in style.items()
                                 if key not in {"background", "radius", "padding", "gap", "imageWidth", "imageHeight"}},
                              **overrides.get("style", {})}}
            node.update(type="group", elements=[image, text],
                        layout={"type": "row", "padding": style.get("padding", 14), "gap": style.get("gap", 20)},
                        style={"background": style.get("background", "#232D43"), "radius": style.get("radius", 12)})
            for key in ("image", "textOverrides", "text"):
                node.pop(key, None)
        for child in node.get("elements", []):
            expand(child)
        if node.get("type", "group") == "group":
            node.setdefault("type", "group")
            if node.get("title"):
                from .styles import DEFAULT_TITLE_STYLE
                identity = node["id"] + ":title"
                if not any(child["id"] == identity for child in node.get("elements", [])):
                    node.setdefault("elements", []).insert(0, {"id": identity, "type": "text", "text": node["title"],
                                                               "style": {**DEFAULT_TITLE_STYLE, **node.get("titleStyle", {})}})
                node.setdefault("name", node.pop("title"))
                node.pop("titleStyle", None)
            layout = node.get("layout", {})
            columns = layout[1] if isinstance(layout, list) else layout.get("columns") if layout.get("type") == "grid" else None
            if columns is not None:
                for index, child in enumerate(node.get("elements", [])):
                    child.setdefault("position", [index // columns, index % columns])
    for module in result["modules"]:
        if result[MARKER] == "v0.0.1":
            module.setdefault("layout", {"type": "column", "padding": 24, "gap": 16})
            module.setdefault("style", {"background": "#1A2132", "radius": 18})
        expand(module)
    result[MARKER] = VERSION
    validate_document(result)
    return result


def resolve_directory(project: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return (project / path).resolve() if not path.is_absolute() else path.resolve()


def validate_document(doc: Any) -> None:
    if not isinstance(doc, dict) or not isinstance(doc.get(MARKER), str) or not doc[MARKER]:
        raise ProjectError("INVALID_PROJECT", "图片 JSON 缺少 image-create-tool-version 标记")
    if doc[MARKER] not in SUPPORTED_VERSIONS:
        raise ProjectError("UNSUPPORTED_VERSION", f"不支持的图片 JSON 版本：{doc[MARKER]}")
    if "fonts" in doc and (not isinstance(doc["fonts"], dict) or any(not isinstance(value, str) or not value for value in doc["fonts"].values())):
        raise ProjectError("INVALID_FONT", "fonts 必须是字体名到非空文件路径的对象")
    for key in ("title", "documentId"):
        if key in doc and (not isinstance(doc[key], str) or (key == "documentId" and not doc[key])):
            raise ProjectError("INVALID_DOCUMENT", f"{key} 字段无效")
    for key in ("assetsDir", "outputsDir"):
        if key in doc and (not isinstance(doc[key], str) or not doc[key].strip()):
            raise ProjectError("INVALID_CONFIG", f"{key} 必须是非空路径")
    if not isinstance(doc.get("modules", []), list):
        raise ProjectError("INVALID_DOCUMENT", "modules 必须是列表")
    if "revision" in doc and (not isinstance(doc["revision"], int) or isinstance(doc["revision"], bool) or doc["revision"] < 0):
        raise ProjectError("INVALID_REVISION", "revision 必须为非负整数")
    ids = set()
    numeric = {"x", "y", "width", "height", "padding", "gap", "rowGap", "columnGap", "offsetX", "offsetY", "fontSize", "lineHeight", "radius", "blurRadius", "zIndex", "opacity", "contentScale"}

    def check_values(obj, context=""):
        for key, value in obj.items():
            if key in numeric and not (key in {"width", "height"} and value == "auto"):
                if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                    raise ProjectError("INVALID_NUMBER", f"{key} 必须是有限数值")
                if key in {"width", "height", "fontSize", "lineHeight", "contentScale"} and value <= 0 and not (context == "border" and key == "width" and value == 0):
                    raise ProjectError("INVALID_NUMBER", f"{key} 必须大于 0")
                if key in {"padding", "gap", "rowGap", "columnGap", "radius", "blurRadius"} and value < 0:
                    raise ProjectError("INVALID_NUMBER", f"{key} 不能为负")
                if key == "opacity" and not 0 <= value <= 1:
                    raise ProjectError("INVALID_OPACITY", "opacity 必须在 0–1 之间")
            if isinstance(value, dict):
                if key not in {"params", "assetQuery", "assetAliases"}:
                    check_values(value, key)

    def node(obj, module=False):
        if not isinstance(obj, dict) or not isinstance(obj.get("id"), str) or not obj["id"]:
            raise ProjectError("INVALID_ID", "模块和元素需要非空 id")
        if obj["id"] in ids:
            raise ProjectError("DUPLICATE_ID", f"重复 id：{obj['id']}")
        ids.add(obj["id"])
        if len(ids) > MAX_DOCUMENT_NODES:
            raise ProjectError("DOCUMENT_TOO_LARGE", "模块数量超过 10000")
        for key in ("visible", "locked"):
            if key in obj and not isinstance(obj[key], bool):
                raise ProjectError("INVALID_DOCUMENT", f"{key} 必须是布尔值")
        if (not isinstance(obj.get("type"), str) or obj["type"] not in TYPES) and not (module and "type" not in obj):
            raise ProjectError("UNKNOWN_ELEMENT", f"不支持元素类型：{obj.get('type')}")
        for key in ("text", "title", "name"):
            if key in obj and not isinstance(obj[key], str):
                raise ProjectError("INVALID_TEXT", f"{key} 必须为字符串")
        for key in ("assetPath", "assetId"):
            if key in obj and not isinstance(obj[key], str):
                raise ProjectError("INVALID_ASSET", f"{key} 必须为字符串")
        if "assetQuery" in obj and not isinstance(obj["assetQuery"], (dict, str)):
            raise ProjectError("INVALID_ASSET", "assetQuery 必须是名称或查询对象")
        if "style" in obj and not isinstance(obj["style"], (dict, str)):
            raise ProjectError("INVALID_STYLE", "style 必须是对象或样式名称")
        if isinstance(obj.get("style"), dict):
            style = obj["style"]
            allowed = set(STYLE_FIELDS)
            if obj.get("type") == "itemRow":
                allowed |= {"padding", "gap", "imageWidth", "imageHeight"}
            if set(style) - allowed:
                raise ProjectError("UNSUPPORTED_STYLE", "不支持的样式属性", fields=sorted(set(style) - allowed), elementId=obj["id"])
            if "align" in style and (not isinstance(style["align"], str) or style["align"] not in {"left", "center", "right"}):
                raise ProjectError("INVALID_STYLE", "align 必须为 left/center/right")
            if "bold" in style and not isinstance(style["bold"], bool):
                raise ProjectError("INVALID_STYLE", "bold 必须为布尔值")
            for key in ("color",):
                if key in style and not isinstance(style[key], str):
                    raise ProjectError("INVALID_STYLE", f"{key} 必须是颜色字符串")
            if "border" in style and not isinstance(style["border"], dict):
                raise ProjectError("INVALID_STYLE", "border 必须是对象")
            if "font" in style and (not isinstance(style["font"], str) or not style["font"]):
                raise ProjectError("INVALID_FONT", "font 必须是非空字体文件路径")
            border = style.get("border", {})
            if "visible" in border and not isinstance(border["visible"], bool):
                raise ProjectError("INVALID_STYLE", "border.visible 必须是布尔值")
            background = style.get("background")
            if background is not None and not isinstance(background, (str, dict)):
                raise ProjectError("INVALID_STYLE", "background 必须是颜色或对象")
            if isinstance(background, dict) and (not isinstance(background.get("type", "solid"), str) or background.get("type", "solid") not in {"solid", "image", "blur"}):
                raise ProjectError("INVALID_STYLE", "background.type 必须为 solid/image/blur")
        if "fit" in obj and (not isinstance(obj["fit"], str) or obj["fit"] not in {"contain", "cover", "stretch", "height", "width"}):
            raise ProjectError("INVALID_FIT", "fit 必须为 contain/cover/stretch/height/width")
        layout = obj.get("layout", {"type": "column"})
        if isinstance(layout, list):
            if len(layout) != 2 or any(type(value) is not int or value <= 0 for value in layout):
                raise ProjectError("INVALID_LAYOUT", "layout 数组必须为正整数 [行数, 列数]")
            rows, columns = layout
        elif isinstance(layout, dict):
            mode = layout.get("type", "column")
            if not isinstance(mode, str) or mode not in {"column", "row", "grid", "fixed"}:
                raise ProjectError("INVALID_LAYOUT", "未知布局类型")
            rows, columns = layout.get("rows"), layout.get("columns")
            if mode == "grid" and any(type(value) is not int or value <= 0 for value in (rows, columns)):
                raise ProjectError("INVALID_LAYOUT", "grid 需要正整数 rows/columns")
            if mode != "grid":
                rows = columns = None
        else:
            raise ProjectError("INVALID_LAYOUT", "layout 必须为对象或 [行数, 列数]")
        if rows is not None and rows * columns > MAX_LAYOUT_CELLS:
            raise ProjectError("INVALID_LAYOUT", "网格最多允许 10000 个位置")
        if "position" in obj:
            position = obj["position"]
            if not isinstance(position, list) or len(position) != 2 or any(type(value) is not int or value < 0 for value in position):
                raise ProjectError("INVALID_POSITION", "position 必须为非负整数 [行, 列]")
        check_values(obj)
        children = obj.get("elements", [])
        if not isinstance(children, list):
            raise ProjectError("INVALID_DOCUMENT", "elements 必须是列表")
        positions = set()
        for index, child in enumerate(children):
            if not isinstance(child, dict):
                raise ProjectError("INVALID_DOCUMENT", "子模块必须为对象")
            if rows is not None:
                position = child.get("position", [index // columns, index % columns])
                if not isinstance(position, list) or len(position) != 2 or any(type(value) is not int or value < 0 for value in position):
                    raise ProjectError("INVALID_POSITION", "position 必须为非负整数 [行, 列]")
                if position[0] >= rows or position[1] >= columns or tuple(position) in positions:
                    raise ProjectError("INVALID_POSITION", "位置重复或超出布局范围", elementId=obj["id"])
                positions.add(tuple(position))
        if obj.get("type") not in {None, "group", "itemRow"} and children:
            raise ProjectError("INVALID_DOCUMENT", "最小模块不能包含 elements")
        for child in children:
            node(child)
    for module in doc.get("modules", []):
        node(module, True)
    composition = doc.get("composition", {})
    if not isinstance(composition, dict):
        raise ProjectError("INVALID_DOCUMENT", "composition 必须是对象")
    check_values(composition)
    background = composition.get("background")
    if background is not None and not isinstance(background, (str, dict)):
        raise ProjectError("INVALID_STYLE", "画布 background 必须是颜色或背景对象")
    width = composition.get("width", 1200)
    if not isinstance(width, (int, float)) or isinstance(width, bool) or not 1 <= width <= 16000:
        raise ProjectError("INVALID_CANVAS", "画布宽度需在 1–16000 像素之间")
    if "moduleOrder" in composition:
        order = composition["moduleOrder"]
        mids = [m["id"] for m in doc.get("modules", [])]
        if not isinstance(order, list) or len(order) != len(set(order)) or set(order) != set(mids):
            raise ProjectError("INVALID_ORDER", "moduleOrder 必须包含每个模块且不重复")


def walk(document: dict):
    def visit(node):
        yield node
        for child in node.get("elements", []):
            yield from visit(child)
    for module in document.get("modules", []):
        yield from visit(module)


def find_element(document: dict, element_id: str) -> dict:
    for node in walk(document):
        if node["id"] == element_id:
            return node
        if node.get("type") == "itemRow":
            if element_id == node["id"] + ":text":
                overrides = node.get("textOverrides", {})
                return {"id": element_id, "type": "text", "text": node.get("text", ""),
                        **copy.deepcopy(overrides),
                        "style": {**copy.deepcopy(node.get("style", {})), **copy.deepcopy(overrides.get("style", {}))}}
            if element_id == node["id"] + ":image":
                return node.setdefault("image", {})
    raise ProjectError("ELEMENT_NOT_FOUND", f"找不到元素：{element_id}")


def apply_operations(document: dict, operations: list[dict]) -> dict:
    result = copy.deepcopy(document)
    for op in operations:
        kind = op["type"]
        if kind == "set_composition":
            result.setdefault("composition", {}).update(op["values"])
        elif kind == "set_project_config":
            for key, value in op["values"].items():
                if key not in {"assetsDir", "outputsDir", "title"}:
                    raise ProjectError("INVALID_OPERATION", "不允许更改该配置")
                result[key] = value
        elif kind == "add_module":
            result["modules"].append(copy.deepcopy(op["module"]))
            if "moduleOrder" in result["composition"]:
                result["composition"]["moduleOrder"].append(op["module"]["id"])
        elif kind == "reorder_modules":
            result["composition"]["moduleOrder"] = list(op["order"])
        elif kind == "add_element":
            parent = find_element(result, op["parentId"])
            element = copy.deepcopy(op["element"])
            _place_in_grid(parent, element)
            parent.setdefault("elements", []).append(element)
        elif kind in {"delete_element", "duplicate_element"}:
            target = op["elementId"]
            parents = [result] + list(walk(result))
            for parent in parents:
                key = "modules" if parent is result else "elements"
                children = parent.get(key, [])
                for index, child in enumerate(children):
                    if child["id"] == target:
                        if kind == "delete_element":
                            children.pop(index)
                        else:
                            cloned = copy.deepcopy(child)
                            def new_ids(n):
                                n["id"] = "element_" + uuid.uuid4().hex[:10]
                                for c in n.get("elements", []):
                                    new_ids(c)
                            new_ids(cloned)
                            cloned.pop("position", None)
                            if parent is not result:
                                _place_in_grid(parent, cloned)
                            children.insert(index + 1, cloned)
                        break
                else:
                    continue
                if parent is result and "moduleOrder" in result["composition"]:
                    result["composition"]["moduleOrder"] = [m["id"] for m in result["modules"]]
                break
            else:
                raise ProjectError("ELEMENT_NOT_FOUND", "无法删除/复制组件子项，请选择所属组件")
        else:
            node = find_element(result, op["elementId"])
            text_owner = None
            if op["elementId"].endswith(":text"):
                text_owner = find_element(result, op["elementId"][:-5])
                if text_owner.get("type") == "itemRow":
                    node = text_owner.setdefault("textOverrides", {})
            if kind == "set_text":
                (text_owner if text_owner is not None else node)["text"] = op["text"]
            elif kind == "set_style":
                node.setdefault("style", {}).update(op["values"])
            elif kind == "replace_style":
                node["style"] = copy.deepcopy(op["values"])
            elif kind == "set_title_style":
                node.setdefault("titleStyle", {}).update(op["values"])
            elif kind == "replace_asset":
                node.pop("assetQuery", None)
                node.pop("assetPath", None)
                node["assetId"] = op["assetId"]
                node.pop("crop", None)
            elif kind == "set_crop":
                node["crop"] = op["crop"]
            elif kind in {"move_element", "resize_element", "set_properties"}:
                allowed = {"x", "y", "width", "height", "offsetX", "offsetY", "title", "visible", "locked", "fit", "layout", "crop", "assetId", "zIndex", "position", "contentScale", "processor", "processors"}
                if not set(op["values"]) <= allowed:
                    raise ProjectError("INVALID_OPERATION", "不允许更新这些元素字段")
                for key, value in op["values"].items():
                    if key == "layout":
                        _change_layout(node, value)
                        continue
                    if value is None and key in {"width", "height", "crop"}:
                        node.pop(key, None)
                    else:
                        node[key] = copy.deepcopy(value)
            else:
                raise ProjectError("INVALID_OPERATION", f"未知操作：{kind}")
    validate_document(result)
    return result


def _place_in_grid(parent: dict, child: dict) -> None:
    """Use a vacant cell for an explicit add/copy without reflowing existing cells."""
    layout = parent.get("layout", {})
    if isinstance(layout, list):
        rows, columns = layout
    elif layout.get("type") == "grid":
        rows, columns = layout["rows"], layout["columns"]
    else:
        return
    if "position" in child:
        return
    occupied = {tuple(node.get("position", [index // columns, index % columns]))
                for index, node in enumerate(parent.get("elements", []))}
    for row in range(rows):
        for column in range(columns):
            if (row, column) not in occupied:
                child["position"] = [row, column]
                return
    raise ProjectError("GRID_FULL", "网格没有空位，请先增加行数或列数", elementId=parent.get("id"))


def _change_layout(node: dict, layout: dict | list) -> None:
    """Explicit layout edits reflow children while keeping their content and IDs."""
    children = node.get("elements", [])
    current = node.get("layout", {})
    if isinstance(current, list) or isinstance(current, dict) and current.get("type") == "grid":
        columns = current[1] if isinstance(current, list) else current["columns"]
        positions = {child["id"]: child.get("position", [index // columns, index % columns])
                     for index, child in enumerate(children)}
        children.sort(key=lambda child: positions[child["id"]])
    node["layout"] = copy.deepcopy(layout)
    if isinstance(layout, list) and len(layout) == 2:
        rows, columns = layout
    elif isinstance(layout, dict) and layout.get("type") == "grid":
        rows, columns = layout.get("rows"), layout.get("columns")
    elif isinstance(layout, dict):
        for child in children:
            child.pop("position", None)
        return
    else:
        return  # The common validator reports malformed layouts.
    if type(rows) is not int or type(columns) is not int or rows <= 0 or columns <= 0:
        return
    if rows * columns < len(children):
        raise ProjectError("GRID_FULL", "新网格不能容纳全部子模块")
    for index, child in enumerate(children):
        child["position"] = [index // columns, index % columns]


_MISSING = object()


def three_way_merge(base, local, external, choices=None):
    """Merge by stable IDs, never by array index; conflicting orders are explicit."""
    choices = choices or {}
    conflicts = []

    def rec(b, l, e, path):
        if l == e:
            return copy.deepcopy(l) if l is not _MISSING else _MISSING
        if l == b:
            return copy.deepcopy(e) if e is not _MISSING else _MISSING
        if e == b:
            return copy.deepcopy(l) if l is not _MISSING else _MISSING
        if all(isinstance(v, dict) for v in (b, l, e)):
            out = {}
            for key in sorted(set(b) | set(l) | set(e)):
                if key == "revision":
                    out[key] = l.get(key, 0)
                    continue
                value = rec(b.get(key, _MISSING), l.get(key, _MISSING), e.get(key, _MISSING), path + "/" + key)
                if value is not _MISSING:
                    out[key] = value
            return out
        if all(isinstance(v, list) and all(isinstance(n, dict) and "id" in n for n in v) for v in (b, l, e)):
            maps = [{n["id"]: n for n in v} for v in (b, l, e)]
            values = {}
            for key in sorted(set(maps[0]) | set(maps[1]) | set(maps[2])):
                value = rec(*(m.get(key, _MISSING) for m in maps), path + "/" + key)
                if value is not _MISSING:
                    values[key] = value
            orders = [[n["id"] for n in v] for v in (b, l, e)]
            order = rec(*orders, path + "/$order")
            return [values[k] for k in dict.fromkeys(order + list(values)) if k in values]
        choice = choices.get(path)
        if choice not in {"local", "external"}:
            conflicts.append({"path": path, "local": None if l is _MISSING else l,
                              "external": None if e is _MISSING else e})
        value = e if choice == "external" else l
        return copy.deepcopy(value) if value is not _MISSING else _MISSING

    return rec(base, local, external, ""), conflicts

