export type GenericUpstreamContext = {
  designConstraints: string[];
  requiredDeliverables: string[];
  referenceArtifacts: string[];
};

function normalizeEntry(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeEntry(value);
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

function extractMarkdownLinks(scopeNotes: string): string[] {
  return Array.from(scopeNotes.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g))
    .map((match) => `${match[1]} -> ${match[2]}`)
    .filter((entry) => /\b(mockup|wireframe|spec|reference|figma|design)\b/i.test(entry));
}

function extractBacktickedDeliverables(scopeNotes: string): string[] {
  return Array.from(scopeNotes.matchAll(/`([^`]+)`/g))
    .map((match) => normalizeEntry(match[1]!))
    .filter((entry) => /^[A-Za-z][A-Za-z0-9/_ -]{1,80}$/.test(entry))
    .filter((entry) => !/\b(idea|brainstorm|requirements|implementation|done)\b/i.test(entry));
}

function extractLinesByHeading(scopeNotes: string, headingMatchers: RegExp[]): string[] {
  const lines = scopeNotes.split(/\r?\n/);
  const result: string[] = [];
  let capture = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (capture) {
        continue;
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      capture = headingMatchers.some((matcher) => matcher.test(line));
      continue;
    }
    if (capture) {
      result.push(line.replace(/^\s*[-*•]\s*/, ""));
    }
  }

  return result;
}

export function deriveGenericUpstreamContext(input: {
  constraints?: string[] | null;
  nonGoals?: string[] | null;
  scopeNotes?: string | null;
}): GenericUpstreamContext {
  const constraints = input.constraints ?? [];
  const nonGoals = input.nonGoals ?? [];
  const scopeNotes = input.scopeNotes ?? "";

  const designConstraints = dedupe([
    ...constraints.filter((entry) =>
      /\b(design|visual|layout|typography|font|color|theme|look|feel|control panel|marketing|terminal emulator|shell)\b/i.test(entry)
    ),
    ...nonGoals.filter((entry) =>
      /\b(marketing|terminal emulator|visual|theme|look|feel)\b/i.test(entry)
    ),
    ...extractLinesByHeading(scopeNotes, [/^#{1,6}\s+shared design inputs\b/i, /^#{1,6}\s+component constraints\b/i]).filter((entry) =>
      /\b(color|font|typography|button|background|petrol|gold|mono|inter|space grotesk|design|visual|layout)\b/i.test(entry)
    )
  ]);

  const requiredDeliverables = dedupe([
    ...constraints.filter((entry) =>
      /\b(showcase|inventory|deliverable|component list|component inventory)\b/i.test(entry)
    ),
    ...extractLinesByHeading(scopeNotes, [
      /^#{1,6}\s+required deliverables\b/i,
      /^#{1,6}\s+ui showcase requirement\b/i,
      /^#{1,6}\s+component inventory requirement\b/i
    ]),
    ...extractBacktickedDeliverables(scopeNotes).filter((entry) =>
      /\b(showcase|inventory|view|switcher|nav|overlay|conversation|board|inbox|signals|shell|button|chip|state|panel|row)\b/i.test(entry)
    )
  ]);

  const referenceArtifacts = dedupe([
    ...extractMarkdownLinks(scopeNotes),
    ...scopeNotes
      .split(/\r?\n/)
      .map((line) => normalizeEntry(line))
      .filter((line) => /\b(reference|mockup|wireframe|figma|prototype|spec)\b/i.test(line))
      .filter((line) => line.length <= 200)
  ]);

  return {
    designConstraints,
    requiredDeliverables,
    referenceArtifacts
  };
}
