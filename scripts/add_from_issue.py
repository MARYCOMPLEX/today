#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""add-event.yml 的后端：解析 issue 正文里的 JSON 事件 -> 校验 -> 追加 events.json -> 提交 -> 关 issue"""
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "events.json"
REPO = os.environ.get("GITHUB_REPOSITORY", "")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
ISSUE_NUMBER = os.environ.get("ISSUE_NUMBER", "")
BODY = os.environ.get("ISSUE_BODY", "")


def gh(method, path, payload=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}{path}",
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "family-calendar"})
    data = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print("GH API 错误:", e.code, e.read().decode()[:500])
        return None


def extract_event(body):
    """issue 正文：```json ... ``` 或首行 JSON"""
    if "```" in body:
        body = body.split("```")[1]
    return json.loads(body.strip())


def main():
    if not (REPO and TOKEN and ISSUE_NUMBER):
        sys.exit("缺少环境变量 GITHUB_REPOSITORY/GITHUB_TOKEN/ISSUE_NUMBER")
    try:
        ev = extract_event(BODY)
    except Exception as e:
        gh("POST", f"/issues/{ISSUE_NUMBER}/comments",
           {"body": f"❌ 无法解析 JSON：{e}\n\n请按 site 表单的格式提交。"})
        sys.exit(1)

    # 校验（复用 validate 的逻辑：跑一遍子进程太重，直接做最小校验）
    eid = ev.get("id", "")
    if not eid or ev.get("month") not in range(1, 13) or ev.get("day") not in range(1, 31):
        gh("POST", f"/issues/{ISSUE_NUMBER}/comments",
           {"body": "❌ 校验失败：id 必填，month 1-12，day 1-30"})
        sys.exit(1)

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data["events"] = [e for e in data["events"] if e.get("id") != eid]  # 同 id 覆盖更新
    data["events"].append(ev)
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 提交
    content = base64.b64encode(DATA_FILE.read_bytes()).decode()
    current = gh("GET", f"/contents/data/events.json")
    if current:
        gh("PUT", f"/contents/data/events.json", {
            "message": f"add event {eid} from issue #{ISSUE_NUMBER}",
            "content": content,
            "sha": current.get("sha"),
        })
    gh("POST", f"/issues/{ISSUE_NUMBER}/comments",
       {"body": f"✅ 已添加事件 `{eid}`，Pages 将自动重建。同 id 会覆盖更新。"})
    gh("PATCH", f"/issues/{ISSUE_NUMBER}", {"state": "closed"})
    print("done:", eid)


if __name__ == "__main__":
    main()
