import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readViewPref, writeViewPref } from "../src/lib/view-prefs";

type StorageName = "localStorage" | "sessionStorage";
const originals = new Map<StorageName, PropertyDescriptor | undefined>();

function stub(name: StorageName, store: Storage | (() => never)): void {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: typeof store === "function" ? store : () => store,
  });
}

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
}

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originals.clear();
});

test("a value left in sessionStorage is copied to localStorage once", () => {
  const local = memory();
  stub("localStorage", local);
  stub("sessionStorage", memory({ "vdf-results-sort:server": "time-desc" }));
  assert.equal(readViewPref("vdf-results-sort:server"), "time-desc");
  assert.equal(local.getItem("vdf-results-sort:server"), "time-desc");
});

test("localStorage wins over sessionStorage", () => {
  stub("localStorage", memory({ k: "files-desc" }));
  stub("sessionStorage", memory({ k: "time-desc" }));
  assert.equal(readViewPref("k"), "files-desc");
});

test("a write is read back", () => {
  stub("localStorage", memory());
  stub("sessionStorage", memory());
  writeViewPref("k", "5");
  assert.equal(readViewPref("k"), "5");
});

test("blocked storage returns null and writes do not throw", () => {
  const blocked = () => {
    throw new Error("SecurityError");
  };
  stub("localStorage", blocked);
  stub("sessionStorage", blocked);
  assert.equal(readViewPref("k"), null);
  assert.doesNotThrow(() => writeViewPref("k", "5"));
});
