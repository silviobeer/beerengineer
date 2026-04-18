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

export type ProjectsOutput = z.infer<typeof projectsOutputSchema>;
export type StoriesOutput = z.infer<typeof storiesOutputSchema>;
export type ArchitecturePlanOutput = z.infer<typeof architecturePlanOutputSchema>;
