import { IgnoredScreen } from "@/components/ignored-screen";
import type { SectionId } from "@/lib/types";

export default async function IgnoredPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const id: SectionId = section === "immich" ? "immich" : "server";
  return <IgnoredScreen section={id} />;
}
