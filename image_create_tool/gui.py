"""PySide6 UI. Qt objects are only touched on the application's main thread."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from PySide6.QtCore import QObject, Qt, Signal, QTimer
from PySide6.QtGui import QAction, QColor, QPen, QPixmap, QFont, QFontDatabase
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QSplitter, QVBoxLayout, QHBoxLayout,
    QFormLayout, QPushButton, QLabel, QTreeWidget, QTreeWidgetItem, QGraphicsView,
    QGraphicsScene, QGraphicsRectItem, QLineEdit, QPlainTextEdit, QSpinBox,
    QComboBox, QFileDialog, QMessageBox, QDialog, QDialogButtonBox, QInputDialog,
    QTableWidget, QTableWidgetItem, QListWidget, QListWidgetItem, QCheckBox,
    QAbstractItemView, QDoubleSpinBox, QScrollArea,
)

from .model import find_element, ProjectError
from .service import ApplicationService
from .styles import effective_style
from .storage import default_png_path


class ServiceBridge(QObject):
    event = Signal(object)
    completed = Signal(object, object)

    def __init__(self, service):
        super().__init__()
        self.unsubscribe = service.subscribe(self.event.emit)


class HitBox(QGraphicsRectItem):
    def __init__(self, bounds, window):
        super().__init__(0, 0, bounds["width"], bounds["height"])
        self.bounds, self.window = bounds, window
        self.setPos(bounds["x"], bounds["y"])
        self.setPen(QPen(Qt.PenStyle.NoPen))
        self.setBrush(Qt.BrushStyle.NoBrush)
        self.setAcceptedMouseButtons(Qt.MouseButton.LeftButton)
        self.setToolTip(bounds["elementId"])
        self.start = None

    def mousePressEvent(self, event):
        self.start = event.scenePos()
        self.window.select(self.bounds["elementId"])
        event.accept()

    def mouseMoveEvent(self, event):
        if self.start and not self.bounds.get("locked"):
            delta = event.scenePos() - self.start
            self.setPos(self.bounds["x"] + delta.x(), self.bounds["y"] + delta.y())
        event.accept()

    def mouseReleaseEvent(self, event):
        if self.start:
            delta = event.scenePos() - self.start
            if abs(delta.x()) + abs(delta.y()) > 2:
                self.window.move_selected(delta.x(), delta.y())
            self.setPos(self.bounds["x"], self.bounds["y"])
        self.start = None
        event.accept()


class Canvas(QGraphicsView):
    def __init__(self, window):
        self.scene = QGraphicsScene()
        super().__init__(self.scene)
        self.window, self.boxes = window, {}
        self.setBackgroundBrush(QColor("#303440"))
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)

    def show_artifact(self, artifact, editable=True):
        if not artifact.get("pngBytes"):
            return
        self.scene.clear()
        self.boxes.clear()
        if not artifact.get("pngBytes"):
            return
        pixmap = QPixmap()
        pixmap.loadFromData(artifact["pngBytes"], "PNG")
        self.scene.addPixmap(pixmap)
        self.scene.setSceneRect(0, 0, pixmap.width(), pixmap.height())
        if editable:
            for index, bounds in enumerate(artifact["layout"].get("elements", [])):
                box = HitBox(bounds, self.window)
                box.setZValue(10 + index)
                self.scene.addItem(box)
                self.boxes[bounds["elementId"]] = box
        self.highlight(self.window.selected)

    def highlight(self, selected):
        for key, box in self.boxes.items():
            pen = QPen(QColor("#4BC9FF"), 2) if key == selected else QPen(Qt.PenStyle.NoPen)
            pen.setCosmetic(True)
            box.setPen(pen)

    def fit(self):
        if not self.scene.sceneRect().isEmpty():
            self.fitInView(self.scene.sceneRect(), Qt.AspectRatioMode.KeepAspectRatio)

    def wheelEvent(self, event):
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self.scale(1.15 if event.angleDelta().y() > 0 else 1 / 1.15, 1.15 if event.angleDelta().y() > 0 else 1 / 1.15)
            event.accept()
        else:
            super().wheelEvent(event)


class EditorWindow(QMainWindow):
    def __init__(self, file_path=None, service=None, settings=None):
        super().__init__()
        # Qt's offscreen backend may not discover the Windows CJK fallback fonts.
        # Register the same installed Chinese font explicitly for UI labels.
        installed = Path("C:/Windows/Fonts/msyh.ttc")
        if installed.is_file():
            font_id = QFontDatabase.addApplicationFont(str(installed))
            families = QFontDatabase.applicationFontFamilies(font_id)
            if families:
                QApplication.instance().setFont(QFont(families[0], 10))
        self.setWindowTitle("图片 JSON 编辑器 · v0.1.0")
        self.resize(1450, 950)
        self.service = service or ApplicationService(settings=settings)
        self.bridge = ServiceBridge(self.service)
        self.bridge.event.connect(self.on_event, Qt.ConnectionType.QueuedConnection)
        self.bridge.completed.connect(self.on_completed, Qt.ConnectionType.QueuedConnection)
        self.state, self.selected, self.artifacts = None, None, {}
        self._closing, self._allow_close, self._loading = False, False, False
        self._editing = False
        self._fit_once = True
        self._queued_ops = []
        self._inflight = False
        self._after_flush = None
        self.text_timer = QTimer(self)
        self.text_timer.setSingleShot(True)
        self.text_timer.setInterval(400)
        self.text_timer.timeout.connect(self.apply_properties)
        self.build_ui()
        if file_path:
            self.call("open_file", path=str(file_path), callback=self.set_state)

    def call(self, method, callback=None, **kwargs):
        future = self.service.command(method, **kwargs)
        future.add_done_callback(lambda f: self.bridge.completed.emit(f, callback))
        return future

    def on_completed(self, future, callback):
        if self._allow_close:
            return
        try:
            value = future.result()  # Future is already completed; never blocks GUI.
            if callback:
                callback(value)
        except Exception as exc:
            self._inflight = False
            self._after_flush = None
            self.status.setText("修改未保存：" + str(exc))
            self.issues.setPlainText(str(exc))

    def build_ui(self):
        toolbar = self.addToolBar("图片文件")
        for title, handler in [("打开 JSON", self.open_file), ("新建 JSON", self.new_file),
                               ("另存 JSON", self.save_as), ("图片设置", self.image_settings),
                               ("应用设置", self.app_settings), ("打开终端", lambda: self.call("open_terminal")),
                               ("保存/重试", self.save), ("撤销", lambda: self.history(False)),
                               ("重做", lambda: self.history(True)), ("刷新素材", self.refresh_assets),
                               ("适应画布", lambda: self.canvas.fit()), ("导出 PNG", self.export)]:
            action = QAction(title, self)
            action.triggered.connect(handler)
            toolbar.addAction(action)
        self.status = QLabel("打开或新建一份图片 JSON 开始")
        self.statusBar().addWidget(self.status, 1)
        root = QWidget()
        root_layout = QVBoxLayout(root)
        external = QHBoxLayout()
        self.external_label = QLabel("")
        self.preview_mode = QComboBox()
        self.preview_mode.addItems(["当前内容", "外部候选", "合并预览"])
        self.preview_mode.currentIndexChanged.connect(self.switch_preview)
        external.addWidget(self.external_label, 1)
        external.addWidget(self.preview_mode)
        for title, handler in [("审阅并合并", self.merge), ("恢复当前内容", self.restore)]:
            button = QPushButton(title)
            button.clicked.connect(handler)
            external.addWidget(button)
        root_layout.addLayout(external)
        splitter = QSplitter()
        left = QWidget()
        left_layout = QVBoxLayout(left)
        self.tree = QTreeWidget()
        self.tree.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.tree.setHeaderLabel("模块与元素")
        self.tree.itemSelectionChanged.connect(self.tree_selected)
        left_layout.addWidget(self.tree)
        for titles in [[("添加模块", self.add_module), ("添加元素", self.add_element)],
                       [("复制", lambda: self.copy_delete(False)), ("删除", lambda: self.copy_delete(True))],
                       [("模块上移", lambda: self.reorder(-1)), ("模块下移", lambda: self.reorder(1))]]:
            row = QHBoxLayout()
            for title, handler in titles:
                button = QPushButton(title)
                button.clicked.connect(handler)
                row.addWidget(button)
            left_layout.addLayout(row)
        splitter.addWidget(left)
        self.canvas = Canvas(self)
        splitter.addWidget(self.canvas)
        right = QWidget()
        right_layout = QVBoxLayout(right)
        self.selection_label = QLabel("请选择元素")
        right_layout.addWidget(self.selection_label)
        self.text_edit = QPlainTextEdit()
        self.text_edit.setPlaceholderText("文案或模块标题")
        self.text_edit.setMaximumHeight(180)
        self.text_edit.textChanged.connect(self.schedule_text)
        right_layout.addWidget(self.text_edit)
        form = QFormLayout()
        self.size = QSpinBox(); self.size.setRange(1, 512)
        self.color = QLineEdit("#F2F0FA")
        self.bold = QCheckBox("加粗")
        self.visible = QCheckBox("可见"); self.visible.setChecked(True)
        self.locked = QCheckBox("锁定位置")
        self.fields = {}
        form.addRow("字号", self.size)
        form.addRow("文字/形状颜色", self.color)
        form.addRow("字重", self.bold)
        form.addRow("可见性", self.visible)
        form.addRow("锁定", self.locked)
        for key, label in [("width", "宽度（0=自动）"), ("height", "高度（0=自动）"),
                           ("offsetX", "横向偏移"), ("offsetY", "纵向偏移"), ("zIndex", "层级")]:
            spin = QSpinBox(); spin.setRange(-40000 if "offset" in key else 0, 40000)
            self.fields[key] = spin
            form.addRow(label, spin)
        self.fit_mode = QComboBox(); self.fit_mode.addItems(["contain", "cover", "stretch", "height", "width"])
        form.addRow("图片填充", self.fit_mode)
        self.content_scale = QDoubleSpinBox()
        self.content_scale.setRange(0.01, 100)
        self.content_scale.setValue(1)
        self.content_scale.setSingleStep(0.1)
        form.addRow("图片内部缩放", self.content_scale)
        right_layout.addLayout(form)
        for title, handler in [("应用属性", self.apply_properties), ("替换/选择素材", self.choose_asset),
                               ("精确裁剪", self.crop), ("模块布局", self.layout_settings),
                               ("画布设置", self.composition_settings), ("样式参数", self.style_settings),
                               ("批量应用 Style", self.apply_saved_style), ("保存为新 Style", self.save_style),
                               ("从模板添加模块", self.add_template), ("保存为新模板", self.save_template),
                               ("导出所选模块", self.export_element)]:
            button = QPushButton(title); button.clicked.connect(handler); right_layout.addWidget(button)
        self.issues = QPlainTextEdit(); self.issues.setReadOnly(True); self.issues.setPlaceholderText("问题与任务状态")
        right_layout.addWidget(self.issues, 1)
        properties_scroll = QScrollArea()
        properties_scroll.setWidgetResizable(True)
        properties_scroll.setWidget(right)
        splitter.addWidget(properties_scroll)
        splitter.setSizes([260, 850, 340])
        root_layout.addWidget(splitter, 1)
        self.setCentralWidget(root)
        self.size.valueChanged.connect(self.schedule_text)
        self.color.textChanged.connect(self.schedule_text)
        self.bold.toggled.connect(self.schedule_text)
        self.visible.toggled.connect(self.schedule_text)
        self.locked.toggled.connect(self.schedule_text)
        self.fit_mode.currentIndexChanged.connect(self.schedule_text)
        self.content_scale.valueChanged.connect(self.schedule_text)
        for spin in self.fields.values():
            spin.valueChanged.connect(self.schedule_text)

    def set_state(self, state):
        self.state = state
        doc = state["document"]
        self.setWindowTitle(f"{doc['title']} · 图片 JSON 编辑器 · {state['filePath']}")
        self.status.setText(f"版本 {doc['revision']} · " + ("外部修改待处理，尚未写回" if state.get("candidate") else "未保存" if state["dirty"] else "已保存"))
        self.external_label.setText("检测到外部修改，请比较并选择合并或恢复" if state.get("candidate") else "")
        self._loading = True
        selected_ids = set(self.selected_ids())
        self.tree.clear()
        def add(parent, node):
            item = QTreeWidgetItem([node.get("name") or node.get("title") or node.get("text", "")[:24] or node["id"]])
            item.setData(0, Qt.ItemDataRole.UserRole, node["id"])
            parent.addChild(item) if parent else self.tree.addTopLevelItem(item)
            item.setSelected(node["id"] in selected_ids)
            if node.get("type") == "itemRow":
                for suffix, label in [(":text", "文字"), (":image", "图片")]:
                    child = QTreeWidgetItem([label]); child.setData(0, Qt.ItemDataRole.UserRole, node["id"] + suffix); item.addChild(child)
            for child in node.get("elements", []):
                add(item, child)
        modules = {m["id"]: m for m in doc["modules"]}
        for mid in doc["composition"].get("moduleOrder", list(modules)):
            add(None, modules[mid])
        self.tree.expandAll()
        self._loading = False
        if not self._editing and self.selected:
            self.select(self.selected)
        if state.get("issue"):
            self.issues.setPlainText(state["issue"])

    def on_event(self, event):
        if self._closing:
            return
        kind, payload = event["type"], event["payload"]
        if kind == "document_changed":
            self.set_state(payload["state"])
            if payload.get("issue"):
                self.issues.setPlainText(payload["issue"])
        elif kind == "preview_ready":
            artifact = payload["artifact"]
            self.artifacts[payload["target"]] = artifact
            current_mode = ["current", "external", "merged"][self.preview_mode.currentIndex()]
            if payload["target"] == current_mode:
                self.display_artifact(artifact, current_mode)
        elif kind == "external_change_pending":
            self.call("get_document", callback=self.set_state)
        elif kind == "external_change_resolved":
            self.artifacts.pop("external", None)
            self.artifacts.pop("merged", None)
            self.preview_mode.setCurrentIndex(0)
            self.call("get_document", callback=self.set_state)
        elif kind in {"service_error", "external_change_invalid"}:
            self.issues.setPlainText(payload.get("error", "文件变化无法解析"))
            self.external_label.setText("外部文件无效，当前内容保留；请修正文件")
        elif kind == "export_ready":
            self.status.setText(f"已导出版本 {payload['revision']}：{payload['path']}")
            self.issues.setPlainText("导出成功：" + payload["path"])
        elif kind == "job_changed":
            job = payload["job"]
            if job["status"] == "running":
                self.status.setText("正在渲染…")
            elif job["status"] == "failed":
                self.issues.setPlainText(json.dumps(job.get("issues"), ensure_ascii=False, indent=2))

    def display_artifact(self, artifact, target):
        if target == "current" and self.state and artifact.get("revision") != self.state["document"]["revision"]:
            return
        self.canvas.show_artifact(artifact, editable=target == "current")
        self.issues.setPlainText("\n".join(f"{i.get('code','')}：{i['message']} {i.get('elementId') or ''}" for i in artifact.get("issues", [])))
        if artifact.get("ok") and self._fit_once:
            self.canvas.fit(); self._fit_once = False
        if self.state:
            self.status.setText(f"预览版本 {artifact.get('revision')} · " + ("尚未保存" if self.state["dirty"] else "已保存"))

    def switch_preview(self, index):
        target = ["current", "external", "merged"][index]
        if target in self.artifacts:
            self.display_artifact(self.artifacts[target], target)
        elif target != "current" and self.state and self.state.get("candidate"):
            self.call("preview_external_change", mode=target)

    def open_file(self):
        if self.state and (self.state["dirty"] or self.state.get("candidate") or self._editing):
            QMessageBox.information(self, "先保存", "请先保存或处理外部修改，再切换文件。")
            return
        path, _ = QFileDialog.getOpenFileName(self, "打开图片 JSON", "", "JSON (*.json)")
        if path:
            self.call("open_file", path=path, callback=self.reset_file)

    def new_file(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "新建图片 JSON", "image.json", "JSON (*.json)")
        if path:
            self.flush(lambda: self.call("new_file", path=path, callback=self.reset_file))

    def reset_file(self, state: dict) -> None:
        self.artifacts.clear()
        self.canvas.scene.clear()
        self.canvas.boxes.clear()
        self.selected = None
        self._fit_once = True
        self.set_state(state)

    def save_as(self) -> None:
        if self.state:
            path, _ = QFileDialog.getSaveFileName(self, "另存图片 JSON", self.state["filePath"], "JSON (*.json)")
            if path:
                self.flush(lambda: self.call("save_as", path=path, callback=self.reset_file))

    def tree_selected(self):
        if not self._loading:
            items = self.tree.selectedItems()
            if items:
                self.select(items[0].data(0, Qt.ItemDataRole.UserRole))

    def select(self, element_id):
        if not self.state:
            return
        if self._editing and element_id != self.selected:
            self.apply_properties()
        try:
            node = find_element(self.state["document"], element_id)
        except ProjectError:
            self.selected = None
            return
        self.selected = element_id
        self._loading = True
        self.text_timer.stop()
        self.text_edit.setPlainText(node.get("text", node.get("title", "")))
        self.selection_label.setText(element_id)
        style = effective_style(node)
        if "elements" in node and "type" not in node:
            style = {"fontSize": 36, "bold": True, "color": "#C2A0FF", **node.get("titleStyle", {})}
        self.size.setValue(int(style.get("fontSize", 28)))
        self.color.setText(style.get("color", "#F2F0FA"))
        self.bold.setChecked(bool(style.get("bold", False)))
        self.visible.setChecked(node.get("visible", True))
        self.locked.setChecked(node.get("locked", False))
        for key, spin in self.fields.items():
            value = node.get(key, 0)
            spin.setValue(int(value) if isinstance(value, (int, float)) else 0)
        self.fit_mode.setCurrentText(node.get("fit", "contain"))
        self.content_scale.setValue(node.get("contentScale", 1))
        is_text = node.get("type") == "text"
        for widget in (self.text_edit, self.size, self.bold):
            widget.setEnabled(is_text)
        self.color.setEnabled(is_text or node.get("type") == "rect")
        self.fit_mode.setEnabled(node.get("type") == "image")
        self.content_scale.setEnabled(node.get("type") == "image")
        self._loading, self._editing = False, False
        self.canvas.highlight(element_id)

    def schedule_text(self, *_):
        if not self._loading and self.selected:
            self._editing = True
            self.text_timer.start()

    def submit_ops(self, operations, after=None):
        if not self.state:
            return
        self._queued_ops.append((operations, after))
        self.pump_ops()

    def pump_ops(self):
        if self._inflight or not self._queued_ops:
            return
        operations, after = self._queued_ops.pop(0)
        self._inflight = True
        def accepted(state):
            self._inflight = False
            self.set_state(state)
            self.pump_ops()
            if after:
                after()
            if not self._inflight and not self._queued_ops and self._after_flush:
                callback, self._after_flush = self._after_flush, None
                callback()
        self.call("apply_operations", base_revision=self.state["document"]["revision"], operations=operations, callback=accepted)

    def apply_properties(self):
        self.text_timer.stop()
        if not self.selected or not self.state or self._loading:
            return
        node = find_element(self.state["document"], self.selected)
        ops = []
        value = self.text_edit.toPlainText()
        if "elements" in node and "type" not in node:
            if value != node.get("title", ""):
                ops.append({"type": "set_properties", "elementId": self.selected, "values": {"title": value}})
        elif node.get("type") in {"text", "itemRow"}:
            if value != node.get("text", ""):
                ops.append({"type": "set_text", "elementId": self.selected, "text": value})
        color = QColor(self.color.text())
        if not color.isValid():
            self.issues.setPlainText("颜色无效，请使用 #RRGGBB")
            return
        style = {"fontSize": self.size.value(), "color": self.color.text(), "bold": self.bold.isChecked()}
        is_module = "elements" in node and "type" not in node
        previous_style = {"fontSize": 36, "bold": True, "color": "#C2A0FF", **node.get("titleStyle", {})} if is_module else {"fontSize": 28, "color": "#F2F0FA", "bold": False, **node.get("style", {})}
        if any(previous_style.get(k) != v for k, v in style.items()):
            ops.append({"type": "set_title_style" if is_module else "set_style", "elementId": self.selected, "values": style})
        values = {k: (None if k in {"width", "height"} and spin.value() == 0 else spin.value())
                  for k, spin in self.fields.items() if spin.value() != node.get(k, 0)}
        if self.visible.isChecked() != node.get("visible", True):
            values["visible"] = self.visible.isChecked()
        if self.locked.isChecked() != node.get("locked", False):
            values["locked"] = self.locked.isChecked()
        if self.fit_mode.currentText() != node.get("fit", "contain"):
            values["fit"] = self.fit_mode.currentText()
        if self.content_scale.value() != node.get("contentScale", 1):
            values["contentScale"] = self.content_scale.value()
        if values:
            ops.append({"type": "set_properties", "elementId": self.selected, "values": values})
        self._editing = False
        if ops:
            self.submit_ops(ops)

    def move_selected(self, dx, dy):
        if not self.state or not self.selected or self.preview_mode.currentIndex() != 0:
            return
        artifact = self.artifacts.get("current")
        if not artifact or artifact.get("revision") != self.state["document"]["revision"]:
            self.issues.setPlainText("预览更新中，请稍后拖动")
            return
        node = find_element(self.state["document"], self.selected)
        if node.get("locked"):
            return
        self.submit_ops([{"type": "move_element", "elementId": self.selected,
                          "values": {"offsetX": node.get("offsetX", 0) + round(dx), "offsetY": node.get("offsetY", 0) + round(dy)}}])

    def add_module(self):
        name, ok = QInputDialog.getText(self, "添加模块", "模块标题")
        if ok:
            identity = "module_" + uuid.uuid4().hex[:8]
            elements = [{"id": identity + ":title", "type": "text", "text": name,
                         "style": {"fontSize": 36, "bold": True}}] if name else []
            self.submit_ops([{"type": "add_module", "module": {"id": identity, "type": "group", "name": name,
                            "layout": {"type": "column", "gap": 16}, "elements": elements}}])

    def parent_id(self):
        if not self.state or not self.state["document"]["modules"]:
            raise ProjectError("NO_MODULE", "请先添加模块")
        if self.selected:
            selected_node = find_element(self.state["document"], self.selected)
            if selected_node.get("type", "group") == "group":
                return self.selected
            for module in self.state["document"]["modules"]:
                def contains(n):
                    return self.selected.startswith(n["id"] + ":") or self.selected == n["id"] or any(contains(c) for c in n.get("elements", []))
                if contains(module):
                    return module["id"]
        return self.state["document"]["modules"][0]["id"]

    def add_element(self):
        kind, ok = QInputDialog.getItem(self, "添加元素", "类型", ["text", "image", "rect", "group"], editable=False)
        if not ok:
            return
        try:
            parent = self.parent_id()
        except ProjectError as exc:
            self.issues.setPlainText(str(exc)); return
        element = {"id": "element_" + uuid.uuid4().hex[:8], "type": kind}
        if kind in {"text", "itemRow"}:
            element["text"] = "在右侧输入内容"
        if kind == "group":
            element.update(elements=[], layout={"type": "row", "gap": 16})
        if kind == "itemRow":
            element["image"] = {}
        self.submit_ops([{"type": "add_element", "parentId": parent, "element": element}])

    def copy_delete(self, delete):
        if self.selected:
            self.submit_ops([{"type": "delete_element" if delete else "duplicate_element", "elementId": self.selected}])

    def reorder(self, delta):
        if not self.state:
            return
        mid = self.parent_id()
        order = list(self.state["document"]["composition"].get("moduleOrder", [m["id"] for m in self.state["document"]["modules"]]))
        if mid not in order:
            for module in self.state["document"]["modules"]:
                if any(node["id"] == mid for node in self._descendants(module)):
                    mid = module["id"]
                    break
        index = order.index(mid); other = index + delta
        if 0 <= other < len(order):
            order[index], order[other] = order[other], order[index]
            self.submit_ops([{"type": "reorder_modules", "order": order}])

    @staticmethod
    def _descendants(node: dict):
        yield node
        for child in node.get("elements", []):
            yield from EditorWindow._descendants(child)

    def save(self):
        self.flush(lambda: self.call("save", callback=self.set_state))

    def flush(self, callback):
        if self._editing:
            self.apply_properties()
        if self._inflight or self._queued_ops:
            self._after_flush = callback
        else:
            callback()

    def history(self, redo):
        if self.state:
            self.flush(lambda: self.call("redo" if redo else "undo", base_revision=self.state["document"]["revision"], callback=self.set_state))

    def export(self):
        if not self.state:
            return
        def export_saved():
            if self.state.get("candidate"):
                self.issues.setPlainText("请先合并或恢复外部修改"); return
            self.call("request_export")
        self.flush(export_saved)

    def refresh_assets(self):
        self.call("refresh_assets", callback=lambda _: self.call("request_preview"))

    def image_settings(self):
        if not self.state:
            return
        dialog = QDialog(self); dialog.setWindowTitle("图片设置")
        form = QFormLayout(dialog)
        fields = {}
        for key, label in [("title", "图片名称"), ("assetsDir", "素材目录")]:
            fields[key] = QLineEdit(self.state["document"][key])
            row = QHBoxLayout(); row.addWidget(fields[key])
            if key != "title":
                button = QPushButton("选择…")
                def browse(checked=False, k=key):
                    selected = QFileDialog.getExistingDirectory(dialog, "选择目录")
                    if selected: fields[k].setText(selected)
                button.clicked.connect(browse); row.addWidget(button)
            form.addRow(label, row)
        form.addRow("应用版本", QLabel(self.state["document"]["image-create-tool-version"]))
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(dialog.accept); buttons.rejected.connect(dialog.reject); form.addRow(buttons)
        if dialog.exec():
            self.submit_ops([{"type": "set_project_config", "values": {k: f.text() for k, f in fields.items()}}])

    def composition_settings(self):
        if not self.state:
            return
        current = self.state["document"]["composition"]
        raw, ok = QInputDialog.getMultiLineText(self, "画布设置", "width / height(auto) / background / padding / gap", json.dumps(current, ensure_ascii=False, indent=2))
        if ok:
            try:
                values = json.loads(raw)
                self.submit_ops([{"type": "set_composition", "values": values}])
            except Exception as exc:
                self.issues.setPlainText(str(exc))

    def layout_settings(self):
        if not self.selected or not self.state:
            return
        node = find_element(self.state["document"], self.selected)
        raw, ok = QInputDialog.getMultiLineText(self, "模块/组合布局", "[行数, 列数] 或 type: column/row/grid/fixed；padding；gap", json.dumps(node.get("layout", {"type": "column", "gap": 16}), indent=2))
        if ok:
            try:
                self.submit_ops([{"type": "set_properties", "elementId": self.selected, "values": {"layout": json.loads(raw)}}])
            except Exception as exc:
                self.issues.setPlainText(str(exc))

    def selected_ids(self) -> list[str]:
        identities = [item.data(0, Qt.ItemDataRole.UserRole) for item in self.tree.selectedItems()]
        return identities if self.selected in identities else ([self.selected] if self.selected else identities)

    def style_settings(self) -> None:
        if not self.selected or not self.state:
            return
        node = find_element(self.state["document"], self.selected)
        raw, accepted = QInputDialog.getMultiLineText(
            self, "模块样式", "background / border / radius / opacity；文本 font/fontSize/color/align",
            json.dumps(node.get("style", {}), ensure_ascii=False, indent=2))
        if accepted:
            try:
                values = json.loads(raw)
                self.submit_ops([{"type": "replace_style", "elementId": self.selected, "values": values}])
            except ValueError as exc:
                self.issues.setPlainText(str(exc))

    def app_settings(self) -> None:
        def show(values):
            raw, accepted = QInputDialog.getMultiLineText(
                self, "应用设置", "全局资源目录、终端程序和参数数组",
                json.dumps(values, ensure_ascii=False, indent=2))
            if accepted:
                try:
                    self.call("configure", values=json.loads(raw), callback=lambda _: self.status.setText("应用设置已保存"))
                except ValueError as exc:
                    self.issues.setPlainText(str(exc))
        self.call("get_settings", callback=show)

    def choose_resource(self, kind: str, callback) -> None:
        def choose(resources):
            if not resources:
                self.issues.setPlainText("尚无可用资源，可先选中模块保存为新样式或模板。")
                return
            identity, accepted = QInputDialog.getItem(self, "选择资源", "名称", [item["id"] for item in resources], editable=False)
            if accepted:
                callback(identity)
        self.call("list_resources", kind=kind, callback=choose)

    def apply_saved_style(self) -> None:
        identities = self.selected_ids()
        if self.state and identities:
            def apply(identity):
                self.call("apply_style", base_revision=self.state["document"]["revision"],
                          element_ids=identities, style_id=identity, callback=self.set_state)
            self.flush(lambda: self.choose_resource("styles", apply))

    def save_resource(self, kind: str) -> None:
        if not self.state:
            return
        name, accepted = QInputDialog.getText(self, "保存新资源", "新名称（现有资源不会覆盖）")
        if accepted and name.strip():
            self.flush(lambda: self.call("save_resource", kind=kind, resource_id=name.strip(), element_id=self.selected,
                                         callback=lambda path: self.status.setText("已保存资源：" + path)))

    def save_style(self) -> None:
        self.save_resource("styles")

    def save_template(self) -> None:
        self.save_resource("templates")

    def add_template(self) -> None:
        if not self.state:
            return
        def add(identity):
            parent = None
            if self.selected:
                location, accepted = QInputDialog.getItem(self, "添加模板", "位置", ["画布顶层", "当前容器内部"], editable=False)
                if not accepted:
                    return
                if location == "当前容器内部":
                    parent = self.parent_id()
            self.call("add_template", template_id=identity, parent_id=parent,
                      base_revision=self.state["document"]["revision"], callback=self.set_state)
        self.flush(lambda: self.choose_resource("templates", add))

    def export_element(self) -> None:
        if not self.selected or not self.state:
            return
        suggested = default_png_path(Path(self.state["filePath"]), self.selected)
        path, _ = QFileDialog.getSaveFileName(self, "导出模块 PNG", str(suggested), "PNG (*.png)")
        if path:
            self.flush(lambda: self.call("request_export", output_path=path, element_id=self.selected))

    def choose_asset(self):
        if self.selected:
            self.call("search_assets", callback=self.asset_dialog)

    def asset_dialog(self, assets):
        dialog = QDialog(self); dialog.setWindowTitle("选择素材"); dialog.resize(600, 500)
        layout = QVBoxLayout(dialog)
        search = QLineEdit(); search.setPlaceholderText("搜索素材名称")
        listing = QListWidget()
        layout.addWidget(search); layout.addWidget(listing)
        def fill(text=""):
            listing.clear()
            for asset in assets:
                if text in asset["name"]:
                    item = QListWidgetItem(asset["name"] + " — " + asset["relativePath"])
                    item.setData(Qt.ItemDataRole.UserRole, asset["assetId"])
                    listing.addItem(item)
        fill(); search.textChanged.connect(fill)
        import_button = QPushButton("导入图片…")
        def import_image():
            path, _ = QFileDialog.getOpenFileName(dialog, "导入素材", "", "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
            if path:
                self.call("import_asset", path=path, callback=lambda _: self.call("search_assets", callback=lambda a: assets.clear() or assets.extend(a) or fill()))
        import_button.clicked.connect(import_image); layout.addWidget(import_button)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(dialog.accept); buttons.rejected.connect(dialog.reject); layout.addWidget(buttons)
        if dialog.exec() and listing.currentItem():
            target = self.selected
            node = find_element(self.state["document"], target)
            if node.get("type") == "itemRow":
                target += ":image"
            self.submit_ops([{"type": "replace_asset", "elementId": target, "assetId": listing.currentItem().data(Qt.ItemDataRole.UserRole)}])

    def crop(self):
        if not self.selected or not self.state:
            return
        node = find_element(self.state["document"], self.selected)
        raw, ok = QInputDialog.getMultiLineText(self, "原图裁剪", "原图像素：x/y/width/height；空对象表示全图", json.dumps(node.get("crop", {}), indent=2))
        if ok:
            try:
                self.submit_ops([{"type": "set_crop", "elementId": self.selected, "crop": json.loads(raw)}])
            except Exception as exc:
                self.issues.setPlainText(str(exc))

    def restore(self):
        if self.state and self.state.get("candidate"):
            if QMessageBox.question(self, "恢复当前内容", "拒绝外部修改，将当前 GUI 内容写回图片 JSON？") == QMessageBox.StandardButton.Yes:
                self.flush(lambda: self.call("resolve_external_change", candidate_id=self.state["candidate"]["id"],
                                            base_revision=self.state["document"]["revision"], choice="restore", callback=self.set_state))

    def merge(self):
        if self.state and self.state.get("candidate"):
            self.flush(lambda: self.call("get_external_change", callback=self.merge_dialog))

    def merge_dialog(self, info):
        dialog = QDialog(self); dialog.setWindowTitle("合并外部修改"); dialog.resize(1000, 600)
        layout = QVBoxLayout(dialog)
        layout.addWidget(QLabel("不冲突的修改将保留双方内容；下面的冲突需要逐项选择。"))
        table = QTableWidget(len(info["conflicts"]), 4)
        table.setHorizontalHeaderLabels(["字段", "当前内容", "外部内容", "取值"])
        combos = {}
        for row, conflict in enumerate(info["conflicts"]):
            for col, key in enumerate(["path", "local", "external"]):
                text = conflict[key] if key == "path" else json.dumps(conflict[key], ensure_ascii=False)
                table.setItem(row, col, QTableWidgetItem(str(text)))
            combo = QComboBox(); combo.addItems(["请选择", "当前内容", "外部内容"])
            table.setCellWidget(row, 3, combo); combos[conflict["path"]] = combo
        table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(table)
        preview = QPushButton("预览当前合并选择")
        def choices():
            return {p: "local" if c.currentIndex() == 1 else "external" for p, c in combos.items() if c.currentIndex()}
        preview.clicked.connect(lambda: (self.preview_mode.setCurrentIndex(2), self.call("preview_external_change", mode="merged", choices=choices())))
        layout.addWidget(preview)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        def accept():
            if any(c.currentIndex() == 0 for c in combos.values()):
                QMessageBox.information(dialog, "尚有冲突", "请为每个冲突选择取值。")
            else:
                dialog.accept()
        buttons.accepted.connect(accept); buttons.rejected.connect(dialog.reject); layout.addWidget(buttons)
        if dialog.exec():
            self.call("resolve_external_change", candidate_id=info["candidate"]["id"],
                      base_revision=info["local"]["revision"], choice="merge", choices=choices(), callback=self.set_state)

    def closeEvent(self, event):
        if self._allow_close:
            event.accept(); return
        event.ignore()
        if self._closing:
            return
        if self._editing or (self.state and (self.state["dirty"] or self.state.get("candidate"))):
            answer = QMessageBox.question(self, "未保存修改", "有未保存修改或外部候选。关闭并放弃内存修改？", QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.Cancel)
            if answer != QMessageBox.StandardButton.Yes:
                return
        self._closing = True
        self.bridge.unsubscribe()
        self.status.setText("正在结束后台线程…")
        self.call("shutdown", callback=self.finish_close)

    def finish_close(self, _):
        self._allow_close = True
        self.close()


def run_gui(file_path=None, settings=None):
    app = QApplication.instance() or QApplication([])
    window = EditorWindow(file_path, settings=settings)
    window.show()
    return app.exec()

