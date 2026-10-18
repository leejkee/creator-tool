"""Cross-thread render contracts. Mutable document values are copied by the caller."""
from typing import Literal, NotRequired, TypedDict


class Issue(TypedDict):
    code: str
    message: str
    severity: Literal["error", "warning"]
    elementId: NotRequired[str | None]
    moduleId: NotRequired[str | None]


class RenderRequest(TypedDict):
    filePath: str
    baseDir: str
    documentSnapshot: dict
    documentId: str
    revision: int
    target: str
    jobId: str
    renderId: str
    candidateId: str | None
    contentFingerprint: str
    resourceFingerprint: str
    resources: list[dict]
    extraResources: list[dict]
    scriptsDir: str
    elementId: NotRequired[str | None]
    session: NotRequired[str]
    outputPath: NotRequired[str | None]


class RenderResult(TypedDict):
    jobId: NotRequired[str | None]
    renderId: NotRequired[str | None]
    documentId: NotRequired[str | None]
    revision: NotRequired[int | None]
    target: NotRequired[str | None]
    candidateId: NotRequired[str | None]
    contentFingerprint: NotRequired[str | None]
    resourceFingerprint: NotRequired[str | None]
    ok: bool
    exportable: bool
    pngBytes: bytes
    layout: dict
    imageWidth: NotRequired[int]
    imageHeight: NotRequired[int]
    issues: list[Issue]
