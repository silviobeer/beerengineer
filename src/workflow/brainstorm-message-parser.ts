export type BrainstormExtractionField =
  | "targetUsers"
  | "useCases"
  | "constraints"
  | "nonGoals"
  | "risks"
  | "assumptions";

export type BrainstormExtraction = Record<BrainstormExtractionField, string[]>;

const FIELD_LABELS: Array<{ field: BrainstormExtractionField; labels: string[] }> = [
  { field: "targetUsers", labels: ["target users", "target user", "users", "user", "actors", "actor"] },
  { field: "useCases", labels: ["use cases", "use case", "scenarios", "scenario"] },
  { field: "constraints", labels: ["constraints", "constraint"] },
  { field: "nonGoals", labels: ["non-goals", "non goals", "non-goal", "non goal", "out of scope", "out-of-scope"] },
  { field: "risks", labels: ["risks", "risk"] },
  { field: "assumptions", labels: ["assumptions", "assumption"] }
];

function emptyExtraction(): BrainstormExtraction {
  return {
    targetUsers: [],
    useCases: [],
    constraints: [],
    nonGoals: [],
    risks: [],
    assumptions: []
  };
}

function splitInlineEntries(value: string): string[] {
  return value
    .split(/\s*[;,]\s*|\s+\/\s+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function resolveFieldFromLabel(label: string): BrainstormExtractionField | null {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  for (const entry of FIELD_LABELS) {
    if (entry.labels.includes(normalized)) {
      return entry.field;
    }
  }
  return null;
}

const LABEL_LINE = /^([a-z][a-z\s-]{1,30}):\s*(.*)$/i;
const BULLET_LINE = /^\s*[-*•]\s+(.+)$/;

export function extractLabeledBrainstormLists(message: string): BrainstormExtraction {
  const result = emptyExtraction();
  if (!message) {
    return result;
  }

  const lines = message.split(/\r?\n/);
  let activeField: BrainstormExtractionField | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      activeField = null;
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch && activeField) {
      result[activeField].push(bulletMatch[1]!);
      continue;
    }

    const labelMatch = line.match(LABEL_LINE);
    if (labelMatch) {
      const field = resolveFieldFromLabel(labelMatch[1]!);
      if (!field) {
        activeField = null;
        continue;
      }
      activeField = field;
      const inline = labelMatch[2]!.trim();
      if (inline) {
        result[field].push(...splitInlineEntries(inline));
      }
      continue;
    }

    activeField = null;
  }

  for (const field of Object.keys(result) as BrainstormExtractionField[]) {
    result[field] = dedupe(result[field]);
  }
  return result;
}

export function hasAnyExtraction(extraction: BrainstormExtraction): boolean {
  return Object.values(extraction).some((entries) => entries.length > 0);
}
