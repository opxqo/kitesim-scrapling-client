"""Read-only Kitesim client powered by Scrapling's static Fetcher."""

from __future__ import annotations

import json
import logging
import re
import sys
import types
from typing import Any, Iterable


def _install_static_fetcher_type_compatibility() -> None:
    """Supply the Playwright types imported by Scrapling's response converter.

    Scrapling's static Fetcher uses curl_cffi and never starts Playwright, but
    version 0.4.12 imports four Playwright classes for optional response type
    checks. Shipping the full Playwright package adds roughly 130 MB and exceeds
    EdgeOne's function bundle limit. These inert classes satisfy those imports
    only when Playwright is absent; DynamicFetcher is intentionally unsupported
    in this project.
    """

    if "playwright" in sys.modules:
        return
    try:
        __import__("playwright")
        return
    except ModuleNotFoundError:
        pass

    playwright_module = types.ModuleType("playwright")
    playwright_module.__path__ = []  # type: ignore[attr-defined]
    impl_module = types.ModuleType("playwright._impl")
    impl_module.__path__ = []  # type: ignore[attr-defined]
    errors_module = types.ModuleType("playwright._impl._errors")
    sync_module = types.ModuleType("playwright.sync_api")
    async_module = types.ModuleType("playwright.async_api")

    class PlaywrightError(Exception):
        pass

    class PlaywrightPage:
        pass

    class PlaywrightResponse:
        pass

    errors_module.Error = PlaywrightError  # type: ignore[attr-defined]
    sync_module.Page = PlaywrightPage  # type: ignore[attr-defined]
    sync_module.Response = PlaywrightResponse  # type: ignore[attr-defined]
    async_module.Page = PlaywrightPage  # type: ignore[attr-defined]
    async_module.Response = PlaywrightResponse  # type: ignore[attr-defined]

    sys.modules.update(
        {
            "playwright": playwright_module,
            "playwright._impl": impl_module,
            "playwright._impl._errors": errors_module,
            "playwright.sync_api": sync_module,
            "playwright.async_api": async_module,
        }
    )


_install_static_fetcher_type_compatibility()

from scrapling.fetchers import Fetcher  # noqa: E402


DEFAULT_BASE_URL = "https://api.kitesim.co"
WEB_ORIGIN = "https://h5.kitesim.co/"
STATUS_LABELS = {
    0: "待支付",
    1: "激活中",
    2: "使用中",
    3: "已过期",
    4: "已退款",
}
# The H5 page exposes the statuses in the semantic order above, while the
# order-list endpoint expects a different filter code for four of the tabs.
# Keep this separate from ``orderStatus``, whose values do use STATUS_LABELS.
ORDER_FILTER_TO_UPSTREAM_STATUS = {
    0: 2,  # 待支付
    1: 3,  # 激活中
    2: 1,  # 使用中
    3: 0,  # 已过期
    4: 4,  # 已退款
}
CODE_PATTERNS = (
    re.compile(
        r"(?:验证码|校验码|动态码|动态验证码|verification\s*code|one[- ]time\s+password|otp|code)"
        r"[^0-9]{0,24}(\d{2,4}(?:[\s\u00a0\-‐‑‒–—]\d{2,4}){1,2}|\d{4,8})",
        re.IGNORECASE,
    ),
)
SEGMENTED_DIGITS_PATTERN = re.compile(
    r"(?<!\d)\d{2,4}(?:[\s\u00a0\-‐‑‒–—]\d{2,4}){1,2}(?!\d)"
)

# Scrapling logs full request URLs at INFO level. Kitesim's SMS endpoint places
# the phone number in its query string, so keep normal application logs private.
logging.getLogger("scrapling").setLevel(logging.WARNING)


class KitesimError(RuntimeError):
    """Base error for the read-only Kitesim client."""


class KitesimAuthError(KitesimError):
    """Raised when the Kitesim AppToken is missing, expired, or unauthorized."""


def _json_loads(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise KitesimError("Kitesim 接口返回的不是有效 JSON") from exc


def _as_records(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict) and isinstance(data.get("records"), list):
        return [item for item in data["records"] if isinstance(item, dict)]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [data]
    return []


def _sort_key(record: dict[str, Any]) -> str:
    return str(record.get("createTime") or record.get("paymentTime") or "")


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def extract_codes(content: str) -> list[str]:
    """Extract likely OTP values without treating every number as a code."""

    found: list[str] = []
    for pattern in CODE_PATTERNS:
        for match in pattern.findall(content or ""):
            normalized = _digits(match)
            if 4 <= len(normalized) <= 8 and normalized not in found:
                found.append(normalized)

    if not found and re.search(r"验证码|校验码|verification|one[- ]time|\botp\b|\bcode\b", content, re.I):
        for match in re.findall(r"(?<!\d)(\d{6})(?!\d)", content):
            if match not in found:
                found.append(match)
    return found


def mask_code(code: str) -> str:
    if len(code) <= 2:
        return "*" * len(code)
    return f"{code[0]}{'*' * (len(code) - 2)}{code[-1]}"


def mask_message(content: str) -> str:
    """Mask long digit runs unless the caller explicitly requests SMS text."""

    masked = SEGMENTED_DIGITS_PATTERN.sub(
        lambda match: re.sub(r"\d", "*", match.group(0)),
        content or "",
    )
    return re.sub(r"\d{4,}", lambda match: "*" * len(match.group(0)), masked)


class KitesimClient:
    """Small wrapper around the read-only endpoints used by the Kitesim H5 app."""

    def __init__(
        self,
        token: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 12.0,
        retries: int = 1,
    ) -> None:
        token = token.strip()
        if not token:
            raise KitesimAuthError("缺少 Kitesim 运行时登录凭据")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        # Scrapling interprets ``retries`` as the total number of attempts.
        # A value of zero skips the request loop entirely, so always permit at
        # least the initial request.
        self.retries = max(1, retries)
        self.headers = {
            "Accept": "application/json",
            "Referer": WEB_ORIGIN,
            "token": token,
        }

    def _request(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        kwargs: dict[str, Any] = {
            "headers": self.headers,
            "timeout": self.timeout,
            "impersonate": "chrome",
            "retries": self.retries,
            "retry_delay": 0.6,
        }
        if params:
            kwargs["params"] = params

        response = Fetcher.get(url, **kwargs)
        if response.status in {401, 403}:
            raise KitesimAuthError("Kitesim AppToken 已失效或无权访问")
        if response.status != 200:
            raise KitesimError(f"Kitesim HTTP {response.status}")

        payload = _json_loads(response.body)
        if isinstance(payload, dict) and "code" in payload and payload.get("code") != 200:
            if payload.get("code") in {401, 403}:
                raise KitesimAuthError("Kitesim AppToken 已失效或无权访问")
            raise KitesimError(f"Kitesim 业务错误 code={payload.get('code')}")
        return payload.get("data") if isinstance(payload, dict) and "data" in payload else payload

    def list_phone_orders(
        self,
        *,
        status: int,
        page: int = 1,
        size: int = 50,
        phone: str = "",
    ) -> list[dict[str, Any]]:
        try:
            upstream_status = ORDER_FILTER_TO_UPSTREAM_STATUS[status]
        except KeyError as exc:
            raise ValueError("status 必须是 0 到 4") from exc
        data = self._request(
            "/userPhonePurchase/getOrderPage",
            params={"page": page, "size": size, "status": upstream_status, "phone": phone},
        )
        return _as_records(data)

    def get_phone_order_detail(self, order_no: str) -> list[dict[str, Any]]:
        data = self._request(
            "/userPhonePurchase/getOrderDetail",
            params={"orderNo": order_no},
        )
        return _as_records(data)

    def get_phone_sms(self, order_id: Any, phone_number: str) -> Any:
        return self._request(
            "/userPhonePurchase/seePhoneNubmerSms",
            params={"orderId": str(order_id), "phoneNumber": phone_number},
        )


def select_orders(
    client: KitesimClient,
    *,
    phone: str = "",
    status: int = 2,
    all_status: bool = False,
    order_no: str = "",
) -> list[dict[str, Any]]:
    if order_no:
        records = client.get_phone_order_detail(order_no)
    else:
        statuses: Iterable[int] = range(5) if all_status else (status,)
        records = []
        seen: set[str] = set()
        for current_status in statuses:
            for record in client.list_phone_orders(status=current_status, phone=phone):
                key = str(record.get("id") or record.get("orderNo") or id(record))
                if key not in seen:
                    seen.add(key)
                    records.append(record)

    if phone:
        wanted = _digits(phone)
        records = [record for record in records if _digits(record.get("phoneNumber")) == wanted]

    records = [record for record in records if record.get("phoneNumber")]
    return sorted(records, key=_sort_key, reverse=True)


def compact_order(record: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "id",
        "orderNo",
        "phoneNumber",
        "countryCode",
        "phoneCode",
        "packageId",
        "durationType",
        "durationValue",
        "packagePrice",
        "paidAmount",
        "currency",
        "orderStatus",
        "autoRenew",
        "createTime",
        "paymentTime",
        "expireTime",
        "nextRenewalDate",
    )
    compact = {key: record.get(key) for key in keys if key in record}
    status = record.get("orderStatus")
    compact["statusLabel"] = STATUS_LABELS.get(status, f"状态 {status}" if status is not None else "未知")
    return compact


def normalize_messages(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict) and isinstance(data.get("noteList"), list):
        records = [item for item in data["noteList"] if isinstance(item, dict)]
    elif isinstance(data, list):
        records = [item for item in data if isinstance(item, dict)]
    elif isinstance(data, dict):
        records = [data]
    else:
        records = []
    return sorted(
        records,
        key=lambda item: str(item.get("sendTime") or item.get("createTime") or ""),
        reverse=True,
    )


def build_messages(
    data: Any,
    *,
    show_code: bool,
    show_sms: bool,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    records = normalize_messages(data)
    if limit is not None:
        records = records[:limit]
    for message in records:
        content = str(message.get("content") or "")
        codes = extract_codes(content)
        messages.append(
            {
                "id": message.get("id"),
                "sender": message.get("caller"),
                "recipient": message.get("callee"),
                "time": message.get("sendTime") or message.get("createTime"),
                "code": codes if show_code else [mask_code(code) for code in codes],
                "content": content if show_sms else mask_message(content),
            }
        )
    return messages


def build_report(
    client: KitesimClient,
    orders: list[dict[str, Any]],
    *,
    all_orders: bool,
    show_code: bool,
    show_sms: bool,
) -> list[dict[str, Any]]:
    selected = orders if all_orders else orders[:1]
    report: list[dict[str, Any]] = []
    for order in selected:
        sms_data = client.get_phone_sms(order.get("id"), str(order.get("phoneNumber")))
        report.append(
            {
                "order": compact_order(order),
                "messages": build_messages(sms_data, show_code=show_code, show_sms=show_sms),
            }
        )
    return report
