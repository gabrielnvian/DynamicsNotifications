import type { DailyPoint, OperatorSummary } from "./types.ts";

type Cell = string | number | null | undefined;

export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  return lines.join("\r\n") + "\r\n";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function summaryCsv(operators: OperatorSummary[]): string {
  const headers = [
    "first_name",
    "available_seconds",
    "active_seconds",
    "calls_received",
    "calls_answered",
    "not_answered",
    "answer_rate",
    "avg_time_to_answer_ms",
    "avg_handle_ms",
    "handle_sample",
  ];
  const rows: Cell[][] = operators.map((o) => [
    o.first_name,
    o.available_seconds,
    o.active_seconds,
    o.calls_received,
    o.calls_answered,
    Math.max(0, o.calls_received - o.calls_answered),
    o.answer_rate == null ? null : round3(o.answer_rate),
    o.avg_time_to_answer_ms,
    o.avg_handle_ms,
    o.handle_sample,
  ]);
  return toCsv(headers, rows);
}

export function dailyCsv(
  rows: (DailyPoint & { first_name: string })[],
): string {
  const headers = [
    "first_name",
    "day",
    "available_seconds",
    "calls_received",
    "calls_answered",
    "not_answered",
    "avg_time_to_answer_ms",
    "avg_handle_ms",
    "handle_sample",
  ];
  const out: Cell[][] = rows.map((r) => [
    r.first_name,
    r.day,
    r.available_seconds,
    r.calls_received,
    r.calls_answered,
    Math.max(0, r.calls_received - r.calls_answered),
    r.avg_time_to_answer_ms,
    r.avg_handle_ms,
    r.handle_sample,
  ]);
  return toCsv(headers, out);
}
