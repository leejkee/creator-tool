"""Agent-facing file workflow and headless calls to the production renderer."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .assets import index_assets
from .model import ProjectError, normalize, resolve_directory


def load_project(project):
    root = Path(project).resolve()
    doc = normalize(json.loads((root / "pjt.json").read_text(encoding="utf-8-sig")))
    assets = index_assets(resolve_directory(root, doc["assetsDir"]), doc.get("assetAliases"))
    return root, doc, assets


def request_from_project(project):
    from .model import fingerprint
    root, doc, assets = load_project(project)
    return {"project": str(root), "documentSnapshot": doc, "resources": assets,
            "documentId": doc["documentId"], "revision": doc["revision"], "target": "current",
            "jobId": "cli", "renderId": "cli", "candidateId": None,
            "contentFingerprint": fingerprint(doc), "resourceFingerprint": fingerprint(assets)}


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="一图流攻略编辑器 · PySide6 / Pillow")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("open", "validate", "layout", "render"):
        p = sub.add_parser(name)
        p.add_argument("--project", default=".", help="工作目录，读取根目录 pjt.json")
        if name == "render":
            p.add_argument("--output", help="PNG 输出位置，默认 outputsDir/guide.png")
    asset_parser = sub.add_parser("assets")
    asset_parser.add_argument("action", choices=["search", "index"])
    asset_parser.add_argument("--project", default=".")
    asset_parser.add_argument("--name", default="")
    asset_parser.add_argument("--category")
    args = parser.parse_args(argv)
    try:
        if args.command == "open":
            from .gui import run_gui
            return run_gui(Path(args.project).resolve())
        if args.command == "assets":
            root = Path(args.project).resolve()
            try:
                _, _, assets = load_project(root)
            except FileNotFoundError:
                assets = index_assets(root / "assets")
            matches = [a for a in assets if args.name in a["name"] and (not args.category or a["category"] == args.category)]
            print(json.dumps({"ok": True, "assets": matches}, ensure_ascii=False, indent=2))
            return 0
        request = request_from_project(args.project)
        from .renderer import Renderer, render_document
        if args.command == "layout":
            renderer = Renderer(request)
            layout = renderer.layout()
            for node in layout["elements"]:
                node.pop("image", None); node.pop("style", None)
            print(json.dumps({"ok": True, "layout": layout, "issues": renderer.issues}, ensure_ascii=False, indent=2))
            return int(bool(renderer.issues))
        result = render_document(request)
        if args.command == "render" and result.get("exportable"):
            from .storage import save_png
            root = Path(request["project"])
            path = Path(args.output).resolve() if args.output else resolve_directory(root, request["documentSnapshot"]["outputsDir"]) / "guide.png"
            save_png(path, result["pngBytes"])
            result["output"] = str(path)
        metadata = {k: v for k, v in result.items() if k not in {"pngBytes", "layout"}}
        print(json.dumps(metadata, ensure_ascii=False, indent=2))
        return 0 if result.get("exportable") else 1
    except Exception as exc:
        error = exc.as_dict() if isinstance(exc, ProjectError) else {"code": "COMMAND_FAILED", "message": str(exc)}
        print(json.dumps({"ok": False, "error": error}, ensure_ascii=False, indent=2))
        return 1

