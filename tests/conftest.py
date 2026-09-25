"""Test fixtures: the suite runs on a throwaway local Postgres.

Production keeps everything in Supabase, which is Postgres, so the tests run
on the same engine — never on the real Supabase project. `pgserver` bundles
the Postgres binaries: one server starts per test session in a temp dir and is
stopped at the end. Each test gets empty tables.

`api.main` calls `setup_db()` at import time (DATABASE_URL is unset here, so
that only logs); the fixture points the module-level engine/sessionmaker at
the test server before each test and disposes it afterwards.
"""

import os
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A DATABASE_URL in the developer's environment must not reach the tests.
os.environ.pop("DATABASE_URL", None)
os.environ["ADMIN_PASSWORD"] = "wedding2027"

from api import models          # noqa: E402
from api.main import app        # noqa: E402

ADMIN = {"X-Admin-Password": "wedding2027"}


@pytest.fixture(scope="session")
def pg_url():
    """URL of a Postgres server that lives for the whole test session."""
    import pgserver

    datadir = tempfile.mkdtemp(prefix="wedding-pg-")
    server = pgserver.get_server(datadir, cleanup_mode="delete")
    yield server.get_uri()
    server.cleanup()


@pytest.fixture()
def db_url(pg_url):
    """Point the app at the test server with every table empty."""
    models.setup_db(url=pg_url)
    models.Base.metadata.drop_all(models.engine)
    models._schema_ready = False
    models.ensure_schema()
    yield pg_url
    models.engine.dispose()


@pytest.fixture()
def client(db_url):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin():
    return dict(ADMIN)


def make_invite(client, name="דנה כהן", side="vered", phone="0501234567"):
    res = client.post(
        "/api/invites",
        headers=ADMIN,
        json={"name": name, "side": side, "phone": phone},
    )
    assert res.status_code == 200, res.text
    return res.json()
