// dsh-aesthete-agent — DeepSeek Harness 原生插件(Cordis)
// 把 aesthete-agent(前端美学引擎)的核心命令注册为原生工具与捆绑 Skill。
// 引擎 = 随插件捆绑的 skills/aesthete-agent(纯 Python 标准库,本地运行,零联网)。
// 契约依据:官方 docs/cookbook/adding-a-tool + docs/cordis-tutorial + dsh-tools 0.2.1-rc.2 类型。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const execFileP = promisify(execFile);

const SKILL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "aesthete-agent");
const ENGINE = path.join(SKILL_DIR, "scripts", "palette_forge.py");

const PY_CANDIDATES = process.platform === "win32"
  ? ["python", "python3", "py"]
  : ["python3", "python"];

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
async function runEngine(args, cwd, signal) {
  const py = await resolvePython();
  try {
    const { stdout, stderr } = await execFileP(py, [ENGINE, ...args], {
      cwd: cwd || process.cwd(), timeout: 180000, maxBuffer: 8e6, signal,
    });
    return { ok: true, exit: 0, text: (stdout + (stderr ? "\n" + stderr : "")).trim() };
  } catch (e) {
    if (e.code === "ENOENT" || /ENOENT/i.test(String(e.message))) {
      return { ok: false, exit: -1, text: "Python 未找到:" + String(e.message) };
    }
    if (e.killed || /terminated|signal/i.test(String(e.message))) {
      return { ok: false, exit: -2, text: "引擎调用被取消(超时或 signal)。" };
    }
    const text = ((e.stdout || "") + (e.stderr ? "\n" + e.stderr : "")).trim() || String(e.message);
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
    timeoutMs: 60000,
    presentCall: (a) => ({ card: "generic", title: "配色选库:" + asString(a?.brief), kind: "read" }),
    execute: async (a) => {
      const args = ["match", "--brief", asString(a?.brief)];
      if (a?.limit) args.push("--limit", asString(a.limit));
      return runEngine(args);
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
    timeoutMs: 120000,
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
      const r = await runEngine(args, cwd, exec?.signal);
      return { ...r, files: ["directions.html"] };
    },
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_report",
    description: "四道机械检查一键验收:WCAG 对比度、色盲三模拟、AI 味配色检测、五维评分,聚合成单个 PASS/FAIL JSON。检查不过不交付——FAIL 也是合法结果,按发现修复后重跑。",
    parameters: { palette: PALETTE_ARG },
    output: nativeOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 120000,
    presentCall: (a) => ({ card: "generic", title: "四道检查验收", kind: "read" }),
    execute: async (a) => runEngine(["report", "--palette", asString(a?.palette)]),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_matrix",
    description: "色板全对对比度矩阵(WCAG 比值)+最佳文字/底色配对推荐——哪个字配哪个底,给个准数。",
    parameters: { palette: PALETTE_ARG },
    output: nativeOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 60000,
    presentCall: (a) => ({ card: "generic", title: "对比度矩阵", kind: "read" }),
    execute: async (a) => runEngine(["matrix", "--palette", asString(a?.palette), "--recommend"]),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_blind",
    description: "红绿蓝三型色盲模拟,报告最小分离度与碰撞风险——配色对色盲朋友是否友好,给机械结论。",
    parameters: { palette: PALETTE_ARG },
    output: nativeOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 60000,
    presentCall: (a) => ({ card: "generic", title: "色盲模拟", kind: "read" }),
    execute: async (a) => runEngine(["blind", "--palette", asString(a?.palette)]),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_score",
    description: "五维评分卡(/20):架构、可读性、色盲安全、饱和纪律、独特性,附 P0-P3 发现与修复建议。",
    parameters: { palette: PALETTE_ARG },
    output: nativeOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 60000,
    presentCall: (a) => ({ card: "generic", title: "五维评分", kind: "read" }),
    execute: async (a) => runEngine(["score", "--palette", asString(a?.palette)]),
  }));

  ctx.tools.register(defineTool({
    name: "aesthete_evidence",
    description: "对已完成页面出证据卷宗:四道机械检查+静态审计(渐变禁令/字号下限/剂量)合成一份 PASS/FAIL 验收记录(工作目录下 <page>.evidence.json/.html)。任一闸不过即 FAIL。",
    parameters: {
      page: { type: "string", required: true, description: "页面 HTML 路径(相对当前工作目录)" },
      palette: PALETTE_ARG,
    },
    output: nativeOutput,
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "页面证据卷宗", kind: "write",
      locations: [{ path: asString(a?.page) }],
    }),
    execute: async (a, exec) => {
      const r = await runEngine(
        ["evidence", asString(a?.page), "--palette", asString(a?.palette)],
        sessionCwd(exec), exec?.signal);
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
    timeoutMs: 120000,
    presentCall: (a) => ({
      card: "generic", title: "十场景渲染", kind: "write",
      locations: [{ path: "visualizer.html" }],
    }),
    execute: async (a, exec) => {
      const args = ["visualize", "--palette", asString(a?.palette),
                    "--out", path.join(sessionCwd(exec), "visualizer.html")];
      if (a?.theme) args.push("--theme", asString(a.theme));
      return runEngine(args, undefined, exec?.signal);
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
              text: ["aesthete-agent 0.7.0(引擎自检 " + (r.ok ? "PASS" : "FAIL") + ")",
                     "引擎路径:" + ENGINE].join("\n"),
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
      return () => { for (const d of disposers) { try { d(); } catch {} } };
    });
  });
}
