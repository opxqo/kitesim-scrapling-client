"""Server-only Kitesim account configuration and signed routing identities."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from typing import Any, Mapping


MAX_KITESIM_ACCOUNTS = 20
# EdgeOne Makers currently limits each environment-variable value to 500 bytes.
MAX_TOKEN_CONFIG_BYTES = 500


class KitesimConfigurationError(RuntimeError):
    """Raised when the server-side multi-account configuration is invalid."""


@dataclass(frozen=True)
class KitesimAccount:
    id: str
    label: str
    token: str = field(repr=False)


def _clean_account_label(value: Any) -> str:
    label = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    return re.sub(r"\s+", " ", label).strip()[:40]


def _parse_multi_token_config(raw: str) -> list[tuple[str, str]]:
    raw = raw.strip()
    if not raw:
        return []
    if len(raw.encode("utf-8")) > MAX_TOKEN_CONFIG_BYTES:
        raise KitesimConfigurationError(
            "KITESIM_TOKENS 超过 EdgeOne 单变量 500 字节限制，请改用 KITESIM_TOKEN_1 等分项变量"
        )

    parsed_entries: list[Any]
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise KitesimConfigurationError("KITESIM_TOKENS 不是有效 JSON") from exc
        if not isinstance(parsed, list):
            raise KitesimConfigurationError("KITESIM_TOKENS JSON 必须是数组")
        parsed_entries = parsed
    elif raw.startswith("{"):
        raise KitesimConfigurationError("KITESIM_TOKENS JSON 必须是数组")
    else:
        parsed_entries = [part for part in re.split(r"[,;\n]+", raw) if part.strip()]

    specs: list[tuple[str, str]] = []
    for entry in parsed_entries:
        if isinstance(entry, str):
            label = ""
            token = entry.strip()
        elif isinstance(entry, dict):
            label = _clean_account_label(entry.get("name") or entry.get("label"))
            token = str(entry.get("token") or "").strip()
        else:
            raise KitesimConfigurationError("KITESIM_TOKENS 包含不支持的账户项")
        if not token:
            raise KitesimConfigurationError("KITESIM_TOKENS 包含空 Token")
        specs.append((label, token))
    return specs


def _account_id(token: str, signer_secret: str) -> str:
    secret = (signer_secret or "kitesim-relay").encode("utf-8")
    digest = hmac.new(secret, token.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
    return f"acct_{digest}"


def load_kitesim_accounts(
    environment: Mapping[str, str],
    *,
    signer_secret: str,
    primary_token: str = "",
    primary_label: str = "",
) -> list[KitesimAccount]:
    """Load, merge and de-duplicate all supported server-side token variables."""

    managed_token = primary_token.strip()
    if managed_token:
        specs = [(_clean_account_label(primary_label), managed_token)]
        first_numbered_index = 2
    else:
        specs = _parse_multi_token_config(environment.get("KITESIM_TOKENS", ""))
        first_numbered_index = 1

    for index in range(first_numbered_index, MAX_KITESIM_ACCOUNTS + 1):
        token = environment.get(f"KITESIM_TOKEN_{index}", "").strip()
        if not token:
            continue
        label = _clean_account_label(environment.get(f"KITESIM_TOKEN_NAME_{index}", ""))
        specs.append((label, token))

    if not managed_token:
        legacy_token = environment.get("KITESIM_TOKEN", "").strip()
        if legacy_token:
            specs.append(("默认账户" if not specs else "兼容账户", legacy_token))

    unique_specs: list[tuple[str, str]] = []
    seen_tokens: set[str] = set()
    for label, token in specs:
        if token in seen_tokens:
            continue
        seen_tokens.add(token)
        unique_specs.append((label, token))

    if not unique_specs:
        raise KitesimConfigurationError(
            "服务端尚未配置 KITESIM_TOKEN、KITESIM_TOKENS 或 KITESIM_TOKEN_1"
        )
    if len(unique_specs) > MAX_KITESIM_ACCOUNTS:
        raise KitesimConfigurationError(f"最多支持 {MAX_KITESIM_ACCOUNTS} 个 Kitesim 账户")

    single_account = len(unique_specs) == 1
    return [
        KitesimAccount(
            id=_account_id(token, signer_secret),
            label=label or ("默认账户" if single_account else f"账户 {index}"),
            token=token,
        )
        for index, (label, token) in enumerate(unique_specs, start=1)
    ]


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
