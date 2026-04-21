export type BrainstormScalarExtractionField =
  | "problem"
  | "coreOutcome"
  | "recommendedDirection"
  | "scopeNotes";

export type BrainstormListExtractionField =
  | "targetUsers"
  | "useCases"
  | "constraints"
  | "nonGoals"
  | "risks"
  | "assumptions"
  | "openQuestions"
  | "candidateDirections";

export type BrainstormExtractionField = BrainstormScalarExtractionField | BrainstormListExtractionField;

export type BrainstormExtraction = Record<BrainstormListExtractionField, string[]>;

export type BrainstormMessageStructure = BrainstormExtraction & {
  problem: string | null;
  coreOutcome: string | null;
  recommendedDirection: string | null;
  scopeNotes: string | null;
};

const LIST_FIELD_LABELS: Array<{ field: BrainstormListExtractionField; labels: string[] }> = [
  { field: "targetUsers", labels: ["target users", "target user", "users", "user", "actors", "actor"] },
  { field: "useCases", labels: ["use cases", "use case", "scenarios", "scenario"] },
  { field: "constraints", labels: ["constraints", "constraint"] },
  { field: "nonGoals", labels: ["non-goals", "non goals", "non-goal", "non goal", "out of scope", "out-of-scope"] },
  { field: "risks", labels: ["risks", "risk"] },
  { field: "assumptions", labels: ["assumptions", "assumption"] },
  { field: "openQuestions", labels: ["open questions", "open question", "questions", "question"] },
  { field: "candidateDirections", labels: ["candidate directions", "candidate direction", "directions", "direction", "options", "option"] }
];

const SCALAR_FIELD_LABELS: Array<{ field: BrainstormScalarExtractionField; labels: string[] }> = [
  { field: "problem", labels: ["problem"] },
  { field: "coreOutcome", labels: ["core outcome", "desired outcome", "outcome"] },
  { field: "recommendedDirection", labels: ["recommended direction", "recommendation", "recommended approach"] },
  { field: "scopeNotes", labels: ["scope notes", "notes"] }
];

function emptyExtraction(): BrainstormMessageStructure {
  return {
    problem: null,
    coreOutcome: null,
    targetUsers: [],
    useCases: [],
    constraints: [],
    nonGoals: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    candidateDirections: [],
    recommendedDirection: null,
    scopeNotes: null
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

function resolveListFieldFromLabel(label: string): BrainstormListExtractionField | null {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  for (const entry of LIST_FIELD_LABELS) {
    if (entry.labels.includes(normalized)) {
      return entry.field;
    }
  }
  return null;
}

function resolveScalarFieldFromLabel(label: string): BrainstormScalarExtractionField | null {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  for (const entry of SCALAR_FIELD_LABELS) {
    if (entry.labels.includes(normalized)) {
      return entry.field;
    }
  }
  return null;
}

const LABEL_LINE = /^([a-z][a-z\s-]{1,30}):\s*(.*)$/i;
const BULLET_LINE = /^\s*[-*•]\s+(.+)$/;

export function extractLabeledBrainstormLists(message: string): BrainstormExtraction {
  const structured = extractBrainstormMessageStructure(message);
  return {
    targetUsers: structured.targetUsers,
    useCases: structured.useCases,
    constraints: structured.constraints,
    nonGoals: structured.nonGoals,
    risks: structured.risks,
    assumptions: structured.assumptions,
    openQuestions: structured.openQuestions,
    candidateDirections: structured.candidateDirections
  };
}

export function extractBrainstormMessageStructure(message: string): BrainstormMessageStructure {
  const result = emptyExtraction();
  if (!message) {
    return result;
  }

  const lines = message.split(/\r?\n/);
  let activeListField: BrainstormListExtractionField | null = null;
  let activeScalarField: BrainstormScalarExtractionField | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      activeListField = null;
      activeScalarField = null;
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch && activeListField) {
      result[activeListField].push(bulletMatch[1]!);
      continue;
    }
    if (bulletMatch && activeScalarField === "scopeNotes") {
      result.scopeNotes = [result.scopeNotes, bulletMatch[1]!].filter(Boolean).join("\n");
      continue;
    }

    const labelMatch = line.match(LABEL_LINE);
    if (labelMatch) {
      const scalarField = resolveScalarFieldFromLabel(labelMatch[1]!);
      if (scalarField) {
        activeScalarField = scalarField;
        activeListField = null;
        const inline = normalizeWhitespace(labelMatch[2]!);
        if (inline) {
          result[scalarField] = inline;
        }
        continue;
      }

      const listField = resolveListFieldFromLabel(labelMatch[1]!);
      if (!listField) {
        activeListField = null;
        activeScalarField = null;
        continue;
      }
      activeListField = listField;
      activeScalarField = null;
      const inline = labelMatch[2]!.trim();
      if (inline) {
        result[listField].push(...splitInlineEntries(inline));
      }
      continue;
    }

    activeListField = null;
    activeScalarField = null;
  }

  for (const field of [
    "targetUsers",
    "useCases",
    "constraints",
    "nonGoals",
    "risks",
    "assumptions",
    "openQuestions",
    "candidateDirections"
  ] as BrainstormListExtractionField[]) {
    result[field] = dedupe(result[field]);
  }
  result.problem = result.problem ? normalizeWhitespace(result.problem) : null;
  result.coreOutcome = result.coreOutcome ? normalizeWhitespace(result.coreOutcome) : null;
  result.recommendedDirection = result.recommendedDirection ? normalizeWhitespace(result.recommendedDirection) : null;
  result.scopeNotes = result.scopeNotes ? result.scopeNotes.split("\n").map((entry) => normalizeWhitespace(entry)).filter(Boolean).join("\n") : null;
  return result;
}

export function hasAnyExtraction(extraction: BrainstormMessageStructure | BrainstormExtraction): boolean {
  return Object.values(extraction).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
}

export function mergeBrainstormMessageStructures(
  values: BrainstormMessageStructure[]
): BrainstormMessageStructure {
  const result = emptyExtraction();
  for (const value of values) {
    if (value.problem) {
      result.problem = value.problem;
    }
    if (value.coreOutcome) {
      result.coreOutcome = value.coreOutcome;
    }
    if (value.recommendedDirection) {
      result.recommendedDirection = value.recommendedDirection;
    }
    if (value.scopeNotes) {
      result.scopeNotes = value.scopeNotes;
    }
    for (const field of [
      "targetUsers",
      "useCases",
      "constraints",
      "nonGoals",
      "risks",
      "assumptions",
      "openQuestions",
      "candidateDirections"
    ] as BrainstormListExtractionField[]) {
      result[field] = dedupe([...result[field], ...value[field]]);
    }
  }
  return result;
}
