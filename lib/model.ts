import { z } from "zod";
export const id = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
export const dateKey = (date = new Date(), timezone = "Europe/London") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "日期无效",
  );
const keySchema = z.string().min(1).max(100);
const titleSchema = z.string().trim().min(1, "请填写名称").max(160);
export const projectSchema = z.object({
  id: keySchema,
  name: titleSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  kind: z.enum(["work", "life"]),
});
export const goalSchema = z.object({
  id: keySchema,
  title: titleSchema,
  projectId: keySchema,
  dueDate: dateSchema,
});
export const milestoneSchema = z.object({
  id: keySchema,
  title: titleSchema,
  goalId: keySchema,
});
export const taskSchema = z.object({
  id: keySchema,
  title: titleSchema,
  notes: z.string().max(5000),
  projectId: keySchema,
  milestoneId: z.string(),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  plannedDate: dateSchema,
  dueDate: dateSchema,
  priority: z.enum(["high", "medium", "low"]),
  estimate: z.number().int().min(1).max(1440),
  actual: z.number().int().min(0).max(100000),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .or(z.literal("")),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  rollovers: z
    .array(
      z.object({ from: dateSchema, to: dateSchema, at: z.string().datetime() }),
    )
    .max(1000),
});
export const stateSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema).max(100),
  goals: z.array(goalSchema).max(1000),
  milestones: z.array(milestoneSchema).max(5000),
  tasks: z.array(taskSchema).max(20000),
  settings: z.object({
    capacityMinutes: z.number().int().min(30).max(900),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "时区无效"),
    autoRollover: z.boolean(),
  }),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type Task = z.infer<typeof taskSchema>;
export type State = z.infer<typeof stateSchema>;
export type Period = Task["cadence"];
export const periodNames: Record<Period, string> = {
  daily: "日",
  weekly: "周",
  monthly: "月",
};
export const priorityNames = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};
export function shiftDate(key: string, days: number) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
export function rangeFor(key: string, period: Period): [string, string] {
  if (period === "daily") return [key, key];
  const d = new Date(key + "T12:00:00Z");
  if (period === "weekly") {
    const start = shiftDate(key, -((d.getUTCDay() + 6) % 7));
    return [start, shiftDate(start, 6)];
  }
  return [
    key.slice(0, 7) + "-01",
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))
      .toISOString()
      .slice(0, 10),
  ];
}
export function stepPeriod(key: string, period: Period, step: number) {
  if (period !== "monthly")
    return shiftDate(key, step * (period === "daily" ? 1 : 7));
  const d = new Date(key + "T12:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1, 12))
    .toISOString()
    .slice(0, 10);
}
export function tasksInRange(tasks: Task[], key: string, period: Period) {
  const [a, b] = rangeFor(key, period);
  return tasks.filter((t) => t.plannedDate >= a && t.plannedDate <= b);
}
export function progress(tasks: Task[]) {
  return tasks.length
    ? Math.round(
        (tasks.filter((t) => t.completedAt).length / tasks.length) * 100,
      )
    : 0;
}
export function goalTasks(state: State, goalId: string) {
  const ids = new Set(
    state.milestones.filter((m) => m.goalId === goalId).map((m) => m.id),
  );
  return state.tasks.filter((t) => ids.has(t.milestoneId));
}
export function protectedConflict(task: Task, project: Project) {
  if (!task.startTime) return "";
  const [h, m] = task.startTime.split(":").map(Number),
    start = h * 60 + m,
    end = start + task.estimate;
  if (end > 1440) return "任务不能跨越午夜，请调整开始时间或预计时长。";
  if (project.kind === "work" && start < 23 * 60 && end > 20 * 60)
    return "20:00–23:00 是健身 + CS2 受保护时段，请调整工作任务。";
  return "";
}
export function validateTask(task: Task, state: State) {
  taskSchema.parse(task);
  const p = state.projects.find((p) => p.id === task.projectId);
  if (!p) throw Error("项目不存在");
  if (task.milestoneId) {
    const m = state.milestones.find((m) => m.id === task.milestoneId),
      g = state.goals.find((g) => g.id === m?.goalId);
    if (!g || g.projectId !== task.projectId)
      throw Error("里程碑必须属于当前项目");
  }
  const conflict = protectedConflict(task, p);
  if (conflict) throw Error(conflict);
}
export function parseState(input: unknown): State {
  const s = stateSchema.parse(input);
  for (const list of [s.projects, s.goals, s.milestones, s.tasks])
    if (new Set(list.map((v) => v.id)).size !== list.length)
      throw Error("存在重复 ID");
  s.goals.forEach((g) => {
    if (!s.projects.some((p) => p.id === g.projectId))
      throw Error("目标引用了不存在的项目");
  });
  s.milestones.forEach((m) => {
    if (!s.goals.some((g) => g.id === m.goalId))
      throw Error("里程碑引用了不存在的目标");
  });
  s.tasks.forEach((t) => validateTask(t, s));
  return s;
}
export function rollOver(state: State, today: string, cadence?: Period): State {
  const now = new Date().toISOString();
  let changed = false;
  const tasks = state.tasks.map((t) => {
    const end = rangeFor(t.plannedDate, t.cadence)[1];
    if (t.completedAt || end >= today || (cadence && t.cadence !== cadence))
      return t;
    changed = true;
    return {
      ...t,
      plannedDate: today,
      rollovers: [
        ...t.rollovers,
        { from: t.plannedDate, to: today, at: now },
      ].slice(-1000),
    };
  });
  return changed ? { ...state, tasks, updatedAt: now } : state;
}
export function capacity(state: State, key: string) {
  const tasks = state.tasks.filter(
    (t) =>
      t.plannedDate === key &&
      state.projects.find((p) => p.id === t.projectId)?.kind === "work",
  );
  return {
    planned: tasks.reduce((a, t) => a + t.estimate, 0),
    remaining: tasks
      .filter((t) => !t.completedAt)
      .reduce((a, t) => a + Math.max(0, t.estimate - t.actual), 0),
    actual: tasks.reduce((a, t) => a + t.actual, 0),
    limit: state.settings.capacityMinutes,
  };
}
export function chartBuckets(tasks: Task[], key: string, period: Period) {
  const [start, end] = rangeFor(key, period);
  const buckets: {
    label: string;
    rate: number;
    total: number;
    done: number;
  }[] = [];
  const segments =
    period === "daily"
      ? [[start, end]]
      : period === "weekly"
        ? Array.from({ length: 7 }, (_, i) => [
            shiftDate(start, i),
            shiftDate(start, i),
          ])
        : Array.from(
            { length: Math.ceil((daysBetween(start, end) + 1) / 7) },
            (_, i) => [
              shiftDate(start, i * 7),
              shiftDate(start, Math.min(i * 7 + 6, daysBetween(start, end))),
            ],
          );
  for (const [a, b] of segments) {
    const subset = tasks.filter(
      (t) => t.plannedDate >= a && t.plannedDate <= b,
    );
    buckets.push({
      label:
        period === "daily"
          ? "今日"
          : period === "weekly"
            ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
                new Date(a + "T12:00Z").getUTCDay()
              ]
            : `${+a.slice(8)}–${+b.slice(8)}日`,
      rate: progress(subset),
      total: subset.length,
      done: subset.filter((t) => t.completedAt).length,
    });
  }
  return buckets;
}
export function seedState(today = dateKey()): State {
  const now = new Date().toISOString();
  const projects: Project[] = [
    { id: "ai", name: "AI 课程", color: "#9b8afb", kind: "work" },
    { id: "agent", name: "Agent Harness 论文", color: "#68b9d8", kind: "work" },
    { id: "kaggle", name: "Kaggle", color: "#e6b76b", kind: "work" },
    { id: "career", name: "求职", color: "#e88ea5", kind: "work" },
    { id: "fitness", name: "健身", color: "#78c8a3", kind: "life" },
    { id: "cs2", name: "CS2", color: "#93a4d2", kind: "life" },
  ];
  const goals: Goal[] = [
    {
      id: "g-ai",
      title: "建立扎实的机器学习基础",
      projectId: "ai",
      dueDate: shiftDate(today, 30),
    },
    {
      id: "g-agent",
      title: "完成 Agent Harness 论文复现",
      projectId: "agent",
      dueDate: shiftDate(today, 21),
    },
    {
      id: "g-career",
      title: "拿到下一次面试机会",
      projectId: "career",
      dueDate: shiftDate(today, 14),
    },
  ];
  const milestones: Milestone[] = [
    { id: "m-ai-1", title: "Week 2 · 损失函数与线性回归", goalId: "g-ai" },
    { id: "m-ai-2", title: "Week 3 · 线性分类", goalId: "g-ai" },
    { id: "m-agent", title: "阅读论文并搭建最小实验", goalId: "g-agent" },
    { id: "m-career", title: "打磨简历并投递目标岗位", goalId: "g-career" },
  ];
  const base = {
    notes: "",
    cadence: "daily" as const,
    plannedDate: today,
    dueDate: today,
    priority: "medium" as const,
    actual: 0,
    startTime: "",
    completedAt: null,
    createdAt: now,
    rollovers: [],
  };
  const tasks: Task[] = [
    {
      ...base,
      id: "t1",
      title: "复习 Week 2：损失函数与梯度",
      projectId: "ai",
      milestoneId: "m-ai-1",
      estimate: 60,
      actual: 55,
      startTime: "09:00",
      completedAt: now,
    },
    {
      ...base,
      id: "t2",
      title: "精读 Harness 论文，整理核心设计",
      projectId: "agent",
      milestoneId: "m-agent",
      estimate: 90,
      startTime: "10:30",
      priority: "high",
    },
    {
      ...base,
      id: "t3",
      title: "完成线性回归练习与笔记",
      projectId: "ai",
      milestoneId: "m-ai-1",
      estimate: 60,
      startTime: "14:00",
      priority: "high",
    },
    {
      ...base,
      id: "t4",
      title: "更新一版机器学习方向简历",
      projectId: "career",
      milestoneId: "m-career",
      estimate: 45,
      startTime: "16:00",
    },
    {
      ...base,
      id: "t5",
      title: "力量训练 · 上肢 + 拉伸",
      projectId: "fitness",
      milestoneId: "",
      estimate: 75,
      startTime: "20:00",
    },
    {
      ...base,
      id: "t6",
      title: "CS2 · 放松一下，享受两局",
      projectId: "cs2",
      milestoneId: "",
      estimate: 90,
      startTime: "21:30",
    },
    {
      ...base,
      id: "t7",
      title: "完成 Kaggle baseline 并记录分数",
      projectId: "kaggle",
      milestoneId: "",
      estimate: 120,
      cadence: "weekly",
      plannedDate: shiftDate(today, 2),
      dueDate: shiftDate(today, 5),
    },
    {
      ...base,
      id: "t8",
      title: "完成 Week 3 线性分类学习",
      projectId: "ai",
      milestoneId: "m-ai-2",
      estimate: 120,
      cadence: "monthly",
      plannedDate: shiftDate(today, 7),
      dueDate: shiftDate(today, 14),
    },
    {
      ...base,
      id: "t9",
      title: "梳理目标公司与岗位清单",
      projectId: "career",
      milestoneId: "m-career",
      estimate: 30,
      actual: 25,
      completedAt: now,
    },
  ];
  return {
    version: 1,
    projects,
    goals,
    milestones,
    tasks,
    settings: {
      capacityMinutes: 360,
      timezone: "Europe/London",
      autoRollover: false,
    },
    updatedAt: now,
  };
}
