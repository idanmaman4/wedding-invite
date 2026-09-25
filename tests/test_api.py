"""End-to-end coverage of the RSVP / invite API against a throwaway Postgres."""

import pytest

from api import models
from conftest import ADMIN, make_invite


# ── Health & schema ──────────────────────────────────────────────────────────

def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}

def test_fresh_database_has_both_tables(client):
    from sqlalchemy import inspect
    insp = inspect(models.engine)
    assert {"guests", "invites", "bot_subscribers", "bot_state"} <= set(insp.get_table_names())
    cols = {c["name"] for c in insp.get_columns("invites")}
    assert {"token", "name", "side", "phone", "created_at", "sent_at", "guest_id"} <= cols


# ── Admin auth ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/api/guests", None),
        ("GET", "/api/invites", None),
        ("GET", "/api/stats", None),
        ("GET", "/api/diag", None),
        # Bodies here are valid on purpose: a 422 would prove nothing about auth.
        ("POST", "/api/invites", {"name": "א", "side": "idan"}),
        ("POST", "/api/invites/bulk", {"rows": [{"name": "א", "side": "idan"}]}),
        ("DELETE", "/api/guests/1", None),
        ("DELETE", "/api/invites/nope", None),
        ("POST", "/api/invites/nope/sent", None),
    ],
)
def test_admin_endpoints_401_without_header(client, method, path, body):
    res = client.request(method, path, json=body)
    assert res.status_code == 401


def test_unauthorised_write_changes_nothing(client):
    client.post("/api/invites", json={"name": "א", "side": "idan"})
    assert client.get("/api/invites", headers=ADMIN).json() == []


def test_admin_endpoint_401_with_wrong_password(client):
    res = client.get("/api/guests", headers={"X-Admin-Password": "nope"})
    assert res.status_code == 401


def test_public_invite_lookup_needs_no_auth(client):
    inv = make_invite(client)
    res = client.get(f"/api/invite/{inv['token']}")
    assert res.status_code == 200
    assert res.json()["name"] == "דנה כהן"


# ── Plain RSVP ───────────────────────────────────────────────────────────────

def test_rsvp_create(client):
    res = client.post("/api/rsvp", json={"name": "אורח", "attending": True, "guests": 2})
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True and body["updated"] is False and body["id"] > 0

    rows = client.get("/api/guests", headers=ADMIN).json()
    assert len(rows) == 1
    assert rows[0]["name"] == "אורח"
    assert rows[0]["guests"] == 2
    assert rows[0]["plus_one"] is True     # legacy flag derived from party size
    assert rows[0]["attending"] is True


def test_rsvp_declining_is_stored(client):
    client.post("/api/rsvp", json={"name": "לא מגיע", "attending": False})
    row = client.get("/api/guests", headers=ADMIN).json()[0]
    assert row["attending"] is False
    assert row["guests"] == 1


@pytest.mark.parametrize("count", [0, -1, 21, 100])
def test_rsvp_rejects_out_of_range_party_size(client, count):
    res = client.post("/api/rsvp", json={"name": "א", "attending": True, "guests": count})
    assert res.status_code == 422


@pytest.mark.parametrize("count", [1, 2, 20])
def test_rsvp_accepts_valid_party_size(client, count):
    res = client.post("/api/rsvp", json={"name": "א", "attending": True, "guests": count})
    assert res.status_code == 200


def test_rsvp_rejects_blank_name(client):
    res = client.post("/api/rsvp", json={"name": "   ", "attending": True})
    assert res.status_code == 422


def test_rsvp_with_unknown_token_still_saves(client):
    res = client.post(
        "/api/rsvp",
        json={"name": "אורח", "attending": True, "invite_token": "does-not-exist"},
    )
    assert res.status_code == 200
    assert len(client.get("/api/guests", headers=ADMIN).json()) == 1


# ── Guests listing / delete ──────────────────────────────────────────────────

def test_guests_listing_is_newest_first(client):
    client.post("/api/rsvp", json={"name": "ראשון", "attending": True})
    client.post("/api/rsvp", json={"name": "שני", "attending": True})
    names = [g["name"] for g in client.get("/api/guests", headers=ADMIN).json()]
    assert names[0] == "שני"


def test_delete_guest(client):
    gid = client.post("/api/rsvp", json={"name": "א", "attending": True}).json()["id"]
    assert client.delete(f"/api/guests/{gid}", headers=ADMIN).status_code == 200
    assert client.get("/api/guests", headers=ADMIN).json() == []
    assert client.delete(f"/api/guests/{gid}", headers=ADMIN).status_code == 404


def test_deleting_the_guest_frees_the_invite(client):
    inv = make_invite(client)
    gid = client.post(
        "/api/rsvp",
        json={"name": "דנה", "attending": True, "invite_token": inv["token"]},
    ).json()["id"]
    client.delete(f"/api/guests/{gid}", headers=ADMIN)

    row = client.get("/api/invites", headers=ADMIN).json()[0]
    assert row["responded"] is False and row["guest_id"] is None
    assert client.get("/api/stats", headers=ADMIN).json()["not_responded"] == 1


# ── Invites CRUD ─────────────────────────────────────────────────────────────

def test_create_invite_returns_a_personal_url(client):
    inv = make_invite(client)
    assert len(inv["token"]) == 36
    assert inv["url"].endswith(f"/?i={inv['token']}")
    assert inv["side"] == "vered"
    assert inv["responded"] is False
    assert inv["attending"] is None and inv["guests"] is None


def test_invite_tokens_are_unique(client):
    tokens = {make_invite(client, name=f"אורח {i}")["token"] for i in range(5)}
    assert len(tokens) == 5


def test_bulk_create(client):
    res = client.post(
        "/api/invites/bulk",
        headers=ADMIN,
        json={"rows": [
            {"name": "א", "side": "idan", "phone": "0501111111"},
            {"name": "ב", "side": "הורי ורד"},          # Hebrew label accepted
            {"name": "ג", "side": "vered_parents"},
        ]},
    )
    assert res.status_code == 200
    rows = res.json()
    assert [r["side"] for r in rows] == ["idan", "vered_parents", "vered_parents"]
    assert len(client.get("/api/invites", headers=ADMIN).json()) == 3


def test_bulk_rejects_the_whole_batch_on_a_bad_side(client):
    res = client.post(
        "/api/invites/bulk",
        headers=ADMIN,
        json={"rows": [{"name": "א", "side": "idan"}, {"name": "ב", "side": "grandma"}]},
    )
    assert res.status_code == 422
    assert client.get("/api/invites", headers=ADMIN).json() == []


def test_delete_invite(client):
    inv = make_invite(client)
    assert client.delete(f"/api/invites/{inv['token']}", headers=ADMIN).status_code == 200
    assert client.get("/api/invites", headers=ADMIN).json() == []
    assert client.delete(f"/api/invites/{inv['token']}", headers=ADMIN).status_code == 404


def test_mark_sent_toggles(client):
    inv = make_invite(client)
    first = client.post(f"/api/invites/{inv['token']}/sent", headers=ADMIN).json()
    assert first["sent_at"] is not None
    assert client.get("/api/invites", headers=ADMIN).json()[0]["sent_at"] is not None

    second = client.post(f"/api/invites/{inv['token']}/sent", headers=ADMIN).json()
    assert second["sent_at"] is None


def test_mark_sent_unknown_token_404(client):
    assert client.post("/api/invites/nope/sent", headers=ADMIN).status_code == 404


# ── Side validation ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("side", ["vered_parents", "idan_parents", "vered", "idan"])
def test_all_four_side_keys_accepted(client, side):
    assert make_invite(client, side=side)["side"] == side


@pytest.mark.parametrize(
    "label,expected",
    [("הורי ורד", "vered_parents"), ("הורי עידן", "idan_parents"),
     ("ורד", "vered"), ("עידן", "idan"), ("  idan  ", "idan")],
)
def test_hebrew_side_labels_normalise(client, label, expected):
    assert make_invite(client, side=label)["side"] == expected


@pytest.mark.parametrize("side", ["", "bride", "הורים", "IDAN"])
def test_bad_side_is_rejected(client, side):
    res = client.post(
        "/api/invites", headers=ADMIN, json={"name": "א", "side": side},
    )
    assert res.status_code == 422


def test_invite_requires_a_name(client):
    res = client.post("/api/invites", headers=ADMIN, json={"name": " ", "side": "idan"})
    assert res.status_code == 422


# ── RSVP through a personal link ─────────────────────────────────────────────

def test_public_prefill_before_and_after_answering(client):
    inv = make_invite(client, name="דנה כהן", phone="0501234567")

    before = client.get(f"/api/invite/{inv['token']}").json()
    assert before == {
        "name": "דנה כהן", "phone": "0501234567",
        "responded": False, "attending": None, "guests": None,
    }

    client.post("/api/rsvp", json={
        "name": "דנה כהן", "attending": True, "guests": 3,
        "phone": "0509999999", "invite_token": inv["token"],
    })

    after = client.get(f"/api/invite/{inv['token']}").json()
    assert after["responded"] is True
    assert after["attending"] is True
    assert after["guests"] == 3


def test_public_prefill_leaks_nothing_else(client):
    inv = make_invite(client)
    client.post("/api/rsvp", json={
        "name": "דנה", "attending": True, "guests": 2,
        "dietary": "צמחוני", "message": "מזל טוב", "invite_token": inv["token"],
    })
    body = client.get(f"/api/invite/{inv['token']}").json()
    assert set(body) == {"name", "phone", "responded", "attending", "guests"}


def test_unknown_token_404(client):
    assert client.get("/api/invite/00000000").status_code == 404


def test_rsvp_via_invite_links_the_guest(client):
    inv = make_invite(client)
    gid = client.post("/api/rsvp", json={
        "name": "דנה כהן", "attending": True, "guests": 2, "invite_token": inv["token"],
    }).json()["id"]

    row = client.get("/api/invites", headers=ADMIN).json()[0]
    assert row["responded"] is True
    assert row["guest_id"] == gid
    assert row["attending"] is True
    assert row["guests"] == 2


def test_resubmitting_a_personal_link_updates_instead_of_duplicating(client):
    inv = make_invite(client)
    first = client.post("/api/rsvp", json={
        "name": "דנה כהן", "attending": True, "guests": 2, "invite_token": inv["token"],
    }).json()
    assert first["updated"] is False

    second = client.post("/api/rsvp", json={
        "name": "דנה לוי", "attending": True, "guests": 5,
        "phone": "0521112222", "dietary": "טבעוני", "invite_token": inv["token"],
    }).json()
    assert second["updated"] is True
    assert second["id"] == first["id"]          # same row, edited in place

    rows = client.get("/api/guests", headers=ADMIN).json()
    assert len(rows) == 1                        # no double-counting
    assert rows[0]["name"] == "דנה לוי"
    assert rows[0]["guests"] == 5
    assert rows[0]["phone"] == "0521112222"
    assert rows[0]["dietary"] == "טבעוני"

    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["responses"] == 1 and stats["total_people"] == 5


def test_changing_the_answer_to_declining(client):
    inv = make_invite(client)
    client.post("/api/rsvp", json={
        "name": "דנה", "attending": True, "guests": 4, "invite_token": inv["token"]})
    client.post("/api/rsvp", json={
        "name": "דנה", "attending": False, "guests": 1, "invite_token": inv["token"]})

    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["responses"] == 1
    assert stats["attending_responses"] == 0
    assert stats["declined"] == 1
    assert stats["total_people"] == 0

    row = client.get("/api/invites", headers=ADMIN).json()[0]
    assert row["attending"] is False
    assert row["guests"] is None                 # party size is meaningless here


def test_two_invites_do_not_share_a_guest_row(client):
    a = make_invite(client, name="א", side="idan")
    b = make_invite(client, name="ב", side="vered")
    client.post("/api/rsvp", json={"name": "א", "attending": True, "guests": 2,
                                   "invite_token": a["token"]})
    client.post("/api/rsvp", json={"name": "ב", "attending": True, "guests": 3,
                                   "invite_token": b["token"]})
    assert len(client.get("/api/guests", headers=ADMIN).json()) == 2
    stats = client.get("/api/stats", headers=ADMIN).json()
    assert stats["total_people"] == 5 and stats["not_responded"] == 0


# ── Stats maths ──────────────────────────────────────────────────────────────

def test_stats_on_an_empty_database(client):
    s = client.get("/api/stats", headers=ADMIN).json()
    assert s["responses"] == 0
    assert s["attending_responses"] == 0
    assert s["declined"] == 0
    assert s["total_people"] == 0
    assert s["invites"] == 0
    assert s["not_responded"] == 0
    # "other" is where answers with no personal link land — always present, even empty.
    assert set(s["by_side"]) == {"vered_parents", "idan_parents", "vered", "idan", "other"}
    assert s["by_side"]["other"] == {
        "invites": 0, "responded": 0, "attending": 0, "declined": 0, "total_people": 0}


def test_stats_totals_and_per_side_breakdown(client):
    inv_a = make_invite(client, name="א", side="idan")
    inv_b = make_invite(client, name="ב", side="idan")
    inv_c = make_invite(client, name="ג", side="vered_parents")
    make_invite(client, name="ד", side="idan_parents")          # never answers

    client.post("/api/rsvp", json={"name": "א", "attending": True, "guests": 2,
                                   "invite_token": inv_a["token"]})
    client.post("/api/rsvp", json={"name": "ב", "attending": False,
                                   "invite_token": inv_b["token"]})
    client.post("/api/rsvp", json={"name": "ג", "attending": True, "guests": 4,
                                   "invite_token": inv_c["token"]})
    # A walk-in with no invite at all: counts in the totals, in no side.
    client.post("/api/rsvp", json={"name": "אנונימי", "attending": True, "guests": 3})

    s = client.get("/api/stats", headers=ADMIN).json()
    assert s["invites"] == 4
    assert s["responses"] == 4
    assert s["attending_responses"] == 3
    assert s["declined"] == 1
    assert s["total_people"] == 2 + 4 + 3
    assert s["not_responded"] == 1                      # only invite "ד"

    assert s["by_side"]["idan"] == {
        "invites": 2, "responded": 2, "attending": 1, "declined": 1, "total_people": 2}
    assert s["by_side"]["vered_parents"] == {
        "invites": 1, "responded": 1, "attending": 1, "declined": 0, "total_people": 4}
    assert s["by_side"]["idan_parents"] == {
        "invites": 1, "responded": 0, "attending": 0, "declined": 0, "total_people": 0}
    assert s["by_side"]["vered"] == {
        "invites": 0, "responded": 0, "attending": 0, "declined": 0, "total_people": 0}

    # The walk-in has no invitation, so they land in "other".
    assert s["by_side"]["other"] == {
        "invites": 1 * 0, "responded": 1, "attending": 1, "declined": 0, "total_people": 3}

    # Per-side invite counts must add up to the headline invite count.
    assert sum(v["invites"] for v in s["by_side"].values()) == s["invites"]
    # Only the four real sides are answers to invitations; "other" has none.
    invited_sides = ["vered_parents", "idan_parents", "vered", "idan"]
    assert s["invites"] - sum(s["by_side"][k]["responded"] for k in invited_sides) == s["not_responded"]
    # And every response is accounted for exactly once across all the buckets.
    assert sum(v["responded"] for v in s["by_side"].values()) == s["responses"]
    assert sum(v["total_people"] for v in s["by_side"].values()) == s["total_people"]


# ── Bot defaults & invite edits ──────────────────────────────────────────────

def test_a_chat_can_set_and_clear_its_default_side(client):
    client.post("/api/bot/subscribers", headers=ADMIN, json={"chat_id": "77", "first_name": "עידן"})
    res = client.put("/api/bot/subscribers/77/side", headers=ADMIN, json={"side": "עידן"})
    assert res.status_code == 200, res.text
    assert res.json()["subscriber"]["default_side"] == "idan"
    listed = client.get("/api/bot/subscribers", headers=ADMIN).json()
    assert listed[0]["default_side"] == "idan"
    # Blank goes back to asking every time; an unknown side is refused.
    assert client.put("/api/bot/subscribers/77/side", headers=ADMIN, json={"side": ""}).json()["subscriber"]["default_side"] == ""
    assert client.put("/api/bot/subscribers/77/side", headers=ADMIN, json={"side": "שכנים"}).status_code == 422


def test_default_side_needs_a_subscriber_and_the_password(client):
    assert client.put("/api/bot/subscribers/nobody/side", headers=ADMIN, json={"side": "idan"}).status_code == 404
    assert client.put("/api/bot/subscribers/nobody/side", json={"side": "idan"}).status_code == 401


def test_an_invite_can_be_renamed_and_keeps_its_link(client):
    inv = make_invite(client, name="איש קשר", side="idan")
    res = client.patch(f"/api/invites/{inv['token']}", headers=ADMIN, json={"name": "  דוד ושרה  "})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "דוד ושרה"
    assert body["token"] == inv["token"] and body["url"] == inv["url"]
    assert body["side"] == "idan"
    assert client.get(f"/api/invite/{inv['token']}").json()["name"] == "דוד ושרה"
    moved = client.patch(f"/api/invites/{inv['token']}", headers=ADMIN, json={"side": "הורי ורד"}).json()
    assert moved["side"] == "vered_parents" and moved["name"] == "דוד ושרה"


def test_renaming_validates_and_needs_the_password(client):
    inv = make_invite(client)
    assert client.patch(f"/api/invites/{inv['token']}", headers=ADMIN, json={"name": "  "}).status_code == 422
    assert client.patch(f"/api/invites/{inv['token']}", json={"name": "x"}).status_code == 401
    assert client.patch("/api/invites/missing", headers=ADMIN, json={"name": "x"}).status_code == 404


def test_a_live_table_from_before_default_side_is_migrated(client):
    """Production's bot_subscribers predates default_side: the first request
    after the deploy must add the column, not fail every bot command."""
    from sqlalchemy import inspect, text
    client.post("/api/bot/subscribers", headers=ADMIN, json={"chat_id": "5", "first_name": "ורד"})
    with models.engine.begin() as conn:
        conn.execute(text("ALTER TABLE bot_subscribers DROP COLUMN default_side"))
    models._schema_ready = False
    rows = client.get("/api/bot/subscribers", headers=ADMIN).json()
    assert rows[0]["chat_id"] == "5" and rows[0]["default_side"] == ""
    assert "default_side" in {c["name"] for c in inspect(models.engine).get_columns("bot_subscribers")}
