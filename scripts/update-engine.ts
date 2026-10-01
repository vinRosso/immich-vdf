import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM_REPO = "0x90d/videoduplicatefinder";
const COPIED = ["VDF.Core", "VDF.CLI", "Directory.Build.props"] as const;

export function parseEngineTag(input: string): { tag: string; version: string } {
  const trimmed = input.trim().replace(/^refs\/tags\//, "");
  const tag = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Expected a version tag such as v4.1.1, got ${input}`);
  }
  return { tag, version: tag.slice(1) };
}

export function renderUpstreamPin(pin: { repository: string; tag: string; commit: string; version: string }): string {
  return `${JSON.stringify(pin, null, 2)}\n`;
}

async function commitForTag(tag: string): Promise<string> {
  const headers = { accept: "application/vnd.github+json", "user-agent": "immich-vdf" };
  const refResponse = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/git/refs/tags/${tag}`, { headers });
  if (!refResponse.ok) throw new Error(`GitHub tag lookup failed (${refResponse.status}) for ${tag}`);
  const ref = (await refResponse.json()) as { object?: { type?: string; sha?: string } };
  const type = ref.object?.type;
  const sha = ref.object?.sha;
  if (!sha) throw new Error(`GitHub did not return a commit for ${tag}`);
  if (type === "commit") return sha;
  if (type !== "tag") throw new Error(`Unexpected tag object type for ${tag}`);
  const tagResponse = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/git/tags/${sha}`, { headers });
  if (!tagResponse.ok) throw new Error(`GitHub annotated tag lookup failed (${tagResponse.status}) for ${tag}`);
  const annotated = (await tagResponse.json()) as { object?: { type?: string; sha?: string } };
  if (annotated.object?.type !== "commit" || !annotated.object.sha) {
    throw new Error(`Annotated tag ${tag} did not point at a commit`);
  }
  return annotated.object.sha;
}

function findExtractedRoot(dir: string): string {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);
    if (readdirSync(candidate).includes("VDF.CLI")) return candidate;
  }
  throw new Error("The upstream archive did not contain VDF.CLI");
}

async function downloadTag(tag: string, destination: string): Promise<void> {
  const url = `https://github.com/${UPSTREAM_REPO}/archive/refs/tags/${tag}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function extractArchive(archive: string, destination: string): void {
  const tar = spawnSync("tar", ["-xzf", archive, "-C", destination], { stdio: "inherit" });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error("tar could not extract the upstream archive");
}

async function updateEngine(tagInput: string): Promise<void> {
  const { tag, version } = parseEngineTag(tagInput);
  const root = process.cwd();
  const engine = path.join(root, "engine");
  const work = mkdtempSync(path.join(tmpdir(), "immich-vdf-engine-"));
  try {
    const archive = path.join(work, "upstream.tar.gz");
    console.log(`Downloading ${tag}`);
    await downloadTag(tag, archive);
    extractArchive(archive, work);
    const source = findExtractedRoot(work);
    for (const name of COPIED) {
      const from = path.join(source, name);
      const to = path.join(engine, name);
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
    }
    const commit = await commitForTag(tag);
    const pin = {
      repository: `https://github.com/${UPSTREAM_REPO}`,
      tag,
      commit,
      version,
    };
    writeFileSync(path.join(engine, "UPSTREAM.json"), renderUpstreamPin(pin));
    writeFileSync(path.join(engine, "fork-version.txt"), `${version}\n`);
    console.log(`Engine is now ${tag} (${commit})`);
    console.log("Next: npm run build:cli && npm test && npm run test:engine");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("Usage: npm run update-engine -- v4.1.1");
    process.exit(1);
  }
  updateEngine(tag).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
