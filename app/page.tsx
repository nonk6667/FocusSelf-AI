"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  Search,
  LayoutDashboard,
  ListTodo,
  Target,
  ChartNoAxesCombined,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Clock,
  ShieldCheck,
  MoreHorizontal,
  Pencil,
  Trash2,
  Download,
  Upload,
  RotateCcw,
  Menu,
  Layers,
  Command,
  CheckCheck,
  Flag,
  CalendarDays,
  AlertTriangle,
  Database,
  Sun,
  ExternalLink,
  Bot,
} from "lucide-react";
import {
  State,
  Task,
  Goal,
  Milestone,
  Project,
  Period,
  id,
  dateKey,
  seedState,
  parseState,
  validateTask,
  progress,
  goalTasks,
  capacity,
  rangeFor,
  tasksInRange,
  stepPeriod,
  daysBetween,
  chartBuckets,
  rollOver,
  periodNames,
  priorityNames,
} from "@/lib/model";
import {
  createRepository,
  type DashboardRepository,
  STORAGE_KEY,
  BACKUP_KEY,
  downloadState,
} from "@/lib/storage";
import AIWorkspace from "@/components/ai/AIWorkspace";
import { applyAIDrafts } from "@/lib/ai/drafts";
import { lockPageScroll } from "@/lib/scroll-lock";
import {
  isNative,
  readStoredRaw,
  writeStoredRaw,
  removeStoredRaw,
} from "@/lib/native";

type View = "dashboard" | "tasks" | "goals" | "analytics" | "settings" | "ai";
type Editor =
  | { type: "task"; value: Task }
  | { type: "goal"; value: Goal; milestones: Milestone[] }
  | { type: "project"; value: Project }
  | null;
const nav = [
  { id: "dashboard", label: "工作台", icon: LayoutDashboard },
  { id: "tasks", label: "所有任务", icon: ListTodo },
  { id: "goals", label: "目标与里程碑", icon: Target },
  { id: "analytics", label: "统计与回顾", icon: ChartNoAxesCombined },
  { id: "ai", label: "本地 AI", icon: Bot },
] as const;
const fmt = (minutes: number) =>
  minutes >= 60 ? `${+(minutes / 60).toFixed(1)}h` : `${minutes}m`;
const humanDate = (key: string) =>
  new Date(key + "T12:00Z").toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  });
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.name === "ZodError"
      ? "数据格式无效，请检查日期、名称和数字范围。"
      : e.message
    : "操作失败，请重试";
function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />;
}
function Progress({
  value,
  color = "#a69aff",
}: {
  value: number;
  color?: string;
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="完成率"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${value}%`, background: color }} />
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const unlockScroll = lockPageScroll();
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,a[href]",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      unlockScroll();
      document.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={ref}
      >
        <div className="modal-head">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-btn" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function TaskEditor({
  task,
  state,
  onSave,
  onClose,
}: {
  task: Task;
  state: State;
  onSave: (t: Task) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(task),
    [error, setError] = useState("");
  const set = <K extends keyof Task>(k: K, v: Task[K]) =>
    setValue((s) => ({ ...s, [k]: v }));
  const goals = state.goals.filter((g) => g.projectId === value.projectId);
  return (
    <Modal
      title={
        state.tasks.some((t) => t.id === task.id) ? "编辑任务" : "新建任务"
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            validateTask(value, state);
            onSave(value);
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        <label>
          任务名称
          <input
            required
            maxLength={160}
            placeholder="下一步，做一件具体的事…"
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            项目
            <select
              value={value.projectId}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  projectId: e.target.value,
                  milestoneId: "",
                }))
              }
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            计划粒度
            <select
              value={value.cadence}
              onChange={(e) => set("cadence", e.target.value as Period)}
            >
              <option value="daily">每日任务</option>
              <option value="weekly">每周任务</option>
              <option value="monthly">每月任务</option>
            </select>
          </label>
        </div>
        <label>
          关联 Goal → Milestone
          <select
            value={value.milestoneId}
            onChange={(e) => set("milestoneId", e.target.value)}
          >
            <option value="">不关联目标</option>
            {goals.map((g) => (
              <optgroup key={g.id} label={g.title}>
                {state.milestones
                  .filter((m) => m.goalId === g.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            计划日期
            <input
              type="date"
              required
              value={value.plannedDate}
              onChange={(e) => set("plannedDate", e.target.value)}
            />
          </label>
          <label>
            截止日期 DDL
            <input
              type="date"
              required
              value={value.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
            />
          </label>
          <label>
            优先级
            <select
              value={value.priority}
              onChange={(e) =>
                set("priority", e.target.value as Task["priority"])
              }
            >
              {Object.entries(priorityNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            开始时间（可选）
            <input
              type="time"
              value={value.startTime}
              onChange={(e) => set("startTime", e.target.value)}
            />
          </label>
          <label>
            预计用时 / 分钟
            <input
              type="number"
              required
              min={1}
              max={1440}
              value={value.estimate}
              onChange={(e) => set("estimate", +e.target.value)}
            />
          </label>
          <label>
            实际用时 / 分钟
            <input
              type="number"
              required
              min={0}
              max={100000}
              value={value.actual}
              onChange={(e) => set("actual", +e.target.value)}
            />
          </label>
        </div>
        <label>
          备注
          <textarea
            rows={3}
            maxLength={5000}
            value={value.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="参考链接、想法，或者一个小提醒"
          />
        </label>
        <div className="form-note">
          <ShieldCheck size={15} />
          工作任务不可占用 20:00–23:00；健身、CS2 等生活项目可安排。
        </div>
        {value.rollovers.length > 0 && (
          <details>
            <summary>结转记录 · {value.rollovers.length} 次</summary>
            {value.rollovers.map((r, i) => (
              <p key={i} className="muted">
                {r.from} → {r.to}
              </p>
            ))}
          </details>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="submit">
            保存任务 <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function GoalEditor({
  goal,
  milestones,
  state,
  onSave,
  onClose,
}: {
  goal: Goal;
  milestones: Milestone[];
  state: State;
  onSave: (g: Goal, m: Milestone[]) => void;
  onClose: () => void;
}) {
  const [g, setG] = useState(goal),
    [ms, setMs] = useState(milestones),
    [error, setError] = useState("");
  return (
    <Modal title="目标与里程碑" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ms.length) {
            setError("至少添加一个里程碑，以便关联任务。");
            return;
          }
          onSave(g, ms);
        }}
      >
        <label>
          Goal 名称
          <input
            required
            maxLength={160}
            value={g.title}
            onChange={(e) => setG({ ...g, title: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            项目
            <select
              value={g.projectId}
              disabled={goalTasks(state, g.id).length > 0}
              onChange={(e) => setG({ ...g, projectId: e.target.value })}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标截止日期
            <input
              type="date"
              required
              value={g.dueDate}
              onChange={(e) => setG({ ...g, dueDate: e.target.value })}
            />
          </label>
        </div>
        <p className="section-label">里程碑</p>
        {ms.map((m, i) => (
          <div className="milestone-edit" key={m.id}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <input
              required
              maxLength={160}
              aria-label={`里程碑 ${i + 1}`}
              value={m.title}
              onChange={(e) =>
                setMs(
                  ms.map((x) =>
                    x.id === m.id ? { ...x, title: e.target.value } : x,
                  ),
                )
              }
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="移除里程碑"
              onClick={() => setMs(ms.filter((x) => x.id !== m.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <button
          className="text-btn"
          type="button"
          onClick={() => setMs([...ms, { id: id(), goalId: g.id, title: "" }])}
        >
          <Plus size={14} />
          添加里程碑
        </button>
        <p className="form-note">
          进度按任务数量等权计算。删除里程碑后，其任务会保留并解除关联。
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary">保存目标</button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectEditor({
  project,
  onSave,
  onClose,
}: {
  project: Project;
  onSave: (p: Project) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState(project);
  return (
    <Modal title="编辑项目类别" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(p);
        }}
      >
        <label>
          项目名称
          <input
            required
            maxLength={160}
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            项目颜色
            <input
              type="color"
              value={p.color}
              onChange={(e) => setP({ ...p, color: e.target.value })}
            />
          </label>
          <label>
            容量归类
            <select
              value={p.kind}
              onChange={(e) =>
                setP({ ...p, kind: e.target.value as Project["kind"] })
              }
            >
              <option value="work">工作 · 计入容量</option>
              <option value="life">生活 · 允许受保护时段</option>
            </select>
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary">保存项目</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Dashboard() {
  const repo = useRef<DashboardRepository | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State | null>(null),
    [loadError, setLoadError] = useState(""),
    [toast, setToast] = useState(""),
    [view, setView] = useState<View>("dashboard"),
    [period, setPeriod] = useState<Period>("daily"),
    [anchor, setAnchor] = useState(""),
    [project, setProject] = useState("all"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [cadence, setCadence] = useState("all"),
    [editor, setEditor] = useState<Editor>(null),
    [mobile, setMobile] = useState(false),
    [now, setNow] = useState(new Date()),
    [confirm, setConfirm] = useState<{
      title: string;
      body: string;
      action: () => unknown;
    } | null>(null);
  useEffect(() => {
    let active = true;
    document.documentElement.dataset.platform = isNative() ? "android" : "web";
    (async () => {
      try {
        const repository = createRepository();
        repo.current = repository;
        const saved = await repository.load();
        if (!active) return;
        const s = saved ?? seedState();
        if (!saved) await repository.save(s);
        if (!active) return;
        setState(s);
        setAnchor(dateKey(new Date(), s.settings.timezone));
      } catch (e) {
        if (active) setLoadError(errorText(e));
      }
    })();
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const listener = async (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          const s = await repo.current?.load();
          if (s) {
            setState(s);
            setToast("已加载另一个标签页的最新修改");
          }
        } catch (e) {
          setToast(errorText(e));
        }
      }
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);
  const saveInFlight = useRef(false);
  const commit = async (next: State, message?: string) => {
    if (saveInFlight.current) {
      setToast("正在保存，请稍候再操作");
      return false;
    }
    saveInFlight.current = true;
    try {
      const valid = parseState({
        ...next,
        updatedAt: new Date().toISOString(),
      });
      await repo.current?.save(valid);
      setState(valid);
      if (message) setToast(message);
      return true;
    } catch (e) {
      setToast(errorText(e));
      return false;
    } finally {
      saveInFlight.current = false;
    }
  };
  useEffect(() => {
    if (!isNative()) return;
    const listener = import("@capacitor/app").then(({ App }) =>
      App.addListener("backButton", () => {
        if (confirm) setConfirm(null);
        else if (editor) setEditor(null);
        else if (mobile) setMobile(false);
        else if (view !== "dashboard") setView("dashboard");
        else App.exitApp();
      }),
    );
    return () => {
      void listener.then((h) => h.remove());
    };
  }, [confirm, editor, mobile, view]);
  const today = state ? dateKey(now, state.settings.timezone) : "";
  useEffect(() => {
    if (state?.settings.autoRollover) {
      const next = rollOver(state, today);
      if (next !== state) commit(next, "未完成任务已自动结转，原 DDL 已保留");
    }
  }, [today, state?.settings.autoRollover]); // Only on day/settings changes.
  const scoped = useMemo(
    () =>
      state
        ? state.tasks.filter(
            (t) =>
              (project === "all" || t.projectId === project) &&
              (!search ||
                `${t.title} ${t.notes}`
                  .toLowerCase()
                  .includes(search.toLowerCase())),
          )
        : [],
    [state, project, search],
  );
  const periodTasks = useMemo(
    () => tasksInRange(scoped, anchor || today, period),
    [scoped, anchor, today, period],
  );
  if (loadError)
    return (
      <main className="recovery">
        <Database size={32} />
        <h1>本地数据暂时无法读取</h1>
        <p>{loadError}</p>
        <p>现有数据未被覆盖。可以恢复上一次自动备份，或导入之前导出的 JSON。</p>
        <button
          className="btn primary"
          onClick={async () => {
            try {
              const raw = await readStoredRaw(BACKUP_KEY);
              if (!raw) throw Error("还没有自动备份");
              const s = parseState(JSON.parse(raw));
              await writeStoredRaw(STORAGE_KEY, JSON.stringify(s));
              location.reload();
            } catch (e) {
              setLoadError(errorText(e));
            }
          }}
        >
          恢复自动备份
        </button>
        <label className="btn">
          导入备份
          <input
            type="file"
            hidden
            accept=".json,application/json"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (!f) return;
                const s = parseState(JSON.parse(await f.text()));
                await writeStoredRaw(STORAGE_KEY, JSON.stringify(s));
                location.reload();
              } catch (e) {
                setLoadError(errorText(e));
              }
            }}
          />
        </label>
        <button
          className="btn"
          onClick={async () => {
            if (window.confirm("清除无法读取的数据并重新开始？")) {
              await removeStoredRaw(STORAGE_KEY);
              location.reload();
            }
          }}
        >
          重新开始
        </button>
      </main>
    );
  if (!state)
    return (
      <main className="loading">
        <div className="brand-mark">f</div>
        <p>正在打开你的工作台…</p>
      </main>
    );
  const cap = capacity(state, anchor || today),
    done = periodTasks.filter((t) => t.completedAt).length,
    rate = progress(periodTasks),
    [rangeStart, rangeEnd] = rangeFor(anchor || today, period);
  const visible = periodTasks
    .filter(
      (t) =>
        view !== "tasks" ||
        ((status === "all" ||
          (status === "done" ? !!t.completedAt : !t.completedAt)) &&
          (cadence === "all" || t.cadence === cadence)),
    )
    .sort(
      (a, b) =>
        Number(!!a.completedAt) - Number(!!b.completedAt) ||
        { high: 0, medium: 1, low: 2 }[a.priority] -
          { high: 0, medium: 1, low: 2 }[b.priority] ||
        a.plannedDate.localeCompare(b.plannedDate) ||
        a.startTime.localeCompare(b.startTime),
    );
  const overdue = state.tasks.filter(
    (t) => !t.completedAt && rangeFor(t.plannedDate, t.cadence)[1] < today,
  );
  const newTask = () => {
    if (!state.projects.length) {
      setToast("请先在设置中添加项目");
      setView("settings");
      return;
    }
    setEditor({
      type: "task",
      value: {
        id: id(),
        title: "",
        notes: "",
        projectId: project === "all" ? state.projects[0].id : project,
        milestoneId: "",
        cadence: period,
        plannedDate: anchor || today,
        dueDate: anchor || today,
        priority: "medium",
        estimate: 30,
        actual: 0,
        startTime: "",
        completedAt: null,
        createdAt: new Date().toISOString(),
        rollovers: [],
      },
    });
  };
  const newGoal = () => {
    if (!state.projects.length) {
      setToast("请先添加项目");
      setView("settings");
      return;
    }
    const gid = id();
    setEditor({
      type: "goal",
      value: {
        id: gid,
        title: "",
        projectId: project === "all" ? state.projects[0].id : project,
        dueDate: rangeEnd,
      },
      milestones: [{ id: id(), goalId: gid, title: "" }],
    });
  };
  const toggle = (t: Task) =>
    commit(
      {
        ...state,
        tasks: state.tasks.map((x) =>
          x.id === t.id
            ? {
                ...x,
                completedAt: x.completedAt ? null : new Date().toISOString(),
              }
            : x,
        ),
      },
      t.completedAt ? "任务已重新打开" : "完成一件事，向前一步。",
    );
  const removeTask = (t: Task) =>
    setConfirm({
      title: "删除这个任务？",
      body: `「${t.title}」将被删除，关联目标进度会重新计算。`,
      action: () =>
        commit(
          { ...state, tasks: state.tasks.filter((x) => x.id !== t.id) },
          "任务已删除",
        ),
    });
  const ddl = (due: string, completed = false) => {
    const n = daysBetween(today, due);
    return completed
      ? "已完成"
      : n < 0
        ? `逾期 ${-n} 天`
        : n === 0
          ? "今天截止"
          : `还有 ${n} 天`;
  };
  const goalCards = (compact = false) => (
    <div className={compact ? "goal-list compact" : "goal-grid"}>
      {state.goals
        .filter((g) => project === "all" || g.projectId === project)
        .map((g) => {
          const p = state.projects.find((p) => p.id === g.projectId)!;
          const ts = goalTasks(state, g.id),
            r = progress(ts);
          return (
            <article className="goal-card" key={g.id}>
              <div className="goal-top">
                <span className="project-label">
                  <Dot color={p.color} />
                  {p.name}
                </span>
                <button
                  className="icon-btn"
                  aria-label={`编辑目标 ${g.title}`}
                  onClick={() =>
                    setEditor({
                      type: "goal",
                      value: g,
                      milestones: state.milestones.filter(
                        (m) => m.goalId === g.id,
                      ),
                    })
                  }
                >
                  <Pencil size={13} />
                </button>
              </div>
              <h3>{g.title}</h3>
              <div className="goal-progress">
                <span>
                  {ts.filter((t) => t.completedAt).length} / {ts.length} 任务
                </span>
                <strong>{r}%</strong>
              </div>
              <Progress value={r} color={p.color} />
              {!compact && (
                <div className="milestones">
                  {state.milestones
                    .filter((m) => m.goalId === g.id)
                    .map((m) => {
                      const mt = state.tasks.filter(
                        (t) => t.milestoneId === m.id,
                      );
                      return (
                        <div key={m.id}>
                          <Layers size={13} />
                          <span>{m.title}</span>
                          <b>{progress(mt)}%</b>
                        </div>
                      );
                    })}
                </div>
              )}
              <div className="goal-bottom">
                <span>
                  <Flag size={12} />
                  {ddl(g.dueDate, r === 100)}
                </span>
                {!compact && (
                  <button
                    className="icon-btn danger"
                    aria-label={`删除目标 ${g.title}`}
                    onClick={() =>
                      setConfirm({
                        title: "删除目标？",
                        body: "目标及里程碑将删除，已有任务会保留并解除关联。",
                        action: () => {
                          const mids = state.milestones
                            .filter((m) => m.goalId === g.id)
                            .map((m) => m.id);
                          commit(
                            {
                              ...state,
                              goals: state.goals.filter((x) => x.id !== g.id),
                              milestones: state.milestones.filter(
                                (m) => m.goalId !== g.id,
                              ),
                              tasks: state.tasks.map((t) =>
                                mids.includes(t.milestoneId)
                                  ? { ...t, milestoneId: "" }
                                  : t,
                              ),
                            },
                            "目标已删除",
                          );
                        },
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      {!state.goals.filter((g) => project === "all" || g.projectId === project)
        .length && (
        <div className="empty">
          还没有目标，先定义一个小的方向。
          <button className="text-btn" onClick={newGoal}>
            创建目标 <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
  const taskRows = (
    <div className="task-list">
      {visible.map((t) => {
        const p = state.projects.find((p) => p.id === t.projectId)!;
        return (
          <div
            className={`task-row ${t.completedAt ? "completed" : ""}`}
            key={t.id}
          >
            <button
              className="check-btn"
              aria-label={`${t.completedAt ? "重新打开" : "完成"} ${t.title}`}
              aria-pressed={!!t.completedAt}
              onClick={() => toggle(t)}
            >
              {t.completedAt ? <Check size={13} /> : null}
            </button>
            <button
              className="task-content"
              onClick={() => setEditor({ type: "task", value: t })}
            >
              <span className="task-title">{t.title}</span>
              <span className="task-meta">
                <span>
                  <Dot color={p.color} />
                  {p.name}
                </span>
                <span>
                  {t.cadence === "daily"
                    ? "日任务"
                    : t.cadence === "weekly"
                      ? "周任务"
                      : "月任务"}
                </span>
                {period !== "daily" && <span>{t.plannedDate.slice(5)}</span>}
                {t.rollovers.length > 0 && (
                  <span className="rollover">
                    <RotateCcw size={10} />
                    结转 {t.rollovers.length}
                  </span>
                )}
              </span>
            </button>
            <span
              className={`priority ${t.priority}`}
              title={priorityNames[t.priority]}
              aria-label={priorityNames[t.priority]}
            >
              <i />
              <i />
              <i />
            </span>
            <span
              className={`task-ddl ${!t.completedAt && t.dueDate < today ? "late" : ""}`}
            >
              {ddl(t.dueDate, !!t.completedAt)}
            </span>
            <span className="task-duration">
              <Clock size={12} />
              {fmt(t.estimate)}
              {t.actual > 0 && <small> / {fmt(t.actual)}</small>}
            </span>
            <button
              className="icon-btn delete-task"
              aria-label={`删除任务 ${t.title}`}
              onClick={() => removeTask(t)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      {!visible.length && (
        <div className="empty">
          <CheckCheck size={26} />
          <h3>{search ? "没有匹配的任务" : "这里留有一点空间"}</h3>
          <p>添加一个具体的小任务，让计划开始流动。</p>
          <button className="btn" onClick={newTask}>
            <Plus size={14} />
            新建任务
          </button>
        </div>
      )}
    </div>
  );
  const pie = state.projects
    .map((p) => ({
      ...p,
      value: periodTasks
        .filter((t) => t.projectId === p.id)
        .reduce((a, t) => a + t.estimate, 0),
    }))
    .filter((p) => p.value > 0);
  const analytics = (
    <div className="analytics-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>完成率趋势</h2>
            <p>按计划日期统计 · {periodNames[period]}视图</p>
          </div>
          <span className="legend-dot">
            <Dot color="#a69aff" />
            完成率
          </span>
        </div>
        <div className="chart" role="img" aria-label="柱状完成率图">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartBuckets(scoped, anchor, period)}
              margin={{ left: -20, right: 8, top: 10, bottom: 0 }}
            >
              <CartesianGrid stroke="#ffffff08" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#83838f", fontSize: 11 }}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#73737f", fontSize: 10 }}
              />
              <Tooltip
                cursor={{ fill: "#ffffff05" }}
                contentStyle={{
                  background: "#24242b",
                  border: "1px solid #393940",
                  borderRadius: 8,
                  color: "#f1f1f5",
                }}
                formatter={(v) => [`${v}%`, "完成率"]}
              />
              <Bar
                dataKey="rate"
                fill="#a69aff"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="chart-caption">
          {done} / {periodTasks.length} 项已完成 · 无任务时记为 0%
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>时间投向</h2>
            <p>按项目的预计用时占比</p>
          </div>
          <ChartNoAxesCombined size={17} className="muted" />
        </div>
        <div className="pie-layout">
          <div
            className="pie-chart"
            role="img"
            aria-label="按项目的预计用时饼图"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="68%"
                  outerRadius="93%"
                  paddingAngle={4}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {pie.map((p) => (
                    <Cell key={p.id} fill={p.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#24242b",
                    border: "1px solid #393940",
                    borderRadius: 8,
                  }}
                  itemStyle={{ color: "#f1f1f5" }}
                  formatter={(v) => [fmt(Number(v)), "预计用时"]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-center">
              <strong>{fmt(pie.reduce((a, p) => a + p.value, 0))}</strong>
              <span>计划投入</span>
            </div>
          </div>
          <div className="pie-legend">
            {pie.map((p) => (
              <div key={p.id}>
                <Dot color={p.color} />
                <span>{p.name}</span>
                <b>
                  {Math.round(
                    (p.value / pie.reduce((a, x) => a + x.value, 0)) * 100,
                  )}
                  %
                </b>
              </div>
            ))}
            {!pie.length && <p className="muted">本周期暂无任务</p>}
          </div>
        </div>
      </section>
    </div>
  );
  const switchView = (v: View) => {
    setView(v);
    setMobile(false);
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            switchView("dashboard");
          }}
        >
          <span className="brand-mark">f</span>
          <strong>
            focus<span>.</span>
          </strong>
          <span className="workspace-label">个人空间</span>
        </a>
        <button
          className="mobile-close icon-btn"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        >
          <X size={18} />
        </button>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              className={`nav-item ${view === n.id ? "active" : ""}`}
              key={n.id}
              aria-label={n.label}
              onClick={() => switchView(n.id)}
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.id === "tasks" && (
                <small>
                  {state.tasks.filter((t) => !t.completedAt).length}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-label projects-label">
          <span>PROJECTS</span>
          <button
            className="icon-btn"
            aria-label="添加项目"
            onClick={() =>
              setEditor({
                type: "project",
                value: { id: id(), name: "", color: "#9b8afb", kind: "work" },
              })
            }
          >
            <Plus size={14} />
          </button>
        </div>
        <button
          className={`project-nav ${project === "all" ? "selected" : ""}`}
          onClick={() => {
            setProject("all");
            setMobile(false);
          }}
        >
          <Layers size={14} />
          <span>全部项目</span>
        </button>
        {state.projects.map((p) => (
          <button
            className={`project-nav ${project === p.id ? "selected" : ""}`}
            key={p.id}
            onClick={() => {
              setProject(p.id);
              if (view === "settings") setView("dashboard");
              setMobile(false);
            }}
          >
            <Dot color={p.color} />
            <span>{p.name}</span>
            <small>
              {
                state.tasks.filter(
                  (t) => t.projectId === p.id && !t.completedAt,
                ).length
              }
            </small>
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-light" />
            <span>已保存在此设备</span>
            <ShieldCheck size={13} />
          </div>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => switchView("settings")}
          >
            <Settings size={16} />
            <span>偏好与数据</span>
          </button>
          <div className="profile">
            <div className="avatar">Z</div>
            <div>
              <strong>My workspace</strong>
              <span>保持节奏，慢慢来。</span>
            </div>
            <span className="local-badge">LOCAL</span>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-shade" onClick={() => setMobile(false)} />
      )}
      <div className="main-shell" data-main-scroll>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-btn"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="muted">个人空间</span>
            <ChevronRight size={12} />
            <span>
              {view === "settings"
                ? "偏好与数据"
                : nav.find((n) => n.id === view)?.label}
            </span>
          </div>
          <div className="topbar-right">
            <span className="today-top">{humanDate(today)}</span>
            <span className="topbar-separator" />
            <span className="status-light" />
            <span className="saved-label">本地优先</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "dashboard"
                  ? "YOUR PERSONAL COMMAND CENTER"
                  : view === "goals"
                    ? "SMALL STEPS, REAL PROGRESS"
                    : view === "analytics"
                      ? "REFLECT & REFOCUS"
                      : view === "settings"
                        ? "MAKE IT YOURS"
                        : view === "ai" ? "PRIVATE INTELLIGENCE" : "ONE THING AT A TIME"}
              </div>
              <h1>
                {view === "dashboard"
                  ? "让今天，向前一点。"
                  : view === "tasks"
                    ? "把想法变成下一步。"
                    : view === "goals"
                      ? "每一步，都有方向。"
                      : view === "analytics"
                        ? "看见你的投入。"
                        : view === "ai" ? "想清楚，再往前。" : "为自己设定节奏。"}
              </h1>
              <p>
                {view === "dashboard"
                  ? "专注重要的事，也给生活留一点空间。"
                  : view === "settings"
                    ? "所有数据保存在此设备，你始终拥有它们。"
                    : view === "ai" ? "4B 快速整理，9B 深入思考，全部在此设备完成。" : project === "all"
                      ? "清晰的计划，比满满的清单更有力量。"
                      : state.projects.find((p) => p.id === project)?.name}
              </p>
            </div>
            {view !== "settings" && view !== "ai" && (
              <button
                className="btn primary add-main"
                onClick={view === "goals" ? newGoal : newTask}
              >
                <Plus size={16} />
                {view === "goals" ? "新建目标" : "新建任务"}
                <span className="button-key">↵</span>
              </button>
            )}
          </div>
          {view !== "settings" && view !== "goals" && view !== "ai" && (
            <div className="view-toolbar">
              <div className="segmented" aria-label="统计周期">
                {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
                  <button
                    className={period === p ? "active" : ""}
                    key={p}
                    onClick={() => setPeriod(p)}
                  >
                    {p === "daily" ? "每日" : p === "weekly" ? "每周" : "每月"}
                  </button>
                ))}
              </div>
              <div className="date-control">
                <button
                  className="icon-btn"
                  aria-label="上一个周期"
                  onClick={() => setAnchor(stepPeriod(anchor, period, -1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {period === "daily"
                    ? humanDate(anchor)
                    : `${rangeStart.slice(5).replace("-", "/")} – ${rangeEnd.slice(5).replace("-", "/")}`}
                </span>
                <button
                  className="icon-btn"
                  aria-label="下一个周期"
                  onClick={() => setAnchor(stepPeriod(anchor, period, 1))}
                >
                  <ChevronRight size={16} />
                </button>
                <button className="today-btn" onClick={() => setAnchor(today)}>
                  今天
                </button>
              </div>
              <label className="search-field">
                <Search size={14} />
                <input
                  aria-label="搜索任务"
                  placeholder="搜索任务…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-btn"
                    aria-label="清除搜索"
                    onClick={() => setSearch("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </label>
            </div>
          )}
          {overdue.length > 0 && view !== "settings" && view !== "ai" && (
            <div className="rollover-banner">
              <RotateCcw size={15} />
              <span>
                {overdue.length}{" "}
                项未完成任务已超过计划周期。给它们一个新的位置。
              </span>
              <button
                onClick={() => {
                  const next = rollOver(state, today);
                  commit(next, `已结转 ${overdue.length} 项任务，原 DDL 保留`);
                  setAnchor(today);
                }}
              >
                结转到当前周期 <ArrowRight size={13} />
              </button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="stats-grid">
                <article className="stat-card">
                  <div className="stat-title">
                    {periodNames[period]}计划完成率{" "}
                    <ChartNoAxesCombined size={15} />
                  </div>
                  <div className="stat-value">
                    {rate}
                    <small>%</small>
                    <span className="stat-note violet">
                      稳步向前 <ArrowUpRight size={12} />
                    </span>
                  </div>
                  <Progress value={rate} />
                  <span className="stat-description">
                    每完成一件事，都是进展
                  </span>
                </article>
                <article className="stat-card">
                  <div className="stat-title">
                    已完成任务 <CheckCheck size={15} />
                  </div>
                  <div className="stat-value">
                    {done}
                    <small>/ {periodTasks.length}</small>
                  </div>
                  <span className="stat-description">
                    <span className="green">
                      {periodTasks.length - done} 项
                    </span>{" "}
                    待完成 · 一次专注一件
                  </span>
                </article>
                <article className="stat-card">
                  <div className="stat-title">
                    实际投入 <Clock size={15} />
                  </div>
                  <div className="stat-value">
                    {
                      +(
                        periodTasks.reduce((a, t) => a + t.actual, 0) / 60
                      ).toFixed(1)
                    }
                    <small>小时</small>
                  </div>
                  <span className="stat-description">
                    预计 {fmt(periodTasks.reduce((a, t) => a + t.estimate, 0))}{" "}
                    · 包含工作与生活
                  </span>
                </article>
                <article
                  className={`stat-card ${cap.planned > cap.limit ? "overloaded" : ""}`}
                >
                  <div className="stat-title">
                    {anchor === today ? "今日" : "所选日期"}工作容量{" "}
                    <Sun size={15} />
                  </div>
                  <div className="stat-value">
                    {+(cap.planned / 60).toFixed(1)}
                    <small>/ {+(cap.limit / 60).toFixed(1)}h</small>
                  </div>
                  <div className="capacity-bars">
                    {Array.from({ length: 16 }, (_, i) => (
                      <span
                        key={i}
                        className={
                          i < Math.ceil((cap.planned / cap.limit) * 16)
                            ? "filled"
                            : ""
                        }
                      />
                    ))}
                  </div>
                  <span className="stat-description">
                    {cap.planned > cap.limit
                      ? `超载 ${fmt(cap.planned - cap.limit)}，建议推迟低优先级任务`
                      : `还有 ${fmt(cap.limit - cap.planned)} 可安排 · 生活时段不计入`}
                  </span>
                </article>
              </div>
              <div className="dashboard-grid">
                <div className="dashboard-primary">
                  <section className="panel tasks-panel">
                    <div className="panel-heading">
                      <div className="heading-inline">
                        <h2>
                          {period === "daily"
                            ? "今天的重点"
                            : period === "weekly"
                              ? "本周的重点"
                              : "本月的重点"}
                        </h2>
                        <span className="count-badge">
                          {periodTasks.length}
                        </span>
                      </div>
                      <button
                        className="text-btn muted"
                        onClick={() => setView("tasks")}
                      >
                        查看全部 <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <div className="task-subhead">
                      <span>任务</span>
                      <span>DDL / 预计用时</span>
                    </div>
                    {taskRows}
                    <button className="add-task-row" onClick={newTask}>
                      <Plus size={15} />
                      添加一个小任务<span>让计划更具体</span>
                    </button>
                  </section>
                  <div className="section-title">
                    <h2>
                      <Target size={16} />
                      长期目标
                    </h2>
                    <button
                      className="text-btn muted"
                      onClick={() => setView("goals")}
                    >
                      管理目标 <ArrowUpRight size={13} />
                    </button>
                  </div>
                  {goalCards(true)}
                </div>
                <aside className="day-aside">
                  <section className="protected-card">
                    <div className="protected-tag">
                      <ShieldCheck size={14} />
                      为生活留白
                    </div>
                    <h2>今晚，属于你。</h2>
                    <p>
                      把努力留在白天，
                      <br />
                      把自己还给生活。
                    </p>
                    <div className="protected-time">
                      20:00 <span>—</span> 23:00
                    </div>
                    <div className="life-pills">
                      <span>
                        <Dot color="#78c8a3" />
                        健身
                      </span>
                      <span>
                        <Dot color="#93a4d2" />
                        CS2
                      </span>
                      <ShieldCheck size={13} />
                    </div>
                    <div className="protected-footer">
                      <span className="status-light" />
                      受保护时段 · 工作不侵入
                    </div>
                  </section>
                  <section className="panel agenda">
                    <div className="panel-heading">
                      <h2>日程速览</h2>
                      <span>{anchor.slice(5).replace("-", "/")}</span>
                    </div>
                    <div className="timeline">
                      {state.tasks
                        .filter(
                          (t) =>
                            t.plannedDate === anchor &&
                            t.startTime &&
                            (project === "all" || t.projectId === project),
                        )
                        .sort((a, b) => a.startTime.localeCompare(b.startTime))
                        .map((t) => {
                          const p = state.projects.find(
                            (p) => p.id === t.projectId,
                          )!;
                          return (
                            <button
                              key={t.id}
                              className={`timeline-item ${t.completedAt ? "is-done" : ""}`}
                              onClick={() =>
                                setEditor({ type: "task", value: t })
                              }
                            >
                              <span className="timeline-time">
                                {t.startTime}
                              </span>
                              <i style={{ background: p.color }} />
                              <div>
                                <strong>{t.title}</strong>
                                <span>
                                  {p.name} · {fmt(t.estimate)}
                                  {t.completedAt ? " · 已完成" : ""}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      {!state.tasks.some(
                        (t) =>
                          t.plannedDate === anchor &&
                          t.startTime &&
                          (project === "all" || t.projectId === project),
                      ) && (
                        <p className="muted agenda-empty">
                          还没有安排时间的任务。
                        </p>
                      )}
                    </div>
                  </section>
                  <div className="gentle-note">
                    <span>✳</span>
                    <p>
                      计划是为了减轻负担，
                      <br />
                      不是为了填满每一分钟。
                    </p>
                  </div>
                </aside>
              </div>
              <div className="section-title">
                <h2>
                  <ChartNoAxesCombined size={16} />
                  投入与进展
                </h2>
                <span className="muted">跟自己比，慢慢积累。</span>
              </div>
              {analytics}
            </>
          )}
          {view === "tasks" && (
            <section className="panel tasks-panel">
              <div className="panel-heading">
                <h2>
                  任务清单 <span className="count-badge">{visible.length}</span>
                </h2>
                <div className="filters">
                  <select
                    aria-label="完成状态筛选"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">全部状态</option>
                    <option value="todo">未完成</option>
                    <option value="done">已完成</option>
                  </select>
                  <select
                    aria-label="任务粒度筛选"
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value)}
                  >
                    <option value="all">全部粒度</option>
                    <option value="daily">日任务</option>
                    <option value="weekly">周任务</option>
                    <option value="monthly">月任务</option>
                  </select>
                </div>
              </div>
              {taskRows}
              <button className="add-task-row" onClick={newTask}>
                <Plus size={15} />
                新建任务
              </button>
            </section>
          )}
          {view === "goals" && (
            <>
              <div className="info-strip">
                <Layers size={16} />
                Goal 确定方向，Milestone 拆解阶段，Task
                推动进度。完成关联任务后，进度自动更新。
              </div>
              {goalCards()}
            </>
          )}
          {view === "analytics" && (
            <>
              {analytics}
              <section className="panel review-panel">
                <div className="panel-heading">
                  <h2>项目回顾</h2>
                  <span className="muted">
                    {rangeStart} — {rangeEnd}
                  </span>
                </div>
                <div className="review-table">
                  <div className="review-row table-head">
                    <span>项目</span>
                    <span>完成</span>
                    <span>预计 / 实际</span>
                    <span>完成率</span>
                  </div>
                  {state.projects.map((p) => {
                    const ts = periodTasks.filter((t) => t.projectId === p.id);
                    return (
                      <div className="review-row" key={p.id}>
                        <span>
                          <Dot color={p.color} />
                          {p.name}
                        </span>
                        <span>
                          {ts.filter((t) => t.completedAt).length}/{ts.length}
                        </span>
                        <span>
                          {fmt(ts.reduce((a, t) => a + t.estimate, 0))} /{" "}
                          {fmt(ts.reduce((a, t) => a + t.actual, 0))}
                        </span>
                        <span>{progress(ts)}%</span>
                      </div>
                    );
                  })}
                </div>
              </section>
              <p className="muted footnote">
                完成率 = 所选计划周期内已完成任务数 /
                总任务数；图表受项目与搜索筛选影响。结转会移动计划归属，历史结转记录保留在任务中。
              </p>
            </>
          )}
          {view === "settings" && (
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2>日常节奏</h2>
                <form
                  key={
                    state.settings.timezone +
                    state.settings.capacityMinutes +
                    state.settings.autoRollover
                  }
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    commit(
                      {
                        ...state,
                        settings: {
                          capacityMinutes: Number(f.get("capacity")),
                          timezone: String(f.get("timezone")),
                          autoRollover: f.get("rollover") === "on",
                        },
                      },
                      "偏好已保存",
                    );
                  }}
                >
                  <label>
                    每天工作容量 / 分钟
                    <input
                      name="capacity"
                      type="number"
                      required
                      min={30}
                      max={900}
                      step={15}
                      defaultValue={state.settings.capacityMinutes}
                    />
                  </label>
                  <label>
                    日历时区
                    <select
                      name="timezone"
                      defaultValue={state.settings.timezone}
                    >
                      {Array.from(
                        new Set([
                          state.settings.timezone,
                          "Europe/London",
                          "Asia/Shanghai",
                          "Asia/Hong_Kong",
                          "America/New_York",
                          "America/Los_Angeles",
                          "UTC",
                        ]),
                      ).map((z) => (
                        <option value={z} key={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      name="rollover"
                      type="checkbox"
                      defaultChecked={state.settings.autoRollover}
                    />
                    <span>打开页面或跨日时，自动结转已过期计划</span>
                  </label>
                  <p className="form-note">
                    日任务在次日、周任务在下周一、月任务在次月结转；原 DDL
                    和实际用时保留。页面关闭时不执行。
                  </p>
                  <div className="protected-setting">
                    <ShieldCheck size={17} />
                    <div>
                      <strong>20:00–23:00 · 健身 + CS2</strong>
                      <p>固定受保护时段。生活项目不计入工作容量。</p>
                    </div>
                  </div>
                  <button className="btn primary" type="submit">
                    保存偏好
                  </button>
                </form>
              </section>
              <section className="panel settings-panel">
                <h2>数据由你掌握</h2>
                <p className="muted">
                  本地保存，无需注册。Mac 和安卓之间，可通过导出、导入 JSON
                  迁移数据。
                </p>
                <div className="data-summary">
                  <Database size={20} />
                  <div>
                    <strong>
                      {state.tasks.length} 任务 · {state.goals.length} 目标
                    </strong>
                    <span>
                      {state.projects.length} 项目 · 上次保存{" "}
                      {new Date(state.updatedAt).toLocaleTimeString("zh-CN", {
                        timeZone: state.settings.timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <span className="local-badge">LOCAL</span>
                </div>
                <div className="data-actions">
                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        await downloadState(state);
                        setToast("备份已导出");
                      } catch (e) {
                        setToast(errorText(e));
                      }
                    }}
                  >
                    <Download size={15} />
                    导出 JSON
                  </button>
                  <button
                    className="btn"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={15} />
                    导入备份
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      if (file.size > 8 * 1024 * 1024)
                        throw Error("备份文件不能超过 8 MB");
                      const imported = parseState(
                        JSON.parse(await file.text()),
                      );
                      setConfirm({
                        title: "用备份替换本地数据？",
                        body: `导入 ${imported.projects.length} 个项目、${imported.goals.length} 个目标、${imported.tasks.length} 个任务。当前版本会保留一份自动备份。`,
                        action: async () => {
                          if (await commit(imported, "备份已导入")) {
                            setAnchor(
                              dateKey(new Date(), imported.settings.timezone),
                            );
                            setProject("all");
                            setSearch("");
                            setCadence("all");
                            setStatus("all");
                          }
                        },
                      });
                    } catch (e) {
                      setToast(errorText(e));
                    }
                  }}
                />
                <button
                  className="text-btn"
                  onClick={async () => {
                    try {
                      const raw = await readStoredRaw(BACKUP_KEY);
                      if (!raw) throw Error("还没有上一次备份");
                      const s = parseState(JSON.parse(raw));
                      setConfirm({
                        title: "恢复上一次保存？",
                        body: "这会恢复最近一次修改之前的数据。当前数据将成为新的自动备份。",
                        action: async () => {
                          if (await commit(s, "已恢复上一次保存")) {
                            setProject("all");
                            setAnchor(dateKey(new Date(), s.settings.timezone));
                          }
                        },
                      });
                    } catch (e) {
                      setToast(errorText(e));
                    }
                  }}
                >
                  <RotateCcw size={14} />
                  恢复上一次保存
                </button>
                <div className="sync-note">
                  <span className="section-label">NEXT CHAPTER</span>
                  <h3>跨设备同步，已预留位置。</h3>
                  <p>
                    浏览器版使用本地存储，安卓使用设备持久存储。项目文档中提供
                    Supabase 认证、数据隔离与冲突处理方案。
                  </p>
                  <span className="tag">尚未连接云端</span>
                </div>
                <button
                  className="text-btn danger"
                  onClick={() =>
                    setConfirm({
                      title: "清空任务和目标？",
                      body: "保留项目类别和偏好，清空任务、目标及里程碑。建议先导出备份。",
                      action: () =>
                        commit(
                          { ...state, tasks: [], goals: [], milestones: [] },
                          "已清空计划，可以重新开始",
                        ),
                    })
                  }
                >
                  清空任务与目标
                </button>
              </section>
              <section className="panel settings-panel project-settings">
                <div className="panel-heading">
                  <div>
                    <h2>项目类别</h2>
                    <p>按自己的生活调整这些方向</p>
                  </div>
                  <button
                    className="btn"
                    onClick={() =>
                      setEditor({
                        type: "project",
                        value: {
                          id: id(),
                          name: "",
                          color: "#9b8afb",
                          kind: "work",
                        },
                      })
                    }
                  >
                    <Plus size={14} />
                    添加项目
                  </button>
                </div>
                {state.projects.map((p) => (
                  <div className="project-settings-row" key={p.id}>
                    <Dot color={p.color} />
                    <strong>{p.name}</strong>
                    <span className="tag">
                      {p.kind === "life" ? "生活" : "工作"}
                    </span>
                    <span className="muted">
                      {state.tasks.filter((t) => t.projectId === p.id).length}{" "}
                      任务
                    </span>
                    <button
                      className="icon-btn"
                      aria-label={`编辑项目 ${p.name}`}
                      onClick={() => setEditor({ type: "project", value: p })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label={`删除项目 ${p.name}`}
                      onClick={() => {
                        if (
                          state.tasks.some((t) => t.projectId === p.id) ||
                          state.goals.some((g) => g.projectId === p.id)
                        ) {
                          setToast("请先迁移或删除该项目的任务和目标");
                          return;
                        }
                        setConfirm({
                          title: "删除项目类别？",
                          body: `删除「${p.name}」。`,
                          action: async () => {
                            if (
                              await commit(
                                {
                                  ...state,
                                  projects: state.projects.filter(
                                    (x) => x.id !== p.id,
                                  ),
                                },
                                "项目已删除",
                              )
                            )
                              setProject("all");
                          },
                        });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </section>
            </div>
          )}
          <AIWorkspace state={state} active={view === "ai"} onApply={async (drafts) =>
            commit(applyAIDrafts(state, drafts), "AI 任务草稿已保存")
          } />
          <footer className="page-footer">
            <span>
              <span className="mini-brand">f</span>少一点焦虑，多一点清晰。
            </span>
            <span>LOCAL FIRST · YOUR PACE</span>
          </footer>
        </main>
      </div>
      {editor?.type === "task" && (
        <TaskEditor
          task={editor.value}
          state={state}
          onClose={() => setEditor(null)}
          onSave={async (t) => {
            if (
              await commit(
                {
                  ...state,
                  tasks: state.tasks.some((x) => x.id === t.id)
                    ? state.tasks.map((x) => (x.id === t.id ? t : x))
                    : [...state.tasks, t],
                },
                "任务已保存",
              )
            )
              setEditor(null);
          }}
        />
      )}
      {editor?.type === "goal" && (
        <GoalEditor
          goal={editor.value}
          milestones={editor.milestones}
          state={state}
          onClose={() => setEditor(null)}
          onSave={async (g, ms) => {
            const remaining = state.milestones.filter((m) => m.goalId !== g.id),
              validIds = new Set([...remaining, ...ms].map((m) => m.id));
            if (
              await commit(
                {
                  ...state,
                  goals: state.goals.some((x) => x.id === g.id)
                    ? state.goals.map((x) => (x.id === g.id ? g : x))
                    : [...state.goals, g],
                  milestones: [...remaining, ...ms],
                  tasks: state.tasks.map((t) =>
                    t.milestoneId && !validIds.has(t.milestoneId)
                      ? { ...t, milestoneId: "" }
                      : t,
                  ),
                },
                "目标已保存",
              )
            )
              setEditor(null);
          }}
        />
      )}
      {editor?.type === "project" && (
        <ProjectEditor
          project={editor.value}
          onClose={() => setEditor(null)}
          onSave={async (p) => {
            if (
              await commit(
                {
                  ...state,
                  projects: state.projects.some((x) => x.id === p.id)
                    ? state.projects.map((x) => (x.id === p.id ? p : x))
                    : [...state.projects, p],
                },
                "项目已保存",
              )
            )
              setEditor(null);
          }}
        />
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="confirm-body">{confirm.body}</p>
          <div className="modal-footer">
            <button className="btn" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                await confirm.action();
                setConfirm(null);
              }}
            >
              确认
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button
            aria-label="关闭提示"
            className="icon-btn"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
