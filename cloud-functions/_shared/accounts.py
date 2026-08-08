"""Validated Kitesim account identities received through the signed internal bridge."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping


MAX_KITESIM_ACCOUNTS = 20
ACCOUNT_ID_PATTERN = re.compile(r"^login_(?:[1-9]|1\d|20)$")


class KitesimConfigurationError(RuntimeError):
    """Raised when the managed account bridge is missing or invalid."""


@dataclass(frozen=True)
class KitesimAccount:
    id: str
    label: str
    token: str = field(repr=False)


def _clean_account_label(value: Any) -> str:
    label = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    return re.sub(r"\s+", " ", label).strip()[:40]


def load_managed_kitesim_accounts(specs: Iterable[Mapping[str, Any]]) -> list[KitesimAccount]:
    """Validate accounts from the HMAC-protected Node-to-Python bridge.

    Static token environment variables are intentionally unsupported. Tokens may
    enter the Python origin only through this short-lived signed payload.
    """

    entries = list(specs)
    if not entries:
        raise KitesimConfigurationError("尚无已登录的 Kitesim 账户，请先在后台完成验证码登录")
    if len(entries) > MAX_KITESIM_ACCOUNTS:
        raise KitesimConfigurationError(f"最多支持 {MAX_KITESIM_ACCOUNTS} 个 Kitesim 账户")

    accounts: list[KitesimAccount] = []
    seen_ids: set[str] = set()
    seen_tokens: set[str] = set()
    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, Mapping):
            raise KitesimConfigurationError("动态 Kitesim 账户格式无效")
        account_id = str(entry.get("accountId") or "").strip()
        token = str(entry.get("token") or "").strip()
        label = _clean_account_label(entry.get("label"))
        if not ACCOUNT_ID_PATTERN.fullmatch(account_id):
            raise KitesimConfigurationError("动态 Kitesim 账户标识无效")
        if not 16 <= len(token) <= 512:
            raise KitesimConfigurationError("动态 Kitesim 账户 Token 无效")
        if account_id in seen_ids or token in seen_tokens:
            raise KitesimConfigurationError("动态 Kitesim 账户包含重复项")
        seen_ids.add(account_id)
        seen_tokens.add(token)
        accounts.append(
            KitesimAccount(
                id=account_id,
                label=label or f"账户 {index}",
                token=token,
            )
        )
    return accounts


def create_message_handle(
    account: KitesimAccount,
    *,
    order_id: str,
    phone_number: str,
) -> str:
    """Sign an account/order/phone tuple with the server-only upstream token."""

    payload = "\x1f".join((account.id, str(order_id), phone_number)).encode("utf-8")
    signature = hmac.new(account.token.encode("utf-8"), payload, hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    return f"msg_{encoded}"


def verify_message_handle(
    account: KitesimAccount,
    *,
    order_id: str,
    phone_number: str,
    supplied_handle: str,
) -> bool:
    expected = create_message_handle(
        account,
        order_id=order_id,
        phone_number=phone_number,
    )
    return hmac.compare_digest(supplied_handle, expected)
