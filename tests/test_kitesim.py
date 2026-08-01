from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "cloud-functions"))

from _shared import kitesim as kitesim_module
from _shared.kitesim import KitesimClient, build_messages, extract_codes, mask_code, mask_message


class KitesimCoreTests(unittest.TestCase):
    def test_extracts_chinese_and_english_codes(self) -> None:
        self.assertEqual(extract_codes("你的验证码为 438921，五分钟内有效"), ["438921"])
        self.assertEqual(extract_codes("Your verification code: 7788"), ["7788"])

    def test_does_not_treat_unlabelled_number_as_code(self) -> None:
        self.assertEqual(extract_codes("Order 123456 has been completed"), [])

    def test_mask_helpers(self) -> None:
        self.assertEqual(mask_code("438921"), "4****1")
        self.assertEqual(mask_message("code 438921, phone 15551234567"), "code ******, phone ***********")

    def test_build_messages_is_masked_by_default(self) -> None:
        result = build_messages(
            {"noteList": [{"id": 1, "caller": "Service", "content": "验证码 438921", "sendTime": "2026-08-01T10:00:00Z"}]},
            show_code=False,
            show_sms=False,
        )
        self.assertEqual(result[0]["code"], ["4****1"])
        self.assertEqual(result[0]["content"], "验证码 ******")

    def test_client_keeps_at_least_one_request_attempt(self) -> None:
        client = KitesimClient("fake-token", retries=0)
        self.assertEqual(client.retries, 1)

    def test_dashboard_status_is_mapped_to_kitesim_filter_status(self) -> None:
        response = SimpleNamespace(
            status=200,
            reason="OK",
            body=b'{"code":200,"data":{"records":[]}}',
        )
        expected = {0: 2, 1: 3, 2: 1, 3: 0, 4: 4}
        client = KitesimClient("fake-token")

        with patch.object(kitesim_module.Fetcher, "get", return_value=response) as fetch:
            for dashboard_status, upstream_status in expected.items():
                with self.subTest(dashboard_status=dashboard_status):
                    client.list_phone_orders(status=dashboard_status)
                    self.assertEqual(fetch.call_args.kwargs["params"]["status"], upstream_status)


if __name__ == "__main__":
    unittest.main()
