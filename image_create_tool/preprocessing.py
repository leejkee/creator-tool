"""Configured local image functions, called only in the render worker."""
from __future__ import annotations

import io
import re
from pathlib import Path

from PIL import Image

from .model import ProjectError, fingerprint


def processor_specs(node: dict) -> list[dict]:
    values = node.get("processors", [])
    if "processor" in node:
        values = [node["processor"], *values] if isinstance(values, list) else values
    if not isinstance(values, list):
        raise ProjectError("INVALID_PROCESSOR", "processors 必须为数组")
    result = []
    for value in values:
        if isinstance(value, str):
            value = {"script": value + ".py", "function": value}
        if not isinstance(value, dict):
            raise ProjectError("INVALID_PROCESSOR", "处理函数需要名称或对象")
        script = value.get("script", "")
        function = value.get("function", "process")
        params = value.get("params", {})
        if not isinstance(script, str) or not re.fullmatch(r"[\w.-]+\.py", script) or Path(script).name != script:
            raise ProjectError("INVALID_PROCESSOR", "script 必须是 scripts/ 下的 Python 文件名")
        if not isinstance(function, str) or not function.isidentifier() or not isinstance(params, dict):
            raise ProjectError("INVALID_PROCESSOR", "function/params 无效")
        result.append({"script": script, "function": function, "params": params})
    return result


def processor_path(scripts_dir: Path, name: str) -> Path:
    path = (scripts_dir / name).resolve()
    if path.parent != scripts_dir.resolve():
        raise ProjectError("INVALID_PROCESSOR", "处理脚本必须位于配置的 scripts/ 目录")
    bundled = Path(__file__).with_name("resources") / "scripts" / name
    return path if path.exists() or not bundled.is_file() else bundled.resolve()


def process_image(image: Image.Image, node: dict, scripts_dir: Path, resources: list[dict]) -> Image.Image:
    """Each function receives an RGBA copy and keyword parameters; never writes source files."""
    for specification in processor_specs(node):
        path = processor_path(scripts_dir, specification["script"])
        try:
            raw = path.read_bytes()
            expected = next((item["hash"] for item in resources if item["path"] == str(path)), None)
            if expected is None or fingerprint(raw) != expected:
                raise ProjectError("RESOURCE_CHANGED", f"图片处理脚本发生变化：{path.name}")
            namespace = {"__name__": "image_create_tool_user_processor", "__file__": str(path)}
            exec(compile(raw, str(path), "exec"), namespace)
            function = namespace.get(specification["function"])
            if not callable(function):
                raise ProjectError("PROCESSOR_NOT_FOUND", f"未找到处理函数：{specification['function']}")
            result = function(image.copy(), **specification["params"])
            if isinstance(result, bytes):
                with Image.open(io.BytesIO(result)) as decoded:
                    result = decoded.convert("RGBA")
            if not isinstance(result, Image.Image) or result.width <= 0 or result.height <= 0:
                raise ProjectError("INVALID_PROCESSOR_OUTPUT", "处理函数必须返回 Pillow 图片或 PNG 字节")
            if result.width * result.height > 100_000_000:
                raise ProjectError("INVALID_PROCESSOR_OUTPUT", "处理后的图片过大")
            image = result.convert("RGBA")
        except ProjectError:
            raise
        except Exception as exc:
            raise ProjectError("PROCESSOR_FAILED", f"处理函数失败：{path.name}：{exc}") from exc
    return image
