from __future__ import annotations

import base64
import hmac
import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "cloud-functions"))

from _shared import api as api_module


ACCESS_KEY = "test-access-key-12345"
BRIDGE_SECRET = "bridge-secret-at-least-24-characters"
DEFAULT_ACCOUNTS = [
    {"accountId": "login_1", "label": "主账户", "token": "fake-kitesim-token-123"}
]


def managed_headers(accounts=None, *, signature: str | None = None) -> dict[str, str]:
    payload = json.dumps(
        {"version": 1, "accounts": accounts or DEFAULT_ACCOUNTS},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    timestamp = str(int(time.time()))
    actual_signature = hmac.new(
        BRIDGE_SECRET.encode("utf-8"),
        f"{timestamp}\n{encoded}".encode("utf-8"),
        "sha256",
    ).hexdigest()
    return {
        "Authorization": f"Bearer {ACCESS_KEY}",
        "X-Kitesim-Managed-Accounts": encoded,
        "X-Kitesim-Managed-Timestamp": timestamp,
        "X-Kitesim-Managed-Signature": signature or actual_signature,
    }


AUTH_HEADERS = managed_headers()


class FakeKitesimClient:
    def __init__(self, token: str, *args, **kwargs) -> None:
        self.token = token

    def list_phone_orders(self, *, status: int, page: int = 1, size: int = 50, phone: str = ""):
        if status != 2:
            return []
        return [
            {
                "id": 42,
                "orderNo": "ORDER-42",
                "phoneNumber": "+15551234567",
                "countryCode": "CA",
                "phoneCode": "+1",
                "orderStatus": 2,
                "packageId": 9,
            }
        ]

    def get_phone_order_detail(self, order_no: str):
        return []

    def get_phone_sms(self, order_id: str, phone_number: str):
        return {
            "noteList": [
                {
                    "id": 7,
                    "caller": "Example",
                    "callee": phone_number,
                    "content": "Your verification code is 438921",
                    "sendTime": "2026-08-01T10:00:00Z",
                }
            ]
        }


class MultiAccountFakeClient:
    ORDERS = {
        "token-primary-test": {
            "id": 101,
            "orderNo": "ORDER-PRIMARY",
            "phoneNumber": "+15550000001",
            "countryCode": "CA",
            "phoneCode": "+1",
            "orderStatus": 2,
            "packageId": 11,
        },
        "token-secondary-test": {
            "id": 202,
            "orderNo": "ORDER-SECONDARY",
            "phoneNumber": "+15550000002",
            "countryCode": "US",
            "phoneCode": "+1",
            "orderStatus": 2,
            "packageId": 22,
        },
    }

    def __init__(self, token: str, *args, **kwargs) -> None:
        self.token = token

    def list_phone_orders(self, *, status: int, page: int = 1, size: int = 50, phone: str = ""):
        if status != 2:
            return []
        order = self.ORDERS[self.token]
        return [order] if not phone or order["phoneNumber"] == phone else []

    def get_phone_order_detail(self, order_no: str):
        return [order for order in self.ORDERS.values() if order["orderNo"] == order_no]

    def get_phone_sms(self, order_id: str, phone_number: str):
        primary = self.token == "token-primary-test"
        code = "111111" if primary else "222222"
        return {
            "noteList": [
                {
                    "id": order_id,
                    "caller": "Primary" if primary else "Secondary",
                    "callee": phone_number,
                    "content": f"Your verification code is {code}",
                    "sendTime": "2026-08-01T10:00:00Z",
                }
            ]
        }


class PartialFailureFakeClient(MultiAccountFakeClient):
    def list_phone_orders(self, *, status: int, page: int = 1, size: int = 50, phone: str = ""):
        if self.token == "token-secondary-test":
            raise api_module.KitesimAuthError("fake expired token")
        return super().list_phone_orders(status=status, page=page, size=size, phone=phone)


class ManyOrdersFakeClient(MultiAccountFakeClient):
    def list_phone_orders(self, *, status: int, page: int = 1, size: int = 50, phone: str = ""):
        if self.token != "token-primary-test":
            return super().list_phone_orders(status=status, page=page, size=size, phone=phone)
        return [
            {
                **self.ORDERS["token-primary-test"],
                "id": 1_000 + index,
                "orderNo": f"ORDER-PRIMARY-{index}",
            }
            for index in range(25)
        ] if status == 2 else []


class UnexpectedFailureFakeClient(MultiAccountFakeClient):
    def list_phone_orders(self, *, status: int, page: int = 1, size: int = 50, phone: str = ""):
        if self.token == "token-secondary-test":
            raise RuntimeError("fake programmer error")
        return super().list_phone_orders(status=status, page=page, size=size, phone=phone)


class MessageAuthFailureFakeClient(FakeKitesimClient):
    def get_phone_sms(self, order_id: str, phone_number: str):
        raise api_module.KitesimAuthError("upstream echoed fake-secret-token")


class ManyMessagesFakeClient(FakeKitesimClient):
    def get_phone_sms(self, order_id: str, phone_number: str):
        return {
            "noteList": [
                {
                    "id": index,
                    "caller": "Example",
                    "callee": phone_number,
                    "content": f"Your verification code is {100000 + index}",
                    "sendTime": f"2026-08-01T10:{index:02d}:00Z",
                }
                for index in range(25)
            ]
        }


def two_accounts() -> list[dict[str, str]]:
    return [
        {"accountId": "login_1", "label": "主号码", "token": "token-primary-test"},
        {"accountId": "login_2", "label": "备用号码", "token": "token-secondary-test"},
    ]


def create_test_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(api_module.create_api_blueprint(), url_prefix="/api")
    return app


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {
                "DASHBOARD_ACCESS_KEY": ACCESS_KEY,
                "KITESIM_AUTH_BRIDGE_SECRET": BRIDGE_SECRET,
            },
            clear=False,
        )
        self.environment.start()
        self.client_patch = patch.object(api_module, "KitesimClient", FakeKitesimClient)
        self.client_patch.start()
        self.client = create_test_app().test_client()

    def tearDown(self) -> None:
        self.client_patch.stop()
        self.environment.stop()

    def test_health_is_public_and_non_cacheable(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["authConfigured"])
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_session_rejects_wrong_access_key(self) -> None:
        response = self.client.post("/api/session", headers={"Authorization": "Bearer wrong-key-123"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["kind"], "dashboard_auth")

    def test_session_accepts_configured_access_key(self) -> None:
        response = self.client.post("/api/session", headers=AUTH_HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["scope"], "read-only")

    def test_orders_requires_dashboard_authentication(self) -> None:
        response = self.client.get("/api/orders?status=2")
        self.assertEqual(response.status_code, 401)

    def test_orders_requires_the_signed_managed_account_bridge(self) -> None:
        response = self.client.get(
            "/api/orders?status=2",
            headers={"Authorization": f"Bearer {ACCESS_KEY}"},
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["kind"], "configuration")

    def test_orders_returns_compact_records_with_a_stable_login_id(self) -> None:
        response = self.client.get("/api/orders?status=2", headers=AUTH_HEADERS)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["items"][0]["statusLabel"], "使用中")
        self.assertEqual(payload["items"][0]["accountId"], "login_1")
        self.assertNotIn(DEFAULT_ACCOUNTS[0]["token"], response.get_data(as_text=True))

    def test_orders_origin_alias_preserves_the_protected_python_endpoint(self) -> None:
        response = self.client.get("/api/orders-origin?status=2", headers=AUTH_HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["items"][0]["phoneNumber"], "+15551234567")
        self.assertEqual(response.headers["Cache-Control"], "no-store, max-age=0")

    def test_invalid_managed_account_signature_is_rejected_before_upstream_access(self) -> None:
        with patch.object(api_module, "KitesimClient") as client_class:
            response = self.client.get(
                "/api/orders-origin?status=2",
                headers=managed_headers(signature="0" * 64),
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["kind"], "configuration")
        client_class.assert_not_called()

    def test_orders_aggregates_multiple_managed_accounts_without_exposing_tokens(self) -> None:
        accounts = two_accounts()
        with patch.object(api_module, "KitesimClient", MultiAccountFakeClient):
            response = self.client.get(
                "/api/orders?status=2&limit=20",
                headers=managed_headers(accounts),
            )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["accountCount"], 2)
        self.assertEqual([item["accountLabel"] for item in payload["items"]], ["主号码", "备用号码"])
        self.assertEqual([item["accountId"] for item in payload["items"]], ["login_1", "login_2"])
        serialized = response.get_data(as_text=True)
        self.assertNotIn("token-primary-test", serialized)
        self.assertNotIn("token-secondary-test", serialized)

    def test_messages_routes_to_the_selected_managed_account(self) -> None:
        accounts = two_accounts()
        headers = managed_headers(accounts)
        with patch.object(api_module, "KitesimClient", MultiAccountFakeClient):
            orders_response = self.client.get("/api/orders?status=2&limit=20", headers=headers)
            secondary = orders_response.get_json()["items"][1]
            response = self.client.post(
                "/api/messages",
                headers=headers,
                json={
                    "accountId": secondary["accountId"],
                    "messageHandle": secondary["messageHandle"],
                    "orderId": secondary["id"],
                    "phoneNumber": secondary["phoneNumber"],
                    "revealCode": True,
                    "showSms": True,
                },
            )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["accountId"], "login_2")
        self.assertEqual(payload["items"][0]["sender"], "Secondary")
        self.assertEqual(payload["items"][0]["code"], ["222222"])

    def test_messages_reject_account_and_handle_mismatch(self) -> None:
        accounts = two_accounts()
        headers = managed_headers(accounts)
        with patch.object(api_module, "KitesimClient", MultiAccountFakeClient):
            orders_response = self.client.get("/api/orders?status=2&limit=20", headers=headers)
            primary, secondary = orders_response.get_json()["items"]
            response = self.client.post(
                "/api/messages",
                headers=headers,
                json={
                    "accountId": secondary["accountId"],
                    "messageHandle": primary["messageHandle"],
                    "orderId": primary["id"],
                    "phoneNumber": primary["phoneNumber"],
                },
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")

    def test_orders_return_healthy_accounts_when_one_login_has_expired(self) -> None:
        with patch.object(api_module, "KitesimClient", PartialFailureFakeClient):
            response = self.client.get(
                "/api/orders?status=2&limit=20",
                headers=managed_headers(two_accounts()),
            )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["partial"])
        self.assertEqual(payload["failedAccountCount"], 1)
        self.assertEqual(payload["warnings"][0]["accountLabel"], "备用号码")
        self.assertNotIn("fake expired token", response.get_data(as_text=True))

    def test_order_limit_keeps_results_from_both_accounts(self) -> None:
        with patch.object(api_module, "KitesimClient", ManyOrdersFakeClient):
            response = self.client.get(
                "/api/orders?status=2&limit=20",
                headers=managed_headers(two_accounts()),
            )
        self.assertEqual({item["accountId"] for item in response.get_json()["items"]}, {"login_1", "login_2"})

    def test_unexpected_account_worker_error_is_not_partial_success(self) -> None:
        with patch.object(api_module, "KitesimClient", UnexpectedFailureFakeClient):
            response = self.client.get(
                "/api/orders?status=2&limit=20",
                headers=managed_headers(two_accounts()),
            )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["kind"], "server")

    def test_all_status_query_limits_account_fanout(self) -> None:
        accounts = [
            {
                "accountId": f"login_{index}",
                "label": f"账户 {index}",
                "token": f"fanout-test-token-{index:02d}",
            }
            for index in range(1, 10)
        ]
        response = self.client.get(
            "/api/orders?status=all&limit=20",
            headers=managed_headers(accounts),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("8", response.get_json()["error"])

    def test_messages_require_account_and_handle_for_multiple_accounts(self) -> None:
        headers = managed_headers(two_accounts())
        response = self.client.post(
            "/api/messages",
            headers=headers,
            json={"orderId": 101, "phoneNumber": "+15550000001"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")

    def test_upstream_message_errors_are_redacted(self) -> None:
        with patch.object(api_module, "KitesimClient", MessageAuthFailureFakeClient):
            response = self.client.post(
                "/api/messages",
                headers=AUTH_HEADERS,
                json={"orderId": 42, "phoneNumber": "+15551234567"},
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["kind"], "upstream_auth")
        self.assertNotIn("fake-secret-token", response.get_data(as_text=True))

    def test_messages_mask_and_reveal_only_when_explicit(self) -> None:
        masked = self.client.post(
            "/api/messages",
            headers=AUTH_HEADERS,
            json={"orderId": 42, "phoneNumber": "+15551234567"},
        ).get_json()
        visible = self.client.post(
            "/api/messages",
            headers=AUTH_HEADERS,
            json={
                "orderId": 42,
                "phoneNumber": "+15551234567",
                "revealCode": True,
                "showSms": True,
            },
        ).get_json()
        self.assertEqual(masked["items"][0]["code"], ["4****1"])
        self.assertNotIn("438921", masked["items"][0]["content"])
        self.assertEqual(visible["items"][0]["code"], ["438921"])
        self.assertIn("438921", visible["items"][0]["content"])

    def test_messages_origin_builds_one_full_blob_snapshot(self) -> None:
        response = self.client.post(
            "/api/messages-origin",
            headers=AUTH_HEADERS,
            json={
                "orderId": 42,
                "phoneNumber": "+15551234567",
                "cacheSnapshot": True,
            },
        )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("variants", payload)
        self.assertEqual(payload["items"][0]["code"], ["438921"])

    def test_messages_origin_does_not_silently_truncate_history_at_twenty(self) -> None:
        with patch.object(api_module, "KitesimClient", ManyMessagesFakeClient):
            response = self.client.post(
                "/api/messages-origin",
                headers=AUTH_HEADERS,
                json={
                    "orderId": 42,
                    "phoneNumber": "+15551234567",
                    "cacheSnapshot": True,
                },
            )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["count"], 25)
        self.assertEqual(payload["totalCount"], 25)
        self.assertFalse(payload["hasMore"])
        self.assertEqual(len(payload["items"]), 25)

    def test_messages_validates_input(self) -> None:
        response = self.client.post(
            "/api/messages",
            headers=AUTH_HEADERS,
            json={"orderId": "", "phoneNumber": "bad"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")


if __name__ == "__main__":
    unittest.main()
