"""Exercise the real Qt bridge + service + renderer without a visible test window."""
import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import json
import time
from PySide6.QtWidgets import QApplication
from image_create_tool.gui import EditorWindow


def pump(app, predicate, timeout=8):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        app.processEvents()
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("Qt event did not arrive")


def test_gui_edits_export_and_shutdown(tmp_path):
    from tests.test_application import document, write_project
    write_project(tmp_path, document())
    app = QApplication.instance() or QApplication([])
    window = EditorWindow(tmp_path)
    window.show()
    try:
        pump(app, lambda: window.state is not None and "current" in window.artifacts)
        window.select("text")
        window.text_edit.setPlainText("从 GUI 修改后的真实文本")
        window.apply_properties()
        pump(app, lambda: window.state["document"]["revision"] == 1 and not window._inflight)
        assert json.loads((tmp_path / "pjt.json").read_text("utf-8"))["modules"][0]["elements"][0]["text"] == "从 GUI 修改后的真实文本"
        out = tmp_path / "outputs" / "gui-test.png"
        future = window.service.command("request_export", output_path=str(out))
        pump(app, lambda: future.done() and out.exists())
        assert out.stat().st_size > 100
    finally:
        window.bridge.unsubscribe()
        done = window.service.command("shutdown")
        pump(app, lambda: done.done())
        window._allow_close = True
        window.close()

