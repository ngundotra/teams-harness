import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const restyle = require("../scripts/pg-restyle.js") as {
  parseReactCopy: (text: string) => { emoji: string; copy: string } | null;
  classifyCopies: (texts: string[]) => Array<{ emoji: string; copy: string } | null>;
  findTargetIndex: (
    items: Array<{ text: string; isCopy: boolean }>,
    copyIndex: number,
    copy: string,
  ) => number;
  applyRestyle: (texts: string[]) => Array<{
    text: string;
    hidden: boolean;
    chips: string[];
  }>;
  restyleDocument: (doc: unknown) => void;
  CSS: string;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("parseReactCopy reads eyes/star prefix copies and ignores real text", () => {
  assert.deepEqual(restyle.parseReactCopy("👀 hello there"), { emoji: "👀", copy: "hello there" });
  assert.deepEqual(restyle.parseReactCopy("⭐ star this"), { emoji: "⭐", copy: "star this" });
  assert.deepEqual(restyle.parseReactCopy("👀"), { emoji: "👀", copy: "" });
  assert.deepEqual(restyle.parseReactCopy("👀 "), { emoji: "👀", copy: "" });
  assert.deepEqual(restyle.parseReactCopy("👀\uFE0F star this"), { emoji: "👀", copy: "star this" });
  assert.equal(restyle.parseReactCopy("original text: ping"), null);
  assert.equal(restyle.parseReactCopy("Working on it…"), null);
});

test("classifyCopies only treats prefix+matching-target as a copy", () => {
  const classified = restyle.classifyCopies([
    "hello there",
    "👀 hello there",
    "⭐ I starred something else",
    "⭐ hello there",
  ]);
  assert.equal(classified[0], null);
  assert.deepEqual(classified[1], { emoji: "👀", copy: "hello there" });
  assert.equal(classified[2], null, "emoji-leading grok text is not a copy without a target");
  assert.deepEqual(classified[3], { emoji: "⭐", copy: "hello there" });
});

test("classifyCopies hides in-thread mid-turn follow-up 👀 without a prior sibling card", () => {
  const classified = restyle.classifyCopies([
    "shim-ch-5 root post",
    "Working on it…",
    "👀 shim-ch-5 root post",
    "👀 shim-ch-5 follow-up also answer this",
  ]);
  assert.equal(classified[0], null);
  assert.equal(classified[1], null);
  assert.deepEqual(classified[2], { emoji: "👀", copy: "shim-ch-5 root post" });
  assert.deepEqual(
    classified[3],
    { emoji: "👀", copy: "shim-ch-5 follow-up also answer this" },
    "follow-up 👀 is a seen-cursor copy even when the follow-up is not in this card list",
  );
});

test("classifyCopies matches a ⭐ copy when the target is a line inside a thread card", () => {
  const classified = restyle.classifyCopies([
    "Alex Wilber\nshim-ch-5 root post\nshim-ch-5 follow-up also answer this",
    "⭐ shim-ch-5 follow-up also answer this",
  ]);
  assert.equal(classified[0], null);
  assert.deepEqual(classified[1], { emoji: "⭐", copy: "shim-ch-5 follow-up also answer this" });
});

test("findTargetIndex skips other copies and matches remaining text", () => {
  const items = [
    { text: "hello there", isCopy: false },
    { text: "👀 hello there", isCopy: true },
    { text: "Working on it…", isCopy: false },
    { text: "⭐ hello there", isCopy: true },
  ];
  assert.equal(restyle.findTargetIndex(items, 1, "hello there"), 0);
  assert.equal(restyle.findTargetIndex(items, 3, "hello there"), 0);
  assert.equal(restyle.findTargetIndex(items, 3, ""), 2, "emoji-only copy lands on previous non-copy");
});

test("applyRestyle hides prefix copies and chips the target, not the previous bubble", () => {
  const out = restyle.applyRestyle([
    "pg-dm-3 star this",
    "Working on it…",
    "⭐ pg-dm-3 star this",
    "👀 Working on it…",
  ]);
  assert.equal(out[0]?.hidden, false);
  assert.deepEqual(out[0]?.chips, ["⭐"]);
  assert.equal(out[1]?.hidden, false);
  assert.deepEqual(out[1]?.chips, ["👀"]);
  assert.equal(out[2]?.hidden, true);
  assert.deepEqual(out[2]?.chips, []);
  assert.equal(out[3]?.hidden, true);
});

test("applyRestyle chips a channel root and hides the in-thread prefix copy", () => {
  const out = restyle.applyRestyle([
    "new channel post",
    "Working on it…",
    "original text: new channel post",
    "⭐ new channel post",
  ]);
  assert.equal(out[0]?.hidden, false);
  assert.deepEqual(out[0]?.chips, ["⭐"]);
  assert.equal(out[2]?.hidden, false);
  assert.equal(out[3]?.hidden, true);
});

test("applyRestyle hides mid-turn channel follow-up 👀 leftover", () => {
  const out = restyle.applyRestyle([
    "shim-ch-5 root post",
    "Working on it…",
    "👀 shim-ch-5 root post",
    "👀 shim-ch-5 follow-up also answer this",
    "original text: shim-ch-5 root post",
  ]);
  assert.equal(out[2]?.hidden, true);
  assert.equal(out[3]?.hidden, true);
  assert.deepEqual(out[0]?.chips, ["👀"]);
  assert.equal(out[4]?.hidden, false);
});

test("applyRestyle chips the in-card follow-up row when collectMessages lists nested p", () => {
  const out = restyle.applyRestyle([
    "shim-ch-5 root post",
    "shim-ch-5 follow-up also answer this",
    "👀 shim-ch-5 follow-up also answer this",
  ]);
  assert.equal(out[0]?.hidden, false);
  assert.equal(out[1]?.hidden, false);
  assert.deepEqual(out[1]?.chips, ["👀"]);
  assert.equal(out[2]?.hidden, true);
});

test("applyRestyle hides grok+playground loop 5 in-thread 👀 rows", () => {
  const out = restyle.applyRestyle([
    "pr5-ch-5b ping",
    "star this",
    "👀 star this",
    "pr5-ch-5 follow-up also answer this",
    "👀 pr5-ch-5 follow-up also answer this",
  ]);
  assert.equal(out[1]?.hidden, false);
  assert.deepEqual(out[1]?.chips, ["👀"]);
  assert.equal(out[2]?.hidden, true);
  assert.equal(out[3]?.hidden, false);
  assert.deepEqual(out[3]?.chips, ["👀"]);
  assert.equal(out[4]?.hidden, true);
});

test("restyle CSS hides prefix-copy bubbles instead of outlining them", () => {
  assert.match(restyle.CSS, /data-pg-reactcopy='1'/);
  assert.match(restyle.CSS, /display:none/);
  assert.equal(restyle.CSS.includes("outline:2px"), false);
});

test("ungate injects pg-restyle.js and patches replyToId onto existing Post conversations", () => {
  const ungate = readFileSync(join(root, "scripts", "ungate-playground.mjs"), "utf8");
  assert.match(ungate, /pg-restyle\.js/);
  assert.match(ungate, /generatePostConversationId\(conversation\.id,rid\)/);
  assert.equal(ungate.includes("const MARK = /^(👀|⭐)/"), false, "old inlined CHIP_JS must be gone");
  const restyleSrc = readFileSync(join(root, "scripts", "pg-restyle.js"), "utf8");
  assert.doesNotThrow(() => new Function(restyleSrc));
  assert.match(restyleSrc, /querySelectorAll\("p"\)/, "in-thread follow-up copies are nested <p> rows");
  assert.match(restyleSrc, /collectCopyLeaves/, "sweep leftover in-card prefix copies");
  assert.match(
    restyleSrc,
    /fui-Card/,
    "hideCopy must not walk up to the root post card",
  );
});

test("src still has no Graph SDK and no second control plane in the restyle", () => {
  const restyleSrc = readFileSync(join(root, "scripts", "pg-restyle.js"), "utf8");
  assert.equal(restyleSrc.includes("graph.microsoft.com"), false);
  assert.equal(restyleSrc.includes("@microsoft/microsoft-graph-client"), false);
  const ungate = readFileSync(join(root, "scripts", "ungate-playground.mjs"), "utf8");
  assert.equal(ungate.includes("graph.microsoft.com"), false);
});
