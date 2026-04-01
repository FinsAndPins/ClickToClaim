#!/usr/bin/env python3
import base64
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests


ROOT = Path(__file__).resolve().parent
PINS_DIR = ROOT / "pins"
KEYS_PATH = Path("/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Minimal folder for Claude/ebay_keys.json")

TOKEN_CACHE = {"value": "", "expires_at": 0}


def get_access_token():
    now = time.time()
    if TOKEN_CACHE["value"] and now < TOKEN_CACHE["expires_at"] - 120:
        return TOKEN_CACHE["value"]

    keys = json.loads(KEYS_PATH.read_text(encoding="utf-8"))
    creds = base64.b64encode(f"{keys['client_id']}:{keys['client_secret']}".encode()).decode()
    resp = requests.post(
        "https://api.ebay.com/identity/v1/oauth2/token",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {creds}",
        },
        data={
            "grant_type": "client_credentials",
            "scope": "https://api.ebay.com/oauth/api_scope",
        },
        timeout=20,
    )
    resp.raise_for_status()
    payload = resp.json()
    token = payload["access_token"]
    expires_in = int(payload.get("expires_in", 7200))
    TOKEN_CACHE["value"] = token
    TOKEN_CACHE["expires_at"] = now + expires_in
    return token


def ebay_visual_search(filename: str, limit: int = 50):
    image_path = PINS_DIR / filename
    if not image_path.exists():
        return {"items": [], "error": f"Missing local pin image: {filename}"}

    token = get_access_token()
    image_b64 = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    url = f"https://api.ebay.com/buy/browse/v1/item_summary/search_by_image?limit={max(5, min(limit, 100))}"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        json={"image": image_b64},
        timeout=45,
    )
    if resp.status_code != 200:
        return {"items": [], "error": f"eBay visual search failed ({resp.status_code})", "raw": resp.text[:300]}

    data = resp.json()
    out = []
    for it in data.get("itemSummaries", []):
        out.append(
            {
                "filename": it.get("itemId", ""),
                "title": it.get("title", ""),
                "price": (it.get("price") or {}).get("value"),
                "thumb": ((it.get("image") or {}).get("imageUrl")) or "",
                "source": it.get("itemWebUrl", ""),
            }
        )
    return {"items": out}


def ebay_keyword_search(query: str, limit: int = 50):
    token = get_access_token()
    q = query.strip()
    if not q:
        return {"items": []}

    url = "https://api.ebay.com/buy/browse/v1/item_summary/search"
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        params={"q": q, "limit": max(5, min(limit, 100))},
        timeout=30,
    )
    if resp.status_code != 200:
        return {"items": [], "error": f"eBay keyword search failed ({resp.status_code})", "raw": resp.text[:300]}

    data = resp.json()
    out = []
    for it in data.get("itemSummaries", []):
        out.append(
            {
                "filename": it.get("itemId", ""),
                "title": it.get("title", ""),
                "price": (it.get("price") or {}).get("value"),
                "thumb": ((it.get("image") or {}).get("imageUrl")) or "",
                "source": it.get("itemWebUrl", ""),
            }
        )
    return {"items": out}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload, code=200):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self._send_json({"ok": True}, 200)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._send_json({"ok": True})
        if parsed.path == "/visual_search":
            qs = parse_qs(parsed.query)
            filename = (qs.get("filename", [""])[0]).strip()
            limit = int((qs.get("limit", ["50"])[0] or "50"))
            return self._send_json(ebay_visual_search(filename, limit))
        if parsed.path == "/keyword_search":
            qs = parse_qs(parsed.query)
            query = (qs.get("q", [""])[0]).strip()
            limit = int((qs.get("limit", ["50"])[0] or "50"))
            return self._send_json(ebay_keyword_search(query, limit))
        return self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length > 0 else b"{}"
        payload = json.loads(body.decode("utf-8") or "{}")
        if parsed.path == "/visual_search":
            filename = (payload.get("filename") or "").strip()
            limit = int(payload.get("limit", 50) or 50)
            return self._send_json(ebay_visual_search(filename, limit))
        if parsed.path == "/keyword_search":
            query = (payload.get("q") or "").strip()
            limit = int(payload.get("limit", 50) or 50)
            return self._send_json(ebay_keyword_search(query, limit))
        return self._send_json({"error": "Not found"}, 404)


def main():
    port = 8091
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"eBay proxy listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
