// Real native CPU inference on an explicitly selected device; never applies or alters tasks.
import {execFileSync} from "node:child_process";
import {chromium} from "@playwright/test";
import {homedir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
const arg=process.argv.indexOf("--serial"),serial=arg>=0?process.argv[arg+1]:"";
const at=process.argv.indexOf("--models"),models=(at>=0?process.argv[at+1]:"4b,9b").split(",");
if(!serial||models.some(m=>!["4b","9b"].includes(m)))throw Error("请明确指定 --serial DEVICE，可选 --models 4b,9b。");
const adb=join(process.env.ANDROID_HOME||join(homedir(),"Library/Android/sdk"),"platform-tools","adb");
const run=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8"}).trim();
const pid=run("shell","pidof","io.focusworkspace.app");
run("forward","tcp:9225",`localabstract:webview_devtools_remote_${pid}`);
let browser;
try {
 browser=await chromium.connectOverCDP("http://127.0.0.1:9225",{timeout:10000});
 const page=browser.contexts()[0].pages()[0];
 if(await page.evaluate(()=>document.visibilityState)!=="visible")throw Error("请将工作台保持在手机前台。");
 const hash=async()=>createHash("sha256").update((await page.evaluate(async()=> (await window.Capacitor.Plugins.Preferences.get({key:"focus-dashboard:v1"})).value))||"").digest("hex");
 const before=await hash();const results=[];
 for(const modelId of models){
  console.log(`Testing ${modelId} on device…`);
  const result=await page.evaluate(async modelId=>{
   const ai=window.Capacitor.Plugins.LocalAI;
   const start=performance.now();await ai.loadModel({modelId,requestId:`test-load-${modelId}`});
   const loadMs=performance.now()-start;
   const prompt=(system,user)=>`<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
   const chat=await ai.generate({requestId:`test-chat-${modelId}`,prompt:prompt('你是中文助手，只用一句话回答。','明天学习一小时AI课程，给我一句行动建议。'),maxTokens:80,json:false});
   const draft=await ai.generate({requestId:`test-json-${modelId}`,prompt:prompt('只输出JSON，不要解释。格式为{"tasks":[{"title":"标题","projectId":"project-test","plannedDate":"2026-10-21","dueDate":"2026-10-23","estimate":60,"startTime":"14:00","priority":"medium","notes":""}],"note":""}。','创建一个任务：学习AI课程。保留所有固定字段。'),maxTokens:384,json:true});
   const cancellationStart=performance.now();
   const pending=ai.generate({requestId:`test-cancel-${modelId}`,prompt:prompt('用中文详细回答。','请列出一百条学习建议。'),maxTokens:768,json:false});
   setTimeout(()=>void ai.cancel({requestId:`test-cancel-${modelId}`}),300);
   const stopped=await pending;
   return {modelId,loadMs,chat,draft,cancelled:stopped.cancelled,cancelElapsedMs:performance.now()-cancellationStart,status:await ai.getStatus()};
  },modelId);
  if(!result.chat.text||result.chat.cancelled||result.chat.timedOut)throw Error(`${modelId} chat failed`);
  const parsed=JSON.parse(result.draft.text);
  if(result.draft.truncated||result.draft.cancelled||result.draft.timedOut||!Array.isArray(parsed.tasks)||parsed.tasks.length!==1||parsed.tasks[0].projectId!=="project-test")throw Error(`${modelId} structured reply failed`);
  if(!result.cancelled)throw Error(`${modelId} cancellation failed`);
  if(result.status.loadedModelId!==modelId)throw Error(`${modelId} single-model state failed`);
  results.push(result);console.log(JSON.stringify(result));
 }
 await page.evaluate(()=>window.Capacitor.Plugins.LocalAI.unloadModel());
 if(await hash()!==before)throw Error("测试期间持久任务数据变化，未做覆盖恢复。");
 console.log(JSON.stringify({pass:true,dataUnchanged:true,models:results.map(r=>r.modelId)}));
} finally {await browser?.close();run("forward","--remove","tcp:9225");}
