import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCliResults } from "../src/lib/parse-results";

const file = path.join(process.cwd(), "fixtures", "cli-results.json");
const groups = parseCliResults(readFileSync(file, "utf8"));
if (groups.length !== 2) {
  console.error(`expected 2 groups, got ${groups.length}`);
  process.exit(1);
}
const clip = groups[1]?.items.find((item) => item.partialClipOffsetSeconds === 125);
if (!clip || !clip.flags.includes("PartialClip") || !clip.flags.includes("AiMatched")) {
  console.error("fixture is missing the partial-clip item at 00:02:05");
  process.exit(1);
}
if (groups[0]?.items[0]?.path !== "/media/library/holiday-1080p.mp4") {
  console.error("fixture path did not parse");
  process.exit(1);
}
console.log(`parsed ${groups.length} groups from ${file}`);
