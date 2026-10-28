import type { ImageProcessor } from "../types";
import { array, error, fieldPath, string } from "./validation";
import type { ValidationContext } from "./validation";

/** Processor arguments stay opaque JSON; each registered function validates its own arguments. */
function validateJson(value: unknown, path: string, ctx: ValidationContext): void {
  const active = new WeakSet<object>();
  const stack: { value: unknown; path: string; leave?: boolean }[] = [{ value, path }];
  while (stack.length > 0) {
    const item = stack.pop()!;
    const current = item.value;
    if (item.leave) {
      active.delete(current as object);
    } else if (current === null || typeof current === "string" || typeof current === "boolean"
      || (typeof current === "number" && Number.isFinite(current))) {
      continue;
    } else if (typeof current === "object" && current !== null
      && (Array.isArray(current) || Object.getPrototypeOf(current) === Object.prototype || Object.getPrototypeOf(current) === null)) {
      if (active.has(current)) {
        error(ctx, item.path, "处理函数参数不能循环引用", "INVALID_STRUCTURE");
        continue;
      }
      active.add(current);
      stack.push({ ...item, leave: true });
      if (Array.isArray(current)) {
        for (let i = current.length - 1; i >= 0; i--) stack.push({ value: current[i], path: `${item.path}[${i}]` });
      } else {
        for (const [key, child] of Object.entries(current)) stack.push({ value: child, path: fieldPath(item.path, key) });
      }
    } else {
      error(ctx, item.path, "处理函数参数必须是 JSON 值");
    }
  }
}

export function resolveProcessors(value: unknown, path: string, ctx: ValidationContext): readonly ImageProcessor[] {
  const calls = array(value, path, ctx, true);
  const result: ImageProcessor[] = [];
  for (let i = 0; i < calls.length; i++) {
    const stepPath = `${path}[${i}]`;
    const before = ctx.errors.length;
    const step = array(calls[i], stepPath, ctx);
    string(step[0], `${stepPath}[0]`, ctx);
    for (let j = 1; j < step.length; j++) validateJson(step[j], `${stepPath}[${j}]`, ctx);
    if (before !== ctx.errors.length) continue;
    try {
      // Independent rendering input: later script mutation cannot alter the saved DTO.
      result.push(structuredClone(step) as ImageProcessor);
    } catch {
      error(ctx, stepPath, "无法复制处理函数参数");
    }
  }
  return result;
}
