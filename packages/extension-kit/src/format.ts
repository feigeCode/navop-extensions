// 纯函数小工具：单位换算、时间、错误文案。页面里不要重复实现这些。

/** 字节数 → `1.4 GB` 这类人读形式；非法输入给 `-`。 */
export function humanBytes(bytes: unknown): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${size} ${units[unit]}` : `${size.toFixed(1)} ${units[unit]}`;
}

/** 百分比，保留一位小数；分母为 0 时给 `-`。 */
export function percent(part: unknown, total: unknown): string {
  const value = Number(part);
  const whole = Number(total);
  if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return "-";
  return `${((value / whole) * 100).toFixed(1)}%`;
}

/** 0..1 的比例，用于进度条宽度；越界会被夹紧。 */
export function ratio(part: unknown, total: unknown): number {
  const value = Number(part);
  const whole = Number(total);
  if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.max(0, Math.min(1, value / whole));
}

/** `2026-11-02T09:31:04Z` → `11-02 09:31`；解析不了就原样返回。 */
export function shortTime(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "-";
  const date = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Docker 把 Cmd 交给页面时是数组；按 CLI 的样子拼起来。 */
export function joinCommand(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(" ") : "-";
  if (typeof value === "string" && value.length > 0) return value;
  return "-";
}

/** `ghcr.io/acme/api:1.4` → 仓库 + 标签；registry 端口不会误判成标签。 */
export function splitImageRef(reference: string): { image: string; tag: string } {
  const index = reference.lastIndexOf(":");
  if (index > 0 && !reference.slice(index + 1).includes("/")) {
    return { image: reference.slice(0, index), tag: reference.slice(index + 1) || "latest" };
  }
  return { image: reference, tag: "latest" };
}

/** provider 抛出来的错误可能是 Error、字符串或 `{message}`；统一成一句话。 */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * 判断错误是不是「容器没在跑」这类可解释的状态，而不是真的故障。
 *
 * 进容器执行命令（docker exec）的接口在容器停止/暂停时会被 Docker 以
 * `status code 409: container <id> is not running` 拒绝，对用户来说这是
 * 一个正常的业务状态，不该把协议错误原文糊到脸上。
 */
export function isContainerStoppedError(message: string): boolean {
  return /is not running|is paused|status code 409/i.test(message);
}

/** 取对象上的字符串字段（provider 的 JSON 不保证形状）。 */
export function str(source: unknown, key: string, fallback = "-"): string {
  if (!source || typeof source !== "object") return fallback;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return fallback;
}

/** 取数组字段；不是数组就是空数组。 */
export function arr(source: unknown, key: string): unknown[] {
  if (!source || typeof source !== "object") return [];
  const value = (source as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}
