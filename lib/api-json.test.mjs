import assert from "node:assert/strict";
import test from "node:test";
import { readApiJson } from "./api-json.ts";

test("returns parsed JSON for a successful response", async () => {
  const response = new Response(JSON.stringify({ branch: "main" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await readApiJson(response), { branch: "main" });
});

test("prefers the server error field over the status code", async () => {
  const response = new Response(JSON.stringify({ error: "Access denied" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(readApiJson(response), { message: "Access denied" });
});

test("reports a plain-text 500 instead of a JSON parse error", async () => {
  // Next.js answers an uncaught pipeline error with this exact body. Parsing it
  // as JSON used to surface `Unexpected token 'I', "Internal S"... is not valid
  // JSON`, which hid both the status and the fact that the route never ran.
  const response = new Response("Internal Server Error", {
    status: 500,
    headers: { "content-type": "text/plain" },
  });
  await assert.rejects(readApiJson(response, { hint: "see desktop.log" }), {
    message: "HTTP 500 (see desktop.log)",
  });
});

test("keeps a non-JSON body preview for unexpected responses", async () => {
  const response = new Response("<html><body>Bad gateway</body></html>", { status: 502 });
  await assert.rejects(readApiJson(response), { message: "HTTP 502: <html><body>Bad gateway</body></html>" });
});

test("rejects an empty body instead of returning null", async () => {
  const response = new Response("", { status: 200 });
  await assert.rejects(readApiJson(response), { message: "Empty response" });
});
