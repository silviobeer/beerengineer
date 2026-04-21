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
  smallestUsefulOutcome: string | null;
  projectShapeDecision: "single_project" | "split_projects" | null;
  decisionRationale: string | null;
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

const PROJECT_SHAPE_DECISION_LABELS = ["project shape decision", "project shape"];
const SMALLEST_OUTCOME_LABELS = ["smallest useful user outcome", "smallest useful outcome", "smallest useful slice"];
const DECISION_RATIONALE_LABELS = ["rationale", "decision rationale"];

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
    scopeNotes: null,
    smallestUsefulOutcome: null,
    projectShapeDecision: null,
    decisionRationale: null
  };
}

function splitInlineEntries(value: string, field?: BrainstormListExtractionField): string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }
  if (field === "targetUsers") {
    return normalized
      .split(/\s*;\s*|\s*,\s*|\s+\/\s+/g)
      .map((entry) => entry.replace(/^and\s+/i, "").replace(/[.,;:]+$/, "").trim())
      .filter((entry) => entry.length > 0);
  }
  return normalized
    .split(/\s*;\s*|\s+\/\s+/g)
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

function isProjectShapeDecisionLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  return PROJECT_SHAPE_DECISION_LABELS.includes(normalized);
}

function isSmallestOutcomeLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  return SMALLEST_OUTCOME_LABELS.includes(normalized);
}

function isDecisionRationaleLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  return DECISION_RATIONALE_LABELS.includes(normalized);
}

const LABEL_LINE = /^([a-z][a-z\s-]{1,30}):\s*(.*)$/i;
const BULLET_LINE = /^\s*[-*•]\s+(.+)$/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

function normalizeProjectShapeDecision(value: string): "single_project" | "split_projects" | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (/\bsingle[_\s-]*project\b/.test(normalized) || /\bone focused project\b/.test(normalized)) {
    return "single_project";
  }
  if (/\bsplit[_\s-]*projects?\b/.test(normalized) || /\bmultiple projects?\b/.test(normalized)) {
    return "split_projects";
  }
  return null;
}

function splitCompoundLabelLines(message: string): string[] {
  return message
    .replace(/\.\s+(?=[A-Z][A-Za-z\s-]{1,40}:)/g, ".\n")
    .replace(/;\s+(?=[A-Z][A-Za-z\s-]{1,40}:)/g, ";\n")
    .split(/\r?\n/);
}

function normalizeHeading(value: string): string {
  return value
    .replace(/[`*_]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripMarkdownDecorations(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function resolveHeadingFields(heading: string): {
  listField: BrainstormListExtractionField | null;
  scalarField: BrainstormScalarExtractionField | null;
} {
  const normalized = normalizeHeading(heading);
  if (!normalized) {
    return { listField: null, scalarField: null };
  }

  if (normalized === "goal" || normalized === "desired outcome") {
    return { listField: null, scalarField: "coreOutcome" };
  }
  if (normalized === "problem") {
    return { listField: null, scalarField: "problem" };
  }
  if (normalized === "recommended approach") {
    return { listField: null, scalarField: "recommendedDirection" };
  }
  if (normalized === "target users" || normalized === "actors") {
    return { listField: "targetUsers", scalarField: null };
  }
  if (
    normalized === "main views"
    || normalized.endsWith("capabilities")
    || normalized === "use cases"
  ) {
    return { listField: "useCases", scalarField: null };
  }
  if (
    normalized === "constraints"
    || normalized === "component constraints"
    || normalized === "confirmed design decisions"
  ) {
    return { listField: "constraints", scalarField: null };
  }
  if (normalized === "non goals" || normalized === "non-goals" || normalized === "out of scope") {
    return { listField: "nonGoals", scalarField: null };
  }
  if (normalized === "risks" || normalized.startsWith("risk ")) {
    return { listField: "risks", scalarField: null };
  }
  if (normalized === "open questions" || normalized === "questions") {
    return { listField: "openQuestions", scalarField: null };
  }
  if (normalized === "candidate directions" || normalized === "alternatives considered") {
    return { listField: "candidateDirections", scalarField: null };
  }
  if (
    normalized === "required deliverables"
    || normalized === "ui showcase requirement"
    || normalized === "component inventory requirement"
    || normalized === "scope notes"
  ) {
    return { listField: null, scalarField: "scopeNotes" };
  }

  if (
    normalized === "workspace first"
    || normalized === "board first"
    || normalized === "overlay detail panel"
    || normalized === "inbox is a first class view"
    || normalized === "ui uses core services not cli text"
  ) {
    return { listField: "constraints", scalarField: null };
  }

  return { listField: null, scalarField: null };
}

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

  const lines = splitCompoundLabelLines(message);
  let activeListField: BrainstormListExtractionField | null = null;
  let activeScalarField: BrainstormScalarExtractionField | null = null;
  let activeMetaField: "smallestUsefulOutcome" | "projectShapeDecision" | "decisionRationale" | null = null;
  let activeFromHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (!activeFromHeading) {
        activeListField = null;
        activeScalarField = null;
        activeMetaField = null;
      }
      continue;
    }

    const headingMatch = line.match(HEADING_LINE);
    if (headingMatch) {
      const resolved = resolveHeadingFields(headingMatch[1]!);
      activeListField = resolved.listField;
      activeScalarField = resolved.scalarField;
      activeMetaField = null;
      activeFromHeading = true;
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch && activeListField) {
      result[activeListField].push(stripMarkdownDecorations(bulletMatch[1]!));
      continue;
    }
    if (bulletMatch && activeScalarField === "scopeNotes") {
      result.scopeNotes = [result.scopeNotes, stripMarkdownDecorations(bulletMatch[1]!)].filter(Boolean).join("\n");
      continue;
    }
    if (bulletMatch && activeMetaField === "smallestUsefulOutcome") {
      result.smallestUsefulOutcome = normalizeWhitespace(stripMarkdownDecorations(bulletMatch[1]!));
      continue;
    }
    if (bulletMatch && activeMetaField === "decisionRationale") {
      result.decisionRationale = normalizeWhitespace(stripMarkdownDecorations(bulletMatch[1]!));
      continue;
    }
    if (bulletMatch && activeMetaField === "projectShapeDecision") {
      result.projectShapeDecision = normalizeProjectShapeDecision(stripMarkdownDecorations(bulletMatch[1]!));
      continue;
    }

    const labelMatch = line.match(LABEL_LINE);
    if (labelMatch) {
      const scalarField = resolveScalarFieldFromLabel(labelMatch[1]!);
      if (scalarField) {
        activeScalarField = scalarField;
        activeListField = null;
        activeMetaField = null;
        activeFromHeading = false;
        const inline = normalizeWhitespace(labelMatch[2]!);
        if (inline) {
          result[scalarField] = inline;
        }
        continue;
      }

      if (isSmallestOutcomeLabel(labelMatch[1]!)) {
        activeScalarField = null;
        activeListField = null;
        activeMetaField = "smallestUsefulOutcome";
        activeFromHeading = false;
        const inline = normalizeWhitespace(labelMatch[2]!);
        if (inline) {
          result.smallestUsefulOutcome = inline;
        }
        continue;
      }

      if (isProjectShapeDecisionLabel(labelMatch[1]!)) {
        activeScalarField = null;
        activeListField = null;
        activeMetaField = "projectShapeDecision";
        activeFromHeading = false;
        const inline = normalizeWhitespace(labelMatch[2]!);
        if (inline) {
          result.projectShapeDecision = normalizeProjectShapeDecision(inline);
        }
        continue;
      }

      if (isDecisionRationaleLabel(labelMatch[1]!)) {
        activeScalarField = null;
        activeListField = null;
        activeMetaField = "decisionRationale";
        activeFromHeading = false;
        const inline = normalizeWhitespace(labelMatch[2]!);
        if (inline) {
          result.decisionRationale = inline;
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
      activeMetaField = null;
      activeFromHeading = false;
      const inline = labelMatch[2]!.trim();
      if (inline) {
        result[listField].push(...splitInlineEntries(stripMarkdownDecorations(inline), listField));
      }
      continue;
    }

    const normalizedLine = stripMarkdownDecorations(line);
    if (activeListField) {
      result[activeListField].push(normalizedLine);
      continue;
    }
    if (activeScalarField === "scopeNotes") {
      result.scopeNotes = [result.scopeNotes, normalizedLine].filter(Boolean).join("\n");
      continue;
    }
    if (activeMetaField === "smallestUsefulOutcome" && !result.smallestUsefulOutcome) {
      result.smallestUsefulOutcome = normalizeWhitespace(normalizedLine);
      continue;
    }
    if (activeMetaField === "decisionRationale" && !result.decisionRationale) {
      result.decisionRationale = normalizeWhitespace(normalizedLine);
      continue;
    }
    if (activeMetaField === "projectShapeDecision" && !result.projectShapeDecision) {
      result.projectShapeDecision = normalizeProjectShapeDecision(normalizedLine);
      continue;
    }
    if (activeScalarField && !result[activeScalarField]) {
      result[activeScalarField] = normalizeWhitespace(normalizedLine);
      continue;
    }

    activeListField = null;
    activeScalarField = null;
    activeMetaField = null;
    activeFromHeading = false;
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
  result.smallestUsefulOutcome = result.smallestUsefulOutcome ? normalizeWhitespace(result.smallestUsefulOutcome) : null;
  result.decisionRationale = result.decisionRationale ? normalizeWhitespace(result.decisionRationale) : null;
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
    if (value.smallestUsefulOutcome) {
      result.smallestUsefulOutcome = value.smallestUsefulOutcome;
    }
    if (value.projectShapeDecision) {
      result.projectShapeDecision = value.projectShapeDecision;
    }
    if (value.decisionRationale) {
      result.decisionRationale = value.decisionRationale;
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
