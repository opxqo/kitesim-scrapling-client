#!/usr/bin/env python3
"""Local server that mirrors the EdgeOne static + Cloud Functions layout."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from flask import Flask, Response, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
CLOUD_FUNCTIONS_ROOT = BASE_DIR / "cloud-functions"
if str(CLOUD_FUNCTIONS_ROOT) not in sys.path:
    sys.path.insert(0, str(CLOUD_FUNCTIONS_ROOT))

from _shared.api import create_api_blueprint  # noqa: E402


app = Flask(__name__, static_folder=str(BASE_DIR / "static"), static_url_path="/static")
app.register_blueprint(create_api_blueprint(), url_prefix="/api")


@app.get("/")
def index() -> Response:
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/favicon.svg")
def favicon() -> Response:
    return send_from_directory(BASE_DIR, "favicon.svg")


@app.after_request
def secure_site_response(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; "
        "script-src 'self'; style-src 'self'; font-src 'self'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    )
    if request.path.startswith("/static/") or request.path == "/favicon.svg":
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    elif not request.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


if __name__ == "__main__":
    port = int(os.getenv("KITESIM_WEB_PORT", "8765"))
    app.run(host="127.0.0.1", port=port, debug=False)
