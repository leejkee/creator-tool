"""File-relative input loading and immutable-by-ownership render snapshots."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from .assets import index_assets
from .contracts import RenderRequest
from .model import ProjectError, fingerprint, normalize, resolve_directory
from .preprocessing import processor_specs, processor_path
from .settings import AppSettings
from .styles import ResourceLibrary, effective_style, DEFAULT_TITLE_STYLE
from .typography import font_path


def load_image_document(path: Path, library: ResourceLibrary) -> tuple[dict, bytes, bool]:
    if path.suffix.lower() != ".json":
        raise ProjectError("INVALID_FILE", "请选择图片描述 JSON 文件")
    try:
        raw = path.read_bytes()
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ProjectError("INVALID_DOCUMENT", f"无法读取图片 JSON：{path}：{exc}") from exc
    document, materialized = library.materialize(normalize(parsed))
    return document, raw, materialized


def resource_catalog(path: Path, document: dict, settings: AppSettings) -> tuple[list[dict], list[dict]]:
    directory = path.parent
    assets = index_assets(resolve_directory(directory, document.get("assetsDir", "assets/")), document.get("assetAliases"))
    extra_paths: set[Path] = set()
    def visible_nodes(nodes):
        for node in nodes:
            if node.get("visible", True):
                yield node
                yield from visible_nodes(node.get("elements", []))
    for node in visible_nodes(document.get("modules", [])):
        if node.get("type") == "text" or (node.get("type", "group") == "group" and node.get("title")):
            style = effective_style(node) if node.get("type") == "text" else {**DEFAULT_TITLE_STYLE, **node.get("titleStyle", {})}
            extra_paths.add(font_path(directory, document, style))
        style = effective_style(node)
        references = [node, style.get("background", {})]
        for reference in references:
            if isinstance(reference, dict):
                for specification in processor_specs(reference):
                    extra_paths.add(processor_path(settings.scripts_dir, specification["script"]))
                if reference.get("assetPath"):
                    if not isinstance(reference["assetPath"], str):
                        raise ProjectError("INVALID_ASSET", "assetPath 必须是文件路径字符串")
                    target = resolve_directory(directory, reference["assetPath"])
                    extra_paths.add(target)
    background = document.get("composition", {}).get("background")
    if isinstance(background, dict) and background.get("assetPath"):
        if not isinstance(background["assetPath"], str):
            raise ProjectError("INVALID_ASSET", "背景 assetPath 必须是文件路径字符串")
        extra_paths.add(resolve_directory(directory, background["assetPath"]))
    if isinstance(background, dict):
        for specification in processor_specs(background):
            extra_paths.add(processor_path(settings.scripts_dir, specification["script"]))
    extras = []
    for target in sorted(extra_paths):
        try:
            extras.append({"path": str(target), "hash": fingerprint(target.read_bytes())})
        except OSError as exc:
            raise ProjectError("RESOURCE_NOT_FOUND", f"无法读取资源：{target}") from exc
    return assets, extras


def build_render_request(path: Path, document: dict, settings: AppSettings, **identity) -> RenderRequest:
    assets, extras = resource_catalog(path, resource_document(document, identity.get("elementId")), settings)
    return {
        "filePath": str(path), "baseDir": str(path.parent), "documentSnapshot": copy.deepcopy(document),
        "resources": assets, "extraResources": extras, "scriptsDir": str(settings.scripts_dir),
        "documentId": document["documentId"], "revision": document["revision"], "target": "current",
        "jobId": "render", "renderId": "render", "candidateId": None,
        "contentFingerprint": fingerprint(document), "resourceFingerprint": fingerprint([assets, extras]),
        **identity,
    }


def resources_unchanged(request: dict, settings: AppSettings) -> bool:
    assets, extras = resource_catalog(Path(request["filePath"]), resource_document(request["documentSnapshot"], request.get("elementId")), settings)
    return fingerprint([assets, extras]) == request["resourceFingerprint"]


def resource_document(document: dict, element_id: str | None) -> dict:
    if element_id is None:
        return document
    from .model import find_element
    result = {**document, "modules": [find_element(document, element_id)], "composition": {}}
    return result
