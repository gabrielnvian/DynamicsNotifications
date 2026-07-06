// Zoom webhook capture spike — logs every delivery verbatim so we can study real
// payloads (breakout-room joins/leaves, admits) before designing the real ingest
// route on the metrics server. Runs on webstorm, exposed via `tailscale funnel 3210`.
//
// Setup: paste the Zoom app's Secret Token into ./secret.txt — it's re-read per
// request, so the token can arrive after the server is already running.
// Output: one JSON line per delivery in ./events.jsonl; stdout is a human tail.

import { createHmac } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = 3210;
const SECRET_PATH = join(import.meta.dir, "secret.txt");
const EVENTS_PATH = join(import.meta.dir, "events.jsonl");

async function readSecret(): Promise<string | null> {
  const file = Bun.file(SECRET_PATH);

  if (!(await file.exists())) return null;

  const token = (await file.text()).trim();

  return token || null;
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

// Zoom signs each delivery as `v0=` + HMAC(`v0:{timestamp}:{raw body}`); null = no secret yet
function signatureValid(req: Request, raw: string, secret: string | null): boolean | null {
  if (!secret) return null;

  const timestamp = req.headers.get("x-zm-request-timestamp") ?? "";
  const expected = `v0=${hmacHex(secret, `v0:${timestamp}:${raw}`)}`;

  return req.headers.get("x-zm-signature") === expected;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

async function handleWebhook(req: Request): Promise<Response> {
  const raw = await req.text();

  let body: { event?: string; payload?: { plainToken?: string } };
  try {
    body = JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;

    console.log(`${new Date().toISOString()} non-JSON delivery (${raw.length} bytes)`);
    return json(400, { error: "expected JSON" });
  }

  const secret = await readSecret();

  // Zoom's endpoint validation challenge: echo plainToken + its HMAC within 3s
  if (body.event === "endpoint.url_validation") {
    console.log(`${new Date().toISOString()} url_validation challenge (secret ${secret ? "present" : "MISSING"})`);

    if (!secret) return json(500, { error: "secret.txt not populated yet" });

    const plainToken = body.payload?.plainToken ?? "";
    return json(200, { plainToken, encryptedToken: hmacHex(secret, plainToken) });
  }

  const record = {
    received_at: new Date().toISOString(),
    sig_valid: signatureValid(req, raw, secret),
    body,
  };

  await appendFile(EVENTS_PATH, JSON.stringify(record) + "\n");
  console.log(`${record.received_at} ${body.event ?? "(no event field)"} sig_valid=${record.sig_valid}`);

  return json(200, {});
}

Bun.serve({
  // loopback only — funnel terminates TLS on 443 and forwards here; nothing else should reach this port
  hostname: "127.0.0.1",
  port: PORT,

  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "POST" && pathname === "/zoom/webhook") return handleWebhook(req);

    if (req.method === "GET" && pathname === "/zoom/health") return json(200, { ok: true });

    return json(404, { error: "not found" });
  },
});

console.log(`capture listening on 127.0.0.1:${PORT} (events -> ${EVENTS_PATH})`);
