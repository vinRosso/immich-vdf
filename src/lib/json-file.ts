import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Kept on `globalThis` because the scheduler and each API route load their own copy of this module. */
const holder = globalThis as typeof globalThis & { __vdfJsonLock?: { chain: Promise<unknown> } };
holder.__vdfJsonLock ??= { chain: Promise.resolve() };
const lock = holder.__vdfJsonLock;

export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.chain.then(fn, fn);
  lock.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function missingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

/** Missing files use `fallback`. Corrupt JSON throws so a later save cannot replace it with defaults. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (missingFile(error)) return fallback;
    throw error;
  }
  return JSON.parse(text) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}
