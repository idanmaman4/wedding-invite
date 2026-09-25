"""The Telegram bot's storage endpoints.

On Vercel the bot is a serverless function with no disk that outlives a
request, so its subscriber registry and its per-chat flow state live here.
The bot's own tests fake these routes; these tests are the real thing.
"""

from conftest import ADMIN


def add(client, chat_id, **extra):
    return client.post(
        "/api/bot/subscribers",
        headers=ADMIN,
        json={"chat_id": chat_id, **extra},
    )


# ── Auth ─────────────────────────────────────────────────────────────────────

def test_every_bot_endpoint_needs_the_admin_password(client):
    assert client.get("/api/bot/subscribers").status_code == 401
    assert client.post("/api/bot/subscribers", json={"chat_id": "1"}).status_code == 401
    assert client.delete("/api/bot/subscribers/1").status_code == 401
    assert client.get("/api/bot/state/1").status_code == 401
    assert client.put("/api/bot/state/1", json={"data": {}}).status_code == 401
    assert client.delete("/api/bot/state/1").status_code == 401


# ── Subscribers ──────────────────────────────────────────────────────────────

def test_a_fresh_database_has_no_subscribers(client):
    assert client.get("/api/bot/subscribers", headers=ADMIN).json() == []


def test_adding_a_subscriber_reports_created_exactly_once(client):
    first = add(client, "111", first_name="עידן", username="idan")
    assert first.status_code == 200, first.text
    assert first.json()["created"] is True
    assert first.json()["subscriber"]["chat_id"] == "111"
    assert first.json()["subscriber"]["first_name"] == "עידן"

    again = add(client, "111", first_name="עידן", username="idan")
    assert again.json()["created"] is False

    rows = client.get("/api/bot/subscribers", headers=ADMIN).json()
    assert [r["chat_id"] for r in rows] == ["111"]
    assert rows[0]["subscribed_at"]


def test_re_adding_refreshes_the_name_but_never_blanks_it(client):
    add(client, "222", first_name="דנה", username="dana")
    add(client, "222", first_name="דנה כהן", username="")
    row = client.get("/api/bot/subscribers", headers=ADMIN).json()[0]
    assert row["first_name"] == "דנה כהן"
    assert row["username"] == "dana", "a blank username must not erase the known one"


def test_removing_a_subscriber_says_whether_anything_went(client):
    add(client, "333")
    assert client.delete("/api/bot/subscribers/333", headers=ADMIN).json() == {"removed": True}
    assert client.delete("/api/bot/subscribers/333", headers=ADMIN).json() == {"removed": False}
    assert client.get("/api/bot/subscribers", headers=ADMIN).json() == []


def test_subscribers_come_back_in_signup_order(client):
    for cid in ("c", "a", "b"):
        add(client, cid)
    rows = client.get("/api/bot/subscribers", headers=ADMIN).json()
    assert [r["chat_id"] for r in rows] == ["c", "a", "b"]


def test_a_blank_chat_id_is_rejected(client):
    assert add(client, "   ").status_code == 422


# ── Flow state ───────────────────────────────────────────────────────────────

def test_state_is_404_until_written(client):
    assert client.get("/api/bot/state/900", headers=ADMIN).status_code == 404


def test_state_round_trips_hebrew_json(client):
    payload = {"flow": "invite", "step": 1, "data": {"name": "דנה כהן", "phone": ""}, "at": 123}
    assert client.put("/api/bot/state/900", headers=ADMIN, json={"data": payload}).status_code == 200

    got = client.get("/api/bot/state/900", headers=ADMIN)
    assert got.status_code == 200
    assert got.json()["data"] == payload
    assert got.json()["chat_id"] == "900"
    assert got.json()["updated_at"]


def test_writing_state_again_replaces_it(client):
    client.put("/api/bot/state/901", headers=ADMIN, json={"data": {"flow": "invite", "step": 0}})
    client.put("/api/bot/state/901", headers=ADMIN, json={"data": {"flow": "invite", "step": 2}})
    assert client.get("/api/bot/state/901", headers=ADMIN).json()["data"]["step"] == 2


def test_deleting_state_says_whether_anything_went(client):
    client.put("/api/bot/state/902", headers=ADMIN, json={"data": {"flow": "search"}})
    assert client.delete("/api/bot/state/902", headers=ADMIN).json() == {"removed": True}
    assert client.delete("/api/bot/state/902", headers=ADMIN).json() == {"removed": False}
    assert client.get("/api/bot/state/902", headers=ADMIN).status_code == 404


def test_state_is_per_chat(client):
    client.put("/api/bot/state/1", headers=ADMIN, json={"data": {"flow": "invite"}})
    client.put("/api/bot/state/2", headers=ADMIN, json={"data": {"flow": "search"}})
    assert client.get("/api/bot/state/1", headers=ADMIN).json()["data"]["flow"] == "invite"
    assert client.get("/api/bot/state/2", headers=ADMIN).json()["data"]["flow"] == "search"


def test_unsubscribing_drops_a_half_finished_flow_too(client):
    add(client, "77")
    client.put("/api/bot/state/77", headers=ADMIN, json={"data": {"flow": "invite", "step": 1}})
    client.delete("/api/bot/subscribers/77", headers=ADMIN)
    assert client.get("/api/bot/state/77", headers=ADMIN).status_code == 404


def test_bot_storage_never_touches_the_guest_list(client):
    add(client, "5")
    client.put("/api/bot/state/5", headers=ADMIN, json={"data": {"flow": "invite"}})
    assert client.get("/api/guests", headers=ADMIN).json() == []
    assert client.get("/api/stats", headers=ADMIN).json()["responses"] == 0
