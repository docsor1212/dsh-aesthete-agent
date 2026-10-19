// dsh-aesthete-agent — DeepSeek Harness 原生插件
// 把 aesthete-agent(前端美学引擎)的核心命令注册为原生工具。
// 引擎 = 随插件捆绑的 skills/aesthete-agent(纯 Python 标准库,本地运行,零联网)。
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
      if (e.code !== "ENOENT" && !/ENOENT|not found/i.test(String(e.message))) {
        _python = py; // 二进制存在但其他报错,仍可用
        return py;
      }
    }
  }
  throw new Error("未找到 Python——aesthete-agent 引擎需要 Python 3.8+,请安装并加入 PATH。");
}

// 引擎退出码=裁决(report FAIL=1 等):非零退出是"结果",不是工具错误。
async function runEngine(args, cwd) {
  const py = await resolvePython();
  try {
    const { stdout, stderr } = await execFileP(py, [ENGINE, ...args], {
      cwd: cwd || process.cwd(), timeout: 180000, maxBuffer: 8e6,
    });
    return { ok: true, exit: 0, text: (stdout + (stderr ? "\n" + stderr : "")).trim() };
  } catch (e) {
    if (e.code === "ENOENT" || /ENOENT/i.test(String(e.message))) {
      return { ok: false, exit: -1, text: "Python 未找到:" + String(e.message) };
    }
    const text = ((e.stdout || "") + (e.stderr ? "\n" + e.stderr : "")).trim() || String(e.message);
    return { ok: false, exit: typeof e.code === "number" ? e.code : 1, text };
  }
}

function sessionCwd(exec) {
  try {
    return exec?.agent?.session?.header?.cwd || exec?.scope?.session?.header?.cwd || process.cwd();
  } catch {
    return process.cwd();
  }
}

const asString = (v, dflt = "") => (typeof v === "string" ? v : v == null ? dflt : String(v));

export const name = "dsh-aesthete-agent";

export function apply(ctx) {
  ctx.inject(["tools"], (c) => {
    // 1) 语域选库
    c.tools.register(defineTool({
      name: "aesthete_match",
      description: "按需求自然语言在 118 块实证色板库中排序选板:自动识别语域(素雅/大气/鲜艳/科技感/医学教学等),偏好档案机械加权。返回带风格标签与 hex 的候选列表,取 ≥2 候选对比后再定。",
      parameters: {
        brief: { type: "string", description: "需求自然语言,如:素雅耐看的落地页 / 儿科教学页" },
        limit: { type: "number", description: "返回候选数,默认 6" },
      },
      presentCall: (a) => ({ card: "generic", title: "配色选库:" + asString(a?.brief, ""), kind: "read" }),
      execute: async (a) => {
        const args = ["match", "--brief", asString(a?.brief)];
        if (a?.limit) args.push("--limit", asString(a.limit));
        const r = await runEngine(args);
        return { ok: r.ok, text: r.text };
      },
    }));

    // 2) 跨语域方向对比
    c.tools.register(defineTool({
      name: "aesthete_directions",
      description: "跨语域设计方向对比:从不同风格族(素雅/大气/鲜艳/科技感)各取头牌色板,整页渲染成并排对比页 directions.html。差异铁律保证方向真不同。每方向带「选择回传句」,用户点名后原样执行。",
      parameters: {
        brief: { type: "string", description: "设计需求,如:素雅耐看的落地页" },
        registers: { type: "string", description: "逗号分隔语域,显式指定(如 frontend_soft,frontend_deep);不给则从 brief 自动识别" },
        n: { type: "number", description: "方向数 2-4,默认 3" },
      },
      presentCall: (a) => ({ card: "generic", title: "生成方向对比页", kind: "write" }),
      execute: async (a, exec) => {
        const args = ["directions", "--out-dir", sessionCwd(exec)];
        if (a?.brief) args.push("--brief", asString(a.brief));
        if (a?.registers) args.push("--registers", asString(a.registers));
        if (a?.n) args.push("--n", asString(a.n));
        const r = await runEngine(args, sessionCwd(exec));
        return { ok: r.ok, text: r.text };
      },
    }));

    // 3) 四闸一键验收
    c.tools.register(defineTool({
      name: "aesthete_report",
      description: "四道机械检查一键验收:WCAG 对比度、色盲三模拟、AI 味配色检测、五维评分,聚合成单个 PASS/FAIL JSON。检查不过不交付。",
      parameters: { palette: { type: "string", description: "逗号分隔 hex,如 555B6E,89B0AE,BEE3DB,FAF9F9,FFD6BA" } },
      presentCall: (a) => ({ card: "generic", title: "四道检查验收", kind: "read" }),
      execute: async (a) => {
        const r = await runEngine(["report", "--palette", asString(a?.palette)]);
        return { ok: r.ok, exit: r.exit, text: r.text };
      },
    }));

    // 4) 全对对比矩阵
    c.tools.register(defineTool({
      name: "aesthete_matrix",
      description: "色板全对对比度矩阵(WCAG 比值)+最佳文字/底色配对推荐——哪个字配哪个底,给个准数。",
      parameters: { palette: { type: "string", description: "逗号分隔 hex" } },
      presentCall: (a) => ({ card: "generic", title: "对比度矩阵", kind: "read" }),
      execute: async (a) => {
        const r = await runEngine(["matrix", "--palette", asString(a?.palette), "--recommend"]);
        return { ok: r.ok, text: r.text };
      },
    }));

    // 5) 色盲三模拟
    c.tools.register(defineTool({
      name: "aesthete_blind",
      description: "红绿蓝三型色盲模拟,报告最小分离度与碰撞风险——配色对色盲朋友是否友好,给机械结论。",
      parameters: { palette: { type: "string", description: "逗号分隔 hex" } },
      presentCall: (a) => ({ card: "generic", title: "色盲模拟", kind: "read" }),
      execute: async (a) => {
        const r = await runEngine(["blind", "--palette", asString(a?.palette)]);
        return { ok: r.ok, text: r.text };
      },
    }));

    // 6) 五维评分
    c.tools.register(defineTool({
      name: "aesthete_score",
      description: "五维评分卡(/20):架构、可读性、色盲安全、饱和纪律、独特性,附 P0-P3 发现与修复建议。",
      parameters: { palette: { type: "string", description: "逗号分隔 hex" } },
      presentCall: (a) => ({ card: "generic", title: "五维评分", kind: "read" }),
      execute: async (a) => {
        const r = await runEngine(["score", "--palette", asString(a?.palette)]);
        return { ok: r.ok, exit: r.exit, text: r.text };
      },
    }));

    // 7) 页面证据卷宗
    c.tools.register(defineTool({
      name: "aesthete_evidence",
      description: "对已完成页面出证据卷宗:四道机械检查+静态审计(渐变禁令/字号下限/剂量)合成一份 PASS/FAIL 验收记录(.json+.html)。任一闸不过即 FAIL。",
      parameters: {
        page: { type: "string", description: "页面 HTML 路径(相对当前工作目录)" },
        palette: { type: "string", description: "页面声明的色板,逗号分隔 hex" },
      },
      presentCall: (a) => ({ card: "generic", title: "页面证据卷宗", kind: "write" }),
      execute: async (a, exec) => {
        const cwd = sessionCwd(exec);
        const r = await runEngine(["evidence", asString(a?.page), "--palette", asString(a?.palette)], cwd);
        return { ok: r.ok, exit: r.exit, text: r.text };
      },
    }));

    // 8) 十场景可视化
    c.tools.register(defineTool({
      name: "aesthete_visualize",
      description: "把色板套进 10 类真实 UI 场景(手机/落地页/仪表盘/品牌/字阶/图表等)渲染成 visualizer.html 自审,角色派生含对比度闸。",
      parameters: {
        palette: { type: "string", description: "逗号分隔 hex(至少 3 色)" },
        theme: { type: "string", description: "light 或 dark,默认 light" },
      },
      presentCall: (a) => ({ card: "generic", title: "十场景渲染", kind: "write" }),
      execute: async (a, exec) => {
        const args = ["visualize", "--palette", asString(a?.palette), "--out",
                      path.join(sessionCwd(exec), "visualizer.html")];
        if (a?.theme) args.push("--theme", asString(a.theme));
        const r = await runEngine(args);
        return { ok: r.ok, text: r.text };
      },
    }));
  });
}
