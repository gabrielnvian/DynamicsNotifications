import { expect, test } from "bun:test";
import { dailyCsv, summaryCsv, toCsv } from "./csv.ts";

test("toCsv escapes quotes/commas/newlines and blanks nulls", () => {
  const out = toCsv(["a", "b"], [['x,"y"', null], ["plain", 2]]);
  expect(out).toBe('a,b\r\n"x,""y""",\r\nplain,2\r\n');
});

test("summaryCsv derives not_answered and rounds answer_rate to 3 decimals", () => {
  const out = summaryCsv([
    {
      first_name: "Dana",
      available_seconds: 100,
      active_seconds: 160,
      calls_received: 14,
      calls_answered: 9,
      answer_rate: 9 / 14, // 0.642857… → 0.643
      avg_time_to_answer_ms: 7218,
      avg_handle_ms: 247589,
      handle_sample: 9,
    },
    {
      first_name: "Nat",
      available_seconds: 50,
      active_seconds: 50,
      calls_received: 0,
      calls_answered: 0,
      answer_rate: null, // → empty cell, never "0"
      avg_time_to_answer_ms: null,
      avg_handle_ms: null,
      handle_sample: 0,
    },
  ]);
  const lines = out.trimEnd().split("\r\n");
  expect(lines[0]).toBe(
    "first_name,available_seconds,active_seconds,calls_received,calls_answered,not_answered,answer_rate,avg_time_to_answer_ms,avg_handle_ms,handle_sample",
  );
  expect(lines[1]).toBe("Dana,100,160,14,9,5,0.643,7218,247589,9");
  expect(lines[2]).toBe("Nat,50,50,0,0,0,,,,0");
});

test("dailyCsv maps day rows with derived not_answered and empty nulls", () => {
  const out = dailyCsv([
    {
      first_name: "Dana",
      day: "2026-06-01",
      available_seconds: 3600,
      active_seconds: 3720,
      calls_received: 5,
      calls_answered: 3,
      avg_time_to_answer_ms: null,
      avg_handle_ms: 60000,
      handle_sample: 2,
    },
  ]);
  const lines = out.trimEnd().split("\r\n");
  expect(lines[0]).toBe(
    "first_name,day,available_seconds,calls_received,calls_answered,not_answered,avg_time_to_answer_ms,avg_handle_ms,handle_sample",
  );
  expect(lines[1]).toBe("Dana,2026-06-01,3600,5,3,2,,60000,2");
});
