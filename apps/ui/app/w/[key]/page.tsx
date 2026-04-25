import { Board } from "@/components/Board";
import { fetchBoard, buildSseUrl } from "@/lib/api";

interface BoardPageProps {
  params: Promise<{ key: string }>;
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { key } = await params;
  const items = await fetchBoard(key);
  const sseUrl = buildSseUrl(key);
  return <Board workspaceKey={key} initialItems={items} sseUrl={sseUrl} />;
}
