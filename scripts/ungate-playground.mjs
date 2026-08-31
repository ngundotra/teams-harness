import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve("@microsoft/m365agentsplayground/package.json"));
const distPath = join(pkgRoot, "dist", "index.js");

const GATED =
  "(isPersonalChat||isBotMentioned)&&(afterAll=()=>this.messageConnector.sendCreateMessageActivity(message).catch((()=>{})))";
const UNGATED = "(afterAll=()=>this.messageConnector.sendCreateMessageActivity(message).catch((()=>{})))";
const BROKEN = "returnafterAll=()=>this.messageConnector.sendCreateMessageActivity(message).catch((()=>{})),";
const FIXED = "return(afterAll=()=>this.messageConnector.sendCreateMessageActivity(message).catch((()=>{}))),";

const src = readFileSync(distPath, "utf8");
let next = src;
if (next.includes(BROKEN)) {
  next = next.replace(BROKEN, FIXED);
}
if (next.includes(GATED)) {
  next = next.replace(GATED, UNGATED);
}
if (!next.includes(FIXED) && !next.includes(UNGATED)) {
  console.error("ungate-playground: mention-gate pattern not found in", distPath);
  process.exit(1);
}
if (next !== src) {
  writeFileSync(distPath, next);
}
console.log("playground: forwarding all channel messages (mention gate off)");

const jsDir = join(pkgRoot, "dist", "client", "static", "js");
const jsFile = readdirSync(jsDir).find((f) => f.startsWith("main.") && f.endsWith(".js") && !f.includes("LICENSE"));
if (!jsFile) {
  console.error("ungate-playground: client bundle not found in", jsDir);
  process.exit(1);
}
const clientPath = join(jsDir, jsFile);
let client = readFileSync(clientPath, "utf8");
const editorOld = '{position:"relative",maxHeight:"276px",overflowY:"auto",paddingLeft:"10px"';
const editorNew = '{position:"relative",minHeight:"40px",maxHeight:"276px",overflowY:"auto",paddingLeft:"10px"';
const sendOld = 'sendButton:(0,U.A)({backgroundColor:nV,maxWidth:"20px",minWidth:"20px",height:"40px"}';
const sendNew = 'sendButton:(0,U.A)({backgroundColor:nV,maxWidth:"40px",minWidth:"40px",height:"40px"}';
const padOld = 'paddingTop:"24px",paddingBottom:"24px"';
const padNew = 'paddingTop:"24px",paddingBottom:"120px"';
const focusOld = 'className:t.chatInputBoxBorder,children:';
const focusNew = 'className:t.chatInputBoxBorder,onMouseDown:()=>n.focus(),children:';
let clientNext = client;
for (const [a, b] of [[editorOld, editorNew], [sendOld, sendNew], [padOld, padNew], [focusOld, focusNew]]) {
  if (clientNext.includes(a)) clientNext = clientNext.replace(a, b);
}
if (clientNext !== client) {
  writeFileSync(clientPath, clientNext);
}
if (!clientNext.includes('minHeight:"40px",maxHeight:"276px"')) {
  console.error("ungate-playground: editor minHeight patch not present in", clientPath);
  process.exit(1);
}
console.log("playground: dm compose hit target 40px");
