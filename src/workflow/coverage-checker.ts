export type CoverageSourceField =
  | "targetUsers"
  | "useCases"
  | "constraints"
  | "nonGoals"
  | "risks"
  | "assumptions";

export type CoverageSeverity = "blocker" | "major";

export type CoverageGap = {
  sourceField: CoverageSourceField;
  sourceEntry: string;
  severity: CoverageSeverity;
  missingTokens: string[];
};

export type CoverageUpstream = {
  targetUsers: string[];
  useCases: string[];
  constraints: string[];
  nonGoals: string[];
  risks: string[];
  assumptions: string[];
};

export type CoverageStory = {
  title: string;
  description: string;
  actor: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string[];
};

export type CoverageCheckResult = {
  gaps: CoverageGap[];
  blockerCount: number;
  majorCount: number;
  summary: string;
};

const SEVERITY_BY_FIELD: Record<CoverageSourceField, CoverageSeverity> = {
  targetUsers: "blocker",
  useCases: "blocker",
  constraints: "blocker",
  nonGoals: "major",
  risks: "major",
  assumptions: "major"
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "these", "those",
  "about", "over", "under", "when", "where", "while", "because", "also",
  "such", "than", "then", "there", "their", "they", "have", "has", "had",
  "should", "could", "would", "will", "shall", "must", "need", "needs", "want",
  "user", "users", "system", "app", "project", "feature", "features",
  "via", "per", "each", "every", "any", "all", "some", "one", "two",
  "use", "uses", "using", "used", "case", "cases",
  "to", "of", "in", "on", "at", "by", "as", "an", "or", "is", "are",
  "be", "been", "being", "a", "i", "it", "its", "we", "us", "our",
  "ui", "ux", "api", "cli"
]);

const MIN_TOKEN_LENGTH = 3;
const COVERAGE_THRESHOLD = 0.5;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]+/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildStoryCorpus(stories: CoverageStory[]): string {
  return stories
    .map((story) =>
      [story.title, story.description, story.actor, story.goal, story.benefit, ...story.acceptanceCriteria]
        .join(" ")
    )
    .join("\n")
    .toLowerCase();
}

function isEntryCovered(entry: string, corpus: string, markdownCorpus: string): { covered: boolean; missingTokens: string[] } {
  const normalizedEntry = normalizeText(entry);
  if (!normalizedEntry) {
    return { covered: true, missingTokens: [] };
  }

  if (corpus.includes(normalizedEntry) || markdownCorpus.includes(normalizedEntry)) {
    return { covered: true, missingTokens: [] };
  }

  const tokens = Array.from(new Set(tokenize(entry)));
  if (tokens.length === 0) {
    const haystack = `${corpus}\n${markdownCorpus}`;
    return { covered: haystack.includes(normalizedEntry), missingTokens: [] };
  }

  const combined = `${corpus}\n${markdownCorpus}`;
  const hitTokens = tokens.filter((token) => combined.includes(token));
  const ratio = hitTokens.length / tokens.length;
  if (ratio >= COVERAGE_THRESHOLD) {
    return { covered: true, missingTokens: [] };
  }
  const missing = tokens.filter((token) => !combined.includes(token));
  return { covered: false, missingTokens: missing };
}

export function checkRequirementsCoverage(input: {
  upstream: CoverageUpstream;
  stories: CoverageStory[];
  storiesMarkdown: string | null;
}): CoverageCheckResult {
  const corpus = buildStoryCorpus(input.stories);
  const markdownCorpus = (input.storiesMarkdown ?? "").toLowerCase();
  const gaps: CoverageGap[] = [];

  const fields: CoverageSourceField[] = ["targetUsers", "useCases", "constraints", "nonGoals", "risks", "assumptions"];
  for (const field of fields) {
    for (const entry of input.upstream[field]) {
      const { covered, missingTokens } = isEntryCovered(entry, corpus, markdownCorpus);
      if (!covered) {
        gaps.push({
          sourceField: field,
          sourceEntry: entry,
          severity: SEVERITY_BY_FIELD[field],
          missingTokens
        });
      }
    }
  }

  const blockerCount = gaps.filter((gap) => gap.severity === "blocker").length;
  const majorCount = gaps.filter((gap) => gap.severity === "major").length;
  const summary = gaps.length === 0
    ? "All upstream entries appear to be covered by the generated stories."
    : `Uncovered upstream entries: ${blockerCount} blocker, ${majorCount} major.`;

  return { gaps, blockerCount, majorCount, summary };
}

export function formatCoverageGapList(gaps: CoverageGap[], limit = 20): string {
  if (gaps.length === 0) {
    return "";
  }
  const lines = gaps.slice(0, limit).map((gap) => `- [${gap.severity}] ${gap.sourceField}: "${gap.sourceEntry}"`);
  const overflow = gaps.length > limit ? `\n…and ${gaps.length - limit} more` : "";
  return `${lines.join("\n")}${overflow}`;
}
