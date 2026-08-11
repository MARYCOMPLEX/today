#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
家庭日历通知脚本
- 读取 data/events.json（唯一数据源）
- sxtwl 万年历引擎：农历↔公历换算（支持闰月、2/29、跨年）
- 按 notify_slots 的 remind 配置匹配事件
- 去重（.state/notified.json）：同一事件在同一时段内只推一次；三个时段各自推送（一天最多 3 条）
- ClawBot HTTP 推送：多 bot / 多 target 路由，失败进 outbox 下次补发
- 用法:
    python scripts/notify.py --run --slot 08:30            # 正式跑
    python scripts/notify.py --run --slot 08:30 --dry-run  # 只打印不发
    python scripts/notify.py --send-test --target filehelper
"""
import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from string import Template
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    requests = None

try:
    import sxtwl
except ImportError:
    sxtwl = None

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "events.json"
STATE_DIR = ROOT / ".state"
NOTIFIED_FILE = STATE_DIR / "notified.json"
OUTBOX_FILE = STATE_DIR / "outbox.json"
CN_TZ = ZoneInfo("Asia/Shanghai")

LUNAR_MONTH_NAMES = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"]


# ---------- 基础工具 ----------

def load_json(path, default):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[warn] 读取 {path} 失败: {e}")
    return default


def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def today_cn():
    return datetime.now(CN_TZ).date()


def auto_slot():
    """schedule 触发时按当前小时推断时段"""
    h = datetime.now(CN_TZ).hour
    if h < 6:
        return "00:05"
    if h < 15:
        return "08:30"
    return "20:30"


# ---------- 农历工具（sxtwl，覆盖约 -4713 ~ 9999 年）----------

def _solar_from_lunar(year, month, day, is_leap=False):
    """农历 -> 公历 date。日期不存在返回 None。兼容 sxtwl 2.x / 4.x。
    注意：sxtwl 2.x 对不存在的闰月会静默回退到正月，这里用 isLunarLeap() 验证真伪。"""
    if sxtwl is None:
        sys.exit("缺少依赖 sxtwl，请先: pip install -r requirements.txt")
    try:
        d = sxtwl.fromLunar(year, month, day, is_leap)
    except TypeError:  # 极旧 API 无 is_leap 参数
        try:
            d = sxtwl.fromLunar(year, month, day)
        except Exception:
            return None
    except Exception:
        return None
    if d is None:
        return None
    if is_leap:  # 验证闰月真实存在（2.x 静默回退检测）
        try:
            if hasattr(d, "isLunarLeap"):
                if not d.isLunarLeap():
                    return None
            else:
                l = d.getLunar()
                if not getattr(l, "isLeap", False):
                    return None
        except Exception:
            pass
    try:
        if hasattr(d, "getSolarYear"):  # sxtwl 2.x
            return date(d.getSolarYear(), d.getSolarMonth(), d.getSolarDay())
        s = d.getSolar()  # sxtwl 4.x
        return date(s.y, s.m, s.d)
    except Exception:
        return None


CN_DAY = ["初一","初二","初三","初四","初五","初六","初七","初八","初九","初十",
         "十一","十二","十三","十四","十五","十六","十七","十八","十九","二十",
         "廿一","廿二","廿三","廿四","廿五","廿六","廿七","廿八","廿九","三十"]


def _cn_day(ld):
    """农历日转中文：2.x 返回 int，4.x 返回字符串，统一成中文"""
    if isinstance(ld, int):
        return CN_DAY[ld - 1] if 1 <= ld <= 30 else str(ld)
    return str(ld)


def lunar_str(d: date) -> str:
    """公历日期 -> '八月十五' 形式（用于消息头）。兼容 sxtwl 2.x / 4.x。"""
    if sxtwl is None:
        return ""
    try:
        day = sxtwl.fromSolar(d.year, d.month, d.day)
        if hasattr(day, "getLunarMonth"):  # sxtwl 2.x
            lm, ld, is_leap = day.getLunarMonth(), day.getLunarDay(), day.isLunarLeap()
        else:  # sxtwl 4.x
            l = day.getLunar()
            lm, ld, is_leap = l.lmonth, l.lday, l.isLeap
        m = LUNAR_MONTH_NAMES[lm - 1] if 1 <= lm <= 12 else str(lm)
        prefix = "闰" if is_leap else ""
        return f"{prefix}{m}月{_cn_day(ld)}"
    except Exception:
        return ""


# ---------- 事件日期计算 ----------

def next_solar_occurrence(today, ev):
    """阳历事件：今天或之后最近一次，处理 2/29 不存在的情况"""
    m, d = ev["month"], ev["day"]
    for yy in (today.year, today.year + 1):
        try:
            cand = date(yy, m, d)
        except ValueError:
            if m == 2 and d == 29:
                policy = ev.get("leap_day_policy", "feb28")
                cand = date(yy, 2, 28) if policy == "feb28" else date(yy, 3, 1)
            else:
                continue
        if cand >= today:
            return cand
    return None


def next_lunar_occurrence(today, ev):
    """农历事件：今天或之后最近一次公历日期。
    leap_policy:
      leap_first - 当年有闰该月则闰月过，否则正月过
      leap_both  - 闰月优先，已过则正月（闰月总在正月之后，等价取未来最近）
      normal     - 永远按正月过
    """
    m, d = ev["month"], ev["day"]
    policy = ev.get("leap_policy", "leap_first")
    for yy in (today.year, today.year + 1):
        normal = _solar_from_lunar(yy, m, d, False)
        leap = None
        if policy in ("leap_first", "leap_both"):
            leap = _solar_from_lunar(yy, m, d, True)
        if leap is not None:
            # 当年有闰该月：闰月才是真正的生日，正月那次不算
            cands = [leap]
        else:
            cands = [normal] if normal else []
        fut = sorted(c for c in cands if c >= today)
        if fut:
            return fut[0]
    return None


def next_occurrence(today, ev):
    if ev.get("calendar") == "solar":
        return next_solar_occurrence(today, ev)
    return next_lunar_occurrence(today, ev)


def age_at(ev, occ):
    """事件发生那年的岁数（周岁，按公历年差）"""
    if not ev.get("birth_year"):
        return None
    return occ.year - ev["birth_year"]


# ---------- 消息生成 ----------

def build_message(ev, occ, diff_days):
    fmt = {
        "name": ev.get("name", ""),
        "person": ev.get("person", ""),
        "days": str(diff_days),
        "age": str(age_at(ev, occ)) if age_at(ev, occ) is not None else "",
        "date": occ.isoformat(),
        "lunar": lunar_str(occ),
    }
    tpl = ev.get("message") or "$name（$person）"
    line = Template(tpl).safe_substitute(**fmt)
    if diff_days == 0:
        head = "🎂 今天：" if "生日" in ev.get("name", "") else "📌 今天："
        return head + line
    return f"⏰ {diff_days} 天后（{occ.isoformat()}）：{line}"


# ---------- 推送（ClawBot 链接协议 HTTP 接口）----------

def _resolve_env(v):
    if isinstance(v, str) and v.startswith("${") and v.endswith("}"):
        return os.environ.get(v[2:-1], "")
    return v or ""


def load_bots(settings):
    bots = {}
    for b in settings.get("bots", []):
        bots[b["id"]] = {
            "id": b["id"],
            "mode": b.get("mode", "weclawbot"),  # cf / weclawbot / generic
            "api": _resolve_env(b.get("api", "")).rstrip("/"),
            "token": _resolve_env(b.get("token", "")),
            "path": b.get("path", "/api/send"),
            "bot_id": _resolve_env(b.get("bot_id", "")),  # WeClawBot-API 的 bot_id（如 xxx@im.bot）
            "default_targets": b.get("default_targets", []),
        }
    return bots


def push(bot, target, text):
    """发一条文本消息。三种协议模式（按 bot.mode 选择）：
    - cf：Cloudflare Worker 网关 POST {api}/api/v1/notify，Bearer API Key，body {"text"}（target 忽略，发给绑定者微信）
    - weclawbot：WeClawBot-API POST {api}/bots/{bot_id}/messages?token=...&text=...
    - generic：通用 ClawBot POST {api}{path}，body {target,text,type}
    """
    if requests is None:
        sys.exit("缺少依赖 requests")
    mode = bot.get("mode", "generic")
    try:
        if mode == "cf":
            url = f"{bot['api']}/api/v1/notify"
            headers = {"Authorization": f"Bearer {bot['token']}", "Content-Type": "application/json"}
            r = requests.post(url, json={"text": text}, headers=headers, timeout=15)
        elif mode == "weclawbot":
            url = f"{bot['api']}/bots/{bot['bot_id']}/messages"
            r = requests.post(url, params={"token": bot["token"], "text": text}, timeout=10)
        else:
            url = f"{bot['api']}{bot['path']}"
            headers = {"Authorization": f"Bearer {bot['token']}"} if bot["token"] else {}
            payload = {"target": target, "text": text, "type": "text"}
            r = requests.post(url, json=payload, headers=headers, timeout=10)
        return r.ok
    except Exception:
        return False


def split_target(t, default_bot):
    if ":" in t:
        bot_id, _, target = t.partition(":")
        return bot_id, target
    return default_bot, t


# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(description="家庭日历通知")
    ap.add_argument("--run", action="store_true", help="执行通知（配合 --slot）")
    ap.add_argument("--slot", default="", help="时段 00:05/08:30/20:30；留空自动推断")
    ap.add_argument("--dry-run", action="store_true", help="只打印，不发送")
    ap.add_argument("--send-test", action="store_true", help="发测试消息到目标")
    ap.add_argument("--target", default="filehelper", help="测试目标（默认文件传输助手）")
    args = ap.parse_args()

    cfg = load_json(DATA_FILE, {"events": [], "settings": {}})
    events = cfg.get("events", [])
    settings = cfg.get("settings", {})
    bots = load_bots(settings)
    default_bot = settings.get("default_bot") or (next(iter(bots)) if bots else "")
    default_targets = settings.get("default_targets", [])
    today = today_cn()

    # --- 测试模式 ---
    if args.send_test:
        if not bots:
            sys.exit("settings.bots 为空，先配置 ClawBot")
        bot_id = args.target.split(":", 1)[0] if ":" in args.target else default_bot
        bot = bots.get(bot_id)
        if not bot:
            sys.exit(f"找不到 bot: {bot_id}")
        _, target = split_target(args.target, default_bot)
        text = f"✅ 家庭日历测试 · {today.isoformat()}（农历 {lunar_str(today)}）"
        if args.dry_run:
            print(f"[dry-run] {bot_id} -> {target}: {text}")
            return
        ok = push(bot, target, text)
        print("test push:", "OK" if ok else "FAIL")
        sys.exit(0 if ok else 1)

    if not args.run:
        ap.print_help()
        return

    slot = args.slot or auto_slot()
    slots = settings.get("notify_slots", {})
    slot_cfg = slots.get(slot, {"remind": [0]})
    reminds = set(slot_cfg.get("remind", [0]))
    print(f"[info] {today.isoformat()} slot={slot} remind={sorted(reminds)} 农历={lunar_str(today)}")

    notified = load_json(NOTIFIED_FILE, {})
    outbox = load_json(OUTBOX_FILE, [])

    # --- 先补发上次失败的 outbox ---
    for item in outbox[:]:
        bot = bots.get(item["bot"])
        if bot and push(bot, item["target"], item["text"]):
            outbox.remove(item)
            print(f"[outbox] 补发成功 -> {item['bot']}:{item['target']}")
        else:
            print(f"[outbox] 补发仍失败 -> {item['bot']}:{item['target']}")
    save_json(OUTBOX_FILE, outbox)

    # --- 匹配事件（5 天窗口，按倒计时排序），按目标聚合 ---
    cands = []
    for ev in events:
        occ = next_occurrence(today, ev)
        if not occ:
            continue
        diff = (occ - today).days
        if diff not in reminds:
            continue
        key = f"{ev['id']}:{occ.isoformat()}:{diff}:{slot}"
        if notified.get(key):
            print(f"[skip] 已推送过: {key}")
            continue
        cands.append((diff, ev, occ, key))
    cands.sort(key=lambda x: x[0])  # 当天在前，越近越靠前

    msg_map = {}      # target -> {"lines": [...], "keys": [...]}
    order = []
    for diff, ev, occ, key in cands:
        text = build_message(ev, occ, diff)
        targets = ev.get("targets")
        if not targets:
            # 事件未指定 targets：发给所有已配置 bot（全家都收到）
            targets = [f"{bid}:{t}" for bid, b in bots.items() for t in (b.get("default_targets") or ["self"])]
        for t in targets:
            bot_id, target = split_target(t, default_bot)
            bucket = f"{bot_id}:{target}"
            if bucket not in msg_map:
                msg_map[bucket] = {"lines": [], "keys": []}
                order.append(bucket)
            msg_map[bucket]["lines"].append(text)
            msg_map[bucket]["keys"].append(key)

    if not msg_map:
        print("[info] 本次无需要提醒的事件")
        save_json(NOTIFIED_FILE, notified)
        return

    # --- 发送 ---
    for bucket in order:
        bot_id, _, target = bucket.partition(":")
        bot = bots.get(bot_id)
        if not bot:
            print(f"[warn] 未知 bot: {bot_id}，跳过 {bucket}")
            continue
        text = "\n".join(f"• {l}" for l in msg_map[bucket]["lines"])
        header = f"📅 家庭日历 · {today.isoformat()}（农历 {lunar_str(today)}）"
        full = f"{header}\n{text}"
        if args.dry_run:
            print(f"[dry-run] {bucket}\n{full}\n")
            continue
        ok = push(bot, target, full)
        if ok:
            for k in msg_map[bucket]["keys"]:
                notified[k] = {"sent": today.isoformat(), "text": full}
            print(f"[ok] {bucket} 已推送 {len(msg_map[bucket]['keys'])} 条")
        else:
            outbox.append({"bot": bot_id, "target": target, "text": full,
                           "ts": today.isoformat()})
            print(f"[fail] {bucket} 推送失败，已进 outbox 待补发")

    save_json(NOTIFIED_FILE, notified)
    save_json(OUTBOX_FILE, outbox)


if __name__ == "__main__":
    main()
