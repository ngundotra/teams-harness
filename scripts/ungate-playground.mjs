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

const CHIP_JS = `(() => {
  const MARK = /^(👀|⭐)/;
  const styleId = "pg-chip-style";
  function ensureStyle() {
    if (document.getElementById(styleId)) return;
    const s = document.createElement("style");
    s.id = styleId;
    s.textContent = ".pg-chip{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;margin:4px 6px 0 0;padding:0 8px;border-radius:14px;border:1px solid #c7a512;background:#fff6cc;font-size:18px;line-height:28px;vertical-align:middle}.ui-chat__message[data-pg-reactcopy="1"] .ui-chat__message__bubble{outline:2px solid #c7a512}";
    document.head.appendChild(s);
  }
  function restyle() {
    ensureStyle();
    const msgs = Array.from(document.querySelectorAll(".ui-chat__message"));
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const bubble = msg.querySelector(".ui-chat__message__bubble") || msg;
      const text = (bubble.innerText || "").trim();
      const m = text.match(MARK);
      if (!m) continue;
      msg.setAttribute("data-pg-reactcopy", "1");
      const prev = i > 0 ? msgs[i - 1] : null;
      if (!prev) continue;
      const emoji = m[1];
      if (prev.querySelector('.pg-chip[data-emoji="' + emoji + '"]')) continue;
      const chip = document.createElement("span");
      chip.className = "pg-chip";
      chip.setAttribute("data-emoji", emoji);
      chip.textContent = emoji;
      const body = prev.querySelector(".ui-chat__message__body") || prev;
      body.appendChild(chip);
    }
  }
  const run = () => { try { restyle(); } catch (e) {} };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(run, 400);
  run();
})();`;

const htmlPath = join(pkgRoot, "dist", "client", "index.html");
let html = readFileSync(htmlPath, "utf8");
if (!html.includes("pg-chip-boot")) {
  const boot = '<script id="pg-chip-boot">' + CHIP_JS + "</script></body>";
  if (!html.includes("</body>")) {
    console.error("ungate-playground: index.html missing </body>");
    process.exit(1);
  }
  html = html.replace("</body>", boot);
  writeFileSync(htmlPath, html);
}
if (!html.includes("pg-chip-boot")) {
  console.error("ungate-playground: reaction chip script not in index.html");
  process.exit(1);
}
console.log("playground: reaction chips injected into client");

const SCHEMA_OLD = 'type:z.union([z.literal("message"),z.literal("typing")])';
const SCHEMA_NEW = 'type:z.union([z.literal("message"),z.literal("typing"),z.literal("messageReaction")])';
let server = readFileSync(distPath, "utf8");
let serverNext = server;
if (serverNext.includes(SCHEMA_OLD)) {
  serverNext = serverNext.replace(SCHEMA_OLD, SCHEMA_NEW);
}
const PROC_OLD = 'if(activity.type===agents_activity_1.ActivityTypes.Typing)return await this.sendTyping(conversationId),{resIds:[],shouldRespond:!0,statusCode:202};const resIds=await this.sendToConversation(conversationId,activity);';
const PROC_NEW = 'if(activity.type==="messageReaction"){const r=(activity.reactionsAdded&&activity.reactionsAdded[0]&&activity.reactionsAdded[0].type)||"star";const map={eyes:"👀",eye:"👀",star:"⭐",like:"👍"};activity.type="message";activity.text=(map[String(r).toLowerCase()]||"⭐")+" ";}if(activity.type===agents_activity_1.ActivityTypes.Typing)return await this.sendTyping(conversationId),{resIds:[],shouldRespond:!0,statusCode:202};const resIds=await this.sendToConversation(conversationId,activity);';
if (serverNext.includes(PROC_OLD)) {
  serverNext = serverNext.replace(PROC_OLD, PROC_NEW);
}
if (serverNext !== server) {
  writeFileSync(distPath, serverNext);
}
if (serverNext.includes(SCHEMA_NEW)) {
  console.log("playground: messageReaction accepted by connector schema");
} else {
  console.log("playground: schema already patched or pattern missing");
}

