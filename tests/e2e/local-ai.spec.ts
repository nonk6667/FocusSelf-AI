import { test, expect, type Page } from "@playwright/test";
async function goAI(page: Page) {
  const menu=page.getByRole("button",{name:"打开导航"}); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button",{name:"本地 AI",exact:true}).click();
}
// Native bridge fixture: validates UI/workflow only. Real model results are measured separately on vivo.
async function nativeFixture(page: Page, slow=false) {
  await page.addInitScript(({slow}) => {
    const w=window as any;w.androidBridge={postMessage(){}};
    const events=new Map<string,Function>(); const calls:any[]=[];
    let sequence=0, pending:any;
    const status:any={available:true,phase:"idle",busy:false,error:"",requestId:"",progress:0,loadedModelId:"",backend:"test bridge",models:[{id:"4b",installed:true,verified:true},{id:"9b",installed:true,verified:true}]};
    const publish=()=>events.get("LocalAI:aiStatus")?.({...status});
    w.__localAITest={calls};
    const methods=(names:string[])=>names.map(name=>({name,rtype:"promise"}));
    w.Capacitor={PluginHeaders:[
      {name:"LocalAI",methods:[...methods(["getStatus","loadModel","generate","cancel","unloadModel","deleteModel","importModel","openModelSource"]),{name:"addListener",rtype:"callback"},{name:"removeListener",rtype:"callback"}]},
      {name:"Preferences",methods:methods(["get","set","remove"])},
      {name:"App",methods:[{name:"addListener",rtype:"callback"},{name:"removeListener",rtype:"callback"},...methods(["exitApp"])]},
    ],nativeCallback:(plugin:string,method:string,options:any,cb:Function)=>{
      if(method==="addListener")events.set(plugin+":"+options.eventName,cb);
      if(method==="removeListener")events.delete(plugin+":"+options.eventName);
      return String(++sequence);
    },nativePromise:async(plugin:string,method:string,options:any={})=>{
      if(plugin==="Preferences") {
        if(method==="get")return {value:localStorage.getItem(options.key)};
        if(method==="set")localStorage.setItem(options.key,options.value);
        if(method==="remove")localStorage.removeItem(options.key);return {};
      }
      if(plugin!=="LocalAI")return {};
      calls.push({method,options});
      if(method==="getStatus")return {...status};
      if(method==="loadModel"){status.loadedModelId=options.modelId;status.phase="ready";publish();return {...status};}
      if(method==="generate"){
        status.busy=true;status.phase="generating";status.requestId=options.requestId;publish();
        return new Promise(resolve=>{
          const s=JSON.parse(localStorage.getItem("focus-dashboard:v1")!);
          const title="AI 草稿验证";
          const output=options.json?JSON.stringify({tasks:[{title,notes:"",projectId:s.projects.find((p:any)=>p.kind==="work").id,plannedDate:"2026-10-21",dueDate:"2026-10-23",priority:"medium",estimate:60,startTime:"14:00"}],note:"请核对日期。"}):"建议先处理临近截止日期的任务，再安排学习。";
          const finish=(stopped=false)=>{
            status.busy=false;status.phase="ready";status.requestId="";publish();
            resolve({requestId:options.requestId,text:stopped?"部分内容":output,tokens:20,firstTokenMs:10,elapsedMs:1000,promptTokens:100,tokensPerSecond:20,cancelled:stopped,timedOut:false,truncated:false});
          };
          const timer=setTimeout(()=>{events.get("LocalAI:aiText")?.({requestId:options.requestId,text:output});finish();},slow?10000:300);
          pending=()=>{clearTimeout(timer);finish(true);setTimeout(()=>events.get("LocalAI:aiText")?.({requestId:options.requestId,text:"LATE_REPLY_SHOULD_BE_IGNORED"}),150);};
        });
      }
      if(method==="cancel"){pending?.();return {};}
      if(method==="unloadModel"){status.loadedModelId="";status.phase="idle";publish();return {};}
      return {};
    }};
  },{slow});
}
test("web explains Android-only inference and keeps manual work usable", async({page})=>{
  await page.goto("/");await goAI(page);
  await expect(page.getByText("请在 Android 安装包中使用本地 AI。",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"导入模型",exact:true})).toHaveCount(2);
  await expect(page.getByRole("button",{name:"导入模型",exact:true}).first()).toBeDisabled();
  const menu=page.getByRole("button",{name:"打开导航"}); if(await menu.isVisible()) await menu.click();
  await page.getByRole("button",{name:"所有任务",exact:true}).click();
  await page.getByRole("button",{name:"新建任务",exact:false}).first().click();
  await expect(page.getByLabel("任务名称")).toBeVisible();
  await page.getByRole("button",{name:"取消",exact:true}).click();
});
test("native bridge UI switches to 9B and shows a reply",async({page})=>{
  await nativeFixture(page);await page.goto("/");await goAI(page);
  await page.getByRole("button",{name:/高质量 · 9B/}).click();
  await page.getByLabel("输入问题或任务想法").fill("应该先做什么？");
  await page.getByRole("button",{name:"加载并发送",exact:true}).click();
  await expect(page.getByText("建议先处理临近截止日期的任务，再安排学习。")).toBeVisible();
  const load=await page.evaluate(()=>(window as any).__localAITest.calls.find((c:any)=>c.method==="loadModel"));
  expect(load.options.modelId).toBe("9b");
});
test("AI drafts require review, enforce protected time, and save once",async({page})=>{
  await nativeFixture(page);await page.goto("/");await goAI(page);
  const count=await page.evaluate(()=>JSON.parse(localStorage.getItem("focus-dashboard:v1")!).tasks.length);
  await page.getByRole("button",{name:"生成任务",exact:true}).click();
  await page.getByLabel("输入问题或任务想法").fill("明天学习一小时");
  await page.getByRole("button",{name:"加载并发送",exact:true}).click();
  await expect(page.getByLabel("草稿 1 标题")).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("focus-dashboard:v1")!).tasks.length)).toBe(count);
  const draft=page.locator("fieldset.ai-draft");
  await draft.getByLabel("开始时间（可选）").fill("19:30");
  await expect(draft.getByRole("alert")).toContainText("受保护");
  await expect(page.getByRole("button",{name:"确认加入工作台"})).toBeDisabled();
  await draft.getByLabel("开始时间（可选）").fill("14:00");
  await page.getByLabel("草稿 1 标题").fill("已确认的 AI 学习任务");
  await page.getByRole("button",{name:"确认加入工作台"}).click();
  await expect(page.getByRole("button",{name:"确认加入工作台"})).toHaveCount(0);
  const tasks=await page.evaluate(()=>JSON.parse(localStorage.getItem("focus-dashboard:v1")!).tasks);
  expect(tasks.length).toBe(count+1);expect(tasks.filter((t:any)=>t.title==="已确认的 AI 学习任务")).toHaveLength(1);
});
test("cancelled generation never offers task application or accepts late text",async({page})=>{
  await nativeFixture(page,true);await page.goto("/");await goAI(page);
  await page.getByRole("button",{name:"生成任务",exact:true}).click();
  await page.getByLabel("输入问题或任务想法").fill("明天学习");
  await page.getByRole("button",{name:"加载并发送",exact:true}).click();
  await expect(page.locator(".ai-runtime")).toContainText("正在生成");
  await page.getByRole("button",{name:"停止操作",exact:true}).click();
  await expect(page.getByText("已停止，保留已生成的内容。未修改任务。")).toBeVisible();
  await expect(page.getByRole("button",{name:"确认加入工作台"})).toHaveCount(0);
  await expect(page.getByText("LATE_REPLY_SHOULD_BE_IGNORED")).toHaveCount(0);
});
