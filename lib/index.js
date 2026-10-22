// dsh-aesthete-agent — DeepSeek Harness 原生插件(Cordis)
// 把 aesthete-agent(前端美学引擎)的核心命令注册为原生工具与捆绑 Skill。
// 引擎 = 随插件捆绑的 skills/aesthete-agent(纯 Python 标准库,本地运行,零联网)。
// 契约依据:官方 docs/cookbook/adding-a-tool + docs/cordis-tutorial + dsh-tools 0.2.1-rc.2 类型。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const execFileP = promisify(execFile);

const SKILL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "aesthete-agent");
const ENGINE = path.join(SKILL_DIR, "scripts", "palette_forge.py");

const PY_CANDIDATES = process.platform === "win32"
  ? ["python", "python3", "py"]
  : ["python3", "python"];

// 0.8.0 失败台账:每工具成败计数落盘(纯自有实现,台账失败绝不影响工具)
const LEDGER_DIR = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "aesthete-agent")
  : path.join(os.homedir(), ".local", "state", "aesthete-agent");
const LEDGER_FILE = path.join(LEDGER_DIR, "ledger.json");
function recordLedger(tool, ok) {
  try {
    fs.mkdirSync(LEDGER_DIR, { recursive: true });
    let l = {};
    try { l = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")); } catch {}
    l[tool] = l[tool] || { ok: 0, fail: 0 };
    l[tool][ok ? "ok" : "fail"] = (l[tool][ok ? "ok" : "fail"] || 0) + 1;
    l.updated = new Date().toISOString();
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(l, null, 1));
  } catch {}
}
function ledgerSummary() {
  try { return fs.readFileSync(LEDGER_FILE, "utf8"); } catch { return "{}"; }
}

let _python = null;
async function resolvePython() {
  if (_python) return _python;
  for (const py of PY_CANDIDATES) {
    try {
      await execFileP(py, ["--version"], { timeout: 15000 });
      _python = py;
      return py;
    } catch (e) {
      if (!(e.code === "ENOENT" || /ENOENT|not found/i.test(String(e.message)))) {
        _python = py; // 二进制存在但 --version 异常,仍交给真实调用
        return py;
      }
    }
  }
  throw new Error("未找到 Python——aesthete-agent 引擎需要 Python 3.8+,请安装并加入 PATH。");
}

// 引擎退出码=裁决(report FAIL=1 等):按官方约定,领域结果写规范值而非抛异常,
// 由 render/模型解释状态(类比官方 tool-bash 的非零退出)。
async function runEngine(args, cwd, signal, toolName) {
  const py = await resolvePython();
  try {
    const { stdout, stderr } = await execFileP(py, [ENGINE, ...args], {
      cwd: cwd || process.cwd(), timeout: 180000, maxBuffer: 8e6, signal,
    });
    const _text = (stdout + (stderr ? "\n" + stderr : "")).trim();
    if (toolName) recordLedger(toolName, true);
    return { ok: true, exit: 0, text: _text };
  } catch (e) {
    if (e.code === "ENOENT" || /ENOENT/i.test(String(e.message))) {
      return { ok: false, exit: -1, text: "Python 未找到:" + String(e.message) };
    }
    if (e.killed || /terminated|signal/i.test(String(e.message))) {
      return { ok: false, exit: -2, text: "引擎调用被取消(超时或 signal)。" };
    }
    const text = ((e.stdout || "") + (e.stderr ? "\n" + e.stderr : "")).trim() || String(e.message);
    if (toolName) recordLedger(toolName, false);
    return { ok: false, exit: typeof e.code === "number" ? e.code : 1, text };
  }
}

function sessionCwd(exec) {
  try {
    return exec?.agent?.session?.header?.cwd || process.cwd();
  } catch {
    return process.cwd();
  }
}

// 官方形态的输出投影:规范值=可编程 JSON,模型可见文本由 render 解释。
const nativeOutput = {
  schema: { type: "json" },
  render: (_args, value) => [{
    type: "text",
    text: typeof value?.text === "string" ? value.text : JSON.stringify(value),
  }],
};

const asString = (v, dflt = "") => (typeof v === "string" ? v : v == null ? dflt : String(v));

// 0.8.0 分数卡:从 report/score 规范值提取 UI 摘要(纯函数;失败返 undefined=通用卡兜底)
function scoreMeta(value) {
  try {
    const j = JSON.parse(value && typeof value.text === "string" ? value.text : "{}");
    if (!j.verdict) return undefined;
    const sc = (j.gates && j.gates.score && /TOTAL (\d+\/20)/.exec(j.gates.score.detail || "")) || [];
    const best = (j.gates && j.gates.contrast && j.gates.contrast.best) || "";
    const gp = (j.summary && j.summary.gates_passed) || "";
    return { verdict: j.verdict, score: sc[1] || "", best, gates: gp,
             line: "裁决 " + j.verdict + (sc[1] ? " · " + sc[1] + " 分" : "") +
                   (best ? " · 最优对比 " + best : "") + (gp ? " · 检查通过 " + gp : "") };
  } catch { return undefined; }
}
const scoreOutput = {
  schema: { type: "json" },
  render: (_args, value) => [{
    type: "text",
    text: typeof value?.text === "string" ? value.text : JSON.stringify(value),
  }],
  presentationMeta: (_args, value) => scoreMeta(value) || undefined,
};
function matrixMeta(value) {
  try {
    const j = JSON.parse(value && typeof value.text === "string" ? value.text : "{}");
    const best = j.recommend && (j.recommend.best || j.recommend.pair);
    if (!best) return undefined;
    const line = typeof best === "string" ? best : JSON.stringify(best);
    return { line: "最佳配对 " + line };
  } catch { return undefined; }
}
const matrixOutput = {
  schema: { type: "json" },
  render: (_args, value) => [{
    type: "text",
    text: typeof value?.text === "string" ? value.text : JSON.stringify(value),
  }],
  presentationMeta: (_args, value) => matrixMeta(value) || undefined,
};
const scorePresent = (_args, result) => {
  const m = result && result.meta;
  if (!m || !m.line) return undefined;
  return { card: "generic", title: "aesthete " + (m.verdict || ""),
           content: [{ type: "text", text: m.line }] };
};
const PALETTE_ARG = {
  type: "string", required: true,
  description: "逗号分隔 hex,如 555B6E,89B0AE,BEE3DB,FAF9F9,FFD6BA",
};

export const name = "dsh-aesthete-agent";
export const inject = ["tools", "skills", "commands"];

export function apply(ctx) {
  // ---- 原生工具(8) ----
  ctx.tools.register(defineTool({
    name: "aesthete_match",
    description: "按需求自然语言在 118 块实证色板库中排序选板:自动识别语域(素雅/大气/鲜艳/科技感/医学教学等),偏好档案机械加权。返回带风格标签与 hex 的候选列表;纪律:取 ≥2 候选对比后由用户点名。",
    parameters: {
      brief: { type: "string", required: true, description: "需求自然语言,如:素雅耐看的落地页 / 儿科教学页" },
      limit: { type: "number", description: "返回候选数,默认 6" },
    },
    output: nativeOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 200000,
    presentCall: (a) => ({ card: "generic", title: "配色选库:" + asString(a?.brief), kind: "read" }),
    execute: async (a) => {
      const args = ["match", "--brief", asString(a?.brief)];
      if (a?.limit) args.push("--limit", asString(a.limit));
      return runEngine(args, undefined, undefined, "match");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_directions",
    description: "跨语域设计方向对比:从不同风格族(素雅/大气/鲜艳/科技感)各取头牌色板,整页渲染成并排对比页(工作目录下 directions.html 与 direction_A/B/C.html)。差异铁律保证方向真不同;每方向带「选择回传句」,用户点名后原样执行,不替用户决定。",
    parameters: {
      brief: { type: "string", description: "设计需求,如:素雅耐看的落地页" },
      registers: { type: "string", description: "逗号分隔语域(如 frontend_soft,frontend_deep);不给则从 brief 自动识别" },
      n: { type: "number", description: "方向数 2-4,默认 3" },
      out_dir: { type: "string", description: "输出目录,默认当前工作目录" },
    },
    output: nativeOutput,
    timeoutMs: 200000,
    presentCall: (a) => ({
      card: "generic", title: "生成跨语域方向对比页", kind: "write",
      locations: [{ path: path.join(asString(a?.out_dir, "."), "directions.html") }],
    }),
    execute: async (a, exec) => {
      const cwd = sessionCwd(exec);
      const outDir = asString(a?.out_dir, cwd);
      const args = ["directions", "--out-dir", outDir];
      if (a?.brief) args.push("--brief", asString(a.brief));
      if (a?.registers) args.push("--registers", asString(a.registers));
      if (a?.n) args.push("--n", asString(a.n));
      const r = await runEngine(args, cwd, exec?.signal, "directions");
      return { ...r, files: ["directions.html"] };
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_report",
    description: "四道机械检查一键验收:WCAG 对比度、色盲三模拟、AI 味配色检测、五维评分,聚合成单个 PASS/FAIL JSON。检查不过不交付——FAIL 也是合法结果,按发现修复后重跑。",
    parameters: { palette: PALETTE_ARG },
    output: scoreOutput,
    presentResult: scorePresent,
    isConcurrencySafe: () => true,
    timeoutMs: 200000,
    presentCall: (a) => ({ card: "generic", title: "四道检查验收", kind: "read" }),
    execute: async (a) => runEngine(["report", "--palette", asString(a?.palette)], undefined, undefined, "report"),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_matrix",
    description: "色板全对对比度矩阵(WCAG 比值)+最佳文字/底色配对推荐——哪个字配哪个底,给个准数。",
    parameters: { palette: PALETTE_ARG },
    output: matrixOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 200000,
    presentCall: (a) => ({ card: "generic", title: "对比度矩阵", kind: "read" }),
    execute: async (a) => runEngine(["matrix", "--palette", asString(a?.palette), "--recommend"], undefined, undefined, "matrix"),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_blind",
    description: "红绿蓝三型色盲模拟,报告最小分离度与碰撞风险——配色对色盲朋友是否友好,给机械结论。",
    parameters: { palette: PALETTE_ARG },
    output: nativeOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 200000,
    presentCall: (a) => ({ card: "generic", title: "色盲模拟", kind: "read" }),
    execute: async (a) => runEngine(["blind", "--palette", asString(a?.palette)], undefined, undefined, "blind"),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_score",
    description: "五维评分卡(/20):架构、可读性、色盲安全、饱和纪律、独特性,附 P0-P3 发现与修复建议。",
    parameters: { palette: PALETTE_ARG },
    output: scoreOutput,
    presentResult: scorePresent,
    isConcurrencySafe: () => true,
    timeoutMs: 200000,
    presentCall: (a) => ({ card: "generic", title: "五维评分", kind: "read" }),
    execute: async (a) => runEngine(["score", "--palette", asString(a?.palette)], undefined, undefined, "score"),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_recipes",
    description: "取表现力技法库:10 条可组合惊艳技法(暗幕颗粒 hero/幽灵序号/跑马灯/粘性堆叠/双色调影像/非对称网格/悬停揭示/巨型裁切字符…)的完整代码与选型规则。整页设计前必取;挑 3-5 条自由构图,产出后过机械闸。",
    parameters: {
      keyword: { type: "string", description: "可选过滤词,如 hero/网格/动效/图片;空=返回全部" },
    },
    output: scoreOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 60000,
    presentCall: (a) => ({ card: "generic", title: "取表现力技法库", kind: "read" }),
    execute: async (a) => {
      try {
        const raw = fs.readFileSync(path.join(SKILL_DIR, "references", "design-techniques.md"), "utf8");
        const kw = asString(a?.keyword).trim().toLowerCase();
        let text = raw;
        if (kw) {
          const secs = raw.split(/\n(?=## R\d)/);
          const hits = secs.filter((sec) => sec.toLowerCase().includes(kw));
          text = hits.length ? hits.join("\n\n") : raw;
        }
        return { ok: true, exit: 0, text };
      } catch (e) {
        return { ok: false, exit: 1, text: "技法库读取失败:" + String(e.message || e) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_scene",
    description: "产出 showcase 级单场景(钱包/落地页/仪表盘/品牌/字阶/图表/电商/邮件/编辑排版/图案)——设备框+证据徽章的精致起点,比从零写页面的质量地板高得多。内置 AI 默认紫守门。产出后替换内容并跑 aesthete_evidence 验收。",
    parameters: {
      kind: { type: "string", description: "wallet/landing/dashboard/branding/typography/chart/ecom/email/editorial/pattern" },
      theme: { type: "string", description: "主题包 name_en/name,如 Deep Pine;不给则用 palette" },
      palette: { type: "string", description: "逗号分隔 hex(无主题时)" },
      dark: { type: "boolean", description: "暗色场景" },
      out: { type: "string", description: "输出路径,默认 scene-<kind>.html" },
    },
    output: scoreOutput,
    timeoutMs: 200000,
    presentCall: (a) => ({
      card: "generic", title: "生成 showcase 场景", kind: "write",
      locations: [{ path: asString(a?.out, "scene-" + asString(a?.kind, "page") + ".html") }],
    }),
    execute: async (a, exec) => {
      const args = ["scene", "--kind", asString(a?.kind)];
      if (a?.theme) args.push("--theme", asString(a.theme));
      if (a?.palette) args.push("--palette", asString(a.palette));
      if (a?.dark) args.push("--dark");
      args.push("--out", a?.out ? asString(a.out)
        : path.join(sessionCwd(exec), "scene-" + asString(a?.kind, "page") + ".html"));
      return runEngine(args, undefined, exec?.signal, "scene");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_scaffold",
    description: "一键产出四幕明暗旅程整页骨架(夜松 hero/晨坊/夜话/夜约):颗粒质感、巨字对微字、不对称网格、滚动揭示、对比度自动调墨,产出即可过闸。工作流:先 scaffold 出骨架,再替换标有『替换』的内容,最后 aesthete_evidence 验收。",
    parameters: {
      theme: { type: "string", description: "主题包 name_en/name,如 Deep Pine;不给则用 palette" },
      palette: { type: "string", description: "逗号分隔 hex(无主题时)" },
      brand: { type: "string", description: "品牌名" },
      out: { type: "string", description: "输出路径,默认 <brand>-page.html" },
    },
    output: scoreOutput,
    timeoutMs: 200000,
    presentCall: (a) => ({
      card: "generic", title: "生成表现力页面骨架", kind: "write",
      locations: [{ path: asString(a?.out, (asString(a?.brand) || "scaffold").toLowerCase() + "-page.html") }],
    }),
    execute: async (a, exec) => {
      const args = ["scaffold"];
      if (a?.theme) args.push("--theme", asString(a.theme));
      if (a?.palette) args.push("--palette", asString(a.palette));
      if (a?.brand) args.push("--brand", asString(a.brand));
      if (a?.out) args.push("--out", a.out);
      else args.push("--out", path.join(sessionCwd(exec), (asString(a?.brand, "scaffold").toLowerCase()) + "-page.html"));
      return runEngine(args, undefined, exec?.signal, "scaffold");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_evidence",
    description: "对已完成页面出证据卷宗:四道机械检查+静态审计(渐变禁令/字号下限/剂量)合成一份 PASS/FAIL 验收记录(工作目录下 <page>.evidence.json/.html)。任一闸不过即 FAIL。",
    parameters: {
      page: { type: "string", required: true, description: "页面 HTML 路径(相对当前工作目录)" },
      palette: PALETTE_ARG,
    },
    output: nativeOutput,
    timeoutMs: 200000,
    presentCall: (a) => ({
      card: "generic", title: "页面证据卷宗", kind: "write",
      locations: [{ path: asString(a?.page) }],
    }),
    execute: async (a, exec) => {
      const r = await runEngine(
        ["evidence", asString(a?.page), "--palette", asString(a?.palette)],
        sessionCwd(exec), exec?.signal, "evidence");
      return r;
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_visualize",
    description: "把色板套进 10 类真实 UI 场景(手机/落地页/仪表盘/品牌/字阶/图表等)渲染成工作目录下 visualizer.html 自审,角色派生含对比度闸。",
    parameters: {
      palette: { ...PALETTE_ARG, description: "逗号分隔 hex(至少 3 色)" },
      theme: { type: "string", description: "light 或 dark,默认 light" },
    },
    output: nativeOutput,
    timeoutMs: 200000,
    presentCall: (a) => ({
      card: "generic", title: "十场景渲染", kind: "write",
      locations: [{ path: "visualizer.html" }],
    }),
    execute: async (a, exec) => {
      const args = ["visualize", "--palette", asString(a?.palette),
                    "--out", path.join(sessionCwd(exec), "visualizer.html")];
      if (a?.theme) args.push("--theme", asString(a.theme));
      return runEngine(args, undefined, exec?.signal, "visualize");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_tokens",
    description: "一条命令出全套语义设计令牌(CSS 变量 + JSON):墨色按对比度自动调墨,强调色拆图形/文字双档(--accent-ink 给文字达标值),间距/圆角/动效一并发出,注释即实测比值。产出 tokens.css/tokens.json 到工作目录,页面直接引用。",
    parameters: {
      palette: { type: "string", description: "逗号分隔 hex;与 theme 二选一" },
      theme: { type: "string", description: "主题包 name_en/name,如 Deep Pine" },
      name: { type: "string", description: "令牌表名(写入注释头)" },
      dark: { type: "boolean", description: "深色为主(令牌明暗互换)" },
      out: { type: "string", description: "输出前缀,默认 tokens" },
    },
    output: nativeOutput,
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "生成设计令牌表", kind: "write",
      locations: [{ path: asString(a?.out, "tokens") + ".css" }],
    }),
    execute: async (a, exec) => {
      if (!a?.palette && !a?.theme) {
        return { ok: false, exit: 2, text: "palette 或 theme 必给其一。" };
      }
      const args = a?.palette ? ["tokens", "--palette", asString(a.palette)]
                              : ["tokens", "--theme", asString(a.theme)];
      if (a?.name) args.push("--name", asString(a.name));
      if (a?.dark) args.push("--dark");
      args.push("--out", a?.out ? asString(a.out)
        : path.join(sessionCwd(exec), "tokens"));
      return runEngine(args, undefined, exec?.signal, "tokens");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_audit",
    description: "对已有页面(不是本引擎产的)做机械体检:色板漂移(给最近板色替换)/禁渐变/紫域大底/文字对比对(给调墨后达标替换值)/字号下限/玻璃拟态/emoji/默认字体/圆角膨胀。P0 或 P1≥2 即 FAIL;每个发现都带可执行的修复值。",
    parameters: {
      page: { type: "string", required: true, description: "页面 HTML 路径(相对当前工作目录)" },
      palette: { type: "string", description: "声明色板(给出即查漂移)" },
      floor: { type: "number", description: "字号下限 px,默认 12" },
      out: { type: "string", description: "JSON 输出前缀" },
    },
    output: nativeOutput,
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "外部页面机械审计", kind: "read",
      locations: [{ path: asString(a?.page) }],
    }),
    execute: async (a, exec) => {
      const pageArg = path.isAbsolute(asString(a?.page))
        ? asString(a.page) : path.join(sessionCwd(exec), asString(a.page));
      const args = ["audit", pageArg];
      if (a?.palette) args.push("--palette", asString(a.palette));
      if (a?.floor) args.push("--floor", asString(a.floor));
      if (a?.out) args.push("--out", path.join(sessionCwd(exec), asString(a.out)));
      return runEngine(args, undefined, exec?.signal, "audit");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_chartpal",
    description: "图表用色三型派生:categorical(三种色盲模拟下两两区分度贪心择优)/sequential(单色相单调明度坡)/diverging(双端色相+近中性中点)。产出标注色样 HTML+JSON;有序数据用坡不用分类色,超 6 系列先分组。",
    parameters: {
      kind: { type: "string", required: true, description: "categorical/sequential/diverging" },
      palette: { type: "string", description: "候选色逗号分隔(分类≥2;发散=两端色);与 theme 二选一" },
      theme: { type: "string", description: "主题包 name_en/name" },
      series: { type: "number", description: "系列数 2-12,默认 6" },
      out: { type: "string", description: "输出前缀,默认 chartpal" },
    },
    output: nativeOutput,
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "图表色板派生:" + asString(a?.kind), kind: "write",
      locations: [{ path: asString(a?.out, "chartpal") + ".html" }],
    }),
    execute: async (a, exec) => {
      if (!a?.palette && !a?.theme) {
        return { ok: false, exit: 2, text: "palette 或 theme 必给其一。" };
      }
      const args = ["chartpal", "--kind", asString(a.kind)];
      if (a?.palette) args.push("--palette", asString(a.palette));
      if (a?.theme) args.push("--theme", asString(a.theme));
      if (a?.series) args.push("--series", asString(a.series));
      args.push("--out", a?.out ? asString(a.out)
        : path.join(sessionCwd(exec), "chartpal"));
      return runEngine(args, undefined, exec?.signal, "chartpal");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_typescale",
    description: "CJK 友好模块字阶:7 级等比(12px 硬下限,低于即钳制留痕),行高配对(展示 1.15/标题 1.3/正文 1.7/辅助 1.5),tabular-nums 数据令牌。产出 tokens CSS + 中英混排样张 + JSON。",
    parameters: {
      base: { type: "number", description: "正文字号 px,默认 16" },
      ratio: { type: "number", description: "等比 1.125-1.5,默认 1.25" },
      name: { type: "string", description: "字阶名(写入标题)" },
      out: { type: "string", description: "输出前缀,默认 typescale" },
    },
    output: nativeOutput,
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "生成模块字阶", kind: "write",
      locations: [{ path: asString(a?.out, "typescale") + ".css" }],
    }),
    execute: async (a, exec) => {
      const args = ["typescale", "--base", asString(a?.base, 16), "--ratio", asString(a?.ratio, 1.25)];
      if (a?.name) args.push("--name", asString(a.name));
      args.push("--out", a?.out ? asString(a.out)
        : path.join(sessionCwd(exec), "typescale"));
      return runEngine(args, undefined, exec?.signal, "typescale");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_qc",
    description: "渲染对账:把页面截图(PNG)对声明令牌/色板机械核对——大底是否真被渲染(P0)、板外色入侵(带面积份额)。宿主有浏览器工具时,交付前必跑:渲染→qc→修→重跑;声明≠实况直到被证明。",
    parameters: {
      image: { type: "string", required: true, description: "渲染截图 PNG 路径" },
      tokens: { type: "string", description: "tokens.json 路径(令牌对账,优先)" },
      palette: { type: "string", description: "声明色板逗号分隔(无 tokens 时)" },
      bg: { type: "string", description: "声明大底 hex(色板模式建议显式给)" },
      out: { type: "string", description: "JSON 输出路径" },
    },
    output: nativeOutput,
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "渲染对账", kind: "read",
      locations: [{ path: asString(a?.image) }],
    }),
    execute: async (a, exec) => {
      if (!a?.tokens && !a?.palette) {
        return { ok: false, exit: 2, text: "tokens 或 palette 必给其一。" };
      }
      const imgArg = path.isAbsolute(asString(a?.image))
        ? asString(a.image) : path.join(sessionCwd(exec), asString(a.image));
      const args = ["qc", imgArg];
      if (a?.tokens) args.push("--tokens", path.isAbsolute(asString(a.tokens))
        ? asString(a.tokens) : path.join(sessionCwd(exec), asString(a.tokens)));
      else args.push("--palette", asString(a.palette));
      if (a?.bg) args.push("--bg", asString(a.bg));
      if (a?.out) args.push("--out", path.join(sessionCwd(exec), asString(a.out)));
      return runEngine(args, undefined, exec?.signal, "qc");
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_narrate",
    description: "量化叙事:把 report 实测闸门(最优对比对/色盲模拟/slop 扫描/评分/指纹)转成双语纯数字说明文,可直接转发给客户或上级。每个数字都可溯源到 report,模板句式零形容词发挥。",
    parameters: {
      palette: { type: "string", description: "逗号分隔 hex;与 theme 二选一" },
      theme: { type: "string", description: "主题包 name_en/name" },
      name: { type: "string", description: "板名(写入标题)" },
      out: { type: "string", description: "输出 md 路径" },
    },
    output: nativeOutput,
    timeoutMs: 200000,
    presentCall: (a) => ({ card: "generic", title: "生成量化叙事", kind: "write" }),
    execute: async (a, exec) => {
      if (!a?.palette && !a?.theme) {
        return { ok: false, exit: 2, text: "palette 或 theme 必给其一。" };
      }
      const args = a?.palette ? ["narrate", "--palette", asString(a.palette)]
                              : ["narrate", "--theme", asString(a.theme)];
      if (a?.name) args.push("--name", asString(a.name));
      args.push("--out", a?.out ? asString(a.out)
        : path.join(sessionCwd(exec), (asString(a?.name, "palette").replace(/\s+/g, "-")) + ".narration.md"));
      return runEngine(args, undefined, exec?.signal, "narrate");
    },
  }));

  // ---- 捆绑 Skill(静态注册:读 SKILL.md,官方 SkillRegistration 形状) ----
  ctx.inject(["skills"], (c) => {
    if (!c.skills || typeof c.skills.register !== "function") return;
    try {
      const raw = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
      const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
      const fm = m ? m[1] : "";
      const body = m ? m[2] : raw;
      const pick = (key) => {
        const line = fm.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(key + ":"));
        return line ? line.slice(key.length + 1).trim() : "";
      };
      c.skills.register({
        name: "aesthete-agent",
        description: pick("description") || "前端美学引擎:机械验证的配色方案与检查。",
        content: body.trim(),
        metadata: { version: pick("version") || "0.7.0" },
        source: "bundled",
      });
    } catch (e) {
      // Skill 注册失败不拖垮工具:引擎工具仍可用
      console.warn("[dsh-aesthete-agent] skill 注册失败:", String(e));
    }
  });

  // ---- 设计宪法注入(0.9.0 起,0.12.0=v4):systemPrompt 通道,让宿主模型带着方法论产出,而不是只拿数字 ----
  const DESIGN_CONSTITUTION = [
    "你正在使用 aesthete-agent 前端美学引擎产出网页/界面。设计宪法(每次产出必须遵守):",
    "1. 明暗旅程:全页至少一次暗/亮幕转换;近黑深色可做 hero/引文/收尾幕。暗幕文字三件套:主字=最浅底色,次字=雾灰 #9FB3BC 级,链接=板内浅强调;深强调色在暗幕禁做字(CTA 反转为浅底深字)。",
    "2. 字比戏剧:展示标题与正文 ≥6 倍字号差(clamp 上探 120px+);巨字旁配 11-12px 加宽字距微标签。",
    "3. 质感:暗幕叠 5-7% 颗粒噪点(SVG feTurbulence data-URI,opacity .07);渐变禁令 P0;质感=噪点+平色分层+出血图形。",
    "4. 签名唯一:每页一个被记住的视觉母题(取主题 signature 字段),可重复但主次分明。",
    "5. 滚动揭示:IntersectionObserver 加 .in 类,translateY(30px)→0 渐入,子元素错峰;prefers-reduced-motion 全关;无 JS 时内容必须可见。",
    "6. 60-30-10:主色约 60%、辅 30%、强调 ≤10%;数字成对出现;一屏一主角。",
    "7. 交付前:跑 aesthete_report 或 check-image,PASS 才交付;FAIL 也是合法结果,按发现修复后重跑。",
    "8. 渲染对账:宿主有浏览器工具时,交付前整页截图跑 aesthete_qc(对 tokens.json 或色板)——大底漂移与板外入侵在此现形;静态检查看不见渲染,声明≠实况直到被证明。",
    "0. 工作流(惊艳版):①调 aesthete_recipes 取表现力技法库 → ②按主题 voice 挑 3-5 条技法自由构图",
    "(要惊艳就组合,不要只套骨架)→ ③产出后 aesthete_report/evidence 验收(有浏览器工具加 aesthete_qc 截图对账),FAIL 修复重跑。",
    "aesthete_scaffold 只是快速起点;惊艳来自技法组合。",
    "9. 内容优先(最高纪律):无图页面的视觉主角=排印与真实内容本身;色彩只承载意义(分类芯片/KPI 阶梯/页顶色条/价格 tabular);抽象色块装饰=滥用,删。真实内容密度:菜单卡/KPI 卡/引文带都是内容组件,不是装饰位。",
    "10. 明暗策略由色板气质决定:浅优色板(浅色≥2/5)浅底优先+深色只做小面积点缀;深色即品牌色的板才走暗幕;大面积中明度色(脏黄/土色)禁作背景(显脏)。",
    "11. 字体宁细勿假粗:页面无 @font-face 真字重时禁用 font-weight 800/900(合成加粗发糊)——钳到 700;要真 Black 走 aesthete_scaffold --fonts preset/auto 的子集管线;中文禁负字距。",
    "12. 渲染诚实:宿主有浏览器工具→交付前截图跑 aesthete_qc + 五镜目审(闸门绿≠完成);无截图工具→交付说明如实写'静态闸已过,渲染未验证',不得谎称已验。",
    "完整法则见捆绑技能 references/expressive-design.md 与 references/typography-aesthetics.md、references/layout-composition.md;主题 voice/signature 见 palettes/themes.json 对应主题包。",
  ].join("\n");
  ctx.inject(["systemPrompt"], (c) => {
    if (!c.systemPrompt || typeof c.systemPrompt.section !== "function") return;
    c.effect(() => {
      const dispose = c.systemPrompt.section({
        name: "dsh-aesthete-agent",
        order: 70,
        interpolate: false,
        text: DESIGN_CONSTITUTION,
      });
      return () => { if (typeof dispose === "function") dispose(); };
    });
  });

  // ---- 斜杠命令(防御式:commands 通道可能缺席) ----
  ctx.inject(["commands", "tools"], (c) => {
    if (!c.commands || typeof c.commands.register !== "function") return;
    c.effect(() => {
      const disposers = [];
      disposers.push(c.commands.register({
        name: "aesthete-status",
        description: "查看 aesthete-agent 插件状态:引擎/Python 可用性、捆绑版本。",
        input: { hint: "" },
        handler: async () => {
          try {
            const r = await runEngine(["selftest"]);
            return {
              kind: "success",
              text: ["aesthete-agent 0.12.0(引擎自检 " + (r.ok ? "PASS" : "FAIL") + ")",
                     "引擎路径:" + ENGINE,
                     "使用台账:" + ledgerSummary()].join("\n"),
            };
          } catch (e) {
            return { kind: "error", text: String(e.message || e) };
          }
        },
      }));
      disposers.push(c.commands.register({
        name: "aesthete-report",
        description: "对一组 hex 跑四道机械检查。用法:/aesthete-report 555B6E,89B0AE,BEE3DB,FAF9F9,FFD6BA",
        input: { hint: "<hex,hex,...>" },
        handler: async (invocation) => {
          const pal = asString(invocation?.rawInput).trim();
          if (!pal) return { kind: "error", text: "用法:/aesthete-report <hex,hex,...>" };
          const r = await runEngine(["report", "--palette", pal]);
          return { kind: "success", text: r.text };
        },
      }));
      disposers.push(c.commands.register({
        name: "aesthete-directions",
        description: "跨语域方向对比:按需求一次出多套整页方向。用法:/aesthete-directions 素雅耐看的落地页",
        input: { hint: "<需求描述>" },
        handler: async (invocation) => {
          const brief = asString(invocation?.rawInput).trim();
          if (!brief) return { kind: "error", text: "用法:/aesthete-directions <需求描述>" };
          const r = await runEngine(["directions", "--brief", brief,
                                     "--out-dir", invocation?.agent?.session?.header?.cwd || process.cwd()],
                                    undefined, undefined, "directions");
          return { kind: "success", text: r.text };
        },
      }));
      disposers.push(c.commands.register({
        name: "aesthete-score",
        description: "五维评分卡(/20)。用法:/aesthete-score 555B6E,89B0AE,BEE3DB,FAF9F9,FFD6BA",
        input: { hint: "<hex,hex,...>" },
        handler: async (invocation) => {
          const pal = asString(invocation?.rawInput).trim();
          if (!pal) return { kind: "error", text: "用法:/aesthete-score <hex,hex,...>" };
          const r = await runEngine(["score", "--palette", pal], undefined, undefined, "score");
          return { kind: "success", text: r.text };
        },
      }));
      disposers.push(c.commands.register({
        name: "aesthete-match",
        description: "按需求语域选板。用法:/aesthete-match 素雅耐看的落地页",
        input: { hint: "<需求描述>" },
        handler: async (invocation) => {
          const brief = asString(invocation?.rawInput).trim();
          if (!brief) return { kind: "error", text: "用法:/aesthete-match <需求描述>" };
          const r = await runEngine(["match", "--brief", brief]);
          return { kind: "success", text: r.text };
        },
      }));
      disposers.push(c.commands.register({
        name: "aesthete-tokens",
        description: "一条命令出全套语义设计令牌(CSS 变量)。用法:/aesthete-tokens 555B6E,89B0AE,BEE3DB,FAF9F9,FFD6BA",
        input: { hint: "<hex,hex,...>" },
        handler: async (invocation) => {
          const pal = asString(invocation?.rawInput).trim();
          if (!pal) return { kind: "error", text: "用法:/aesthete-tokens <hex,hex,...>" };
          const cwd = invocation?.agent?.session?.header?.cwd || process.cwd();
          const r = await runEngine(["tokens", "--palette", pal, "--out", path.join(cwd, "tokens")],
                                    undefined, undefined, "tokens");
          return { kind: "success", text: r.text };
        },
      }));
      disposers.push(c.commands.register({
        name: "aesthete-audit",
        description: "对已有页面做机械体检(漂移/渐变/对比/字号带修复值)。用法:/aesthete-audit page.html",
        input: { hint: "<页面.html>" },
        handler: async (invocation) => {
          const page = asString(invocation?.rawInput).trim();
          if (!page) return { kind: "error", text: "用法:/aesthete-audit <页面.html>" };
          const cwd = invocation?.agent?.session?.header?.cwd || process.cwd();
          const r = await runEngine(["audit", path.isAbsolute(page) ? page : path.join(cwd, page)],
                                    undefined, undefined, "audit");
          return { kind: "success", text: r.text };
        },
      }));
      return () => { for (const d of disposers) { try { d(); } catch {} } };
    });
  });
}
