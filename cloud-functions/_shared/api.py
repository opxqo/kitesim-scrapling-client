"""Authenticated Flask API shared by EdgeOne and the local preview server."""

from __future__ import annotations

import hmac
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable

from flask import Blueprint, Response, jsonify, request

from .accounts import (
    KitesimAccount,
    KitesimConfigurationError,
    create_message_handle,
    load_kitesim_accounts,
    verify_message_handle,
)
from .kitesim import (
    DEFAULT_BASE_URL,
    KitesimAuthError,
    KitesimClient,
    KitesimError,
    build_messages,
    compact_order,
    select_orders,
)


ACCESS_KEY_MIN_LENGTH = 12
MAX_ALL_STATUS_ACCOUNTS = 8
PHONE_PATTERN = re.compile(r"^\+?\d{6,20}$")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error(message: str, status: int, kind: str) -> tuple[Response, int]:
    return jsonify({"error": message, "kind": kind}), status


def _access_key() -> str:
    return os.getenv("DASHBOARD_ACCESS_KEY", "").strip()


def _provided_access_key() -> str:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return request.headers.get("X-Dashboard-Key", "").strip()


def _authorize() -> tuple[Response, int] | None:
    expected = _access_key()
    if len(expected) < ACCESS_KEY_MIN_LENGTH:
        return _error("服务端尚未配置安全访问口令", 503, "configuration")
    supplied = _provided_access_key()
    if not supplied or not hmac.compare_digest(supplied, expected):
        return _error("访问口令无效", 401, "dashboard_auth")
    return None


def _protected(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        failure = _authorize()
        return failure if failure else view(*args, **kwargs)

    return wrapped


def _kitesim_accounts() -> list[KitesimAccount]:
    return load_kitesim_accounts(os.environ, signer_secret=_access_key())


def _kitesim_client(account: KitesimAccount, *, timeout_cap: float = 25.0) -> KitesimClient:
    try:
        timeout = float(os.getenv("KITESIM_REQUEST_TIMEOUT", "12"))
    except ValueError:
        timeout = 12.0
    timeout = min(max(timeout, 5.0), timeout_cap)
    return KitesimClient(
        token=account.token,
        base_url=os.getenv("KITESIM_BASE_URL", DEFAULT_BASE_URL),
        timeout=timeout,
    )


def _orders_for_account(
    account: KitesimAccount,
    *,
    phone: str,
    status: int,
    all_status: bool,
    order_no: str,
    timeout_cap: float,
) -> list[dict[str, Any]]:
    records = select_orders(
        _kitesim_client(account, timeout_cap=timeout_cap),
        phone=phone,
        status=status,
        all_status=all_status,
        order_no=order_no,
    )
    items: list[dict[str, Any]] = []
    for record in records:
        item = compact_order(record)
        order_id = str(item.get("id") or item.get("orderNo") or "")
        phone_number = str(item.get("phoneNumber") or "")
        if not order_id or not phone_number:
            continue
        item["accountId"] = account.id
        item["accountLabel"] = account.label
        item["messageHandle"] = create_message_handle(
            account,
            order_id=order_id,
            phone_number=phone_number,
        )
        items.append(item)
    return items


def _account_warning(account: KitesimAccount, exc: KitesimError) -> dict[str, str]:
    if isinstance(exc, KitesimAuthError):
        kind = "upstream_auth"
        message = "该账户的 Kitesim Token 已失效或无权访问"
    else:
        kind = "upstream"
        message = "该账户暂时读取失败"
    return {
        "accountId": account.id,
        "accountLabel": account.label,
        "kind": kind,
        "message": message,
    }


def _round_robin(groups: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Interleave accounts so a global limit cannot starve later accounts."""

    merged: list[dict[str, Any]] = []
    max_group_size = max((len(group) for group in groups), default=0)
    for index in range(max_group_size):
        for group in groups:
            if index < len(group):
                merged.append(group[index])
    return merged


def _parse_status() -> tuple[int, bool] | tuple[None, None]:
    raw = request.args.get("status", "2").strip().lower()
    if raw == "all":
        return 2, True
    try:
        value = int(raw)
    except ValueError:
        return None, None
    return (value, False) if value in range(5) else (None, None)


def _parse_limit() -> int | None:
    try:
        value = int(request.args.get("limit", "10"))
    except ValueError:
        return None
    return value if 1 <= value <= 20 else None


def _handle_kitesim_error(exc: Exception) -> tuple[Response, int]:
    if isinstance(exc, KitesimConfigurationError):
        return _error(str(exc), 503, "configuration")
    if isinstance(exc, KitesimAuthError):
        return _error("Kitesim Token 已失效或无权访问", 502, "upstream_auth")
    if isinstance(exc, KitesimError):
        return _error("Kitesim 上游读取失败", 502, "upstream")
    return _error("服务端读取失败，请查看 EdgeOne Functions 日志", 500, "server")


def create_api_blueprint() -> Blueprint:
    api = Blueprint("kitesim_api", __name__)

    @api.after_request
    def secure_api_response(response: Response) -> Response:
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @api.get("/health")
    def health() -> Response:
        return jsonify(
            {
                "ok": True,
                "service": "kitesim-signal-desk",
                "runtime": "edgeone-python-cloud-function",
                "authConfigured": len(_access_key()) >= ACCESS_KEY_MIN_LENGTH,
            }
        )

    @api.post("/session")
    @_protected
    def session() -> Response:
        return jsonify({"ok": True, "scope": "read-only", "verifiedAt": _utc_now()})

    @api.get("/orders")
    @_protected
    def orders() -> tuple[Response, int] | Response:
        status, all_status = _parse_status()
        limit = _parse_limit()
        if status is None:
            return _error("status 必须是 0 到 4 或 all", 400, "validation")
        if limit is None:
            return _error("limit 必须是 1 到 20", 400, "validation")

        phone = request.args.get("phone", "").strip()
        order_no = request.args.get("order_no", "").strip()
        if len(phone) > 24 or len(order_no) > 64:
            return _error("筛选条件长度无效", 400, "validation")

        try:
            accounts = _kitesim_accounts()
            if all_status and len(accounts) > MAX_ALL_STATUS_ACCOUNTS:
                return _error(
                    f"全部状态一次最多查询 {MAX_ALL_STATUS_ACCOUNTS} 个账户，请改用单一状态筛选",
                    400,
                    "validation",
                )
            # Default queries use bounded concurrency and at most three
            # 12-second waves for 20 accounts. "all" is limited to eight
            # accounts and caps each of its five requests at eight seconds, so
            # both paths stay below the 60-second function ceiling without an
            # unbounded request fan-out.
            workers = len(accounts) if all_status else min(len(accounts), 8)
            timeout_cap = 8.0 if all_status else 12.0
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="kitesim-orders") as executor:
                pending = [
                    (
                        account,
                        executor.submit(
                            _orders_for_account,
                            account,
                            phone=phone,
                            status=status,
                            all_status=all_status,
                            order_no=order_no,
                            timeout_cap=timeout_cap,
                        ),
                    )
                    for account in accounts
                ]

                record_groups: list[list[dict[str, Any]]] = []
                warnings: list[dict[str, str]] = []
                for account, future in pending:
                    try:
                        record_groups.append(future.result())
                    except KitesimError as exc:
                        warnings.append(_account_warning(account, exc))

            records = _round_robin(record_groups)

            if warnings and len(warnings) == len(accounts):
                return (
                    jsonify(
                        {
                            "error": "所有 Kitesim 账户均读取失败",
                            "kind": "upstream",
                            "warnings": warnings,
                            "accountCount": len(accounts),
                            "failedAccountCount": len(warnings),
                        }
                    ),
                    502,
                )

            items = records[:limit]
            return jsonify(
                {
                    "items": items,
                    "count": len(items),
                    "hasMore": len(records) > limit,
                    "accountCount": len(accounts),
                    "failedAccountCount": len(warnings),
                    "partial": bool(warnings),
                    "warnings": warnings,
                    "status": "all" if all_status else status,
                    "updatedAt": _utc_now(),
                }
            )
        except Exception as exc:  # converted to a redacted API response below
            return _handle_kitesim_error(exc)

    @api.post("/messages")
    @api.post("/messages-origin")
    @_protected
    def messages() -> tuple[Response, int] | Response:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("请求体必须是 JSON 对象", 400, "validation")

        account_id = str(payload.get("accountId") or "").strip()
        message_handle = str(payload.get("messageHandle") or "").strip()
        order_id = str(payload.get("orderId") or "").strip()
        phone_number = str(payload.get("phoneNumber") or "").strip()
        if len(account_id) > 64:
            return _error("accountId 无效", 400, "validation")
        if len(message_handle) > 128:
            return _error("messageHandle 无效", 400, "validation")
        if not order_id or len(order_id) > 64:
            return _error("orderId 无效", 400, "validation")
        if not PHONE_PATTERN.fullmatch(phone_number):
            return _error("phoneNumber 无效", 400, "validation")

        show_code = payload.get("revealCode") is True
        show_sms = payload.get("showSms") is True
        try:
            accounts = _kitesim_accounts()
            if account_id:
                account = next((item for item in accounts if item.id == account_id), None)
                if account is None:
                    return _error("accountId 不属于当前配置", 400, "validation")
            elif len(accounts) == 1:
                account = accounts[0]
            else:
                return _error("多 Token 模式必须提供 accountId", 400, "validation")

            if len(accounts) > 1 and not message_handle:
                return _error("多 Token 模式必须提供 messageHandle", 400, "validation")
            if message_handle and not verify_message_handle(
                account,
                order_id=order_id,
                phone_number=phone_number,
                supplied_handle=message_handle,
            ):
                return _error("号码与 Token 账户不匹配，请重新同步号码", 400, "validation")

            client = _kitesim_client(account)
            sms_data = client.get_phone_sms(order_id, phone_number)
            items = build_messages(
                sms_data,
                show_code=show_code,
                show_sms=show_sms,
                limit=20,
            )
            return jsonify(
                {
                    "items": items,
                    "count": len(items),
                    "accountId": account.id,
                    "accountLabel": account.label,
                    "revealCode": show_code,
                    "showSms": show_sms,
                    "updatedAt": _utc_now(),
                }
            )
        except Exception as exc:  # converted to a redacted API response below
            return _handle_kitesim_error(exc)

    return api
