"""EdgeOne Makers Flask origin mounted under the /origin route prefix."""

from __future__ import annotations

import sys
from pathlib import Path

from flask import Flask


CLOUD_FUNCTIONS_ROOT = Path(__file__).resolve().parents[1]
if str(CLOUD_FUNCTIONS_ROOT) not in sys.path:
    sys.path.insert(0, str(CLOUD_FUNCTIONS_ROOT))

from _shared.api import create_api_blueprint  # noqa: E402


app = Flask(__name__)
app.register_blueprint(create_api_blueprint())
