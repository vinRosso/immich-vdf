import assert from "node:assert/strict";
import test from "node:test";
import { filmstripBatchArgs } from "../src/lib/ffmpeg-args";

test("the filmstrip batch opens the file once per frame and maps each input to its own output", () => {
  const args = filmstripBatchArgs("/media/a.mp4", [
    { seconds: 0, output: "/t/s0.jpg" },
    { seconds: 4.5, output: "/t/s2.jpg" },
  ]);
  assert.equal(args.filter((arg) => arg === "-i").length, 2);
  assert.deepEqual(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4), ["-ss", "4.500", "-i", "/media/a.mp4"]);
  assert.equal(args.filter((arg) => arg === "-ss").length, 1);
  assert.deepEqual(args.filter((arg) => /^\d:v:0$/.test(arg)), ["0:v:0", "1:v:0"]);
  assert.equal(args.at(-1), "/t/s2.jpg");
  assert.equal(args.includes("/t/s0.jpg"), true);
});
