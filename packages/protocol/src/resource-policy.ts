import { z } from "zod";

export const ResourcePolicySchema = z.enum(["economy", "balanced", "deep"]);
export type ResourcePolicy = z.infer<typeof ResourcePolicySchema>;
