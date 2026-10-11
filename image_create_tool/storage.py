"""Short Windows deny-write/delete handle, in-place JSON persistence."""
from __future__ import annotations

import contextlib
import os
from pathlib import Path
from .model import ProjectError, fingerprint


@contextlib.contextmanager
def protected_file(path: Path):
    if os.name == "nt":
        import ctypes
        import msvcrt
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                     ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateFileW(str(path), 0xC0000000, 1, None, 4, 0x80, None)
        if handle == ctypes.c_void_p(-1).value:
            code = ctypes.get_last_error()
            raise ProjectError("FILE_BUSY" if code in (32, 33) else "WRITE_FAILED", f"无法取得文件写入保护（Windows {code}）")
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)
        except Exception:
            kernel.CloseHandle(handle)
            raise
        stream = os.fdopen(fd, "r+b")
    else:
        # POSIX locks require external writers to cooperate; Windows is the supported desktop target.
        import fcntl
        stream = path.open("a+b")
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            stream.close()
            raise ProjectError("FILE_BUSY", "文件被其他程序占用")
    try:
        yield stream
    finally:
        stream.close()


def save_protected(path: Path, data: bytes, expected: str | None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with protected_file(path) as stream:
        stream.seek(0)
        old = stream.read()
        if (expected is None and old) or (expected is not None and fingerprint(old) != expected):
            raise ProjectError("EXTERNAL_CHANGE_STALE", "文件已有新的外部修改，请先审阅")
        stream.seek(0)
        stream.write(data)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())
    return fingerprint(data)


def save_png(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    import uuid
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

