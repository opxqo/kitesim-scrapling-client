#!/usr/bin/env python3
"""Local server that mirrors the EdgeOne static + Cloud Functions layout."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from flask import Flask, Response, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
CLOUD_FUNCTIONS_ROOT = BASE_DIR / "cloud-functions"
if str(CLOUD_FUNCTIONS_ROOT) not in sys.path:
    sys.path.insert(0, str(CLOUD_FUNCTIONS_ROOT))

from _shared.api import create_api_blueprint  # noqa: E402


app = Flask(__name__, static_folder=None)
app.register_blueprint(create_api_blueprint(), url_prefix="/api")


@app.get("/")
def index() -> Response:
    if not (DIST_DIR / "index.html").is_file():
        return Response(
            "前端尚未构建，请先运行 npm ci && npm run build。",
            status=503,
            content_type="text/plain; charset=utf-8",
        )
    return send_from_directory(DIST_DIR, "index.html")


@app.get("/assets/<path:filename>")
def frontend_asset(filename: str) -> Response:
    return send_from_directory(DIST_DIR / "assets", filename)


@app.get("/favicon.svg")
def favicon() -> Response:
    return send_from_directory(DIST_DIR, "favicon.svg")


@app.after_request
def secure_site_response(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    # Radix/shadcn primitives use runtime style attributes for positioning and progress values.
    # Scripts remain restricted to same-origin assets; only inline styles are allowed here.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; "
        "script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    )
    if request.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif request.path == "/favicon.svg":
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    elif not request.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


if __name__ == "__main__":
    port = int(os.getenv("KITESIM_WEB_PORT", "8765"))
    app.run(host="127.0.0.1", port=port, debug=False)
