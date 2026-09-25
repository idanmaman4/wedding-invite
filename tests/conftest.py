"""Test fixtures: every test gets its own throwaway SQLite file.

`api.main` calls `setup_db()` at import time, so the fixture re-points the
module-level engine/sessionmaker at a fresh temp database before each test and
disposes it afterwards. That keeps tests order-independent without needing the
app to grow a dependency-injection seam it does not otherwise need.
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


@pytest.fixture()
def db_path(tmp_path):
    return str(tmp_path / "test.db")


@pytest.fixture()
def client(db_path):
    models.setup_db(url=f"sqlite:///{db_path}")
    with TestClient(app) as c:
        yield c
    models.engine.dispose()


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
