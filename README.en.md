# dsh-aesthete-agent

DeepSeek Harness native plugin for aesthete-agent — the mechanically validated frontend aesthetics engine.

Color decisions by checks, not vibes: a 118-palette evidence library matched by register, four mechanical gates (WCAG contrast, color-blind simulation, AI-slop detection, 5-dimension scorecard) — no delivery without a PASS. Fully local: pure-stdlib Python engine, no network, no API keys (Python 3.8+ required on the host).

## Install

```bash
dsh plugin --profile web add github:docsor1212/dsh-aesthete-agent
```

Use `--profile headless` for headless mode.

## Native tools (8)

`aesthete_match` (register-ranked library search) · `aesthete_directions` (cross-register whole-page candidates with pick-back sentences) · `aesthete_report` (4 gates, PASS/FAIL) · `aesthete_matrix` (contrast matrix + best pairs) · `aesthete_blind` (3 simulations) · `aesthete_score` (/20) · `aesthete_evidence` (page-level dossier) · `aesthete_visualize` (10 real-scene renders)

Natural language works — no commands to memorize: "score this page's palette", "give me three genuinely different directions for a calm landing page".

## Upstream

- Engine & skill: [docsor1212/aesthete-agent](https://github.com/docsor1212/aesthete-agent) (MIT)
- Live demo: https://docsor.cn/aesthete/

## License

MIT
