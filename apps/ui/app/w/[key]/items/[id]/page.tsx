import { fetchItem } from "../../../../_engine/server";
import { ItemDetailClient } from "./ItemDetailClient";

type PageProps = {
  params: Promise<{ key: string; id: string }>;
};

export default async function ItemDetailPage({ params }: PageProps) {
  const { id } = await params;
  let item;
  try {
    item = await fetchItem(id);
  } catch {
    return (
      <main className="p-6 text-sm text-red-400" role="alert">
        Failed to load item {id}.
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <ItemDetailClient item={item} />
    </main>
  );
}
