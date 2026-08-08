#!/usr/bin/env python3
"""Command-line wrapper for the shared read-only Kitesim client."""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
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


CAPTCHA_ENDPOINT = "https://api.kitesim.co/index/captcha-image-base64"
LOGIN_ENDPOINT = "https://api.kitesim.co/index/sign-in"
USER_INFO_ENDPOINT = "https://api.kitesim.co/user/info"


def _login_request(url: str, *, body: dict[str, str] | None = None, token: str = "") -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Origin": "https://h5.kitesim.co",
        "Referer": "https://h5.kitesim.co/",
        "User-Agent": "Mozilla/5.0 (compatible; KitesimRelayCLI/1.0)",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["token"] = token
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KitesimError("Kitesim 登录接口暂时不可用") from exc
    if not isinstance(payload, dict):
        raise KitesimError("Kitesim 登录接口返回格式无效")
    return payload


def _interactive_login() -> str:
    email = os.getenv("KITESIM_LOGIN_EMAIL_1", "").strip().lower()
    password = os.getenv("KITESIM_LOGIN_PASSWORD", "")
    if not email or len(password) < 8:
        raise KitesimAuthError("请配置 KITESIM_LOGIN_EMAIL_1 与 KITESIM_LOGIN_PASSWORD")

    captcha = _login_request(CAPTCHA_ENDPOINT)
    captcha_key = str(captcha.get("captchaKey") or "")
    image_base64 = str(captcha.get("captchaImageBase64") or "")
    try:
        image = base64.b64decode(image_base64, validate=True)
    except ValueError as exc:
        raise KitesimError("Kitesim 图片验证码格式无效") from exc
    if not captcha_key or not image.startswith(b"\x89PNG\r\n\x1a\n"):
        raise KitesimError("Kitesim 图片验证码格式无效")

    image_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="kitesim-captcha-", suffix=".png", delete=False) as image_file:
            image_file.write(image)
            image_path = image_file.name
        if sys.platform == "darwin":
            subprocess.run(["open", image_path], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"验证码图片：{image_path}", file=sys.stderr)
        captcha_code = input("请输入图片中的 4 位字符：").strip().upper()
    finally:
        if image_path:
            try:
                Path(image_path).unlink()
            except OSError:
                pass

    if len(captcha_code) != 4 or not captcha_code.isalnum():
        raise KitesimAuthError("验证码格式无效")
    login = _login_request(
        LOGIN_ENDPOINT,
        body={
            "email": email,
            "pass": password,
            "captchaCode": captcha_code,
            "captchaKey": captcha_key,
        },
    )
    token = str(login.get("data") or "").strip()
    if login.get("code") != 200 or not 16 <= len(token) <= 512:
        raise KitesimAuthError("Kitesim 登录失败，请重新运行并获取验证码")
    user_info = _login_request(USER_INFO_ENDPOINT, token=token)
    account_data = user_info.get("data")
    account_email = str(
        account_data.get("email") if isinstance(account_data, dict) else ""
    ).strip().lower()
    if user_info.get("code") != 200 or account_email != email:
        raise KitesimAuthError("Kitesim 登录账户验证失败")
    return token


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

    try:
        token = _interactive_login()
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
