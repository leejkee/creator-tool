"""Machine-local configuration, shared resources, and terminal launching."""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, replace
from pathlib import Path

from .model import ProjectError, fingerprint
from .storage import save_protected

CONFIG_ENV = "IMAGE_CREATE_TOOL_HOME"


@dataclass(frozen=True)
class AppSettings:
    config_dir: Path
    resource_dir: Path
    terminal_program: str
    terminal_args: tuple[str, ...] = ()

    @property
    def styles_dir(self) -> Path:
        return self.resource_dir / "styles"

    @property
    def templates_dir(self) -> Path:
        return self.resource_dir / "templates"

    @property
    def scripts_dir(self) -> Path:
        return self.resource_dir / "scripts"


def load_settings(config_dir: Path | None = None) -> AppSettings:
    """Read settings without creating any files during normal rendering."""
    if config_dir is None:
        configured = os.environ.get(CONFIG_ENV)
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".config"))
        config_dir = Path(configured) if configured else base / "ImageCreateTool"
    config_dir = config_dir.expanduser().resolve()
    path = config_dir / "settings.json"
    try:
        values = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    except (OSError, ValueError) as exc:
        raise ProjectError("INVALID_SETTINGS", f"无法读取全局配置：{path}") from exc
    if not isinstance(values, dict):
        raise ProjectError("INVALID_SETTINGS", "全局配置必须是对象")
    resource_dir = values.get("resourceDir", "resources")
    program = values.get("terminalProgram", "pwsh" if os.name == "nt" else "x-terminal-emulator")
    args = values.get("terminalArgs", [])
    if not isinstance(resource_dir, str) or not resource_dir.strip():
        raise ProjectError("INVALID_SETTINGS", "resourceDir 必须是非空路径")
    if not isinstance(program, str) or not program.strip():
        raise ProjectError("INVALID_SETTINGS", "terminalProgram 必须是非空程序名或路径")
    if not isinstance(args, list) or any(not isinstance(arg, str) for arg in args):
        raise ProjectError("INVALID_SETTINGS", "terminalArgs 必须是字符串数组")
    resources = Path(resource_dir).expanduser()
    if not resources.is_absolute():
        resources = config_dir / resources
    return AppSettings(config_dir, resources.resolve(), program, tuple(args))


def update_settings(settings: AppSettings, values: dict) -> AppSettings:
    """Validate and persist user-selected configuration; no shell command strings."""
    current = {
        "resourceDir": str(settings.resource_dir),
        "terminalProgram": settings.terminal_program,
        "terminalArgs": list(settings.terminal_args),
    }
    if set(values) - set(current):
        raise ProjectError("INVALID_SETTINGS", "包含未知全局配置字段")
    current.update(values)
    # Reuse the same validation before touching the settings file.
    if not isinstance(current["resourceDir"], str) or not current["resourceDir"].strip():
        raise ProjectError("INVALID_SETTINGS", "resourceDir 必须是非空路径")
    if not isinstance(current["terminalProgram"], str) or not current["terminalProgram"].strip():
        raise ProjectError("INVALID_SETTINGS", "terminalProgram 必须是非空程序名或路径")
    args = current["terminalArgs"]
    if not isinstance(args, list) or any(not isinstance(arg, str) for arg in args):
        raise ProjectError("INVALID_SETTINGS", "terminalArgs 必须是字符串数组")
    resource_dir = Path(current["resourceDir"]).expanduser()
    if not resource_dir.is_absolute():
        resource_dir = settings.config_dir / resource_dir
    updated = replace(settings, resource_dir=resource_dir.resolve(),
                      terminal_program=current["terminalProgram"], terminal_args=tuple(args))
    current["resourceDir"] = str(updated.resource_dir)
    path = settings.config_dir / "settings.json"
    expected = fingerprint(path.read_bytes()) if path.exists() else None
    save_protected(path, (json.dumps(current, ensure_ascii=False, indent=2) + "\n").encode(), expected)
    return updated


def launch_terminal(settings: AppSettings, directory: Path) -> int:
    """Open the explicitly requested interactive terminal in the JSON directory."""
    if not directory.is_dir():
        raise ProjectError("DIRECTORY_NOT_FOUND", f"目录不存在：{directory}")
    arguments = [argument.replace("{cwd}", str(directory)) for argument in settings.terminal_args]
    flags = subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0
    try:
        process = subprocess.Popen([settings.terminal_program, *arguments], cwd=str(directory),
                                   shell=False, creationflags=flags)
    except OSError as exc:
        raise ProjectError("TERMINAL_FAILED", f"无法启动终端：{settings.terminal_program}：{exc}") from exc
    return process.pid
