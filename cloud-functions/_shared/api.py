"""Authenticated Flask API shared by EdgeOne and the local preview server."""

from __future__ import annotations

import hmac
import os
import re
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable

from flask import Blueprint, Response, jsonify, request

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


def _kitesim_client() -> KitesimClient:
    token = os.getenv("KITESIM_TOKEN", "").strip()
    if not token:
        raise KitesimAuthError("服务端尚未配置 KITESIM_TOKEN")
    try:
        timeout = float(os.getenv("KITESIM_REQUEST_TIMEOUT", "12"))
    except ValueError:
        timeout = 12.0
    timeout = min(max(timeout, 5.0), 25.0)
    return KitesimClient(
        token=token,
        base_url=os.getenv("KITESIM_BASE_URL", DEFAULT_BASE_URL),
        timeout=timeout,
    )


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
    if isinstance(exc, KitesimAuthError):
        return _error(str(exc), 502, "upstream_auth")
    if isinstance(exc, KitesimError):
        return _error(str(exc), 502, "upstream")
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
            records = select_orders(
                _kitesim_client(),
                phone=phone,
                status=status,
                all_status=all_status,
                order_no=order_no,
            )
            items = [compact_order(record) for record in records[:limit]]
            return jsonify(
                {
                    "items": items,
                    "count": len(items),
                    "hasMore": len(records) > limit,
                    "status": "all" if all_status else status,
                    "updatedAt": _utc_now(),
                }
            )
        except Exception as exc:  # converted to a redacted API response below
            return _handle_kitesim_error(exc)

    @api.post("/messages")
    @_protected
    def messages() -> tuple[Response, int] | Response:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("请求体必须是 JSON 对象", 400, "validation")

        order_id = str(payload.get("orderId") or "").strip()
        phone_number = str(payload.get("phoneNumber") or "").strip()
        if not order_id or len(order_id) > 64:
            return _error("orderId 无效", 400, "validation")
        if not PHONE_PATTERN.fullmatch(phone_number):
            return _error("phoneNumber 无效", 400, "validation")

        show_code = payload.get("revealCode") is True
        show_sms = payload.get("showSms") is True
        try:
            client = _kitesim_client()
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
                    "revealCode": show_code,
                    "showSms": show_sms,
                    "updatedAt": _utc_now(),
                }
            )
        except Exception as exc:  # converted to a redacted API response below
            return _handle_kitesim_error(exc)

    return api
