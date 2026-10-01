/** At least 8 characters. The `.env.example` value `change-me` is refused. */
export function passwordIsAcceptable(password: string): boolean {
  const value = password.trim();
  if (value.length < 8) return false;
  return value.toLowerCase() !== "change-me";
}
