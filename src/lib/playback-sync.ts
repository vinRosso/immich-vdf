/** drift = followerTime - leaderTime, in seconds. Positive means the follower is ahead. */
export type DriftAction = "jump" | "hold-follower" | "hold-leader" | "resume" | "wait";

const JUMP_AT = 0.25;
const HOLD_AT = 0.3;
const RELEASE_AT = 0.1;

export function driftAction(drift: number, canJump: boolean, userPaused: boolean): DriftAction {
  if (userPaused || !Number.isFinite(drift)) return "wait";
  if (canJump) return Math.abs(drift) > JUMP_AT ? "jump" : "resume";
  if (drift > HOLD_AT) return "hold-follower";
  if (drift < -HOLD_AT) return "hold-leader";
  if (Math.abs(drift) < RELEASE_AT) return "resume";
  return "wait";
}
