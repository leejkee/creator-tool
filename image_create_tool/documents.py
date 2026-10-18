"""Document creation and Agent project initialization, separate from the GUI."""
from __future__ import annotations

import copy
import os
import shlex
import sys
from importlib.resources import files
from pathlib import Path

from .model import empty_document, encode_document, resolve_directory, validate_document, walk
from .settings import AppSettings
from .storage import save_protected
from .styles import ResourceLibrary
from .assets import index_assets, resolve_asset
from .typography import font_path
from .styles import effective_style


def rebase_document(document: dict, directory: Path, capture_resources: bool = False) -> dict:
    """Keep source resources working after saving a document in another directory."""
    result = copy.deepcopy(document)
    result["assetsDir"] = str(resolve_directory(directory, result.get("assetsDir", "assets/")))
    catalog = index_assets(Path(result["assetsDir"]), result.get("assetAliases")) if capture_resources else []
    for key, value in result.get("fonts", {}).items():
        result["fonts"][key] = str(resolve_directory(directory, value))
    def rebase(value):
        if isinstance(value, dict):
            if capture_resources and (value.get("assetId") or value.get("assetQuery")):
                from .model import ProjectError
                try:
                    value["assetPath"] = resolve_asset(value, catalog)["path"]
                    value.pop("assetId", None)
                    value.pop("assetQuery", None)
                except ProjectError:
                    # Templates may deliberately contain unfilled content slots.
                    pass
            for key, child in value.items():
                if key in {"params", "sourceNotes", "assetAliases"}:
                    continue
                if key in {"font", "assetPath"} and isinstance(child, str):
                    value[key] = str(resolve_directory(directory, child))
                else:
                    rebase(child)
        elif isinstance(value, list):
            for child in value:
                rebase(child)
    rebase(result)
    if capture_resources:
        for node in walk(result):
            if node.get("type") == "text":
                node.setdefault("style", {})["font"] = str(font_path(directory, result, effective_style(node)))
    return result


def create_image(path: Path, library: ResourceLibrary, template_id: str | None = None) -> dict:
    from .model import ProjectError
    if path.suffix.lower() != ".json" or path.exists():
        raise ProjectError("FILE_EXISTS", "请选择尚不存在的 .json 文件名")
    document = empty_document()
    document["title"] = path.stem
    if template_id:
        node = library.instantiate(template_id)
        document["modules"].append(node)
        if isinstance(node.get("width"), (int, float)):
            document["composition"].update(width=node["width"], padding=0, gap=0)
    validate_document(document)
    save_protected(path, encode_document(document), None)
    return document


def initialize_project(directory: Path, settings: AppSettings) -> dict:
    """Create Agent instructions without making a project manifest or overwriting notes."""
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / "AGENTS.md"
    if destination.exists():
        return {"directory": str(directory), "agents": str(destination), "created": False}
    resources = files("image_create_tool").joinpath("resources")
    text = resources.joinpath("PROJECT_AGENTS.md.template").read_text(encoding="utf-8")
    example = resources.joinpath("example.image.json").read_text(encoding="utf-8")
    schema = resources.joinpath("JSON_PROTOCOL.md").read_text(encoding="utf-8")
    config_argument = ("'" + str(settings.config_dir).replace("'", "''") + "'") if os.name == "nt" else shlex.quote(str(settings.config_dir))
    interpreter = ("& '" + sys.executable.replace("'", "''") + "'") if os.name == "nt" else shlex.quote(sys.executable)
    command = f"{interpreter} -m image_create_tool --config-dir {config_argument}"
    replacements = {
        "{{RESOURCE_AND_STYLE_RULES}}": f"全局资源目录：{settings.resource_dir}\n\nstyles/ 保存样式，templates/ 保存默认模块，scripts/ 保存图片处理函数。样式引用是一次性应用请求，应用后展开保存在图片 JSON；不保留动态联动。",
        "{{IMAGE_JSON_SCHEMA}}": schema,
        "{{MINIMAL_IMAGE_JSON_EXAMPLE}}": "```json\n" + example.strip() + "\n```",
        "{{CLI_AND_RESOURCE_EXAMPLES}}": f"在安装本应用的 Python 环境运行，JSON 可参考上面的示例填写：\n\n```text\n{command} new guide.json\n{command} assets search --file guide.json --name 芈月\n{command} validate --file guide.json\n{command} render --file guide.json\n{command} styles list\n{command} styles apply --file guide.json --id section --name style_1\n```\n\n默认 PNG 与对应 JSON 同名、同目录；资源目录以同一配置下的 config show 为准。",
    }
    for token, value in replacements.items():
        text = text.replace(token, value)
    with destination.open("x", encoding="utf-8") as stream:
        stream.write(text)
    return {"directory": str(directory), "agents": str(destination), "created": True}
