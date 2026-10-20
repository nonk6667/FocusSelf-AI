// Development-only USB provisioning for a debuggable APK. Never touches task storage.
import {spawn, execFileSync} from "node:child_process";
import {createReadStream, readFileSync, statSync} from "node:fs";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const models=JSON.parse(readFileSync(join(root,"public/ai-models.json"),"utf8")).models;
function arg(key){const i=process.argv.indexOf(key);return i>=0?process.argv[i+1]:undefined;}
const serial=arg("--serial"), directory=arg("--models-dir"), wanted=(arg("--models")||"4b,9b").split(",");
if(!serial||!directory||wanted.some(id=>!models.some(m=>m.id===id)))throw Error("用法: node scripts/provision-ai-models.mjs --serial DEVICE --models-dir DIRECTORY [--models 4b,9b]");
const adb=join(process.env.ANDROID_HOME||join(homedir(),"Library/Android/sdk"),"platform-tools",process.platform==="win32"?"adb.exe":"adb");
const run=(...args)=>execFileSync(adb,["-s",serial,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
if(run("get-state")!=="device")throw Error("设备未连接或未授权。");
run("shell","run-as","io.focusworkspace.app","id");
run("shell","am","force-stop","io.focusworkspace.app");
run("shell","run-as","io.focusworkspace.app","mkdir","-p","files/local-ai");
for(const id of wanted){
 const model=models.find(m=>m.id===id),path=resolve(directory,model.filename);
 if(statSync(path).size!==model.bytes)throw Error(`${id}: 文件大小不匹配`);
 const hash=createHash("sha256");for await(const c of createReadStream(path))hash.update(c);
 if(hash.digest("hex")!==model.sha256)throw Error(`${id}: SHA-256 校验失败`);
 console.log(`${id}: host SHA-256 verified, transferring…`);
 const destination=`files/local-ai/${id}.gguf.part`;
 const temporary=`/data/local/tmp/focus-ai-${id}.gguf`;
 // adb's sync protocol is more robust for multi-GB files than a raw exec-in stream.
 await new Promise((resolve,reject)=>{
   const child=spawn(adb,["-s",serial,"push","-Z",path,temporary],{stdio:["ignore","ignore","pipe"]});
   let errors="";child.stderr.on("data",c=>{errors+=c;});
   child.on("error",reject);child.on("close",code=>code===0?resolve():reject(Error(errors||"USB 传输失败")));
 });
 try {
   run("shell",`cat ${temporary} | run-as io.focusworkspace.app sh -c 'cat > ${destination}'`);
   const bytes=Number(run("shell","run-as","io.focusworkspace.app","stat","-c","%s",destination));
   if(bytes!==model.bytes)throw Error(`${id}: 设备文件大小不匹配`);
   run("shell","run-as","io.focusworkspace.app","mv",destination,`files/local-ai/${id}.gguf`);
 } finally { run("shell","rm",temporary); }
 console.log(`${id}: private model installed; app verifies SHA-256 before first load`);
}
run("shell","am","start","-n","io.focusworkspace.app/.MainActivity");
