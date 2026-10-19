# dsh-aesthete-agent

aesthete-agent(前端美学引擎)的 DeepSeek Harness 原生插件。

把配色决策从"凭感觉"变成"凭检查":118 块实证色板按语域选板,四道机械检查——对比度、色盲模拟、AI 味检测、五维评分——检查不过不交付。全部本地运行,零联网,零 API 密钥(引擎为纯 Python 标准库,需要本机装有 Python 3.8+)。

## 安装

```bash
dsh plugin --profile web add github:docsor1212/dsh-aesthete-agent
```

无头模式把 `--profile web` 换成 `--profile headless`。

## 原生工具(8 个)

| 工具 | 作用 |
|---|---|
| `aesthete_match` | 按需求自然语言在实证库选板,自动识别语域(素雅/大气/鲜艳/科技感…) |
| `aesthete_directions` | 跨语域方向对比:整页渲染并排,差异铁律,选择回传句 |
| `aesthete_report` | 四道机械检查一键验收,PASS/FAIL 即裁决 |
| `aesthete_matrix` | 全对对比度矩阵+最佳文字/底色配对 |
| `aesthete_blind` | 红绿蓝三型色盲模拟与碰撞风险 |
| `aesthete_score` | 五维评分卡(/20)与修复建议 |
| `aesthete_evidence` | 页面证据卷宗:四闸+静态审计合成验收记录 |
| `aesthete_visualize` | 色板套进 10 类真实 UI 场景渲染自审 |

自然语言即可触发,无需记命令:"给这个页面配色打个分""要素雅耐看的,出三个方向对比"。

## 工作流建议

1. **选板**:用 `aesthete_match` 说需求,或直接 `aesthete_directions` 出跨语域方向对比页,用户点名后按回传句继续;
2. **落地**:按 60-30-10 出页面;
3. **验收**:交付前跑 `aesthete_evidence` 或 `aesthete_report`,PASS 才交付。

## 上游

- 引擎与技能本体:[docsor1212/aesthete-agent](https://github.com/docsor1212/aesthete-agent)(MIT)
- 在线演示:https://docsor.cn/aesthete/

## License

MIT
