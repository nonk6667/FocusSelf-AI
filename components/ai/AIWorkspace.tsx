"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, Download, Upload, Play, Square, Trash2, Sparkles, ShieldCheck, Send, RefreshCw } from "lucide-react";
import { aiModels, aiPhase, emptyAIStatus, localAI, nativeAI, type AIStatus, type AIResult, type ModelId } from "@/lib/ai/client";
import { buildAIPrompt, type AIMessage } from "@/lib/ai/prompt";
import { parseAIDrafts, validateAIDraft, type AIDraft } from "@/lib/ai/drafts";
import { id, type State } from "@/lib/model";

type Turn = {id: string; question: string; answer: string; mode: "chat" | "tasks"; result?: AIResult};
const message = (e: unknown) => e instanceof Error ? e.message : "操作未完成，请重试。";
const cancelled = (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "CANCELLED";
function draftError(draft: AIDraft, state: State) {
  try { validateAIDraft(draft, state); return ""; }
  catch(e) { return e instanceof Error && e.name !== "ZodError" ? e.message : "请检查日期、项目、时长和标题。"; }
}
export default function AIWorkspace({state, active, onApply}: {state: State; active: boolean; onApply: (drafts: AIDraft[]) => Promise<boolean>}) {
  const [status, setStatus] = useState<AIStatus>(emptyAIStatus);
  const [modelId, setModelId] = useState<ModelId>("4b");
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"chat" | "tasks">("chat");
  const [includeTasks, setIncludeTasks] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<AIDraft[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [draftVersion, setDraftVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<ModelId | null>(null);
  const request = useRef("");
  const abort = useRef(false);
  const mounted = useRef(true);
  const turnId = useRef("");
  const applied = useRef(false);
  const busy = working || status.busy;
  const installed = status.models.find(m => m.id === modelId)?.installed;
  const refresh = useCallback(async () => {
    if (!nativeAI()) return;
    try { const next = await localAI.getStatus(); if (mounted.current) setStatus(next); }
    catch(e) { if (mounted.current) setError(message(e)); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!nativeAI()) return () => { mounted.current = false; };
    let disposed = false;
    const handles: {remove(): Promise<void>}[] = [];
    (async () => {
      for (const handle of [
        await localAI.addListener("aiStatus", next => { if (!disposed) setStatus(next); }),
        await localAI.addListener("aiText", event => {
          if (disposed || event.requestId !== request.current) return;
          setTurns(prev => prev.map(t => t.id === turnId.current ? {...t, answer:event.text} : t));
        }),
      ]) {
        if (disposed) void handle.remove(); else handles.push(handle);
      }
      if (!disposed) await refresh();
    })().catch(e => { if (!disposed) setError(message(e)); });
    return () => {
      disposed = true; mounted.current = false;
      handles.forEach(h => void h.remove());
      if (request.current) void localAI.cancel({requestId: request.current}).catch(() => {});
    };
  }, [refresh]);
  useEffect(() => {
    if (!active && request.current && nativeAI()) {
      abort.current = true;
      void localAI.cancel({requestId: request.current}).catch(() => {});
    }
  }, [active]);
  const stop = async () => {
    abort.current = true;
    if (request.current) {
      setNotice("正在停止，请稍候…");
      try { await localAI.cancel({requestId: request.current}); } catch(e) { setError(message(e)); }
    }
  };
  async function modelAction(action: "import" | "load" | "delete", selected: ModelId) {
    if (busy) return;
    const requestId = id(); request.current = requestId; abort.current = false;
    setWorking(true); setError(""); setNotice(""); setDeleteId(null);
    try {
      if (action === "import") await localAI.importModel({modelId: selected, requestId});
      else if (action === "load") await localAI.loadModel({modelId: selected, requestId});
      else await localAI.deleteModel({modelId: selected, requestId});
      if (mounted.current) setNotice(action === "import" ? "模型已导入并通过校验。" : action === "delete" ? "模型文件已删除，任务数据保留。" : "模型已就绪，可以开始。");
    } catch(e) { if (mounted.current) cancelled(e) ? setNotice("已停止操作。") : setError(message(e)); }
    finally { if (mounted.current) setWorking(false); request.current = ""; await refresh(); }
  }
  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy || !installed || !status.available || drafts.length) return;
    const text = question.trim(); const selectedMode = mode; const key = id();
    abort.current = false; turnId.current = key; setWorking(true); setError(""); setNotice("");
    setQuestion("");
    const history: AIMessage[] = turns.filter(t => t.result && !t.result.cancelled && !t.result.timedOut && t.mode === "chat").slice(-1).flatMap(t => [{role:"user" as const,text:t.question},{role:"assistant" as const,text:t.answer}]);
    setTurns(prev => [...prev.slice(-5), {id:key,question:text,answer:"",mode:selectedMode}]);
    try {
      if (status.loadedModelId !== modelId) {
        request.current = id(); await localAI.loadModel({modelId, requestId: request.current});
      }
      if (abort.current || !mounted.current) return;
      request.current = key;
      const result = await localAI.generate({requestId:key, prompt:buildAIPrompt({state,question:text,mode:selectedMode,includeTasks,history}), maxTokens:selectedMode === "tasks" ? 768 : 512, json:selectedMode === "tasks"});
      if (!mounted.current) return;
      setTurns(prev => prev.map(t => t.id===key ? {...t,answer:result.text,result} : t));
      if (result.cancelled || abort.current) { setNotice("已停止，保留已生成的内容。未修改任务。"); return; }
      if (result.timedOut) { setNotice("已达到本次等待上限。可以缩短问题或使用 4B 重试。"); return; }
      if (selectedMode === "tasks") {
        if (result.truncated) throw Error("任务回复未生成完整，请减少任务数量后重试。");
        try {
          const parsed = parseAIDrafts(result.text);
          setDrafts(parsed.tasks); setDraftNote(parsed.note); setDraftVersion(state.updatedAt); applied.current = false;
        } catch { throw Error("未能整理成完整任务草稿。请把输入缩短到一个任务后重试。"); }
      } else if (result.truncated) setNotice("本次回复已达到长度上限，可继续提问。");
    } catch(e) { if (mounted.current) cancelled(e) ? setNotice("已停止，未修改任务。") : setError(message(e)); }
    finally { request.current = ""; if (mounted.current) setWorking(false); await refresh(); }
  }
  const updateDraft = (index: number, changes: Partial<AIDraft>) => setDrafts(prev => prev.map((d,i) => i===index ? {...d,...changes} : d));
  const errors = drafts.map(d => draftError(d,state));
  const stale = !!drafts.length && draftVersion !== state.updatedAt;
  async function apply() {
    if (applied.current || saving || stale || errors.some(Boolean)) return;
    setSaving(true); setError("");
    try {
      if (await onApply(drafts)) { applied.current = true; setDrafts([]); setNotice("任务已保存到工作台。"); }
      else setError("任务未保存，请检查提示后重试。草稿已保留。");
    } catch(e) { setError(message(e)); }
    finally { setSaving(false); }
  }
  return (
    <section className="ai-workspace" hidden={!active} aria-label="本地 AI 助手">
      <div className="ai-intro"><ShieldCheck size={18}/><span>模型在手机上运行，任务和对话不会发送到云端。</span><span className="local-badge">OFFLINE</span></div>
      {!status.available && <div className="ai-message ai-notice" role="status">{status.error || "本地推理组件正在准备…"}</div>}
      <div className="ai-models" aria-label="选择本地模型">
        {aiModels.map(model => {
          const selected = model.id === modelId, item = status.models.find(m=>m.id===model.id), loaded = status.loadedModelId===model.id;
          return <article className={`panel ai-model ${selected ? "selected" : ""}`} key={model.id}>
            <button type="button" className="ai-model-choice" aria-pressed={selected} disabled={busy} onClick={()=>{setModelId(model.id as ModelId);setError("");}}>
              <span className="ai-model-icon"><Bot size={21}/></span><span><strong>{model.label} · {model.id.toUpperCase()}</strong><small>{model.title} · {(model.bytes/1e9).toFixed(2)} GB</small></span><span className="ai-radio"/>
            </button>
            <p>{model.id==="4b" ? "日常问答、快速整理任务，默认优先使用。" : "适合需要更充分分析的问题，等待和内存占用会增加。"}</p>
            <div className="ai-model-state"><span className={`status-light ${loaded ? "" : "ai-dim"}`}/>{loaded ? "已加载" : item?.verified ? "文件校验通过" : item?.installed ? "已导入，加载时校验" : "尚未导入"}</div>
            <div className="ai-model-actions">
              <button type="button" className="btn small" disabled={!status.available || busy} onClick={()=>void modelAction("import", model.id as ModelId)}><Upload size={13}/>{item?.installed?"重新导入":"导入模型"}</button>
              {item?.installed ? <><button type="button" className="btn small" disabled={busy || loaded || !status.available} onClick={()=>void modelAction("load",model.id as ModelId)}><Play size={13}/>{loaded?"已就绪":"加载"}</button><button type="button" className="icon-btn" aria-label={`删除 ${model.id.toUpperCase()} 模型文件`} disabled={busy} onClick={()=>setDeleteId(model.id as ModelId)}><Trash2 size={14}/></button></> : <button type="button" className="btn small" disabled={!status.available || busy} onClick={()=>void localAI.openModelSource({modelId:model.id as ModelId}).catch(e=>setError(message(e)))}><Download size={13}/>获取文件</button>}
            </div>
            {deleteId === model.id && <div className="ai-delete"><p>删除 {model.id.toUpperCase()} 模型文件？任务数据会保留。</p><button type="button" className="btn small" onClick={()=>setDeleteId(null)}>取消</button><button type="button" className="btn small danger" onClick={()=>void modelAction("delete",model.id as ModelId)}>确认删除</button></div>}
          </article>;
        })}
      </div>
      <div className="ai-runtime" role="status"><span>{aiPhase[status.phase] || status.phase}{status.progress > 0 && status.busy ? ` · ${status.progress}%` : ""}</span><span className="muted">每次只加载一个模型 · 空闲后自动释放</span>{status.loadedModelId && !busy && <button type="button" className="text-button" onClick={()=>void localAI.unloadModel().catch(e=>setError(message(e)))}>释放内存</button>}{busy && request.current && <button type="button" className="btn small" onClick={()=>void stop()}><Square size={12}/>停止操作</button>}</div>
      {status.busy && ["importing","verifying"].includes(status.phase) && <progress className="ai-progress" aria-label="模型处理进度" value={status.progress} max={100}/>}
      {error && <div className="ai-message ai-error" role="alert">{error}</div>}{notice && <div className="ai-message ai-notice" role="status">{notice}</div>}
      <section className="panel ai-chat" aria-label="AI 对话">
        <div className="panel-heading"><div><span className="eyebrow">THINK WITH FOCUS</span><h2>给想法，一个下一步。</h2></div><button type="button" className="icon-btn" aria-label="清空临时对话" disabled={busy || drafts.length>0} onClick={()=>{setTurns([]);setNotice("");setError("");}}><RefreshCw size={15}/></button></div>
        {turns.length === 0 ? <div className="ai-empty"><Sparkles size={26}/><h3>从一个问题开始。</h3><p>可以聊聊今天的安排，也可以把一句话整理为待办。对话仅保留在本次会话中。</p><div className="ai-examples">{["根据今天的待办，我应该先做什么？","明天学一小时 AI 课程，周五前完成。"].map((q,i)=><button type="button" key={q} disabled={busy} onClick={()=>{setQuestion(q);setMode(i?"tasks":"chat");}}>{q}</button>)}</div></div> : <div className="ai-turns">{turns.map(turn=><article className="ai-turn" key={turn.id}><div className="ai-user"><span>你</span><p>{turn.question}</p></div><div className="ai-answer"><span><Sparkles size={13}/>Focus</span>{turn.mode === "tasks" ? <p>{!turn.result ? (busy && turn.id===turnId.current ? (turn.answer ? "正在整理任务字段…" : "正在准备任务草稿…") : "本次未生成可用草稿。") : turn.result.cancelled ? "已停止整理，未添加任务。" : turn.result.timedOut || turn.result.truncated ? "本次回复不完整，请减少任务后重试。" : "已整理回复，请检查任务草稿。"}</p> : <p>{turn.answer || (busy && turn.id===turnId.current ? "正在思考如何帮你…" : "本次没有生成回复。")}</p>}{turn.result && <small className="muted">{turn.result.tokens} 个词元 · 首字 {turn.result.firstTokenMs>=0?(turn.result.firstTokenMs/1000).toFixed(1):"—"} 秒 · {turn.result.tokensPerSecond.toFixed(1)} 词元/秒</small>}</div></article>)}</div>}
        <form className="ai-composer" onSubmit={ask}>
          <div className="ai-composer-options"><div className="segmented" aria-label="AI 功能"><button type="button" className={mode==="chat"?"active":""} disabled={busy} onClick={()=>setMode("chat")}>问一问</button><button type="button" className={mode==="tasks"?"active":""} disabled={busy} onClick={()=>setMode("tasks")}>生成任务</button></div><label className="ai-context"><input type="checkbox" checked={includeTasks} disabled={busy} onChange={e=>setIncludeTasks(e.target.checked)}/>参考今日待办</label></div>
          <label className="sr-only" htmlFor="ai-question">输入问题或任务想法</label><textarea id="ai-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1000} rows={3} placeholder={mode==="chat"?"说说你现在想解决的事…":"例如：明天下午学习一小时 AI 课程"} disabled={busy}/>
          <div className="ai-composer-footer"><small>{drafts.length ? "先处理下方草稿，再开始新请求。" : !installed ? "先导入所选模型，再开始使用。" : "AI 可能理解有误，任务需经你确认才保存。"}</small><button type="submit" className="btn primary" disabled={!status.available || !installed || busy || !question.trim() || drafts.length>0}><Send size={15}/>{busy?"处理中…":status.loadedModelId===modelId?"发送":"加载并发送"}</button></div>
        </form>
      </section>
      {drafts.length>0 && <section className="panel ai-drafts" aria-label="AI 任务草稿"><div className="panel-heading"><div><span className="eyebrow">REVIEW BEFORE SAVING</span><h2>检查一下，再加入计划。</h2></div><span className="pill">{drafts.length} 个草稿</span></div>{draftNote && <p className="ai-draft-note">{draftNote}</p>}{stale && <div className="ai-message ai-notice">工作台数据已变化，请重新核对草稿。<button type="button" className="text-button" onClick={()=>setDraftVersion(state.updatedAt)}>已核对最新数据</button></div>}
        {drafts.map((draft,index)=><fieldset className="ai-draft" key={index} disabled={saving}><legend>任务 {index+1}</legend><label>标题<input aria-label={`草稿 ${index+1} 标题`} value={draft.title} maxLength={160} onChange={e=>updateDraft(index,{title:e.target.value})}/></label><div className="ai-fields"><label>项目<select aria-label={`草稿 ${index+1} 项目`} value={draft.projectId} onChange={e=>updateDraft(index,{projectId:e.target.value})}><option value="">请选择项目</option>{state.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>优先级<select value={draft.priority} onChange={e=>updateDraft(index,{priority:e.target.value as AIDraft["priority"]})}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><label>计划日期<input type="date" value={draft.plannedDate} onChange={e=>updateDraft(index,{plannedDate:e.target.value})}/></label><label>截止日期<input type="date" value={draft.dueDate} onChange={e=>updateDraft(index,{dueDate:e.target.value})}/></label><label>预计分钟<input type="number" min={1} max={1440} value={draft.estimate || ""} onChange={e=>updateDraft(index,{estimate:Number(e.target.value)})}/></label><label>开始时间（可选）<input type="time" value={draft.startTime} onChange={e=>updateDraft(index,{startTime:e.target.value})}/></label></div><label>备注<textarea rows={2} value={draft.notes} maxLength={2000} onChange={e=>updateDraft(index,{notes:e.target.value})}/></label>{errors[index] && <p className="ai-error" role="alert">{errors[index]}</p>}<button type="button" className="text-button danger-text" onClick={()=>setDrafts(prev=>prev.filter((_,i)=>i!==index))}>移除此草稿</button></fieldset>)}
        <div className="ai-draft-actions"><button type="button" className="btn" disabled={saving} onClick={()=>setDrafts([])}>放弃草稿</button><button type="button" className="btn primary" disabled={saving || stale || errors.some(Boolean)} onClick={()=>void apply()}>{saving?"正在保存…":"确认加入工作台"}</button></div>
      </section>}
      <p className="ai-footnote">先获取指定的 Q4_K_M 文件再导入。4B 约 2.74 GB，9B 约 5.68 GB；导入时需要额外的本地存储空间。进入后台会停止生成并释放模型。</p>
    </section>
  );
}
