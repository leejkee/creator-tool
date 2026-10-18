"""One-shot style application and template copying, independent of Qt/Pillow."""
from __future__ import annotations

import copy
import json
import re
import uuid
from pathlib import Path

from .model import ProjectError, find_element, normalize, validate_document, walk
from .model import STYLE_FIELDS as VISUAL_FIELDS
from .settings import AppSettings

DEFAULT_TEXT_STYLE = {"fontSize": 28, "bold": False, "color": "#F2F0FA", "align": "left"}
DEFAULT_TITLE_STYLE = {"fontSize": 36, "bold": True, "color": "#C2A0FF"}
RENDER_FIELDS = frozenset({
    "width", "height", "layout", "fit", "contentScale", "titleStyle", "textOverrides",
    "x", "y", "offsetX", "offsetY", "zIndex",
})


def effective_style(node: dict) -> dict:
    """Return independent effective values; missing container decoration stays absent."""
    style = node.get("style", {})
    if not isinstance(style, dict):
        raise ProjectError("UNRESOLVED_STYLE", "样式引用必须先应用并写入图片 JSON", elementId=node.get("id"))
    defaults = DEFAULT_TEXT_STYLE if node.get("type") == "text" else {}
    return {**defaults, **style}


def layout_shape(node: dict) -> tuple:
    layout = node.get("layout", {"type": "column"})
    children = node.get("elements", [])
    if isinstance(layout, list):
        if len(layout) != 2 or any(type(value) is not int or value <= 0 for value in layout):
            raise ProjectError("INVALID_LAYOUT", "样式 layout 需要正整数 [行数, 列数]")
        return tuple(layout)
    if not isinstance(layout, dict):
        raise ProjectError("INVALID_LAYOUT", "样式 layout 必须是对象或数组")
    mode = layout.get("type", "column")
    if mode == "row":
        return (1, max(1, len(children)))
    if mode == "column":
        return (max(1, len(children)), 1)
    if mode == "grid":
        shape = (layout.get("rows"), layout.get("columns"))
        if any(type(value) is not int or value <= 0 for value in shape):
            raise ProjectError("INVALID_LAYOUT", "grid 需要正整数 rows/columns")
        return shape
    if mode == "fixed":
        return ("fixed",)
    raise ProjectError("INVALID_LAYOUT", "未知样式布局")


def positioned_children(node: dict) -> dict[tuple[int, int], dict]:
    shape = layout_shape(node)
    columns = shape[1] if len(shape) == 2 else max(1, len(node.get("elements", [])))
    result = {}
    for index, child in enumerate(node.get("elements", [])):
        position = child.get("position", [index // columns, index % columns])
        if not isinstance(position, list) or len(position) != 2 or any(type(value) is not int or value < 0 for value in position):
            raise ProjectError("INVALID_POSITION", "样式 position 需要非负整数 [行, 列]")
        position = tuple(position)
        if position in result:
            raise ProjectError("DUPLICATE_POSITION", "同一布局位置有多个模块", elementId=node.get("id"))
        result[position] = child
    return result


class ResourceLibrary:
    def __init__(self, settings: AppSettings) -> None:
        self.settings = settings

    def path(self, kind: str, resource_id: str) -> Path:
        if kind not in {"styles", "templates"}:
            raise ProjectError("INVALID_RESOURCE_KIND", "资源类型必须是 styles 或 templates")
        if not isinstance(resource_id, str) or not re.fullmatch(r"[\w.-]+", resource_id) or resource_id in {".", ".."}:
            raise ProjectError("INVALID_RESOURCE_ID", "资源名称只允许文字、数字、下划线、点和短横线")
        name = resource_id if resource_id.endswith(".json") else resource_id + ".json"
        return self.settings.resource_dir / kind / name

    def read(self, kind: str, resource_id: str) -> dict:
        path = self.path(kind, resource_id)
        if not path.exists():
            packaged = Path(__file__).with_name("resources") / kind / path.name
            if packaged.is_file():
                path = packaged
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise ProjectError("RESOURCE_NOT_FOUND", f"无法读取资源：{path}：{exc}") from exc
        if not isinstance(value, dict):
            raise ProjectError("INVALID_RESOURCE", f"资源必须是 JSON 对象：{path}")
        return value

    def list(self, kind: str) -> list[dict]:
        if kind not in {"styles", "templates"}:
            raise ProjectError("INVALID_RESOURCE_KIND", "未知资源类型")
        bundled = Path(__file__).with_name("resources") / kind
        paths = {path.stem: path for path in bundled.glob("*.json")}
        paths.update({path.stem: path for path in (self.settings.resource_dir / kind).glob("*.json")})
        return [{"id": identity, "path": str(path)} for identity, path in sorted(paths.items())]

    def resolve_style(self, value: str | dict, chain: tuple[str, ...] = ()) -> dict:
        """Expand the entire referenced style tree now, never at later render time."""
        if isinstance(value, str):
            identity = self.path("styles", value).stem
            if identity in chain:
                raise ProjectError("STYLE_CYCLE", "样式引用形成循环", chain=[*chain, identity])
            specification = self.read("styles", value)
            self._absolute_paths(specification, self.path("styles", value).parent)
            return self.resolve_style(specification, (*chain, identity))
        if not isinstance(value, dict):
            raise ProjectError("INVALID_STYLE", "样式必须为对象或本地样式名称")
        result = copy.deepcopy(value)
        allowed = VISUAL_FIELDS | RENDER_FIELDS | {"style", "type", "elements", "position", "id", "name", "description", "version"}
        if set(result) - allowed:
            raise ProjectError("UNSUPPORTED_STYLE", "样式资源包含未知参数", fields=sorted(set(result) - allowed))
        if isinstance(result.get("style"), str):
            base = self.resolve_style(result["style"], chain)
            base.update({key: val for key, val in result.items() if key != "style"})
            result = base
        children = result.get("elements", [])
        if not isinstance(children, list):
            raise ProjectError("INVALID_STYLE", "组合样式 elements 必须是数组")
        result["elements"] = [self.resolve_style(child, chain) for child in children]
        return result

    def _apply_node(self, node: dict, specification: dict) -> None:
        expected_type = specification.get("type")
        if expected_type and expected_type != node.get("type", "group"):
            raise ProjectError("STYLE_MISMATCH", "样式与目标模块类型不匹配", elementId=node["id"])
        children = specification.get("elements", [])
        if children:
            if layout_shape(specification) != layout_shape(node):
                raise ProjectError("STYLE_MISMATCH", "组合样式布局不匹配", elementId=node["id"])
            source = positioned_children(specification)
            targets = positioned_children(node)
            if source.keys() != targets.keys():
                raise ProjectError("STYLE_MISMATCH", "组合样式子模块位置不匹配", elementId=node["id"])
            for position, child_style in source.items():
                self._apply_node(targets[position], child_style)
        elif node.get("elements") and "elements" in specification:
            # A container-only decoration is allowed; it does not style children.
            pass
        visual = specification.get("style", {})
        if not isinstance(visual, dict):
            raise ProjectError("INVALID_STYLE", "样式参数必须是对象")
        visual = {**{key: specification[key] for key in VISUAL_FIELDS if key in specification}, **visual}
        node["style"] = copy.deepcopy(visual)
        for key in RENDER_FIELDS:
            node.pop(key, None)
            if key in specification:
                node[key] = copy.deepcopy(specification[key])

    def apply(self, document: dict, element_ids: list[str], value: str | dict) -> dict:
        if not element_ids:
            raise ProjectError("NO_SELECTION", "请先选择模块")
        specification = self.resolve_style(value)
        result = copy.deepcopy(document)
        for identity in dict.fromkeys(element_ids):
            self._apply_node(find_element(result, identity), specification)
        validate_document(result)
        return result

    def materialize(self, document: dict) -> tuple[dict, bool]:
        result = copy.deepcopy(document)
        changed = False
        for node in list(walk(result)):
            if isinstance(node.get("style"), str):
                self._apply_node(node, self.resolve_style(node["style"]))
                changed = True
        validate_document(result)
        return result, changed

    def save(self, kind: str, identity: str, value: dict) -> Path:
        path = self.path(kind, identity)
        if any(item["id"] == path.stem for item in self.list(kind)):
            raise ProjectError("RESOURCE_EXISTS", f"资源已存在，请选择新名称：{identity}")
        path.parent.mkdir(parents=True, exist_ok=True)
        serialized = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        try:
            with path.open("x", encoding="utf-8") as stream:
                stream.write(serialized)
        except FileExistsError as exc:
            raise ProjectError("RESOURCE_EXISTS", f"资源已存在，请选择新名称：{identity}") from exc
        return path

    def save_style(self, identity: str, node: dict) -> Path:
        specification = self.extract_style(node)
        return self.save("styles", identity, specification)

    def extract_style(self, node: dict) -> dict:
        result = {"type": node.get("type", "group"), "style": effective_style(node)}
        result.update({key: copy.deepcopy(node[key]) for key in RENDER_FIELDS if key in node})
        if node.get("elements"):
            result["elements"] = [
                {**self.extract_style(child), "position": list(position)}
                for position, child in positioned_children(node).items()
            ]
        return result

    def instantiate(self, identity: str) -> dict:
        value = self.read("templates", identity)
        self._absolute_paths(value, self.path("templates", identity).parent)
        node = copy.deepcopy(value.get("module", value))
        if not isinstance(node, dict):
            raise ProjectError("INVALID_TEMPLATE", "模板必须包含一个模块对象")
        if "type" not in node and not isinstance(node.get("elements"), list):
            raise ProjectError("INVALID_TEMPLATE", "模板需要模块 type/elements，不能使用整张图片的 modules 描述代替模块")
        def assign_ids(current: dict) -> None:
            current["id"] = "module_" + uuid.uuid4().hex[:12]
            for child in current.get("elements", []):
                assign_ids(child)
        assign_ids(node)
        document = {"image-create-tool-version": "v0.1.0", "modules": [node]}
        materialized, _ = self.materialize(normalize(document))
        return materialized["modules"][0]

    @staticmethod
    def _absolute_paths(value, directory: Path) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"params", "sourceNotes", "assetAliases"}:
                    continue
                if key in {"assetPath", "font"} and isinstance(child, str):
                    path = Path(child).expanduser()
                    value[key] = str((directory / path).resolve()) if not path.is_absolute() else str(path.resolve())
                else:
                    ResourceLibrary._absolute_paths(child, directory)
        elif isinstance(value, list):
            for child in value:
                ResourceLibrary._absolute_paths(child, directory)
