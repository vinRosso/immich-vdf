import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @param {string} name */
export function parseReleaseTag(name) {
  const match = RELEASE_TAG.exec(name.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** @param {{ major: number, minor: number, patch: number }} left @param {{ major: number, minor: number, patch: number }} right */
function compareRelease(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

/**
 * Docker tag suffixes for a publish.
 * `only` is the git tag that triggered an automatic run.
 * Without it, the highest vMAJOR.MINOR.PATCH name in `names` is used (manual run).
 * @param {string[]} names
 * @param {{ only?: string }} [options]
 * @returns {string[]}
 */
export function dockerTagSuffixes(names, options = {}) {
  let chosen = null;
  if (options.only != null && options.only !== "") {
    chosen = parseReleaseTag(options.only);
    if (!chosen) throw new Error(`Git tag ${options.only} must look like v0.1.0`);
  } else {
    for (const name of names) {
      const parsed = parseReleaseTag(name);
      if (parsed && (!chosen || compareRelease(parsed, chosen) > 0)) chosen = parsed;
    }
  }
  if (!chosen) return ["latest"];
  const version = `${chosen.major}.${chosen.minor}.${chosen.patch}`;
  return [version, `${chosen.major}.${chosen.minor}`, String(chosen.major), "latest"];
}

/** @param {string} image @param {string[]} suffixes */
export function qualifyImageTags(image, suffixes) {
  const name = image.trim();
  if (!name || /[\s,]/.test(name) || name.endsWith(":") || name.endsWith("/")) {
    throw new Error("Docker image name is empty");
  }
  return suffixes.map((suffix) => `${name}:${suffix}`);
}

function invokedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedAsCli()) {
  const image = process.argv[2] || "";
  const names = readFileSync(0, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    const tags = qualifyImageTags(image, dockerTagSuffixes(names, { only: process.env.RELEASE_TAG }));
    console.error(`Publishing ${tags.join(", ")}`);
    process.stdout.write(tags.join(","));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
