"""Regressions for saving under production conditions.

SQLite (what the rest of the suite runs on) forgives things Postgres does not:
over-long VARCHARs, racing inserts, a DSN written for another client. These
tests pin down the behaviour the API needs once DATABASE_URL points at a real
hosted Postgres (Supabase / Neon), plus the timestamp and notify fixes.
"""

import os

import pytest
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from api import models
from conftest import ADMIN, make_invite
from test_integration import side_service, wait_for  # noqa: F401  (fixture)


# ── DSN handling ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("postgres://u:p@h:5432/db", "postgresql://u:p@h:5432/db"),
        ("postgresql://u:p@h/db?sslmode=require", "postgresql://u:p@h/db?sslmode=require"),
        # Supabase's pooler string, copied for Prisma: libpq rejects pgbouncer=.
        (
            "postgres://u:p@aws-0.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
            "postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres?sslmode=require",
        ),
        ("postgresql://u:p@h/db?pgbouncer=true", "postgresql://u:p@h/db"),
        (
            "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require",
            "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require",
        ),
        ("  postgres://u@h/db  ", "postgresql://u@h/db"),
    ],
)
def test_hosted_postgres_urls_are_normalised(raw, expected):
    # The driver is always named explicitly (see the next test).
    assert models.normalize_database_url(raw) == expected.replace("postgresql://", "postgresql+psycopg2://", 1)


def test_postgres_urls_load_the_installed_driver():
    # SQLAlchemy 2.1 maps a bare postgresql:// to psycopg 3, which is not
    # installed; on Vercel that failed the import of api.main, so every
    # endpoint answered FUNCTION_INVOCATION_FAILED. create_engine imports the
    # DBAPI without connecting, so this catches it offline.
    from sqlalchemy import create_engine
    url = models.normalize_database_url("postgres://u:p@h:6543/postgres?sslmode=require")
    engine = create_engine(url)
    assert engine.dialect.driver == "psycopg2"
    engine.dispose()


def test_serverless_postgres_does_not_pool_connections(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@db.example.com:6543/postgres?sslmode=require")
    monkeypatch.setenv("VERCEL", "1")
    engine = models.build_engine()
    try:
        assert isinstance(engine.pool, NullPool)
        assert engine.url.drivername == "postgresql+psycopg2"
        assert engine.url.query.get("sslmode") == "require"
    finally:
        engine.dispose()


def test_an_unreachable_database_does_not_crash_startup(monkeypatch, db_path):
    """Import-time setup must not 500 every endpoint until the instance dies."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:9/nodb?connect_timeout=1")
    try:
        models.setup_db()  # must not raise
        assert models._schema_ready is False
    finally:
        monkeypatch.delenv("DATABASE_URL")
        models.setup_db(url=f"sqlite:///{db_path}")
    assert models._schema_ready is True


def test_schema_is_created_lazily_when_startup_could_not(client, db_path):
    models.engine.dispose()
    models.setup_db(url=f"sqlite:///{db_path}")
    models._schema_ready = False
    res = client.post("/api/rsvp", json={"name": "דנה", "attending": True})
    assert res.status_code == 200, res.text
    assert models._schema_ready is True


# ── Postgres column widths ───────────────────────────────────────────────────

def test_an_over_long_rsvp_is_saved_not_rejected(client):
    res = client.post(
        "/api/rsvp",
        json={"name": "א" * 400, "attending": True, "phone": "0" * 60},
    )
    assert res.status_code == 200, res.text
    row = client.get("/api/guests", headers=ADMIN).json()[0]
    assert len(row["name"]) == models.Guest.__table__.c.name.type.length
    assert len(row["phone"]) == models.Guest.__table__.c.phone.type.length


def test_an_over_long_invite_fits_its_columns(client):
    res = client.post(
        "/api/invites", headers=ADMIN, json={"name": "ב" * 300, "side": "vered", "phone": "5" * 50},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["name"]) == 255
    assert len(res.json()["phone"]) == 30


def test_an_over_long_telegram_name_fits(client):
    res = client.post(
        "/api/bot/subscribers", headers=ADMIN,
        json={"chat_id": "1", "first_name": "x" * 300, "username": "y" * 300},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["subscriber"]["first_name"]) == 255


# ── Timestamps ───────────────────────────────────────────────────────────────

def test_timestamps_carry_their_utc_offset(client):
    """Naive UTC read by `new Date()` in Israel is three hours off."""
    client.post("/api/rsvp", json={"name": "דנה", "attending": True})
    created = client.get("/api/guests", headers=ADMIN).json()[0]["created_at"]
    assert created.endswith("+00:00"), created

    inv = make_invite(client)
    sent = client.post(f"/api/invites/{inv['token']}/sent", headers=ADMIN).json()["sent_at"]
    assert sent.endswith("+00:00"), sent
    assert inv["created_at"].endswith("+00:00")


# ── Racing inserts ───────────────────────────────────────────────────────────

def _miss_once(monkeypatch, model):
    """Make the first Session.get(model, …) miss, as if another request had
    not committed yet when this one looked."""
    real_get = Session.get
    state = {"missed": False}

    def get(self, entity, ident, *a, **kw):
        if entity is model and not state["missed"]:
            state["missed"] = True
            return None
        return real_get(self, entity, ident, *a, **kw)

    monkeypatch.setattr(Session, "get", get)
    return state


def test_a_racing_duplicate_start_is_not_a_500(client, monkeypatch):
    assert client.post("/api/bot/subscribers", headers=ADMIN,
                       json={"chat_id": "42", "first_name": "עידן"}).json()["created"] is True
    state = _miss_once(monkeypatch, models.Subscriber)
    res = client.post("/api/bot/subscribers", headers=ADMIN,
                      json={"chat_id": "42", "first_name": "עידן מ"})
    assert state["missed"]
    assert res.status_code == 200, res.text
    assert res.json()["created"] is False
    assert res.json()["subscriber"]["first_name"] == "עידן מ"
    assert len(client.get("/api/bot/subscribers", headers=ADMIN).json()) == 1


def test_a_racing_first_flow_write_is_not_a_500(client, monkeypatch):
    client.put("/api/bot/state/42", headers=ADMIN, json={"data": {"flow": "invite", "step": 0}})
    state = _miss_once(monkeypatch, models.BotState)
    res = client.put("/api/bot/state/42", headers=ADMIN,
                     json={"data": {"flow": "invite", "step": 1}})
    assert state["missed"]
    assert res.status_code == 200, res.text
    monkeypatch.undo()
    assert client.get("/api/bot/state/42", headers=ADMIN).json()["data"]["step"] == 1


# ── Notify ───────────────────────────────────────────────────────────────────

def test_the_bot_is_told_when_an_rsvp_is_an_edit(client, side_service, monkeypatch):  # noqa: F811
    monkeypatch.setenv("NOTIFY_URL", f"{side_service.url}/notify/rsvp")
    monkeypatch.setenv("NOTIFY_SECRET", "s")
    token = make_invite(client)["token"]
    body = {"name": "דנה", "attending": True, "guests": 2, "invite_token": token}

    client.post("/api/rsvp", json=body)
    assert wait_for(lambda: len(side_service.received) == 1)
    client.post("/api/rsvp", json={**body, "guests": 3})
    assert wait_for(lambda: len(side_service.received) == 2)

    assert side_service.received[0]["body"]["updated"] is False
    assert side_service.received[1]["body"]["updated"] is True
