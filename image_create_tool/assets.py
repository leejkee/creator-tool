"""File-name asset catalog. No generated index JSON and no GUI dependency."""
from __future__ import annotations

import hashlib
from pathlib import Path
from .model import ProjectError


def index_assets(root: Path, aliases: dict | None = None) -> list[dict]:
    entries = []
    aliases = {} if aliases is None else aliases
    if not isinstance(aliases, dict) or any(
        not isinstance(value, list) or any(not isinstance(name, str) for name in value)
        for value in aliases.values()
    ):
        raise ProjectError("INVALID_ASSET_ALIASES", "assetAliases 必须把素材相对路径映射到名称字符串数组")
    try:
        if root.is_dir():
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
                    relative = path.relative_to(root).as_posix()
                    entries.append({"assetId": relative, "name": path.stem, "category": path.parent.relative_to(root).as_posix(),
                                    "path": str(path), "relativePath": relative,
                                    "aliases": aliases.get(relative, []), "hash": hashlib.sha256(path.read_bytes()).hexdigest()})
    except OSError as exc:
        raise ProjectError("ASSET_READ_FAILED", f"无法读取素材目录：{root}：{exc}") from exc
    return entries


def resolve_asset(ref: dict, entries: list[dict]) -> dict:
    if not isinstance(ref, dict):
        raise ProjectError("ASSET_NOT_FOUND", "图片未指定素材")
    if ref.get("assetId"):
        matches = [a for a in entries if a["assetId"] == ref["assetId"]]
    else:
        query = ref.get("assetQuery", {})
        if isinstance(query, str):
            query = {"name": query}
        if not isinstance(query, dict) or not isinstance(query.get("name", ""), str) or not isinstance(query.get("category", ""), str):
            raise ProjectError("INVALID_ASSET", "素材查询需要字符串 name/category")
        name = query.get("name", "")
        matches = [a for a in entries if name == a["name"] or name in a["aliases"]]
        if query.get("category"):
            matches = [a for a in matches if a["category"] == query["category"]]
    if len(matches) != 1:
        raise ProjectError("ASSET_AMBIGUOUS" if matches else "ASSET_NOT_FOUND",
                           "素材匹配不唯一" if matches else "素材不存在", candidates=matches)
    return matches[0]

