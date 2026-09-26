import type { SectionId } from "./types";
import { safeFetch } from "./urls";

export async function postWebhook(
  url: string,
  body: { section: SectionId; status: "ok" | "error" | "skipped"; groupCount: number },
): Promise<void> {
  const response = await safeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      section: body.section,
      status: body.status,
      groupCount: body.groupCount,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 300) throw new Error(`Webhook returned ${response.status}`);
}
