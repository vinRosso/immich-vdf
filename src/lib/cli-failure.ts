/** How a vdf-cli process ended. */
export type CliOutcome = {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnFailed: boolean;
};

/** Sentence for a run that ended badly, with the last thing the CLI said when it said anything. */
export function cliFailure(
  outcome: { code: number | null; signal?: NodeJS.Signals | null; spawnFailed: boolean },
  tail: string | null,
): string {
  if (outcome.spawnFailed) return "vdf-cli could not be started. Set VDF_CLI or run the Docker image.";
  const suffix = tail ? `: ${tail}` : "";
  if (outcome.code === null) {
    return `${outcome.signal ? `vdf-cli was stopped by ${outcome.signal}` : "vdf-cli stopped without an exit code"}${suffix}`;
  }
  return `vdf-cli exited with code ${outcome.code}${suffix}`;
}
