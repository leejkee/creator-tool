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
VERSION = "v0.0.1"
TYPES = {"text", "image", "rect", "group", "itemRow"}


class ProjectError(Exception):
    def __init__(self, code: str, message: str, **details):
        super().__init__(message)
        self.code, self.details = code, details

    def as_dict(self):
        return {"code": self.code, "message": str(self), **self.details}


def fingerprint(value: Any) -> str:
    data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(data).hexdigest()


def encode_document(document: dict) -> bytes:
    return (json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def empty_document() -> dict:
    return {MARKER: VERSION, "assetsDir": "assets/", "outputsDir": "outputs/",
            "documentId": uuid.uuid4().hex, "revision": 0, "title": "新攻略",
            "sourceNotes": "", "modules": [],
            "composition": {"width": 1200, "height": "auto", "background": "#101521",
                            "padding": 32, "gap": 24}}


def normalize(document: dict) -> dict:
    validate_document(document)
    result = copy.deepcopy(document)
    defaults = empty_document()
    for key, value in defaults.items():
        result.setdefault(key, value)
    return result


def resolve_directory(project: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return (project / path).resolve() if not path.is_absolute() else path.resolve()


def validate_document(doc: Any):
    if not isinstance(doc, dict) or not isinstance(doc.get(MARKER), str) or not doc[MARKER]:
        raise ProjectError("INVALID_PROJECT", "项目缺少 image-create-tool-version 标记")
    for key in ("assetsDir", "outputsDir"):
        if key in doc and (not isinstance(doc[key], str) or not doc[key].strip()):
            raise ProjectError("INVALID_CONFIG", f"{key} 必须是非空路径")
    if not isinstance(doc.get("modules", []), list):
        raise ProjectError("INVALID_DOCUMENT", "modules 必须是列表")
    if "revision" in doc and (not isinstance(doc["revision"], int) or isinstance(doc["revision"], bool) or doc["revision"] < 0):
        raise ProjectError("INVALID_REVISION", "revision 必须为非负整数")
    ids = set()
    numeric = {"x", "y", "width", "height", "padding", "gap", "offsetX", "offsetY", "fontSize", "lineHeight", "radius", "zIndex"}

    def check_values(obj):
        for key, value in obj.items():
            if key in numeric and not (key == "height" and value == "auto"):
                if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                    raise ProjectError("INVALID_NUMBER", f"{key} 必须是有限数值")
                if key in {"width", "height", "fontSize", "lineHeight"} and value <= 0:
                    raise ProjectError("INVALID_NUMBER", f"{key} 必须大于 0")
                if key in {"padding", "gap", "radius"} and value < 0:
                    raise ProjectError("INVALID_NUMBER", f"{key} 不能为负")
            if isinstance(value, dict):
                check_values(value)

    def node(obj, module=False):
        if not isinstance(obj, dict) or not isinstance(obj.get("id"), str) or not obj["id"]:
            raise ProjectError("INVALID_ID", "模块和元素需要非空 id")
        if obj["id"] in ids:
            raise ProjectError("DUPLICATE_ID", f"重复 id：{obj['id']}")
        ids.add(obj["id"])
        if not module and obj.get("type") not in TYPES:
            raise ProjectError("UNKNOWN_ELEMENT", f"不支持元素类型：{obj.get('type')}")
        if "text" in obj and not isinstance(obj["text"], str):
            raise ProjectError("INVALID_TEXT", "text 必须为字符串")
        check_values(obj)
        children = obj.get("elements", [])
        if not isinstance(children, list):
            raise ProjectError("INVALID_DOCUMENT", "elements 必须是列表")
        for child in children:
            node(child)
    for module in doc.get("modules", []):
        node(module, True)
    composition = doc.get("composition", {})
    if not isinstance(composition, dict):
        raise ProjectError("INVALID_DOCUMENT", "composition 必须是对象")
    check_values(composition)
    width = composition.get("width", 1200)
    if width > 16000 or width < 100:
        raise ProjectError("INVALID_CANVAS", "画布宽度需在 100–16000 像素之间")
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
            find_element(result, op["parentId"]).setdefault("elements", []).append(copy.deepcopy(op["element"]))
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
                allowed = {"x", "y", "width", "height", "offsetX", "offsetY", "title", "visible", "locked", "fit", "layout", "crop", "assetId", "zIndex"}
                if not set(op["values"]) <= allowed:
                    raise ProjectError("INVALID_OPERATION", "不允许更新这些元素字段")
                for key, value in op["values"].items():
                    if value is None and key in {"width", "height", "crop"}:
                        node.pop(key, None)
                    else:
                        node[key] = copy.deepcopy(value)
            else:
                raise ProjectError("INVALID_OPERATION", f"未知操作：{kind}")
    validate_document(result)
    return result


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

