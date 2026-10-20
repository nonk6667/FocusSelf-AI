import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import catalog from "@/public/ai-models.json";
export const aiModels = catalog.models;
export type ModelId = "4b" | "9b";
export type AIStatus = {
  available: boolean; phase: string; busy: boolean; error: string;
  requestId: string; progress: number; loadedModelId: string; backend: string;
  models: { id: string; installed: boolean; verified: boolean }[];
};
export type AIResult = {
  text: string; requestId: string; cancelled: boolean; timedOut: boolean; truncated: boolean;
  tokens: number; firstTokenMs: number; elapsedMs: number; promptTokens: number; tokensPerSecond: number;
};
interface LocalAIPlugin {
  getStatus(): Promise<AIStatus>;
  importModel(input: {modelId: ModelId; requestId: string}): Promise<AIStatus>;
  loadModel(input: {modelId: ModelId; requestId: string}): Promise<AIStatus>;
  generate(input: {requestId: string; prompt: string; maxTokens: number; json: boolean}): Promise<AIResult>;
  cancel(input: {requestId: string}): Promise<void>;
  unloadModel(): Promise<void>;
  deleteModel(input: {modelId: ModelId; requestId: string}): Promise<void>;
  openModelSource(input: {modelId: ModelId}): Promise<void>;
  addListener(event: "aiStatus", callback: (event: AIStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: "aiText", callback: (event: {requestId: string; text: string}) => void): Promise<PluginListenerHandle>;
}
export const localAI = registerPlugin<LocalAIPlugin>("LocalAI");
export const nativeAI = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("LocalAI");
export const emptyAIStatus: AIStatus = {
  available: false, phase: "unavailable", busy: false, error: "请在 Android 安装包中使用本地 AI。浏览器版继续支持全部手动任务功能。",
  requestId: "", progress: 0, loadedModelId: "", backend: "", models: [],
};
export const aiPhase: Record<string, string> = {
  initializing: "正在准备", unavailable: "当前设备不可用", idle: "尚未加载", ready: "可以开始",
  choosing: "正在选择文件", importing: "正在导入并校验", verifying: "正在校验模型",
  loading: "正在加载模型", generating: "正在生成", releasing: "正在释放内存", deleting: "正在删除模型",
};
