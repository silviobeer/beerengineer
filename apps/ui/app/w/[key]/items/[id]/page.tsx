import { notFound } from "next/navigation";
import { fetchItem } from "../../../../_engine/server";
import { ItemDetailClient } from "./ItemDetailClient";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ key: string; id: string }>;
}) {
  const { id } = await params;
  try {
    const item = await fetchItem(id);
    return <ItemDetailClient item={item} />;
  } catch {
    notFound();
  }
}
