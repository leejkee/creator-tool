"""Document creation and resource rebasing for the editor service."""
from __future__ import annotations

import copy
from pathlib import Path

from .model import empty_document, encode_document, resolve_directory, validate_document, walk
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
