#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 data/events.json：结构、范围、重复 id、remind_days 合法性"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "events.json"


def main():
    cfg = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    events = cfg.get("events", [])
    errors = []
    ids = set()

    if not isinstance(events, list):
        errors.append("events 必须是数组")
        events = []

    for i, ev in enumerate(events):
        tag = f"events[{i}]"
        if not isinstance(ev, dict):
            errors.append(f"{tag} 必须是对象")
            continue
        eid = ev.get("id", "")
        if not eid:
            errors.append(f"{tag} 缺少 id")
        elif eid in ids:
            errors.append(f"{tag} id 重复: {eid}")
        ids.add(eid)

        cal = ev.get("calendar", "lunar")
        if cal not in ("lunar", "solar"):
            errors.append(f"{tag}({eid}) calendar 必须是 lunar/solar")

        m, d = ev.get("month", 0), ev.get("day", 0)
        if not (1 <= m <= 12):
            errors.append(f"{tag}({eid}) month 必须在 1-12")
        if not (1 <= d <= 30):
            errors.append(f"{tag}({eid}) day 必须在 1-30（农历最大 30）")

        lp = ev.get("leap_policy", "leap_first")
        if lp not in ("leap_first", "leap_both", "normal"):
            errors.append(f"{tag}({eid}) leap_policy 必须是 leap_first/leap_both/normal")

        rd = ev.get("remind_days", [0])
        if not isinstance(rd, list) or not all(isinstance(x, int) and 0 <= x <= 365 for x in rd):
            errors.append(f"{tag}({eid}) remind_days 必须是 0-365 的整数数组")

        by = ev.get("birth_year")
        if by is not None and not isinstance(by, int):
            errors.append(f"{tag}({eid}) birth_year 必须是整数")

        tg = ev.get("targets")
        if tg is not None and not isinstance(tg, list):
            errors.append(f"{tag}({eid}) targets 必须是数组")

    if errors:
        print("校验失败:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print(f"校验通过: {len(events)} 个事件")


if __name__ == "__main__":
    main()
