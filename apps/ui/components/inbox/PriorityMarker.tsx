export function PriorityMarker({ priority }: { priority: "P1" | "P2" | "P3" }) {
  return <span className={`priority-marker priority-${priority.toLowerCase()}`}>{priority}</span>;
}
