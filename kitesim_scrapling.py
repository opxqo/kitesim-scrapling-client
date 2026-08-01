#!/usr/bin/env python3
"""Command-line wrapper for the shared read-only Kitesim client."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


PROJECT_DIR = Path(__file__).resolve().parent
CLOUD_FUNCTIONS_ROOT = PROJECT_DIR / "cloud-functions"
if str(CLOUD_FUNCTIONS_ROOT) not in sys.path:
    sys.path.insert(0, str(CLOUD_FUNCTIONS_ROOT))

from _shared.kitesim import (  # noqa: E402
    DEFAULT_BASE_URL,
    STATUS_LABELS,
    KitesimAuthError,
    KitesimClient,
    KitesimError,
    build_messages,
    build_report,
    compact_order,
    extract_codes,
    mask_code,
    mask_message,
    normalize_messages,
    select_orders,
)


__all__ = [
    "DEFAULT_BASE_URL",
    "STATUS_LABELS",
    "KitesimAuthError",
    "KitesimClient",
    "KitesimError",
    "build_messages",
    "build_report",
    "compact_order",
    "extract_codes",
    "mask_code",
    "mask_message",
    "normalize_messages",
    "select_orders",
]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="用 Scrapling 只读获取 Kitesim 号码信息和短信验证码")
    parser.add_argument("--phone", default="", help="按完整号码筛选")
    parser.add_argument("--order-no", default="", help="直接查询订单号")
    parser.add_argument("--status", type=int, default=2, choices=range(5), help="订单状态，默认 2（使用中）")
    parser.add_argument("--all-status", action="store_true", help="查询 0～4 全部订单状态")
    parser.add_argument("--all-orders", action="store_true", help="输出所有匹配订单，否则只取最新一条")
    parser.add_argument("--show-code", action="store_true", help="输出完整验证码；默认仅输出首尾字符")
    parser.add_argument("--show-sms", action="store_true", help="输出完整短信内容；默认掩码数字")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--base-url", default=os.getenv("KITESIM_BASE_URL", DEFAULT_BASE_URL))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    token = os.getenv("KITESIM_TOKEN", "")
    if not token:
        print("请先设置 KITESIM_TOKEN 环境变量，不要把 Token 写入脚本。", file=sys.stderr)
        return 2

    try:
        client = KitesimClient(token=token, base_url=args.base_url)
        orders = select_orders(
            client,
            phone=args.phone,
            status=args.status,
            all_status=args.all_status,
            order_no=args.order_no,
        )
        if not orders:
            result: Any = {"orders": [], "messages": [], "note": "没有找到带 phoneNumber 的号码订单"}
        else:
            result = build_report(
                client,
                orders,
                all_orders=args.all_orders,
                show_code=args.show_code,
                show_sms=args.show_sms,
            )

        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        elif isinstance(result, dict):
            print(result["note"])
        else:
            for item in result:
                print(json.dumps(item, ensure_ascii=False, indent=2))
        return 0
    except KitesimAuthError as exc:
        print(f"鉴权失败：{exc}", file=sys.stderr)
        return 3
    except KitesimError as exc:
        print(f"请求失败：{exc}", file=sys.stderr)
        return 4
    except KeyboardInterrupt:
        print("已取消。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
