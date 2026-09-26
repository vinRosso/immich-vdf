export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
