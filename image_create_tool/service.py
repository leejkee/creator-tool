"""Qt-free service actor. One service thread, one bounded render worker."""
from __future__ import annotations

import copy
import json
import queue
import shutil
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from .assets import index_assets, resolve_asset
from .model import (MARKER, ProjectError, apply_operations, empty_document, encode_document,
                    fingerprint, normalize, resolve_directory, three_way_merge, validate_document, walk)
from .storage import protected_file, save_png, save_protected


class ApplicationService:
    def __init__(self, renderer=None, poll_interval=0.3):
        self._renderer = renderer
        self._queue = queue.Queue()
        self._listeners = []
        self._listener_lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="guide-render")
        self._running = True
        self._poll_interval = poll_interval
        self.project = None
        self._session_lock = None
        self.document = empty_document()
        self.baseline = copy.deepcopy(self.document)
        self.disk_hash = None
        self.candidate = None
        self.assets = []
        self.undo_stack, self.redo_stack = [], []
        self.pending, self.artifacts, self.jobs = {}, {}, {}
        self.render_running = None
        self.dirty = False
        self.sequence = 0
        self._observed = None
        self._observed_at = 0
        self._invalid_hash = None
        self._session = uuid.uuid4().hex
        self._thread = threading.Thread(target=self._loop, name="guide-service", daemon=False)
        self._thread.start()

    def subscribe(self, callback):
        with self._listener_lock:
            self._listeners.append(callback)
        def unsubscribe():
            with self._listener_lock:
                if callback in self._listeners:
                    self._listeners.remove(callback)
        return unsubscribe

    def command(self, name, **kwargs):
        future = Future()
        if not self._running:
            future.set_exception(ProjectError("SERVICE_CLOSED", "应用服务已关闭"))
        else:
            self._queue.put((name, kwargs, future))
        return future

    def _emit(self, kind, **payload):
        self.sequence += 1
        event = {"type": kind, "sequence": self.sequence, "documentId": self.document["documentId"],
                 "revision": self.document["revision"], "payload": copy.deepcopy(payload)}
        with self._listener_lock:
            listeners = list(self._listeners)
        for listener in listeners:
            try:
                listener(event)
            except Exception:
                # A closed GUI subscriber must not break the persistence actor.
                continue

    def _loop(self):
        next_poll = time.monotonic()
        while self._running:
            try:
                name, args, future = self._queue.get(timeout=max(0.01, next_poll - time.monotonic()))
            except queue.Empty:
                name = None
            if name:
                try:
                    value = getattr(self, "_" + name)(**args)
                    if future:
                        future.set_result(value)
                except Exception as exc:
                    if future:
                        future.set_exception(exc)
                    else:
                        self._emit("service_error", error=str(exc))
            if time.monotonic() >= next_poll and self._running:
                try:
                    self._poll()
                except Exception as exc:
                    self._emit("service_error", error=str(exc))
                next_poll = time.monotonic() + self._poll_interval

    def _state(self):
        return {"document": copy.deepcopy(self.document), "project": str(self.project) if self.project else None,
                "dirty": self.dirty, "candidate": self._candidate_info(), "assetsCount": len(self.assets)}

    def _candidate_info(self):
        return None if not self.candidate else {k: copy.deepcopy(v) for k, v in self.candidate.items() if k != "document"}

    def _get_document(self):
        return self._state()

    def _release_project(self):
        if self._session_lock:
            self._session_lock.__exit__(None, None, None)
            self._session_lock = None

    def _open_project(self, path):
        project = Path(path).resolve()
        if not project.is_dir():
            raise ProjectError("PROJECT_NOT_FOUND", "请选择已有工作目录")
        if self.dirty or self.candidate:
            raise ProjectError("UNSAVED_CHANGES", "请先处理当前项目未保存修改或外部候选")
        if project == self.project:
            return self._state()
        new_lock = protected_file(project / ".image-create-tool.lock")
        try:
            new_lock.__enter__()
        except ProjectError as exc:
            raise ProjectError("PROJECT_BUSY", "该工作目录已在其他窗口中打开") from exc
        raw = b""
        try:
            raw = (project / "pjt.json").read_bytes()
            parsed = json.loads(raw.decode("utf-8-sig"))
            valid = isinstance(parsed, dict) and isinstance(parsed.get(MARKER), str)
            document = normalize(parsed) if valid else empty_document()
            issue = None if valid else "现有 pjt.json 无项目标记；初始化前请确认是否覆盖"
        except FileNotFoundError:
            document, issue = empty_document(), None
        except Exception as exc:
            document, issue = empty_document(), f"项目读取失败，原文件未修改：{exc}"
        self._release_project()
        self._session_lock = new_lock
        self.project, self.document = project, document
        self.baseline = copy.deepcopy(document)
        self.disk_hash = fingerprint(raw) if (project / "pjt.json").exists() else None
        self.candidate, self.dirty = None, False
        self.undo_stack, self.redo_stack = [], []
        self.pending.clear()
        self.artifacts.clear()
        self._session = uuid.uuid4().hex
        self._observed = None
        self._empty_requires_confirmation = bool(raw and issue)
        self._refresh_assets()
        self._emit("document_changed", state=self._state(), issue=issue)
        self._request_preview()
        return {**self._state(), "issue": issue}

    def _refresh_assets(self):
        if self.project:
            self.assets = index_assets(resolve_directory(self.project, self.document["assetsDir"]), self.document.get("assetAliases"))
        self._emit("assets_changed", count=len(self.assets))
        return copy.deepcopy(self.assets)

    def _search_assets(self, name="", category=None):
        return [copy.deepcopy(a) for a in self.assets if name in a["name"] and (not category or a["category"] == category)]

    def _import_asset(self, path):
        source = Path(path).resolve()
        root = resolve_directory(self.project, self.document["assetsDir"])
        root.mkdir(parents=True, exist_ok=True)
        target = root / source.name
        if target.exists() and target.resolve() != source:
            raise ProjectError("ASSET_EXISTS", "同名素材已存在，请先重命名新素材")
        if target.resolve() != source:
            shutil.copy2(source, target)
        self._refresh_assets()
        return next(a for a in self.assets if a["path"] == str(target))

    def _resolve_refs(self, doc):
        for node in walk(doc):
            ref = node.get("image", {}) if node.get("type") == "itemRow" else node
            if node.get("type") in {"image", "itemRow"} and ref.get("assetQuery"):
                try:
                    ref["assetId"] = resolve_asset(ref, self.assets)["assetId"]
                    ref.pop("assetQuery", None)
                except ProjectError:
                    pass

    def _version_check(self, base_revision):
        if base_revision != self.document["revision"]:
            raise ProjectError("REVISION_CONFLICT", "文档已更新，请重新读取", revision=self.document["revision"])

    def _publish(self):
        self._emit("document_changed", state=self._state())
        self._request_preview()

    def _persist(self, document, expected=None, candidate_resolution=False):
        if self.project is None:
            raise ProjectError("PROJECT_NOT_OPEN", "请先打开工作目录")
        if self._empty_requires_confirmation:
            raise ProjectError("INITIALIZE_REQUIRED", "现有文件无效，请明确初始化后保存")
        data = encode_document(document)
        expected = self.disk_hash if not candidate_resolution else expected
        self.disk_hash = save_protected(self.project / "pjt.json", data, expected)
        self.baseline = copy.deepcopy(document)
        self.dirty = False
        self._invalid_hash = None

    def _initialize(self):
        self._empty_requires_confirmation = False
        try:
            self._persist(self.document)
        except Exception:
            self.dirty = True
            raise
        self._publish()
        return self._state()

    def _apply_operations(self, base_revision, operations):
        self._version_check(base_revision)
        old = copy.deepcopy(self.document)
        updated = apply_operations(old, operations)
        updated["revision"] = old["revision"] + 1
        self._resolve_refs(updated)
        self.undo_stack.append(old)
        self.redo_stack.clear()
        self.document, self.dirty = updated, True
        if not self.candidate:
            try:
                self._persist(updated)
            except ProjectError as exc:
                if exc.code == "EXTERNAL_CHANGE_STALE":
                    self._poll(force=True)
                self._publish()
                raise
        if old["assetsDir"] != updated["assetsDir"]:
            self._refresh_assets()
        self._publish()
        return self._state()

    def _save(self):
        if self.candidate:
            raise ProjectError("EXTERNAL_CHANGE_PENDING", "请先合并或恢复外部修改")
        try:
            self._persist(self.document)
        except ProjectError as exc:
            self.dirty = True
            if exc.code == "EXTERNAL_CHANGE_STALE":
                self._poll(force=True)
            raise
        self._publish()
        return self._state()

    def _history(self, base_revision, redo=False):
        self._version_check(base_revision)
        source, dest = (self.redo_stack, self.undo_stack) if redo else (self.undo_stack, self.redo_stack)
        if not source:
            raise ProjectError("HISTORY_EMPTY", "没有可撤销/重做的操作")
        dest.append(copy.deepcopy(self.document))
        previous = source.pop()
        previous["revision"] = self.document["revision"] + 1
        self.document, self.dirty = previous, True
        if not self.candidate:
            try:
                self._persist(previous)
            except Exception:
                self._publish()
                raise
        self._refresh_assets()
        self._publish()
        return self._state()

    def _undo(self, base_revision):
        return self._history(base_revision)

    def _redo(self, base_revision):
        return self._history(base_revision, True)

    def _poll(self, force=False):
        if self.project is None:
            return
        try:
            raw = (self.project / "pjt.json").read_bytes()
        except OSError as exc:
            if self.disk_hash is not None and self._invalid_hash != "missing":
                self._invalid_hash = "missing"
                self._emit("external_change_invalid", error=f"pjt.json 无法读取：{exc}")
            return
        digest = fingerprint(raw)
        if digest == self.disk_hash:
            if self.candidate:
                self.candidate = None
                self._emit("external_change_resolved", choice="file_restored")
            return
        if self.candidate and digest == self.candidate["fingerprint"]:
            return
        if digest != self._observed:
            self._observed, self._observed_at = digest, time.monotonic()
            if not force:
                return
        if not force and time.monotonic() - self._observed_at < self._poll_interval:
            return
        try:
            parsed = json.loads(raw.decode("utf-8-sig"))
            if isinstance(parsed, dict):
                parsed.setdefault("documentId", self.document["documentId"])
            candidate = normalize(parsed)
            if candidate["documentId"] != self.document["documentId"]:
                raise ProjectError("DOCUMENT_ID_CONFLICT", "外部文件改变了 documentId")
        except Exception as exc:
            if self._invalid_hash != digest:
                self._invalid_hash = digest
                self._emit("external_change_invalid", error=str(exc))
            return
        self._invalid_hash = None
        self.candidate = {"id": uuid.uuid4().hex, "fingerprint": digest, "document": candidate}
        self._emit("external_change_pending", candidate=self._candidate_info())
        self._preview_external_change(mode="external")

    def _get_external_change(self):
        if not self.candidate:
            raise ProjectError("NO_CANDIDATE", "没有待处理外部修改")
        merged, conflicts = three_way_merge(self.baseline, self.document, self.candidate["document"])
        return {"candidate": self._candidate_info(), "base": copy.deepcopy(self.baseline),
                "local": copy.deepcopy(self.document), "external": copy.deepcopy(self.candidate["document"]),
                "merged": merged, "conflicts": conflicts}

    def _preview_external_change(self, mode="external", choices=None):
        info = self._get_external_change()
        doc = info["external"] if mode == "external" else three_way_merge(self.baseline, self.document, self.candidate["document"], choices)[0]
        return self._enqueue_render(doc, target=mode, candidate_id=self.candidate["id"])

    def _resolve_external_change(self, candidate_id, base_revision, choice, choices=None):
        self._version_check(base_revision)
        if not self.candidate or self.candidate["id"] != candidate_id:
            raise ProjectError("EXTERNAL_CHANGE_STALE", "外部候选已更新")
        expected = self.candidate["fingerprint"]
        if choice == "restore":
            doc = copy.deepcopy(self.document)
        elif choice == "merge":
            doc, conflicts = three_way_merge(self.baseline, self.document, self.candidate["document"], choices)
            if conflicts:
                raise ProjectError("MERGE_CONFLICT", "请选择各冲突字段的取值", conflicts=conflicts)
        else:
            raise ProjectError("INVALID_CHOICE", "未知外部修改处理方式")
        doc["revision"] = self.document["revision"] + 1
        validate_document(doc)
        try:
            self._persist(doc, expected, candidate_resolution=True)
        except ProjectError as exc:
            if exc.code == "EXTERNAL_CHANGE_STALE":
                self._poll(force=True)
            raise
        self.undo_stack.append(copy.deepcopy(self.document))
        self.redo_stack.clear()
        self.document, self.candidate = doc, None
        self._refresh_assets()
        self._emit("external_change_resolved", choice=choice)
        self._publish()
        return self._state()

    def _request_preview(self):
        if self.project:
            return self._enqueue_render(self.document, "current")

    def _enqueue_render(self, document, target, candidate_id=None, output=None):
        jid = uuid.uuid4().hex
        catalog = self.assets
        if document["assetsDir"] != self.document["assetsDir"]:
            catalog = index_assets(resolve_directory(self.project, document["assetsDir"]), document.get("assetAliases"))
        request = {"jobId": jid, "renderId": jid, "documentId": document["documentId"],
                   "revision": self.document["revision"], "documentSnapshot": copy.deepcopy(document),
                   "project": str(self.project), "resources": copy.deepcopy(catalog), "target": target,
                   "candidateId": candidate_id, "contentFingerprint": fingerprint(document),
                   "resourceFingerprint": fingerprint(catalog), "session": self._session, "outputPath": output}
        self.jobs[jid] = {"id": jid, "status": "queued", "target": target}
        key = jid if output else target
        if key in self.pending:
            self.jobs[self.pending[key]["jobId"]]["status"] = "superseded"
        self.pending[key] = request
        self._dispatch_render()
        return jid

    def _dispatch_render(self):
        if self.render_running or not self.pending:
            return
        key = next(iter(self.pending))
        request = self.pending.pop(key)
        self.render_running = request
        self.jobs[request["jobId"]]["status"] = "running"
        self._emit("job_changed", job=self.jobs[request["jobId"]])
        if self._renderer is None:
            from .renderer import render_document
            self._renderer = render_document
        future = self._pool.submit(self._renderer, request)
        def completed(f):
            try:
                result = f.result()
            except Exception as exc:
                result = {"ok": False, "exportable": False, "issues": [{"code": "RENDER_FAILED", "message": str(exc)}]}
            self._queue.put(("render_done", {"request": request, "result": result}, None))
        future.add_done_callback(completed)

    def _render_done(self, request, result):
        self.render_running = None
        jid = request["jobId"]
        if request["session"] != self._session:
            self.jobs[jid]["status"] = "superseded"
        elif request["outputPath"]:
            if not result.get("exportable"):
                self.jobs[jid].update(status="failed", issues=result.get("issues"))
                self._emit("job_changed", job=self.jobs[jid])
            else:
                try:
                    save_png(Path(request["outputPath"]), result["pngBytes"])
                    self.jobs[jid].update(status="succeeded", path=request["outputPath"])
                    self._emit("export_ready", path=request["outputPath"], revision=request["revision"])
                except Exception as exc:
                    self.jobs[jid].update(status="failed", issues=[{"message": str(exc)}])
                    self._emit("job_changed", job=self.jobs[jid])
        else:
            current = request["target"] == "current"
            valid = (request["revision"] == self.document["revision"] if current else
                     bool(self.candidate and request["candidateId"] == self.candidate["id"] and request["revision"] == self.document["revision"]))
            if valid:
                self.jobs[jid]["status"] = "succeeded" if result.get("ok") else "failed"
                self.artifacts[jid] = copy.deepcopy(result)
                # Keep a bounded number of full-resolution images.
                while len(self.artifacts) > 4:
                    self.artifacts.pop(next(iter(self.artifacts)))
                self._emit("preview_ready", renderId=jid, target=request["target"], artifact=result)
            else:
                self.jobs[jid]["status"] = "superseded"
        self._dispatch_render()

    def _get_job(self, job_id):
        return copy.deepcopy(self.jobs[job_id])

    def _get_preview(self, render_id):
        if render_id not in self.artifacts:
            raise ProjectError("ARTIFACT_EXPIRED", "预览缓存已失效")
        return copy.deepcopy(self.artifacts[render_id])

    def _request_export(self, output_path=None):
        if sum(1 for job in self.jobs.values() if job["target"] == "export" and job["status"] in {"queued", "running"}) >= 4:
            raise ProjectError("JOB_QUEUE_FULL", "导出队列已满，请等待现有任务完成")
        if self.candidate:
            raise ProjectError("EXTERNAL_CHANGE_PENDING", "导出前请先合并或恢复外部修改")
        if self.dirty:
            self._save()
        root = resolve_directory(self.project, self.document["outputsDir"])
        path = Path(output_path).resolve() if output_path else root / "guide.png"
        return self._enqueue_render(self.document, "export", output=str(path))

    def _discard_pending(self):
        self.dirty, self.candidate = False, None

    def _shutdown(self):
        self.pending.clear()
        self._pool.shutdown(wait=True, cancel_futures=True)
        self._release_project()
        self._running = False
        return True

