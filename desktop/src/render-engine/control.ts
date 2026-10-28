import type { EngineIssue, EngineIssueCode, RenderOptions } from "./types";

export class EngineFailure extends Error {
  constructor(
    readonly issue: EngineIssue,
    readonly cause?: unknown,
  ) {
    super(issue.message);
    this.name = "EngineFailure";
  }
}

export interface Control {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

export function failure(
  code: EngineIssueCode,
  message: string,
  location: Partial<Omit<EngineIssue, "code" | "message">> = {},
  cause?: unknown,
): EngineFailure {
  return new EngineFailure({ path: "$", ...location, code, message }, cause);
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export function checkCancelled(control: Control): void {
  if (control.signal?.aborted) {
    throw failure("RENDER_CANCELLED", "渲染已取消");
  }
}

export function resolveControl(
  options: Pick<RenderOptions, "signal" | "timeoutMs">,
): Control {
  const timeoutMs =
    options.timeoutMs === undefined ? 30_000 : options.timeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 0x7fffffff
  ) {
    throw failure(
      "INVALID_RENDER_CONTEXT",
      "等待上限必须为 1～2147483647 的整数毫秒",
    );
  }
  if (
    options.signal !== undefined &&
    (!options.signal ||
      typeof options.signal.aborted !== "boolean" ||
      typeof options.signal.addEventListener !== "function" ||
      typeof options.signal.removeEventListener !== "function")
  ) {
    throw failure("INVALID_RENDER_CONTEXT", "取消参数必须是 AbortSignal");
  }
  const control = { signal: options.signal, timeoutMs };
  checkCancelled(control);
  return control;
}

/** Cancels waiting, not synchronous execution; dispose values arriving after cancellation. */
export function waitFor<T>(
  start: () => T | PromiseLike<T>,
  control: Control,
  disposeLate?: (value: T) => void,
): Promise<T> {
  checkCancelled(control);
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      control.signal?.removeEventListener("abort", onAbort);
    };
    const stop = (error: unknown) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(error);
      }
    };
    const onAbort = () => stop(failure("RENDER_CANCELLED", "渲染已取消"));
    const timer = setTimeout(
      () =>
        stop(
          failure(
            "OPERATION_TIMEOUT",
            `操作等待超过 ${control.timeoutMs} 毫秒`,
          ),
        ),
      control.timeoutMs,
    );
    control.signal?.addEventListener("abort", onAbort, { once: true });
    if (control.signal?.aborted) {
      onAbort();
      return;
    }
    Promise.resolve()
      .then(() => {
        checkCancelled(control);
        return start();
      })
      .then((value) => {
        if (finished) {
          disposeLate?.(value);
          return;
        }
        finished = true;
        cleanup();
        resolve(value);
      }, stop);
  });
}

export function located(
  error: unknown,
  location: { path: string; moduleId?: string },
): EngineFailure {
  if (error instanceof EngineFailure) {
    return new EngineFailure({ ...error.issue, ...location }, error.cause);
  }
  return failure("DRAW_FAILED", messageOf(error), location, error);
}

export async function yieldToHost(control: Control): Promise<void> {
  checkCancelled(control);
  await waitFor(
    () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    control,
  );
  checkCancelled(control);
}
