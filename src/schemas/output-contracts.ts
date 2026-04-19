import { z } from "zod";

export const projectsOutputSchema = z.object({
  projects: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string().min(1),
      goal: z.string().min(1)
    })
  ).min(1)
});

export const storiesOutputSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      actor: z.string().min(1),
      goal: z.string().min(1),
      benefit: z.string().min(1),
      acceptanceCriteria: z.array(z.string().min(1)).min(1),
      priority: z.enum(["low", "medium", "high"])
    })
  ).min(1)
});

export const architecturePlanOutputSchema = z.object({
  summary: z.string().min(1),
  decisions: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)),
  nextSteps: z.array(z.string().min(1))
});

export const implementationPlanOutputSchema = z.object({
  summary: z.string().min(1),
  waves: z.array(
    z.object({
      waveCode: z.string().min(1),
      goal: z.string().min(1),
      dependsOn: z.array(z.string().min(1)).default([]),
      stories: z.array(
        z.object({
          storyCode: z.string().min(1),
          dependsOnStoryCodes: z.array(z.string().min(1)).default([]),
          parallelGroup: z.string().min(1).nullable().optional()
        })
      ).min(1)
    })
  ).min(1),
  risks: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1))
});

export const storyExecutionOutputSchema = z.object({
  summary: z.string().min(1),
  changedFiles: z.array(z.string().min(1)),
  testsRun: z.array(
    z.object({
      command: z.string().min(1),
      status: z.enum(["passed", "failed", "not_run"])
    })
  ),
  implementationNotes: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1))
});

export const testPreparationOutputSchema = z.object({
  summary: z.string().min(1),
  testFiles: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string().min(1),
      writeMode: z.enum(["proposed", "written"])
    })
  ).min(1),
  testsGenerated: z.array(
    z.object({
      path: z.string().min(1),
      intent: z.string().min(1)
    })
  ).min(1),
  assumptions: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1))
});

export const ralphVerificationOutputSchema = z.object({
  storyCode: z.string().min(1),
  overallStatus: z.enum(["passed", "review_required", "failed"]),
  summary: z.string().min(1),
  acceptanceCriteriaResults: z.array(
    z.object({
      acceptanceCriterionId: z.string().min(1),
      acceptanceCriterionCode: z.string().min(1),
      status: z.enum(["passed", "review_required", "failed"]),
      evidence: z.string().min(1),
      notes: z.string().min(1)
    })
  ).min(1),
  blockers: z.array(z.string().min(1))
});

export const appVerificationOutputSchema = z.object({
  storyCode: z.string().min(1),
  runner: z.enum(["agent_browser", "playwright"]),
  overallStatus: z.enum(["passed", "review_required", "failed"]),
  summary: z.string().min(1),
  resolvedStartUrl: z.string().min(1).nullable().optional(),
  checks: z.array(
    z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      status: z.enum(["passed", "review_required", "failed"]),
      evidence: z.string().min(1)
    })
  ).min(1),
  artifacts: z.array(
    z.object({
      kind: z.enum(["screenshot", "log", "trace", "report"]),
      path: z.string().min(1),
      label: z.string().min(1),
      contentType: z.string().min(1)
    })
  ).default([]),
  failureSummary: z.string().min(1).nullable().optional()
});

export const qaOutputSchema = z.object({
  projectCode: z.string().min(1),
  overallStatus: z.enum(["passed", "review_required", "failed"]),
  summary: z.string().min(1),
  findings: z.array(
    z.object({
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.enum(["functional", "security", "regression", "ux"]),
      title: z.string().min(1),
      description: z.string().min(1),
      evidence: z.string().min(1),
      reproSteps: z.array(z.string().min(1)),
      suggestedFix: z.string().min(1),
      storyCode: z.string().min(1).nullable().optional(),
      acceptanceCriterionCode: z.string().min(1).nullable().optional()
    })
  ),
  recommendations: z.array(z.string().min(1)).default([])
});

export const storyReviewOutputSchema = z.object({
  storyCode: z.string().min(1),
  overallStatus: z.enum(["passed", "review_required", "failed"]),
  summary: z.string().min(1),
  findings: z.array(
    z.object({
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.enum(["correctness", "security", "reliability", "performance", "maintainability", "persistence"]),
      title: z.string().min(1),
      description: z.string().min(1),
      evidence: z.string().min(1),
      filePath: z.string().min(1).nullable().optional(),
      line: z.number().int().positive().nullable().optional(),
      suggestedFix: z.string().min(1).nullable().optional()
    })
  ),
  recommendations: z.array(z.string().min(1)).default([])
});

export const documentationOutputSchema = z.object({
  projectCode: z.string().min(1),
  overallStatus: z.enum(["completed", "review_required"]),
  summary: z.string().min(1),
  originalScope: z.string().min(1),
  deliveredScope: z.string().min(1),
  architectureSnapshot: z.string().min(1),
  waves: z.array(
    z.object({
      waveCode: z.string().min(1),
      goal: z.string().min(1),
      storiesDelivered: z.array(z.string().min(1)).min(1)
    })
  ).min(1),
  storiesDelivered: z.array(
    z.object({
      storyCode: z.string().min(1),
      summary: z.string().min(1)
    })
  ).min(1),
  verificationSummary: z.object({
    ralphPassedStoryCodes: z.array(z.string().min(1)),
    storyReviewPassedStoryCodes: z.array(z.string().min(1)),
    qaStatus: z.enum(["passed", "review_required"]),
    qaOpenFindingCount: z.number().int().nonnegative()
  }),
  technicalReviewSummary: z.object({
    reviewedStoryCodes: z.array(z.string().min(1)),
    openFindingCounts: z.object({
      critical: z.number().int().nonnegative(),
      high: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      low: z.number().int().nonnegative()
    })
  }),
  qaSummary: z.object({
    status: z.enum(["passed", "review_required"]),
    summary: z.string().min(1),
    openFindings: z.number().int().nonnegative()
  }),
  openFollowUps: z.array(z.string().min(1)),
  keyChangedAreas: z.array(z.string().min(1)),
  reportMarkdown: z.string().min(1)
});

export type ProjectsOutput = z.infer<typeof projectsOutputSchema>;
export type StoriesOutput = z.infer<typeof storiesOutputSchema>;
export type ArchitecturePlanOutput = z.infer<typeof architecturePlanOutputSchema>;
export type ImplementationPlanOutput = z.infer<typeof implementationPlanOutputSchema>;
export type StoryExecutionOutput = z.infer<typeof storyExecutionOutputSchema>;
export type TestPreparationOutput = z.infer<typeof testPreparationOutputSchema>;
export type RalphVerificationOutput = z.infer<typeof ralphVerificationOutputSchema>;
export type AppVerificationOutput = z.infer<typeof appVerificationOutputSchema>;
export type QaOutput = z.infer<typeof qaOutputSchema>;
export type StoryReviewOutput = z.infer<typeof storyReviewOutputSchema>;
export type DocumentationOutput = z.infer<typeof documentationOutputSchema>;
