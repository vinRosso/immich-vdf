import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../src/components/api";

function stubFetch(texts: string[]): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const text = texts[Math.min(calls, texts.length - 1)];
    calls += 1;
    return { status: 200, ok: true, text: async () => text } as Response;
  }) as typeof fetch;
  return { calls: () => calls, restore: () => void (globalThis.fetch = original) };
}

test("GET retries once when the body is cut off", async () => {
  const stub = stubFetch(['{"a":"x', '{"a":1}']);
  try {
    assert.deepEqual(await api("/x"), { a: 1 });
    assert.equal(stub.calls(), 2);
  } finally {
    stub.restore();
  }
});

test("GET reports a cut-off body after one retry", async () => {
  const stub = stubFetch(['{"a":"x']);
  try {
    await assert.rejects(() => api("/x"), /cut off after 7 bytes/);
    assert.equal(stub.calls(), 2);
  } finally {
    stub.restore();
  }
});

test("POST never retries", async () => {
  const stub = stubFetch(['{"a":"x', '{"a":1}']);
  try {
    await assert.rejects(() => api("/x", { method: "POST", body: "{}" }), /cut off/);
    assert.equal(stub.calls(), 1);
  } finally {
    stub.restore();
  }
});

test("empty body still returns {}", async () => {
  const stub = stubFetch([""]);
  try {
    assert.deepEqual(await api("/x"), {});
  } finally {
    stub.restore();
  }
});
