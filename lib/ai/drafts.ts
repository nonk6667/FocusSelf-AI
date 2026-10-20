import { z } from "zod";
import { id, parseState, validateTask, type State, type Task } from "@/lib/model";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, "日期无效");
export const aiDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  notes: z.string().max(2000).default(""),
  projectId: z.string().max(100),
  plannedDate: date, dueDate: date,
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  estimate: z.number().int().min(1).max(1440).default(30),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")).default(""),
}).strict();
export type AIDraft = z.infer<typeof aiDraftSchema>;
const replySchema = z.object({tasks: z.array(aiDraftSchema).min(1).max(3), note: z.string().max(1000).default("")}).strict();
export function parseAIDrafts(text: string) {
  if (text.length > 24000) throw Error("回复过长，请一次生成更少任务。");
  const source = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
  return replySchema.parse(JSON.parse(source));
}
export function draftTask(draft: AIDraft): Task {
  return {
    ...aiDraftSchema.parse(draft), id: id(), milestoneId: "", cadence: "daily",
    actual: 0, completedAt: null, createdAt: new Date().toISOString(), rollovers: [],
  };
}
export function validateAIDraft(draft: AIDraft, state: State) { validateTask(draftTask(draft), state); }
export function applyAIDrafts(state: State, drafts: AIDraft[]): State {
  if (drafts.length < 1 || drafts.length > 3) throw Error("每次可加入 1–3 个任务。");
  const tasks = drafts.map(d => { const task = draftTask(d); validateTask(task, state); return task; });
  return parseState({...state, tasks: [...state.tasks, ...tasks], updatedAt: new Date().toISOString()});
}
