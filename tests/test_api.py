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


def create_test_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(api_module.create_api_blueprint(), url_prefix="/api")
    return app


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {"DASHBOARD_ACCESS_KEY": ACCESS_KEY, "KITESIM_TOKEN": "fake-kitesim-token"},
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
