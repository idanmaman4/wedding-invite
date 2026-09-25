"""Integration tests: the seams between the API and the services around it.

`test_api.py` covers each endpoint on its own. This file covers the journeys
that cross endpoints — a guest's whole path from invitation to confirmed seat —
and the two outbound bridges (the Telegram notify hook and the WhatsApp
microservice), each against a real local HTTP server rather than a mock object.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from conftest import ADMIN, make_invite


# ── A throwaway HTTP server standing in for a side service ───────────────────

class _Recorder(BaseHTTPRequestHandler):
    """Records every request; answers with whatever the test configured."""

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        self.server.received.append(
            {
                "method": self.command,
                "path": self.path,
                "headers": dict(self.headers),
                "body": json.loads(raw) if raw else None,
            }
        )
        status, payload = self.server.reply
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = _handle
    do_POST = _handle

    def log_message(self, *args):  # keep the test output clean
        pass


@pytest.fixture()
def side_service():
    """A local stand-in for the Telegram bot / WhatsApp service."""
    server = HTTPServer(("127.0.0.1", 0), _Recorder)
    server.received = []
    server.reply = (200, {"ok": True})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.url = f"http://127.0.0.1:{server.server_port}"
    yield server
    server.shutdown()
    server.server_close()


def wait_for(predicate, timeout=3.0):
    """Poll until `predicate()` is true — the notify hook runs on a thread."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


# ── The guest's whole journey ────────────────────────────────────────────────

def test_a_guest_goes_from_invitation_to_a_counted_seat(client):
    """Create an invite, open it, answer it, and see the totals move."""
    invite = make_invite(client, name="דנה כהן", side="vered", phone="0501234567")
    token = invite["token"]

    before = client.get("/api/stats", headers=ADMIN).json()
    assert before["invites"] == 1
    assert before["responses"] == 0
    assert before["not_responded"] == 1
    assert before["total_people"] == 0

    # The guest opens their personal link: the form is prefilled, unanswered.
    prefill = client.get(f"/api/invite/{token}")
    assert prefill.status_code == 200
    assert prefill.json()["name"] == "דנה כהן"
    assert prefill.json()["responded"] is False

    # They answer for four people.
    rsvp = client.post(
        "/api/rsvp",
        json={
            "name": "דנה כהן",
            "attending": True,
            "guests": 4,
            "phone": "0501234567",
            "message": "מחכים!",
            "invite_token": token,
        },
    )
    assert rsvp.status_code == 200, rsvp.text

    after = client.get("/api/stats", headers=ADMIN).json()
    assert after["invites"] == 1, "answering must not create a second invitation"
    assert after["responses"] == 1
    assert after["not_responded"] == 0
    assert after["total_people"] == 4
    assert after["by_side"]["vered"]["total_people"] == 4

    # The couple sees them in the guest list, and the invite is marked answered.
    guests = client.get("/api/guests", headers=ADMIN).json()
    assert [g["name"] for g in guests] == ["דנה כהן"]
    assert guests[0]["guests"] == 4

    invites = client.get("/api/invites", headers=ADMIN).json()
    assert invites[0]["responded"] is True
    assert invites[0]["attending"] is True
    assert invites[0]["guests"] == 4

    # Re-opening the link now shows their answer back to them.
    again = client.get(f"/api/invite/{token}").json()
    assert again["responded"] is True
    assert again["guests"] == 4


def test_a_guest_can_answer_their_link_only_once(client):
    """Repeat submissions through one link are refused: one guest, one total."""
    token = make_invite(client, name="יוסי", side="idan")["token"]

    codes = [
        client.post(
            "/api/rsvp",
            json={"name": "יוסי", "attending": True, "guests": guests, "invite_token": token},
        ).status_code
        for guests in (2, 5, 3)
    ]
    assert codes == [200, 409, 409]
    # Nor can they cancel through the link afterwards — the couple does that.
    assert client.post(
        "/api/rsvp", json={"name": "יוסי", "attending": False, "invite_token": token}
    ).status_code == 409

    assert len(client.get("/api/guests", headers=ADMIN).json()) == 1
    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["responses"] == 1
    assert stats["total_people"] == 2, "only the first answer counts"


def test_a_full_guest_list_adds_up_across_all_four_sides(client):
    """The per-side split is what the couple plans seating from."""
    plan = [
        ("vered_parents", [3, 2, 0]),   # 0 = declined
        ("idan_parents", [4, 1]),
        ("vered", [2]),
        ("idan", [5, 0]),
    ]
    for side, parties in plan:
        for i, size in enumerate(parties):
            token = make_invite(client, name=f"{side}-{i}", side=side)["token"]
            body = {"name": f"{side}-{i}", "attending": size > 0, "invite_token": token}
            if size > 0:
                body["guests"] = size
            client.post("/api/rsvp", json=body)
    # one more invitation nobody has answered
    make_invite(client, name="שותק", side="idan")

    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["invites"] == 9
    assert stats["responses"] == 8
    assert stats["not_responded"] == 1
    assert stats["declined"] == 2
    assert stats["total_people"] == 3 + 2 + 4 + 1 + 2 + 5
    assert stats["by_side"]["vered_parents"]["total_people"] == 5
    assert stats["by_side"]["idan_parents"]["total_people"] == 5
    assert stats["by_side"]["vered"]["total_people"] == 2
    assert stats["by_side"]["idan"]["total_people"] == 5
    assert stats["by_side"]["idan"]["invites"] == 3

    # Every number the bot prints is derivable from the two list endpoints.
    invites = client.get("/api/invites", headers=ADMIN).json()
    assert sum(1 for i in invites if i["responded"]) == stats["responses"]
    assert sum(i["guests"] or 0 for i in invites if i["attending"]) == stats["total_people"]


def test_deleting_a_guest_returns_their_invitation_to_the_pending_list(client):
    token = make_invite(client, name="נמחק", side="vered")["token"]
    client.post("/api/rsvp", json={"name": "נמחק", "attending": True, "guests": 2, "invite_token": token})

    guest_id = client.get("/api/guests", headers=ADMIN).json()[0]["id"]
    assert client.delete(f"/api/guests/{guest_id}", headers=ADMIN).status_code == 200

    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["invites"] == 1, "the invitation itself survives"
    assert stats["responses"] == 0
    assert stats["not_responded"] == 1
    assert stats["total_people"] == 0
    assert client.get(f"/api/invite/{token}").json()["responded"] is False


def test_bulk_invites_then_answers_hold_together(client):
    """The bulk path the admin panel uses, followed through to the totals."""
    rows = [
        {"name": "אורח א", "phone": "0501111111", "side": "vered"},
        {"name": "אורח ב", "phone": "0502222222", "side": "idan"},
        {"name": "אורח ג", "phone": "0503333333", "side": "idan_parents"},
    ]
    res = client.post("/api/invites/bulk", headers=ADMIN, json={"rows": rows})
    assert res.status_code == 200, res.text
    created = res.json()
    tokens = [c["token"] for c in (created if isinstance(created, list) else created["invites"])]
    assert len(set(tokens)) == 3, "every guest gets their own link"

    client.post("/api/rsvp", json={"name": "אורח א", "attending": True, "guests": 2, "invite_token": tokens[0]})

    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["invites"] == 3
    assert stats["responses"] == 1
    assert stats["total_people"] == 2


def test_an_rsvp_without_a_link_still_lands_in_the_list(client):
    """Someone who typed the URL by hand is still a guest."""
    res = client.post("/api/rsvp", json={"name": "אורח לא מוזמן", "attending": True, "guests": 2})
    assert res.status_code == 200

    guests = client.get("/api/guests", headers=ADMIN).json()
    assert [g["name"] for g in guests] == ["אורח לא מוזמן"]

    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["total_people"] == 2
    assert stats["invites"] == 0, "no invitation was ever created for them"


# ── Bridge: the API → the Telegram bot ───────────────────────────────────────

def test_an_rsvp_is_pushed_to_the_telegram_bot(client, side_service, monkeypatch):
    monkeypatch.setenv("NOTIFY_URL", f"{side_service.url}/notify/rsvp")
    monkeypatch.setenv("NOTIFY_SECRET", "shared-secret")

    token = make_invite(client, name="דנה כהן", side="vered", phone="0501234567")["token"]
    client.post(
        "/api/rsvp",
        json={
            "name": "דנה כהן",
            "attending": True,
            "guests": 3,
            "phone": "0501234567",
            "message": "מזל טוב!",
            "invite_token": token,
        },
    )

    assert wait_for(lambda: side_service.received), "the bot was never told about the RSVP"
    call = side_service.received[0]
    assert call["method"] == "POST"
    assert call["path"] == "/notify/rsvp"
    assert call["headers"].get("X-Notify-Secret") == "shared-secret"
    assert call["body"]["name"] == "דנה כהן"
    assert call["body"]["attending"] is True
    assert call["body"]["guests"] == 3
    assert call["body"]["phone"] == "0501234567"
    assert call["body"]["message"] == "מזל טוב!"


def test_a_declined_rsvp_is_pushed_too(client, side_service, monkeypatch):
    monkeypatch.setenv("NOTIFY_URL", f"{side_service.url}/notify/rsvp")
    monkeypatch.setenv("NOTIFY_SECRET", "shared-secret")

    client.post("/api/rsvp", json={"name": "רונית", "attending": False})

    assert wait_for(lambda: side_service.received)
    assert side_service.received[0]["body"]["attending"] is False


def test_nothing_is_pushed_when_the_bot_is_not_configured(client, side_service, monkeypatch):
    monkeypatch.delenv("NOTIFY_URL", raising=False)
    monkeypatch.setenv("NOTIFY_SECRET", "shared-secret")

    client.post("/api/rsvp", json={"name": "דנה", "attending": True, "guests": 1})
    time.sleep(0.2)
    assert side_service.received == []


def test_nothing_is_pushed_without_a_shared_secret(client, side_service, monkeypatch):
    """A misconfigured secret must not leak guest details to an open endpoint."""
    monkeypatch.setenv("NOTIFY_URL", f"{side_service.url}/notify/rsvp")
    monkeypatch.delenv("NOTIFY_SECRET", raising=False)

    client.post("/api/rsvp", json={"name": "דנה", "attending": True, "guests": 1})
    time.sleep(0.2)
    assert side_service.received == []


def test_the_rsvp_still_succeeds_when_the_bot_rejects_the_push(client, side_service, monkeypatch):
    """A guest must never see an error because Telegram is unhappy."""
    monkeypatch.setenv("NOTIFY_URL", f"{side_service.url}/notify/rsvp")
    monkeypatch.setenv("NOTIFY_SECRET", "shared-secret")
    side_service.reply = (500, {"error": "bot exploded"})

    res = client.post("/api/rsvp", json={"name": "דנה", "attending": True, "guests": 2})
    assert res.status_code == 200
    assert wait_for(lambda: side_service.received)
    assert len(client.get("/api/guests", headers=ADMIN).json()) == 1


def test_the_rsvp_still_succeeds_when_the_bot_is_unreachable(client, monkeypatch):
    monkeypatch.setenv("NOTIFY_URL", "http://127.0.0.1:9/notify/rsvp")  # discard port
    monkeypatch.setenv("NOTIFY_SECRET", "shared-secret")

    res = client.post("/api/rsvp", json={"name": "דנה", "attending": True, "guests": 2})
    assert res.status_code == 200
    assert len(client.get("/api/guests", headers=ADMIN).json()) == 1


# ── Bridge: the API → the WhatsApp service ───────────────────────────────────

def test_sending_an_invitation_hands_the_personal_link_to_whatsapp(client, side_service, monkeypatch):
    monkeypatch.setattr("api.main.WHATSAPP_SERVICE_URL", side_service.url)

    token = make_invite(client, name="דנה כהן", side="vered", phone="0501234567")["token"]
    client.post("/api/rsvp", json={"name": "דנה כהן", "attending": True, "guests": 2,
                                   "phone": "0501234567", "invite_token": token})
    guest_id = client.get("/api/guests", headers=ADMIN).json()[0]["id"]

    res = client.post(
        "/api/whatsapp/send",
        headers=ADMIN,
        json={"guest_id": guest_id, "sender": "idan"},
    )
    assert res.status_code == 200, res.text

    call = side_service.received[0]
    assert call["path"] == "/send-invitation"
    assert call["body"]["sender"] == "idan"
    assert call["body"]["guestName"] == "דנה כהן"
    assert call["body"]["phone"] == "0501234567"
    assert token in call["body"]["websiteUrl"], "the guest must get their own link, not the generic one"

    # The send is recorded so the panel can show who has been messaged.
    assert client.get("/api/guests", headers=ADMIN).json()[0]["whatsapp_sent_idan"] is True


def test_a_guest_with_no_invitation_gets_the_generic_site_link(client, side_service, monkeypatch):
    monkeypatch.setattr("api.main.WHATSAPP_SERVICE_URL", side_service.url)

    client.post("/api/rsvp", json={"name": "אורח", "attending": True, "guests": 1, "phone": "0501234567"})
    guest_id = client.get("/api/guests", headers=ADMIN).json()[0]["id"]

    client.post("/api/whatsapp/send", headers=ADMIN, json={"guest_id": guest_id, "sender": "vered"})
    assert "?i=" not in side_service.received[0]["body"]["websiteUrl"]
    assert client.get("/api/guests", headers=ADMIN).json()[0]["whatsapp_sent_vered"] is True


def test_a_whatsapp_outage_is_a_502_and_marks_nobody_as_messaged(client, side_service, monkeypatch):
    monkeypatch.setattr("api.main.WHATSAPP_SERVICE_URL", side_service.url)
    side_service.reply = (500, {"error": "not connected"})

    client.post("/api/rsvp", json={"name": "אורח", "attending": True, "guests": 1, "phone": "0501234567"})
    guest_id = client.get("/api/guests", headers=ADMIN).json()[0]["id"]

    res = client.post("/api/whatsapp/send", headers=ADMIN, json={"guest_id": guest_id, "sender": "idan"})
    assert res.status_code == 502
    assert client.get("/api/guests", headers=ADMIN).json()[0]["whatsapp_sent_idan"] is False


def test_whatsapp_send_validates_before_it_calls_out(client, side_service, monkeypatch):
    monkeypatch.setattr("api.main.WHATSAPP_SERVICE_URL", side_service.url)

    client.post("/api/rsvp", json={"name": "בלי טלפון", "attending": True, "guests": 1})
    guest_id = client.get("/api/guests", headers=ADMIN).json()[0]["id"]

    assert client.post("/api/whatsapp/send", headers=ADMIN,
                       json={"guest_id": guest_id, "sender": "bob"}).status_code == 400
    assert client.post("/api/whatsapp/send", headers=ADMIN,
                       json={"guest_id": 999999, "sender": "idan"}).status_code == 404
    assert client.post("/api/whatsapp/send", headers=ADMIN,
                       json={"guest_id": guest_id, "sender": "idan"}).status_code == 400  # no phone
    assert side_service.received == [], "nothing should have reached the WhatsApp service"


def test_whatsapp_status_and_qr_degrade_to_offline_when_the_service_is_down(client, monkeypatch):
    monkeypatch.setattr("api.main.WHATSAPP_SERVICE_URL", "http://127.0.0.1:9")

    status = client.get("/api/whatsapp/status", headers=ADMIN)
    assert status.status_code == 200
    assert status.json() == {"idan": "offline", "vered": "offline"}

    qr = client.get("/api/whatsapp/qr/idan", headers=ADMIN)
    assert qr.status_code == 200
    assert qr.json()["status"] == "offline"
    assert qr.json()["qr"] is None


def test_whatsapp_status_passes_the_service_answer_through(client, side_service, monkeypatch):
    monkeypatch.setattr("api.main.WHATSAPP_SERVICE_URL", side_service.url)
    side_service.reply = (200, {"idan": "connected", "vered": "awaiting_scan"})

    assert client.get("/api/whatsapp/status", headers=ADMIN).json() == {
        "idan": "connected",
        "vered": "awaiting_scan",
    }


def test_every_whatsapp_bridge_endpoint_needs_the_admin_password(client):
    assert client.get("/api/whatsapp/status").status_code == 401
    assert client.get("/api/whatsapp/qr/idan").status_code == 401
    assert client.post("/api/whatsapp/send", json={"guest_id": 1, "sender": "idan"}).status_code == 401


def test_an_unknown_sender_is_rejected_before_the_service_is_asked(client):
    assert client.get("/api/whatsapp/qr/bob", headers=ADMIN).status_code == 400


# ── Guests with no personal link are counted as "other", never dropped ───────

def test_a_walk_in_is_counted_under_other(client):
    """Somebody who answered without a personal link still shows in the split."""
    token = make_invite(client, name="מוזמן", side="vered")["token"]
    client.post("/api/rsvp", json={"name": "מוזמן", "attending": True, "guests": 2, "invite_token": token})
    client.post("/api/rsvp", json={"name": "נכנס מהרחוב", "attending": True, "guests": 3})

    s = client.get("/api/stats", headers=ADMIN).json()
    assert s["responses"] == 2
    assert s["total_people"] == 5
    assert s["by_side"]["vered"]["total_people"] == 2
    assert s["by_side"]["other"] == {
        "invites": 0, "responded": 1, "attending": 1, "declined": 0, "total_people": 3}

    # Nobody is double-counted, and nobody is lost.
    assert sum(v["responded"] for v in s["by_side"].values()) == s["responses"]
    assert sum(v["total_people"] for v in s["by_side"].values()) == s["total_people"]


def test_other_counts_declines_separately(client):
    client.post("/api/rsvp", json={"name": "מסרב", "attending": False})
    s = client.get("/api/stats", headers=ADMIN).json()
    assert s["by_side"]["other"]["responded"] == 1
    assert s["by_side"]["other"]["declined"] == 1
    assert s["by_side"]["other"]["total_people"] == 0


def test_other_never_holds_a_guest_an_invitation_accounts_for(client):
    """Every invited guest belongs to their side, so "other" stays empty."""
    for side in ("vered_parents", "idan_parents", "vered", "idan"):
        token = make_invite(client, name=f"מוזמן-{side}", side=side)["token"]
        client.post("/api/rsvp", json={"name": f"מוזמן-{side}", "attending": True,
                                       "guests": 2, "invite_token": token})

    s = client.get("/api/stats", headers=ADMIN).json()
    assert s["by_side"]["other"]["responded"] == 0
    assert s["by_side"]["other"]["total_people"] == 0
    assert s["total_people"] == 8


def test_deleting_a_walk_in_empties_the_other_bucket(client):
    client.post("/api/rsvp", json={"name": "זמני", "attending": True, "guests": 4})
    guest_id = client.get("/api/guests", headers=ADMIN).json()[0]["id"]
    client.delete(f"/api/guests/{guest_id}", headers=ADMIN)

    s = client.get("/api/stats", headers=ADMIN).json()
    assert s["by_side"]["other"]["responded"] == 0
    assert s["total_people"] == 0
