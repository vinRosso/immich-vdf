import { spawn } from "node:child_process";
import { cliAvailable } from "./config";

function semverParts(value: string | null | undefined): [number, number, number] | null {
  const match = value?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export async function readCliVersion(command: string): Promise<string | null> {
  if (!cliAvailable(command)) return null;
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 8000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const parts = semverParts(output);
      resolve(parts ? parts.join(".") : null);
    });
  });
}
