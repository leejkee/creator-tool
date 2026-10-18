"""File-based GUI/CLI entrypoints sharing model, resources and production rendering."""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .assets import index_assets
from .documents import create_image, initialize_project, rebase_document
from .model import ProjectError, apply_operations, encode_document, find_element, fingerprint, resolve_directory
from .resources import build_render_request, load_image_document, resources_unchanged
from .settings import launch_terminal, load_settings, update_settings
from .storage import default_png_path, save_png, save_protected
from .styles import ResourceLibrary

LOGGER = logging.getLogger(__name__)


def load_file(path: Path, library: ResourceLibrary) -> dict:
    document, raw, materialized = load_image_document(path, library)
    if materialized:
        save_protected(path, encode_document(document), fingerprint(raw))
    return document


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="图片 JSON 编辑器 · PySide6 / Pillow")
    root.add_argument("--config-dir", type=Path, help="全局配置目录；也可设置 IMAGE_CREATE_TOOL_HOME")
    sub = root.add_subparsers(dest="command", required=True)
    for name in ("open", "new", "validate", "layout", "render", "terminal"):
        command = sub.add_parser(name)
        command.add_argument("filename", nargs="?")
        command.add_argument("--file", dest="file_option", help="图片描述 JSON 文件")
        if name == "new":
            command.add_argument("--template", help="从全局默认模块创建")
        if name in {"render", "layout", "validate"}:
            command.add_argument("--element", help="只导出指定模块")
        if name == "render":
            command.add_argument("--output", help="默认与 JSON 同目录、同名的 PNG")
    initialize = sub.add_parser("init")
    initialize.add_argument("directory", type=Path, help="创建 Agent 工作目录及 AGENTS.md")
    assets = sub.add_parser("assets")
    assets.add_argument("action", choices=["search", "index"])
    assets.add_argument("--file")
    assets.add_argument("--directory", type=Path, help="直接指定素材目录")
    assets.add_argument("--name", default="")
    assets.add_argument("--category")
    for kind in ("styles", "templates"):
        command = sub.add_parser(kind)
        command.add_argument("action", choices=["list", "save", "apply"] if kind == "styles" else ["list", "save", "add"])
        command.add_argument("--file")
        command.add_argument("--name", help="全局资源标识/新资源名称")
        command.add_argument("--id", action="append", default=[], help="目标模块 ID，可重复指定")
        command.add_argument("--parent", help="添加模板的容器 ID；不指定则加入画布")
    config = sub.add_parser("config")
    config.add_argument("action", choices=["show", "set"])
    config.add_argument("--resource-dir")
    config.add_argument("--terminal")
    config.add_argument("--terminal-args", help="参数字符串数组的 JSON")
    return root


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    arguments = parser().parse_args(argv)
    try:
        settings = load_settings(arguments.config_dir)
        library = ResourceLibrary(settings)
        path_value = getattr(arguments, "file_option", None) or getattr(arguments, "filename", None) or getattr(arguments, "file", None)
        path = Path(path_value).expanduser().resolve() if path_value else None
        if arguments.command == "open":
            from .gui import run_gui
            return run_gui(path, settings=settings)
        if arguments.command == "init":
            result = initialize_project(arguments.directory.resolve(), settings)
        elif arguments.command == "new":
            if path is None:
                raise ProjectError("FILE_REQUIRED", "请指定新图片 JSON 路径")
            create_image(path, library, arguments.template)
            result = {"file": str(path)}
        elif arguments.command == "config":
            if arguments.action == "set":
                values = {}
                for source, target in (("resource_dir", "resourceDir"), ("terminal", "terminalProgram")):
                    value = getattr(arguments, source)
                    if value is not None:
                        values[target] = value
                if arguments.terminal_args is not None:
                    values["terminalArgs"] = json.loads(arguments.terminal_args)
                settings = update_settings(settings, values)
            result = {"resourceDir": str(settings.resource_dir), "terminalProgram": settings.terminal_program,
                      "terminalArgs": list(settings.terminal_args), "configDir": str(settings.config_dir)}
        elif arguments.command == "terminal":
            if path is None:
                raise ProjectError("FILE_REQUIRED", "请指定当前 JSON")
            result = {"pid": launch_terminal(settings, path.parent)}
        elif arguments.command == "assets":
            if arguments.directory:
                directory = arguments.directory.resolve()
                aliases = None
            elif path:
                document = load_file(path, library)
                directory = resolve_directory(path.parent, document["assetsDir"])
                aliases = document.get("assetAliases")
            else:
                raise ProjectError("FILE_REQUIRED", "请指定 --file 或 --directory")
            result = {"assets": [entry for entry in index_assets(directory, aliases) if arguments.name in entry["name"]
                                 and (not arguments.category or entry["category"] == arguments.category)]}
        elif arguments.command in {"styles", "templates"}:
            if arguments.action == "list":
                result = {"resources": library.list(arguments.command)}
            else:
                if path is None or not arguments.name:
                    raise ProjectError("INVALID_ARGUMENTS", "需要 --file 和 --name")
                document = load_file(path, library)
                raw = path.read_bytes()
                if arguments.action == "save":
                    if len(arguments.id) != 1:
                        raise ProjectError("NO_SELECTION", "保存资源需要指定一个 --id")
                    selection = {**document, "modules": [find_element(document, arguments.id[0])]}
                    absolute = rebase_document(selection, path.parent, capture_resources=True)["modules"][0]
                    destination = library.save_style(arguments.name, absolute) if arguments.command == "styles" else library.save("templates", arguments.name, {"module": absolute})
                    result = {"resource": str(destination)}
                else:
                    if arguments.command == "styles":
                        document = library.apply(document, arguments.id, arguments.name)
                    else:
                        node = library.instantiate(arguments.name)
                        if arguments.parent:
                            operation = {"type": "add_element", "parentId": arguments.parent, "element": node}
                        else:
                            operation = {"type": "add_module", "module": node}
                        document = apply_operations(document, [operation])
                    from .model import validate_document
                    validate_document(document)
                    document["revision"] += 1
                    save_protected(path, encode_document(document), fingerprint(raw))
                    result = {"file": str(path), "revision": document["revision"]}
        else:
            if path is None:
                raise ProjectError("FILE_REQUIRED", "请指定图片 JSON：--file <path>")
            document = load_file(path, library)
            request = build_render_request(path, document, settings, elementId=arguments.element)
            from .renderer import render_document
            rendered = render_document(request)
            result = {key: value for key, value in rendered.items() if key not in {"pngBytes", "layout"}}
            if arguments.command == "layout":
                result["layout"] = rendered["layout"]
            if arguments.command == "render" and rendered.get("exportable"):
                destination = Path(arguments.output).resolve() if arguments.output else default_png_path(path, arguments.element)
                if destination.suffix.lower() != ".png":
                    raise ProjectError("INVALID_OUTPUT", "输出路径必须以 .png 结尾")
                if not resources_unchanged(request, settings):
                    raise ProjectError("RESOURCE_CHANGED", "资源发生变化，请重新渲染")
                save_png(destination, rendered["pngBytes"])
                result["output"] = str(destination)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if rendered.get("exportable") else 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        LOGGER.exception("Command failed: %s", arguments.command)
        error = exc.as_dict() if isinstance(exc, ProjectError) else {"code": "COMMAND_FAILED", "message": str(exc)}
        print(json.dumps({"ok": False, "error": error}, ensure_ascii=False, indent=2))
        return 1
