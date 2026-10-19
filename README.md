# dsh-aesthete-agent

aesthete-agent(前端美学引擎)的 DeepSeek Harness 原生插件。

把配色决策从"凭感觉"变成"凭检查":118 块实证色板按语域选板,四道机械检查——对比度、色盲模拟、AI 味检测、五维评分——检查不过不交付。全部本地运行,零联网,零 API 密钥(引擎为纯 Python 标准库,需要本机装有 Python 3.8+)。

## 安装

```bash
dsh plugin --profile web add github:docsor1212/dsh-aesthete-agent
```

无头模式把 `--profile web` 换成 `--profile headless`。

## 原生工具(17 个)

| 工具 | 作用 |
|---|---|
| `aesthete_match` | 按需求自然语言在实证库选板,自动识别语域(素雅/大气/鲜艳/科技感/国风水墨…) |
| `aesthete_directions` | 跨语域方向对比:整页渲染并排,差异铁律,选择回传句 |
| `aesthete_report` | 四道机械检查一键验收,PASS/FAIL 即裁决 |
| `aesthete_matrix` | 全对对比度矩阵+最佳文字/底色配对 |
| `aesthete_blind` | 红绿蓝三型色盲模拟与碰撞风险 |
| `aesthete_score` | 五维评分卡(/20)与修复建议 |
| `aesthete_evidence` | 页面证据卷宗:四闸+静态审计合成验收记录 |
| `aesthete_visualize` | 色板套进 10 类真实 UI 场景渲染自审 |
| `aesthete_recipes` | 表现力技法库:14 条可组合惊艳配方,整页设计前必取 |
| `aesthete_scene` | showcase 级单场景(设备框+证据徽章),紫域守门内置 |
| `aesthete_scaffold` | 四幕明暗旅程整页骨架,对比度自动调墨 |
| `aesthete_tokens` | 全套语义设计令牌(CSS+JSON):墨色自动调墨,强调拆图形/文字双档 |
| `aesthete_audit` | 已有页面机械体检:漂移/渐变/对比对带可执行修复值 |
| `aesthete_chartpal` | 图表用色三型派生:分类/顺序/发散,色盲区分度验证 |
| `aesthete_typescale` | CJK 友好模块字阶:12px 下限,行高配对,tabular-nums |
| `aesthete_qc` | 渲染对账:截图对声明令牌核对大底真伪与板外入侵 |
| `aesthete_narrate` | 量化叙事:实测数字转双语说明,每个数字可溯源 |

自然语言即可触发,无需记命令:"给这个页面配色打个分""要素雅耐看的,出三个方向对比""用 Deep Pine 出一页,再对截图跑渲染对账"。

## 工作流建议

1. **选板**:用 `aesthete_match` 说需求,或 `aesthete_directions` 出跨语域方向对比页,用户点名后按回传句继续;
2. **构图**:`aesthete_recipes` 取技法,挑 3-5 条自由组合;快速起点用 `aesthete_scaffold`/`aesthete_scene`,令牌接线用 `aesthete_tokens`;
3. **验收**:交付前 `aesthete_report`/`aesthete_evidence`,宿主有浏览器工具时对截图跑 `aesthete_qc` 渲染对账,PASS 才交付;
4. **转述**:需要向客户解释"为什么这样配"时,`aesthete_narrate` 出双语纯数字说明。

## 斜杠命令(7 条)

/aesthete-status(自检+台账) · /aesthete-report · /aesthete-match · /aesthete-score · /aesthete-directions · /aesthete-tokens · /aesthete-audit

## 上游

- 引擎与技能本体:[docsor1212/aesthete-agent](https://github.com/docsor1212/aesthete-agent)(MIT)
- 在线演示:https://docsor.cn/aesthete/

## 安全声明(供安装前审查)

- **零联网**:引擎为纯 Python 标准库,安装后与运行全程不发起任何网络请求;
- **子进程**:仅调用本机 `python3`/`python` 执行随插件捆绑的引擎脚本,无其他可执行文件;
- **无安装期脚本**:package.json 不含任何 lifecycle scripts(preinstall/postinstall 等);
- **不读凭据**:不触碰 shell 历史、密钥、浏览器数据;
- **写盘范围**:仅当前工作目录(tokens.css / chartpal.html / *.narration.md / *.evidence.json 等)。

## License

MIT
