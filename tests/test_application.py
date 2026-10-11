import copy
import io
import json
import os
import subprocess
import sys
import threading
import time

import pytest
from PIL import Image

from image_create_tool.model import (ProjectError, empty_document, encode_document, fingerprint,
                                     three_way_merge, validate_document)
from image_create_tool.service import ApplicationService
from image_create_tool.storage import protected_file, save_protected
from image_create_tool.renderer import render_document


def document():
    doc = empty_document()
    doc["modules"] = [{"id": "module", "title": "原文标题", "elements": [
        {"id": "text", "type": "text", "text": "用户原文：不要主动改变创作决策。", "style": {"fontSize": 28}}]}]
    return doc


def write_project(path, doc):
    (path / "pjt.json").write_bytes(encode_document(doc))


def wait_for(fn, timeout=6):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.03)
    raise AssertionError("Timed out")


@pytest.fixture
def service(tmp_path):
    write_project(tmp_path, document())
    instance = ApplicationService(poll_interval=0.04)
    instance.command("open_project", path=str(tmp_path)).result(5)
    yield instance
    instance.command("shutdown").result(10)


def test_edit_persists_and_undo_is_new_revision(service, tmp_path):
    rev = service.command("get_document").result()["document"]["revision"]
    state = service.command("apply_operations", base_revision=rev, operations=[
        {"type": "set_text", "elementId": "text", "text": "用户明确改写"}]).result(5)
    assert state["document"]["revision"] == rev + 1
    assert json.loads((tmp_path / "pjt.json").read_text("utf-8"))["modules"][0]["elements"][0]["text"] == "用户明确改写"
    restored = service.command("undo", base_revision=rev + 1).result(5)
    assert restored["document"]["revision"] == rev + 2
    assert "用户原文" in restored["document"]["modules"][0]["elements"][0]["text"]
    assert len(list(tmp_path.glob("*.json"))) == 1


def test_stale_gui_edit_rejected(service):
    with pytest.raises(ProjectError, match="文档已更新"):
        service.command("apply_operations", base_revision=-1, operations=[]).result(5)


def test_external_candidate_does_not_replace_current_and_restore(service, tmp_path):
    current = service.command("get_document").result()["document"]
    external = copy.deepcopy(current)
    external["modules"][0]["elements"][0]["text"] = "Agent 外部修改"
    write_project(tmp_path, external)
    state = wait_for(lambda: (s if s["candidate"] else None) if (s := service.command("get_document").result()) else None)
    assert state["document"]["modules"][0]["elements"][0]["text"] != "Agent 外部修改"
    resolved = service.command("resolve_external_change", candidate_id=state["candidate"]["id"],
                               base_revision=state["document"]["revision"], choice="restore").result(5)
    assert resolved["candidate"] is None
    assert json.loads((tmp_path / "pjt.json").read_text("utf-8"))["modules"][0]["elements"][0]["text"] == current["modules"][0]["elements"][0]["text"]


def test_external_candidate_pauses_save_and_merge_preserves_local(service, tmp_path):
    external = service.command("get_document").result()["document"]
    external["modules"][0]["title"] = "外部标题"
    write_project(tmp_path, external)
    state = wait_for(lambda: (s if s["candidate"] else None) if (s := service.command("get_document").result()) else None)
    edited = service.command("apply_operations", base_revision=state["document"]["revision"], operations=[
        {"type": "set_text", "elementId": "text", "text": "GUI 的新文案"}]).result(5)
    assert edited["dirty"]
    assert json.loads((tmp_path / "pjt.json").read_text("utf-8"))["modules"][0]["elements"][0]["text"] != "GUI 的新文案"
    merged = service.command("resolve_external_change", candidate_id=state["candidate"]["id"],
                             base_revision=edited["document"]["revision"], choice="merge").result(5)
    assert merged["document"]["modules"][0]["title"] == "外部标题"
    assert merged["document"]["modules"][0]["elements"][0]["text"] == "GUI 的新文案"


def test_bad_external_json_keeps_current(service, tmp_path):
    before = service.command("get_document").result()["document"]
    (tmp_path / "pjt.json").write_text('{"incomplete":', encoding="utf-8")
    time.sleep(0.25)
    after = service.command("get_document").result()["document"]
    assert after == before
    assert (tmp_path / "pjt.json").read_text("utf-8") == '{"incomplete":'


def test_merge_conflict_requires_explicit_choice():
    base = document(); local = copy.deepcopy(base); external = copy.deepcopy(base)
    local["modules"][0]["elements"][0]["text"] = "local"
    external["modules"][0]["elements"][0]["text"] = "external"
    merged, conflicts = three_way_merge(base, local, external)
    assert len(conflicts) == 1
    resolved, remaining = three_way_merge(base, local, external, {conflicts[0]["path"]: "external"})
    assert not remaining
    assert resolved["modules"][0]["elements"][0]["text"] == "external"


def test_protected_write_checks_hash_before_truncation(tmp_path):
    path = tmp_path / "pjt.json"
    path.write_bytes(b"original")
    with pytest.raises(ProjectError):
        save_protected(path, b"replacement", fingerprint(b"stale"))
    assert path.read_bytes() == b"original"


@pytest.mark.skipif(os.name != "nt", reason="Windows deny-write/delete guarantee")
def test_windows_protection_blocks_external_writer_then_releases(tmp_path):
    path = tmp_path / "pjt.json"
    path.write_bytes(b"original")
    code = "from pathlib import Path; import sys; Path(sys.argv[1]).write_text('external')"
    with protected_file(path):
        attempt = subprocess.run([sys.executable, "-c", code, str(path)], capture_output=True)
        assert attempt.returncode != 0
    attempt = subprocess.run([sys.executable, "-c", code, str(path)], capture_output=True)
    assert attempt.returncode == 0


def test_render_wraps_preserves_original_and_blocks_missing_asset(tmp_path):
    doc = document()
    original = copy.deepcopy(doc)
    doc["composition"]["width"] = 500
    result = render_document({"project": str(tmp_path), "documentSnapshot": doc, "resources": []})
    assert result["exportable"]
    image = Image.open(io.BytesIO(result["pngBytes"]))
    assert image.size == (500, result["imageHeight"])
    line = next(e for e in result["layout"]["elements"] if e["elementId"] == "text")
    assert "".join(line["lines"]) == original["modules"][0]["elements"][0]["text"]
    doc["modules"][0]["elements"].append({"id": "missing", "type": "image", "assetQuery": {"name": "不存在"}})
    bad = render_document({"project": str(tmp_path), "documentSnapshot": doc, "resources": []})
    assert bad["ok"] and not bad["exportable"]
    assert any(i["code"] == "ASSET_NOT_FOUND" for i in bad["issues"])


def test_canvas_overflow_blocks_export(tmp_path):
    doc = document(); doc["composition"]["height"] = 100
    result = render_document({"project": str(tmp_path), "documentSnapshot": doc, "resources": []})
    assert not result["exportable"]
    assert any(i["code"] == "CONTENT_OVERFLOW" for i in result["issues"])


def test_stale_render_does_not_publish(tmp_path):
    write_project(tmp_path, document())
    started, release = threading.Event(), threading.Event()
    events = []
    def slow(request):
        if request["revision"] == 0:
            started.set(); release.wait(5)
        return {**{k: request[k] for k in ("revision", "target")}, "ok": True, "pngBytes": b"test", "exportable": True, "issues": []}
    service = ApplicationService(renderer=slow)
    service.subscribe(events.append)
    try:
        service.command("open_project", path=str(tmp_path)).result(5)
        assert started.wait(2)
        service.command("apply_operations", base_revision=0, operations=[{"type": "set_text", "elementId": "text", "text": "new"}]).result(5)
        release.set()
        wait_for(lambda: any(e["type"] == "preview_ready" for e in events))
        previews = [e for e in events if e["type"] == "preview_ready"]
        assert all(e["payload"]["artifact"]["revision"] == 1 for e in previews)
    finally:
        release.set(); service.command("shutdown").result(10)


def test_item_row_child_offsets_and_text_are_independent(tmp_path):
    from image_create_tool.model import apply_operations
    doc = document()
    doc["modules"][0]["elements"] = [{"id": "row", "type": "itemRow", "text": "原文", "image": {}}]
    changed = apply_operations(doc, [
        {"type": "set_text", "elementId": "row:text", "text": "新文案"},
        {"type": "move_element", "elementId": "row:text", "values": {"offsetX": 8, "offsetY": 4}},
        {"type": "set_style", "elementId": "row:text", "values": {"fontSize": 36}},
    ])
    assert changed["modules"][0]["elements"][0]["text"] == "新文案"
    assert "offsetX" not in changed["modules"][0]["elements"][0]
    result = render_document({"project": str(tmp_path), "documentSnapshot": changed, "resources": []})
    bounds = {n["elementId"]: n for n in result["layout"]["elements"]}
    assert bounds["row:text"]["text"] == "新文案"
    assert bounds["row:text"]["x"] > bounds["row:image"]["x"]


def test_minimal_project_external_edit_without_id(tmp_path):
    minimal = {"image-create-tool-version": "v0.0.1", "assetsDir": "assets/", "outputsDir": "outputs/"}
    write_project(tmp_path, minimal)
    service = ApplicationService(poll_interval=0.03)
    try:
        state = service.command("open_project", path=str(tmp_path)).result(5)
        minimal["outputsDir"] = "other-outputs/"
        write_project(tmp_path, minimal)
        changed = wait_for(lambda: (s if s["candidate"] else None) if (s := service.command("get_document").result()) else None)
        accepted = service.command("resolve_external_change", candidate_id=changed["candidate"]["id"],
                                   base_revision=changed["document"]["revision"], choice="merge").result(5)
        assert accepted["document"]["outputsDir"] == "other-outputs/"
    finally:
        service.command("shutdown").result(10)


def test_project_config_persists_custom_directories(service, tmp_path):
    outside = str(tmp_path.parent / "shared-assets")
    state = service.command("get_document").result()
    updated = service.command("apply_operations", base_revision=state["document"]["revision"], operations=[
        {"type": "set_project_config", "values": {"assetsDir": outside, "outputsDir": "custom-output"}}]).result(5)
    assert updated["document"]["assetsDir"] == outside
    assert json.loads((tmp_path / "pjt.json").read_text("utf-8"))["outputsDir"] == "custom-output"


def test_missing_font_and_invalid_crop_block_export(tmp_path):
    doc = document(); doc["fonts"] = {"regular": "missing-font.ttf"}
    request = {"project": str(tmp_path), "documentSnapshot": doc, "resources": []}
    result = render_document(request)
    assert not result["ok"] and result["issues"][0]["code"] == "FONT_NOT_FOUND"
    doc.pop("fonts")
    asset = tmp_path / "card.png"; Image.new("RGB", (30, 20), "red").save(asset)
    from image_create_tool.assets import index_assets
    doc["modules"][0]["elements"] = [{"id": "card", "type": "image", "assetId": "card.png",
                                      "crop": {"x": 10, "y": 0, "width": 30, "height": 20}}]
    result = render_document({**request, "resources": index_assets(tmp_path)})
    assert not result["exportable"]
    assert any(i["code"] == "INVALID_CROP" for i in result["issues"])

