// Writes a throwaway set of duplicate images for timing group actions: node scripts/make-dup-set.mjs <dir> [groups]
// Each group is three byte-identical JPEGs built with ffmpeg from a distinct stripe pattern, so groups differ from each other.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const groups = Number(process.argv[3] ?? 50);
if (!dir || !Number.isInteger(groups) || groups < 1) {
  console.error("Usage: node scripts/make-dup-set.mjs <dir> [groups]");
  process.exit(1);
}
if (path.resolve(dir) === path.resolve(".")) {
  console.error("Choose an empty scratch folder, not the project folder");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
if (readdirSync(dir).length > 0) {
  console.error(`${dir} is not empty`);
  process.exit(1);
}

for (let n = 1; n <= groups; n += 1) {
  const a = (0.03 + (n % 7) * 0.07).toFixed(3);
  const b = (0.02 + (Math.floor(n / 7) % 8) * 0.08).toFixed(3);
  const c = (0.05 + (n % 5) * 0.11).toFixed(3);
  const pattern = `128+127*sin(X*${a}+Y*${b})*sin(Y*${c}+X*${a})`;
  const name = `set-${String(n).padStart(3, "0")}`;
  const first = path.join(dir, `${name}-a.jpg`);
  const made = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "lavfi", "-i", `nullsrc=s=320x240:d=1,geq=lum='${pattern}':cb=128:cr=128`, "-frames:v", "1", "-q:v", "3", first],
    { stdio: "inherit" },
  );
  if (made.status !== 0) {
    console.error("ffmpeg failed; it must be on PATH");
    process.exit(1);
  }
  copyFileSync(first, path.join(dir, `${name}-b.jpg`));
  copyFileSync(first, path.join(dir, `${name}-c.jpg`));
}
console.log(`Wrote ${groups} groups of 3 copies to ${dir}`);
