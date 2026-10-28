import type { RenderIssue, RenderIssueCode } from "./types";

export interface ValidationContext {
  readonly errors: RenderIssue[];
  readonly warnings: RenderIssue[];
  readonly moduleId?: string;
}

export type Fields = Record<string, unknown>;

export function fieldPath(path: string, key: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function issue(
  ctx: ValidationContext,
  path: string,
  message: string,
  code: RenderIssueCode,
): RenderIssue {
  return {
    code,
    path,
    message,
    ...(ctx.moduleId === undefined ? {} : { moduleId: ctx.moduleId }),
  };
}

export function error(
  ctx: ValidationContext,
  path: string,
  message: string,
  code: RenderIssueCode = "INVALID_PARAMETER",
): void {
  ctx.errors.push(issue(ctx, path, message, code));
}

export function warn(
  ctx: ValidationContext,
  path: string,
  message: string,
  code: RenderIssueCode,
): void {
  ctx.warnings.push(issue(ctx, path, message, code));
}

export function object(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  optional = false,
): Fields | undefined {
  if (value === undefined && optional) {
    return undefined;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return value as Fields;
  }
  error(ctx, path, "必须是对象，不允许 null");
  return undefined;
}

export function array(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  optional = false,
): readonly unknown[] {
  if (value === undefined && optional) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  error(ctx, path, "必须是数组，不允许 null");
  return [];
}

export function integer(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  minimum: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  error(ctx, path, `必须是大于等于 ${minimum} 的安全整数`);
  // A failed validation never exposes this temporary value to rendering.
  return minimum;
}

export function enumeration<const T extends string>(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  choices: readonly T[],
  fallback?: T,
): T {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value === "string" && choices.includes(value as T)) {
    return value as T;
  }
  error(ctx, path, `必须是以下取值之一：${choices.join("、")}`);
  return choices[0];
}

export function boolean(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  error(ctx, path, "必须是布尔值");
  return fallback;
}

export function string(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  allowBlank = false,
): string {
  if (typeof value === "string" && (allowBlank || value.trim().length > 0)) {
    return value;
  }
  error(ctx, path, allowBlank ? "必须是字符串" : "必须是非空字符串");
  return "";
}

export function color(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  fallback?: string,
): string {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value === "string" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) {
    return value;
  }
  error(ctx, path, "必须是 #RRGGBB 或 #RRGGBBAA 颜色");
  return "#000000";
}

/** Whitelists apply to rendering parameter objects, never to opaque document metadata. */
export function unknownFields(
  fields: Fields,
  allowed: readonly string[],
  path: string,
  ctx: ValidationContext,
): void {
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) {
      warn(
        ctx,
        fieldPath(path, key),
        "未知渲染参数，保留原值但不参与渲染",
        "UNKNOWN_PARAMETER",
      );
    }
  }
}

export function unsupportedFields(
  fields: Fields,
  keys: readonly string[],
  path: string,
  ctx: ValidationContext,
): void {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      warn(
        ctx,
        fieldPath(path, key),
        "旧版或当前不支持的渲染参数，保留原值但不参与渲染",
        "UNSUPPORTED_PARAMETER",
      );
    }
  }
}

export function attempt<T>(
  ctx: ValidationContext,
  path: string,
  read: () => T,
): T | undefined {
  try {
    return read();
  } catch (cause) {
    error(ctx, path, cause instanceof Error ? cause.message : "参数不合法");
    return undefined;
  }
}
