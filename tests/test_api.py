from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "cloud-functions"))

from _shared import api as api_module


ACCESS_KEY = "test-access-key-12345"
AUTH_HEADERS = {"Authorization": f"Bearer {ACCESS_KEY}"}


class FakeKitesimClient:
    def __init__(self, *args, **kwargs) -> None:
        pass

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
        code = "111111" if self.token == "token-primary-test" else "222222"
        return {
            "noteList": [
                {
                    "id": order_id,
                    "caller": "Primary" if self.token == "token-primary-test" else "Secondary",
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
        if status != 2:
            return []
        return [
            {
                **self.ORDERS["token-primary-test"],
                "id": 1_000 + index,
                "orderNo": f"ORDER-PRIMARY-{index}",
            }
            for index in range(25)
        ]


class UnexpectedFailureFakeClient(MultiAccountFakeClient):
    def list_phone_orders(self, *, status: int, page: int = 1, size: int = 50, phone: str = ""):
        if self.token == "token-secondary-test":
            raise RuntimeError("fake programmer error")
        return super().list_phone_orders(status=status, page=page, size=size, phone=phone)


class MessageAuthFailureFakeClient(FakeKitesimClient):
    def get_phone_sms(self, order_id: str, phone_number: str):
        raise api_module.KitesimAuthError("upstream echoed fake-secret-token")


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
                "KITESIM_TOKEN": "fake-kitesim-token",
                "KITESIM_TOKENS": "",
                **{f"KITESIM_TOKEN_{index}": "" for index in range(1, 21)},
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

    def test_orders_requires_authentication(self) -> None:
        response = self.client.get("/api/orders?status=2")
        self.assertEqual(response.status_code, 401)

    def test_orders_returns_compact_records(self) -> None:
        response = self.client.get("/api/orders?status=2", headers=AUTH_HEADERS)
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["items"][0]["statusLabel"], "使用中")

    def test_orders_origin_alias_preserves_the_protected_python_endpoint(self) -> None:
        response = self.client.get("/api/orders-origin?status=2", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["items"][0]["phoneNumber"], "+15551234567")
        self.assertEqual(response.headers["Cache-Control"], "no-store, max-age=0")

    def test_orders_aggregates_multiple_token_accounts_without_exposing_tokens(self) -> None:
        configured_tokens = (
            '[{"name":"主号码","token":"token-primary-test"},'
            '{"name":"备用号码","token":"token-secondary-test"}]'
        )
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["accountCount"], 2)
        self.assertEqual(payload["failedAccountCount"], 0)
        self.assertEqual(
            [item["accountLabel"] for item in payload["items"]],
            ["主号码", "备用号码"],
        )
        self.assertTrue(all(item["accountId"].startswith("acct_") for item in payload["items"]))
        serialized = response.get_data(as_text=True)
        self.assertNotIn("token-primary-test", serialized)
        self.assertNotIn("token-secondary-test", serialized)

    def test_messages_routes_to_the_selected_token_account(self) -> None:
        configured_tokens = (
            '[{"name":"主号码","token":"token-primary-test"},'
            '{"name":"备用号码","token":"token-secondary-test"}]'
        )
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            orders_response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)
            secondary = next(
                item for item in orders_response.get_json()["items"] if item["accountLabel"] == "备用号码"
            )
            response = self.client.post(
                "/api/messages",
                headers={**AUTH_HEADERS, "Content-Type": "application/json"},
                json={
                    "accountId": secondary["accountId"],
                    "messageHandle": secondary["messageHandle"],
                    "orderId": secondary["id"],
                    "phoneNumber": secondary["phoneNumber"],
                    "revealCode": True,
                    "showSms": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["accountId"], secondary["accountId"])
        self.assertEqual(payload["items"][0]["sender"], "Secondary")
        self.assertEqual(payload["items"][0]["code"], ["222222"])
        self.assertNotIn("token-secondary-test", response.get_data(as_text=True))

    def test_messages_reject_account_number_and_handle_mismatch(self) -> None:
        configured_tokens = "token-primary-test,token-secondary-test"
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            orders_response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)
            primary, secondary = orders_response.get_json()["items"]
            response = self.client.post(
                "/api/messages",
                headers={**AUTH_HEADERS, "Content-Type": "application/json"},
                json={
                    "accountId": secondary["accountId"],
                    "messageHandle": primary["messageHandle"],
                    "orderId": primary["id"],
                    "phoneNumber": primary["phoneNumber"],
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")

    def test_orders_return_healthy_accounts_when_one_token_fails(self) -> None:
        configured_tokens = (
            '[{"name":"主号码","token":"token-primary-test"},'
            '{"name":"失效账户","token":"token-secondary-test"}]'
        )
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", PartialFailureFakeClient),
        ):
            response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["count"], 1)
        self.assertTrue(payload["partial"])
        self.assertEqual(payload["failedAccountCount"], 1)
        self.assertEqual(payload["warnings"][0]["accountLabel"], "失效账户")
        self.assertEqual(payload["warnings"][0]["kind"], "upstream_auth")
        self.assertNotIn("fake expired token", response.get_data(as_text=True))

    def test_multi_token_delimited_format_merges_and_deduplicates_legacy_token(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "KITESIM_TOKEN": "token-primary-test",
                    "KITESIM_TOKENS": "token-primary-test, token-secondary-test",
                },
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["accountCount"], 2)
        self.assertEqual([item["accountLabel"] for item in payload["items"]], ["账户 1", "账户 2"])

    def test_indexed_edgeone_token_variables_are_aggregated(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "KITESIM_TOKEN": "",
                    "KITESIM_TOKENS": "",
                    "KITESIM_TOKEN_1": "token-primary-test",
                    "KITESIM_TOKEN_NAME_1": "主号码",
                    "KITESIM_TOKEN_2": "token-secondary-test",
                    "KITESIM_TOKEN_NAME_2": "备用号码",
                },
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["accountCount"], 2)
        self.assertEqual([item["accountLabel"] for item in payload["items"]], ["主号码", "备用号码"])

    def test_order_limit_keeps_at_least_one_result_from_each_account(self) -> None:
        configured_tokens = "token-primary-test,token-secondary-test"
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", ManyOrdersFakeClient),
        ):
            response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200)
        labels = {item["accountLabel"] for item in response.get_json()["items"]}
        self.assertEqual(labels, {"账户 1", "账户 2"})

    def test_unexpected_account_worker_error_is_not_reported_as_partial_success(self) -> None:
        configured_tokens = "token-primary-test,token-secondary-test"
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", UnexpectedFailureFakeClient),
        ):
            response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["kind"], "server")

    def test_invalid_multi_token_json_returns_configuration_error(self) -> None:
        with patch.dict(
            os.environ,
            {"KITESIM_TOKEN": "", "KITESIM_TOKENS": '[{"name":"broken"'},
            clear=False,
        ):
            response = self.client.get("/api/orders?status=2", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["kind"], "configuration")

    def test_multi_token_single_variable_respects_edgeone_size_limit(self) -> None:
        oversized_value = ",".join(f"token-{index:04d}-placeholder" for index in range(30))
        self.assertGreater(len(oversized_value.encode("utf-8")), 500)
        with patch.dict(
            os.environ,
            {"KITESIM_TOKEN": "", "KITESIM_TOKENS": oversized_value},
            clear=False,
        ):
            response = self.client.get("/api/orders?status=2", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["kind"], "configuration")
        self.assertIn("500", response.get_json()["error"])

    def test_all_status_query_limits_account_fanout(self) -> None:
        indexed_tokens = {
            f"KITESIM_TOKEN_{index}": f"fanout-test-token-{index}"
            for index in range(1, 10)
        }
        with patch.dict(
            os.environ,
            {"KITESIM_TOKEN": "", "KITESIM_TOKENS": "", **indexed_tokens},
            clear=False,
        ):
            response = self.client.get("/api/orders?status=all&limit=20", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")
        self.assertIn("8", response.get_json()["error"])

    def test_messages_require_account_id_when_multiple_tokens_are_configured(self) -> None:
        configured_tokens = "token-primary-test,token-secondary-test"
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            response = self.client.post(
                "/api/messages",
                headers={**AUTH_HEADERS, "Content-Type": "application/json"},
                json={"orderId": 101, "phoneNumber": "+15550000001"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")

    def test_messages_require_signed_handle_when_multiple_tokens_are_configured(self) -> None:
        configured_tokens = "token-primary-test,token-secondary-test"
        with (
            patch.dict(
                os.environ,
                {"KITESIM_TOKEN": "", "KITESIM_TOKENS": configured_tokens},
                clear=False,
            ),
            patch.object(api_module, "KitesimClient", MultiAccountFakeClient),
        ):
            orders_response = self.client.get("/api/orders?status=2&limit=20", headers=AUTH_HEADERS)
            primary = orders_response.get_json()["items"][0]
            response = self.client.post(
                "/api/messages",
                headers={**AUTH_HEADERS, "Content-Type": "application/json"},
                json={
                    "accountId": primary["accountId"],
                    "orderId": primary["id"],
                    "phoneNumber": primary["phoneNumber"],
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")

    def test_upstream_message_errors_are_redacted(self) -> None:
        with patch.object(api_module, "KitesimClient", MessageAuthFailureFakeClient):
            response = self.client.post(
                "/api/messages",
                headers={**AUTH_HEADERS, "Content-Type": "application/json"},
                json={"orderId": 42, "phoneNumber": "+15551234567"},
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["kind"], "upstream_auth")
        self.assertNotIn("fake-secret-token", response.get_data(as_text=True))

    def test_messages_masks_code_by_default(self) -> None:
        response = self.client.post(
            "/api/messages",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
            json={"orderId": 42, "phoneNumber": "+15551234567"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["items"][0]["code"], ["4****1"])
        self.assertEqual(payload["items"][0]["content"], "Your verification code is ******")

    def test_messages_reveals_only_when_explicit(self) -> None:
        response = self.client.post(
            "/api/messages",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
            json={
                "orderId": 42,
                "phoneNumber": "+15551234567",
                "revealCode": True,
                "showSms": True,
            },
        )
        payload = response.get_json()
        self.assertEqual(payload["items"][0]["code"], ["438921"])
        self.assertIn("438921", payload["items"][0]["content"])

    def test_messages_origin_alias_preserves_the_protected_python_endpoint(self) -> None:
        response = self.client.post(
            "/api/messages-origin",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
            json={"orderId": 42, "phoneNumber": "+15551234567"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["items"][0]["code"], ["4****1"])
        self.assertEqual(response.headers["Cache-Control"], "no-store, max-age=0")

    def test_messages_origin_builds_one_full_blob_snapshot_from_one_sms_read(self) -> None:
        response = self.client.post(
            "/api/messages-origin",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
            json={
                "orderId": 42,
                "phoneNumber": "+15551234567",
                "cacheSnapshot": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertNotIn("variants", payload)
        self.assertEqual(payload["items"][0]["code"], ["438921"])
        self.assertIn("438921", payload["items"][0]["content"])

    def test_messages_validates_input(self) -> None:
        response = self.client.post(
            "/api/messages",
            headers={**AUTH_HEADERS, "Content-Type": "application/json"},
            json={"orderId": "", "phoneNumber": "bad"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["kind"], "validation")


if __name__ == "__main__":
    unittest.main()
