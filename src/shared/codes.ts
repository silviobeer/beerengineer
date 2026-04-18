const ITEM_CODE_WIDTH = 4;
const PROJECT_CODE_WIDTH = 2;
const STORY_CODE_WIDTH = 2;
const ACCEPTANCE_CRITERION_CODE_WIDTH = 2;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatItemCode(sequence: number): string {
  return `ITEM-${pad(sequence, ITEM_CODE_WIDTH)}`;
}

export function formatProjectCode(itemCode: string, sequence: number): string {
  return `${itemCode}-P${pad(sequence, PROJECT_CODE_WIDTH)}`;
}

export function formatStoryCode(projectCode: string, sequence: number): string {
  return `${projectCode}-US${pad(sequence, STORY_CODE_WIDTH)}`;
}

export function formatAcceptanceCriterionCode(storyCode: string, sequence: number): string {
  return `${storyCode}-AC${pad(sequence, ACCEPTANCE_CRITERION_CODE_WIDTH)}`;
}

export function parseItemCodeSequence(code: string): number | null {
  const match = /^ITEM-(\d{4,})$/.exec(code);
  return match ? Number(match[1]) : null;
}
