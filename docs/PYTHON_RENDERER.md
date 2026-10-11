# Python 渲染线程模块

状态：第一版已实现于 `image_create_tool/renderer.py`。总体约束见 [dev.md](dev.md)，文档输入协议见 [PYTHON_SERVICE.md](PYTHON_SERVICE.md)。本文件定义同进程服务—渲染线程请求与结果，保留原文件名便于引用。

## 1. 职责与依赖

渲染模块负责输入校验、组件展开、文字测量、换行、布局、素材绘制、模块图片生成与最终合成。使用 Pillow 等程序绘图工具。

渲染库不依赖 PySide6 和应用服务实现，不维护当前文档，不监听或直接读取正在变化的项目 JSON，不写项目文档或历史。渲染线程只处理服务传入的独立快照。用户在 GUI 主线程发起导出，正式落盘由服务线程负责；独立 CLI 可调用相同渲染库后写文件。

可变图像、字体等重型对象只由渲染线程使用；组件展开保留稳定元素 ID。发布 PNG 字节与布局后，渲染线程不能继续修改这些结果对象。

## 2. 执行器端口与工作线程

服务依赖 `RenderExecutor.submit(request) -> Future[RenderResult]`，启动入口注入执行器。首版使用 `ThreadPoolExecutor(max_workers=1)` 或等价的常驻工作线程，应用启动时创建并复用。服务队列与渲染队列分离，渲染不能占用服务线程；独立验证可以替换成同步假实现。

线程内调用渲染库函数，不启动脚本子进程。GUI 控件只能在主线程创建和更新；渲染线程不直接向控件绘图，不修改主线程正在使用的图像。同进程也需要固定快照，不能在服务修改 dict 时让渲染读取同一 dict。

工作线程可缓存字体、素材或模块图片，按资源哈希与渲染器版本失效；每个任务创建自己的临时图像。多线程用于隔离耗时任务，不保证 Python CPU 计算能并行加速；需用实际样例测量主线程响应与渲染耗时。

## 3. RenderRequest（唯一协议定义）

请求包含：

| 字段 | 含义 |
| --- | --- |
| `protocolVersion` | 模块数据协议版本，首版 1 |
| `jobId / renderId` | 服务分配的任务与结果标识 |
| `documentId / revision` | 固定目标文档与版本 |
| `target / candidateId / contentFingerprint` | 当前内容、外部候选或合并预览；候选身份与内容指纹用于判断过期 |
| `documentSnapshot` | 已提交文档的独立副本 |
| `resources` | 已解析的素材、字体和模板清单，含本机路径及哈希/版本；未解析引用保留结构化问题 |
| `resourceFingerprint` | 本次任务依赖资源的统一指纹 |
| `purpose` | `preview` 或 `export`，决定是否允许错误占位 |
| `output` | 编码格式 PNG、输出倍率等；首版倍率 1 |

资源路径由服务提供，不从 GUI 接收任意路径。渲染器读取资源时复核存在性及指纹；发现资源变化返回问题，不使用新资源冒充旧快照。

服务按工作目录根部 `pjt.json` 的 `assetsDir` 解析素材路径，资源可以位于工作目录之外；渲染线程只使用已解析清单。`outputsDir` 属于服务的保存配置，不影响排版，渲染器无需管理它。

输入只包含独立快照与普通数据，不传 Qt 控件、服务对象或可变当前文档引用。协议版本不支持时返回 `PROTOCOL_UNSUPPORTED`。外部候选的版本可能与当前内容相同，必须同时检查目标、候选 ID 与内容指纹。

## 4. RenderResult 与布局（唯一协议定义）

```text
RenderResult
  protocolVersion
  jobId, renderId, documentId, revision
  target, candidateId, contentFingerprint
  resourceFingerprint, rendererVersion
  ok                         # 是否生成了可展示的图像
  exportable                 # 是否允许作为正式导出
  pngBytes                   # bytes，失败时可为空
  imageWidth, imageHeight, scale
  layout                     # 普通数据结构
  issues                     # 结构化问题列表
```

`layout` 包含逻辑画布大小、模块边界及元素列表。元素至少包括 `elementId/moduleId/type/x/y/width/height/zIndex/visible`，组合元素记录父子关联；文字可附实际换行，图片可附实际可见原图范围。位置基于最终合成画布，不让 GUI 再加一次模块偏移。

所有问题使用服务定义的 `code/message/severity` 和定位字段。缺素材的预览可以 `ok=true`、`exportable=false` 并包含占位；致命错误 `ok=false`；正式导出遇到阻断问题不能返回可导出的占位图。服务判断正式成功还要检查任务版本、资源与落盘状态。

图片和布局由同一次计算产生，以 `renderId`、目标及内容指纹关联。渲染器不改变文档版本，不把外部候选结果伪装成当前内容。

## 5. 布局与合成规则

1. 校验 Schema、ID、模块引用与参数范围，读取已解析的资源和有效样式。
2. 展开标题块、`itemRow` 等组件，保持稳定子元素身份与用户覆盖值。
3. 按指定字体测量文本，处理中文、标点、长英文和显式换行；不使用系统悄悄替换缺失字体。
4. 计算自动布局、位置偏移与固定布局，形成模块边界和元素最终边界。
5. 按 `moduleOrder`、间距、内外边距及背景合成画布，按层级绘制文字、图片与形状，生成 PNG。

自动高度扩展画布，不因默认 3–4 行限制删减内容。固定画布溢出报告 `CONTENT_OVERFLOW` 并阻止正式导出；不静默截断或缩小到不可读字号。裁剪基于原图像素，显示框基于画布逻辑像素，非法裁剪不静默纠正。

预览和导出调用同一渲染函数。首版预览倍率 1，由 GUI 缩放展示；同一文档、资源、配置的完整结果可复用。将来缩略预览只能改变输出倍率，不能重新改变逻辑字号或换行。

模块图片是可重建中间产物，不取代文档。模块缓存键包括内容、有效样式、布局约束、素材/字体哈希、模板及渲染器版本；先保证正确，再增加缓存。

## 6. 通信与生命周期

执行器返回不可变 PNG 字节及布局快照，回调投递到服务队列；服务验收后经 GUI 桥接的 Qt 信号交给主线程展示。渲染线程不直接操作 GUI。结果对象可以在同进程安全传递引用，但 dict、列表和图像仍须遵守发布后不修改的约定。

同进程线程共用地址空间，无需 `multiprocessing.shared_memory`、管道或 PNG 跨进程序列化。PNG 编码和 GUI 解码仍有成本；若以后直接传只读像素缓冲区，需明确持有与释放约定，不能在 GUI 使用时复用或修改底层缓冲区。

服务控制预览合并，渲染线程不读取外部“最新文件”。旧任务通常完成后丢弃结果；可在布局阶段或模块间检查协作取消标志。等待超时只说明结果没按时返回，不能强制安全终止线程；不能通过创建新线程来假装旧线程已停止。卡住的库调用可能需要退出/重启整个应用，应保持未保存状态可见。

关闭流程由服务触发：停止接收任务、取消未执行预览、请求协作停止并异步等待工作线程结束，主线程不阻塞等待。具体等待时间和退出时导出任务策略继续细化。线程约束见 [Python threading 文档](https://docs.python.org/3/library/threading.html)，GUI 线程规则见 [Qt 文档](https://doc.qt.io/qt-6/threads-qobject.html)。

## 7. 独立命令行入口

```text
python -m guide_renderer assets index --project <project_dir>
python -m guide_renderer validate --project <workdir>
python -m guide_renderer layout --project <workdir>
python -m guide_renderer render --project <workdir> --output <png_path>
```

素材索引工具供服务或离线维护调用，正常渲染任务只消费服务提供的资源清单。CLI 使用同一文档协议和渲染库，元数据 JSON 写 stdout、诊断写 stderr，失败使用非零退出码；PNG 写指定文件，不混入 JSON。文件先写临时文件，再替换目标。

CLI 默认读取工作目录根部 `pjt.json`，按配置解析资源；省略正式输出路径时使用 `outputsDir`。`layout` 元数据输出到 stdout，不额外持久化第二份项目 JSON。

## 8. 独立验收

- 使用固定快照和素材夹具，不启动 GUI/应用服务也能出图并检查尺寸、换行、裁剪、透明度与层级。
- 返回元素边界与图像一致，重排后 ID 仍对应原元素。
- 缺素材预览明确不可导出，非法参数、缺字体及溢出均可定位。
- 同一输入与固定资源得到一致布局；资源变化不能复用旧缓存。
- 单工作线程可连续执行任务，失败不修改 JSON；当前内容与外部候选的迟到结果不会混用，关闭能协作停止工作线程。
