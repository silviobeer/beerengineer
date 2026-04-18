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

export type ProjectsOutput = z.infer<typeof projectsOutputSchema>;
export type StoriesOutput = z.infer<typeof storiesOutputSchema>;
export type ArchitecturePlanOutput = z.infer<typeof architecturePlanOutputSchema>;
export type ImplementationPlanOutput = z.infer<typeof implementationPlanOutputSchema>;
export type StoryExecutionOutput = z.infer<typeof storyExecutionOutputSchema>;
export type TestPreparationOutput = z.infer<typeof testPreparationOutputSchema>;
