import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// Same restyle table as the previous inlined CHIP_JS. Extracted so the
// injected script is valid JS (the template quoted data-pg-reactcopy="1"
// and never booted) and so tests can call the matcher. Always rewrite so
// a later restyle fix actually lands.
const restylePath = join(dirname(fileURLToPath(import.meta.url)), "pg-restyle.js");
const CHIP_JS = readFileSync(restylePath, "utf8");
if (CHIP_JS.includes("</script>")) {
  console.error("ungate-playground: pg-restyle.js must not contain </script>");
  process.exit(1);
}

const htmlPath = join(pkgRoot, "dist", "client", "index.html");
let html = readFileSync(htmlPath, "utf8");
if (!html.includes("</body>")) {
  console.error("ungate-playground: index.html missing </body>");
  process.exit(1);
}
html = html.replace(/<script id="pg-chip-boot">[\s\S]*?<\/script>/, "");
const boot = '<script id="pg-chip-boot">' + CHIP_JS + "</script></body>";
html = html.replace("</body>", boot);
writeFileSync(htmlPath, html);
if (!html.includes("pg-chip-boot") || !html.includes("data-pg-reactcopy")) {
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

// Playground sendToConversation on a Channel conversation always opens a
// new Post (new thread root) and ignores replyToId. Native Post ids are
// already `${channelId};messageid=${messageId}`. Route a Channel post that
// carries replyToId onto that existing Post conversation so replies stay
// visually in-thread. Bot path only (createMessage("bot", ...)).
const THREAD_OLD =
  'conversation.type===conversation_1.ConversationType.Channel&&(postConversation=this.conversationManager.createConversation(conversation));const messageContent=this.convertActivityToMessageContent(activity),message=this.conversationManager.createMessage("bot"';
const THREAD_NEW =
  'if(conversation.type===conversation_1.ConversationType.Channel){const rid=activity.replyToId;if(rid){const pid=conversation_1.Conversation.generatePostConversationId(conversation.id,rid);try{postConversation=this.conversationManager.getConversation(pid)}catch{postConversation=this.conversationManager.createConversation(conversation)}}else postConversation=this.conversationManager.createConversation(conversation);}const messageContent=this.convertActivityToMessageContent(activity),message=this.conversationManager.createMessage("bot"';
if (serverNext.includes(THREAD_OLD)) {
  serverNext = serverNext.replace(THREAD_OLD, THREAD_NEW);
  writeFileSync(distPath, serverNext);
}
if (serverNext.includes("generatePostConversationId(conversation.id,rid)")) {
  console.log("playground: channel replyToId stays on existing post conversation");
} else {
  console.log("playground: thread replyToId patch already applied or pattern missing");
}

