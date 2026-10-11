"""Open the real acceptance project in Qt; screenshot without modifying its JSON."""
import os
os.environ["QT_QPA_PLATFORM"] = "offscreen"
import hashlib
import time
from pathlib import Path
from PySide6.QtWidgets import QApplication
from image_create_tool.gui import EditorWindow

root = Path(__file__).resolve().parents[1]
project = root / "tool_test"
before = hashlib.sha256((project / "pjt.json").read_bytes()).hexdigest()
app = QApplication([])
window = EditorWindow(project)
window.show()
try:
    end = time.monotonic() + 20
    while time.monotonic() < end:
        app.processEvents()
        if window.state and window.artifacts.get("current", {}).get("exportable"):
            break
        time.sleep(0.02)
    else:
        raise AssertionError("GUI did not receive acceptance preview")
    artifact = window.artifacts["current"]
    assert artifact["imageWidth"] == 1600
    assert window.tree.topLevelItemCount() == 4
    screenshot = root / "outputs" / "editor-preview.png"
    window.grab().save(str(screenshot))
    print(f"GUI preview: {artifact['imageWidth']}x{artifact['imageHeight']}; screenshot: {screenshot}")
finally:
    window.bridge.unsubscribe()
    done = window.service.command("shutdown")
    while not done.done():
        app.processEvents(); time.sleep(0.01)
    window._allow_close = True
    window.close()
assert hashlib.sha256((project / "pjt.json").read_bytes()).hexdigest() == before
