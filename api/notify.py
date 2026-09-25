"""Fire-and-forget hook that tells the Telegram bot about a new RSVP.

Import this from `api/main.py` and call `notify_rsvp(...)` right after the
RSVP row is committed. Every failure mode — bot offline, wrong secret, DNS
down, slow network — is swallowed here on purpose: a guest's RSVP must never
fail because a side-channel notification did.

Wire-up in api/main.py (inside `submit_rsvp`, after the commit, before the
return)::

    from .notify import notify_rsvp   # top of the file

    notify_rsvp({"name": data.name, "attending": data.attending,
                 "guests": data.guests, "phone": data.phone,
                 "message": data.message, "side": ""})

Environment:
    NOTIFY_URL      Full URL of the bot's endpoint, e.g.
                    http://localhost:8787/notify/rsvp
                    (unset → notifications are silently disabled)
    NOTIFY_SECRET   Shared secret sent as the X-Notify-Secret header; must
                    match the value the Telegram service runs with.
    NOTIFY_TIMEOUT  Seconds to wait before giving up (default 3).
"""

from typing import Any, Dict
import os
import threading

try:
    import httpx
except ImportError:  # pragma: no cover - httpx is in requirements.txt
    httpx = None


NOTIFY_TIMEOUT = float(os.environ.get("NOTIFY_TIMEOUT", "3"))


def _post(url: str, secret: str, payload: Dict[str, Any]) -> None:
    """Do the actual POST. Runs on a throwaway thread; never raises."""
    try:
        httpx.post(
            url,
            json=payload,
            headers={"X-Notify-Secret": secret},
            timeout=NOTIFY_TIMEOUT,
        )
    except Exception:
        # Deliberately silent: the RSVP is already saved, and a noisy
        # traceback in the request log helps nobody.
        pass


def notify_rsvp(payload: Dict[str, Any]) -> None:
    """Tell the Telegram bot about an RSVP. Returns immediately.

    The request is handed to a daemon thread so the caller is never blocked by
    the network round trip — even the 3-second timeout is paid off-request.
    Serverless hosts may freeze the instance before the thread finishes; that
    is an accepted trade-off for never delaying the guest's response.

    payload keys: name, attending, guests, phone, side, message, updated.
    """
    url = os.environ.get("NOTIFY_URL", "").strip()
    secret = os.environ.get("NOTIFY_SECRET", "").strip()
    if not url or not secret or httpx is None:
        return

    try:
        body = {
            "name": payload.get("name", ""),
            "attending": bool(payload.get("attending")),
            "guests": int(payload.get("guests") or 1),
            "phone": payload.get("phone", "") or "",
            "side": payload.get("side", "") or "",
            "message": payload.get("message", "") or "",
            # A personal link re-submitted: an edit, not one more RSVP.
            "updated": bool(payload.get("updated")),
        }
        if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            # A serverless instance is frozen the moment the response goes out,
            # and a background thread is frozen with it — the message would
            # simply never be sent. Pay the round trip in-request instead; the
            # target is a function in this same deployment, so it is quick.
            _post(url, secret, body)
        else:
            threading.Thread(
                target=_post,
                args=(url, secret, body),
                daemon=True,
            ).start()
    except Exception:
        pass
