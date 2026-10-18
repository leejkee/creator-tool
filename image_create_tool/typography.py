"""Font resolution shared by resource snapshots and the renderer."""
from pathlib import Path

from .model import ProjectError


def font_path(directory: Path, document: dict, style: dict) -> Path:
    config = document.get("fonts", {})
    explicit = style.get("font") or config.get("bold" if style.get("bold") else "regular") or config.get("regular")
    if explicit:
        if not isinstance(explicit, str):
            raise ProjectError("INVALID_FONT", "font 必须为字体文件路径")
        path = Path(explicit).expanduser()
        path = path if path.is_absolute() else directory / path
        if not path.is_file():
            raise ProjectError("FONT_NOT_FOUND", f"字体文件不存在：{path}")
        return path.resolve()
    candidates = (["C:/Windows/Fonts/msyhbd.ttc"] if style.get("bold") else []) + [
        "C:/Windows/Fonts/msyh.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.is_file():
            return path.resolve()
    raise ProjectError("FONT_NOT_FOUND", "请在 fonts.regular 或 style.font 中指定字体文件")
