var SlackHtml = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // hooks/slack-html.ts
  var slack_html_exports = {};
  __export(slack_html_exports, {
    clipboardScript: () => clipboardScript,
    labelOf: () => labelOf,
    mentionBlocks: () => mentionBlocks,
    splitDraft: () => splitDraft,
    toHtml: () => toHtml,
    toPlain: () => toPlain
  });
  var LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  var CODE_SPAN = /`([^`]+)`/;
  var escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var inline = (text) => text.split(CODE_SPAN).map(
    (part, i) => i % 2 ? `<code>${escape(part)}</code>` : escape(part).replace(LINK, (_, label, url) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`)
  ).join("");
  var toHtml = (md) => {
    const out = [];
    let listTag = null;
    let inCode = false;
    let code = [];
    const closeList = () => {
      if (listTag) out.push(`</${listTag}>`);
      listTag = null;
    };
    const flushCode = () => out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (line.startsWith("```")) {
        if (inCode) {
          flushCode();
          code = [];
          inCode = false;
        } else {
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        code.push(raw);
        continue;
      }
      if (!line.trim()) continue;
      if (line.startsWith(">")) {
        closeList();
        out.push(`<blockquote>${inline(line.replace(/^[> ]+/, ""))}</blockquote>`);
        continue;
      }
      const item = /^\d+\.\s+(.*)/.exec(line) ?? /^[-*]\s+(.*)/.exec(line);
      if (item) {
        const want = /^\d/.test(line) ? "ol" : "ul";
        if (listTag !== want) {
          closeList();
          out.push(`<${want}>`);
          listTag = want;
        }
        out.push(`<li>${inline(item[1] ?? "")}</li>`);
        continue;
      }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    if (inCode) flushCode();
    closeList();
    return out.join("");
  };
  var MENTION = /(?<=^|[\s(])(@\w+(?:[.-]\w+)*)/;
  var MARKER = /^(\s*(?:\d+\.\s+|[-*]\s+|>\s?))?(.*)$/;
  var runsOf = (line) => line.split(CODE_SPAN).flatMap((part, i) => {
    if (i % 2) return [{ text: part, kind: "code" }];
    const bits = part.split(LINK);
    return bits.flatMap(
      (bit, j) => j % 3 === 1 ? [{ text: bit, kind: "link", href: bits[j + 1] ?? "" }] : j % 3 === 2 ? [] : bit.split(MENTION).map((text, k) => k % 2 ? { text, kind: "mention" } : { text })
    );
  }).filter((r) => r.text !== "");
  var bullet = (mark) => {
    const m = mark.trim();
    return m === "" ? "" : m === ">" ? "\u2502 " : /\d/.test(m) ? `${m} ` : "\u2022 ";
  };
  var mentionBlocks = (md) => {
    const out = [];
    let buf = [];
    let inCode = false;
    const flush = () => {
      if (buf.join("").trim()) out.push({ md: buf.join("\n") });
      buf = [];
    };
    for (const line of md.split(/\r?\n/)) {
      const fence = line.trimStart().startsWith("```");
      if (fence) inCode = !inCode;
      if (inCode || fence || !line.split(CODE_SPAN).some((p, i) => i % 2 === 0 && MENTION.test(p))) {
        buf.push(line);
        continue;
      }
      flush();
      const [, mark = "", rest = ""] = MARKER.exec(line) ?? [];
      out.push({ prefix: bullet(mark), runs: runsOf(rest) });
    }
    flush();
    return out;
  };
  var toPlain = (md) => {
    const out = [];
    let inCode = false;
    for (const raw of md.split(/\r?\n/)) {
      if (raw.trimStart().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        out.push(raw);
        continue;
      }
      const line = raw.replace(/^(\s*)>\s?/, "$1");
      out.push(
        line.split(CODE_SPAN).map((part, i) => i % 2 ? part : part.replace(LINK, (_, _label, url) => url)).join("")
      );
    }
    return out.join("\n").trim() + "\n";
  };
  var HEADER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  var splitDraft = (md) => {
    const m = HEADER.exec(md);
    if (!m) return { body: md, where: "" };
    const where = (m[1] ?? "").split(/\r?\n/).flatMap((line) => {
      const kv = /^(post_in|tag):\s*(.+)$/.exec(line.trim());
      return kv ? [`${kv[1] === "tag" ? "Tag" : "Post in"} ${kv[2]}`] : [];
    }).join("\n\n");
    return { body: md.slice(m[0].length).replace(/^\s*\n/, ""), where };
  };
  var hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
  var literal = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, '" & linefeed & "') + '"';
  var clipboardScript = (md) => `set the clipboard to {\xABclass HTML\xBB:\xABdata HTML${hex(toHtml(md))}\xBB, string:${literal(md)}}`;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var labelOf = (name) => {
    const m = /^(.*)-(\d{2})(\d{2})-(\d{2})(\d{2})\.md$/.exec(name);
    const month = m ? MONTHS[Number(m[2]) - 1] : void 0;
    return m && month ? { who: m[1] ?? name, when: `${month} ${Number(m[3])}, ${m[4]}:${m[5]}` } : { who: name.replace(/\.md$/, ""), when: "" };
  };
  return __toCommonJS(slack_html_exports);
})();
