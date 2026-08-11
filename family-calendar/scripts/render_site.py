#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 Pages 静态站：事件清单 + 今年/明年日期 + 添加入口（issue 预填）"""
import json
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

from notify import (ROOT, lunar_str, next_occurrence, today_cn)  # noqa

TEMPLATE = ROOT / "site" / "template.html"
OUT_DIR = ROOT / "site_out"


def main():
    cfg = json.loads((ROOT / "data" / "events.json").read_text(encoding="utf-8"))
    today = today_cn()
    rows = []
    for ev in cfg.get("events", []):
        occ = next_occurrence(today, ev)
        if not occ:
            continue
        diff = (occ - today).days
        rows.append({
            "name": ev.get("name", ""),
            "person": ev.get("person", ""),
            "calendar": "农历" if ev.get("calendar") != "solar" else "阳历",
            "when": f"{ev['month']}月{ev['day']}日",
            "occurrence": occ.isoformat(),
            "lunar": lunar_str(occ),
            "diff": diff,
            "note": "今天" if diff == 0 else f"{diff} 天后",
        })
    rows.sort(key=lambda r: r["diff"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "data.json").write_text(
        json.dumps({"generated": today.isoformat(), "rows": rows},
                   ensure_ascii=False, indent=2), encoding="utf-8")

    html = TEMPLATE.read_text(encoding="utf-8")
    rows_html = "".join(
        f"<tr><td>{r['name']}</td><td>{r['person']}</td><td>{r['calendar']}</td>"
        f"<td>{r['when']}</td><td>{r['occurrence']}（{r['lunar']}）</td>"
        f"<td>{r['note']}</td></tr>" for r in rows)
    html = html.replace("<!--ROWS-->", rows_html).replace("{{GENERATED}}", today.isoformat())
    (OUT_DIR / "index.html").write_text(html, encoding="utf-8")
    print(f"已生成 {len(rows)} 条事件 -> site_out/ (index.html + data.json)")


if __name__ == "__main__":
    main()
