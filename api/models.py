"""SQLAlchemy 2.x models and engine wiring for the wedding RSVP API.

Replaces the previous Pony ORM layer: Pony's query decompiler cannot read
Python 3.12 bytecode, so every generator/lambda query raised
``TypeError: Decompiler.YIELD_VALUE() takes 1 positional argument`` on Vercel
while working fine on local 3.10.
"""

from contextlib import contextmanager
from datetime import datetime
from typing import Optional
import os

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool


def sqlite_path() -> str:
    """Where the SQLite file lives.

    Serverless hosts mount the deployment read-only, so a file next to the
    code cannot be created there; only /tmp is writable (and is wiped between
    cold starts). Set DATABASE_URL to a Postgres DSN for real persistence —
    without it, submissions on Vercel survive only as long as the instance.
    """
    if is_serverless():
        return "/tmp/wedding.db"
    return os.path.join(os.path.dirname(__file__), "..", "wedding.db")


class Base(DeclarativeBase):
    pass


class Guest(Base):
    """One RSVP answer. Column set is unchanged from the Pony schema."""

    __tablename__ = "guests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    attending: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Kept for compatibility with older rows/clients; derived from guests on write.
    plus_one: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Total party size including the responder (1–20).
    guests: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    dietary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    whatsapp_sent_idan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    whatsapp_sent_vered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )


class Invite(Base):
    """A personalised invitation link.

    ``guest_id`` is a nullable FK filled in the moment the invitee answers, so
    re-opening the personal link edits that answer instead of adding a row.
    """

    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Which "camp" the guest belongs to — one of api.main.SIDES.
    side: Mapped[str] = mapped_column(String(32), nullable=False)
    phone: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)
    guest_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("guests.id", ondelete="SET NULL"), nullable=True, default=None
    )


class Subscriber(Base):
    """A Telegram chat that asked for RSVP updates.

    This used to be a JSON file next to the bot. On Vercel the bot is a
    serverless function with no disk that survives a request, so the registry
    lives here, behind the same admin-protected API the bot already uses.
    """

    __tablename__ = "bot_subscribers"

    chat_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    username: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    subscribed_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )


class BotState(Base):
    """Where a chat is in a multi-step bot flow (e.g. halfway through /invite).

    One row per chat, JSON in ``data``. Serverless invocations share nothing in
    memory, so the step a person is on has to be read back on every update.
    """

    __tablename__ = "bot_state"

    chat_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )


# ── Engine / session ─────────────────────────────────────────────────────────

engine = None
SessionLocal = None
# Whether create_all/migrations have run against the current engine. Kept
# separate from the engine so a database that is briefly unreachable at cold
# start does not take the whole function down — the next request retries.
_schema_ready = False

# Query parameters some hosts put in their connection strings that libpq (and
# so psycopg2) rejects outright with "invalid dsn". `pgbouncer=true` is what
# Supabase's pooler string carries for Prisma; the rest are Prisma's too.
_NON_LIBPQ_PARAMS = {"pgbouncer", "connection_limit", "pool_timeout", "schema", "statement_cache_size"}


def is_serverless() -> bool:
    return bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


def normalize_database_url(url: str) -> str:
    """Make a hosted Postgres DSN something SQLAlchemy + psycopg2 accept.

    - ``postgres://`` (Heroku/Supabase/Neon spelling) → ``postgresql://``;
    - Prisma-only query parameters are dropped, everything libpq knows
      (``sslmode``, ``channel_binding``, ``options``…) is kept as is.
    """
    url = (url or "").strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    # Name the driver: SQLAlchemy 2.1 maps a bare postgresql:// to psycopg 3,
    # which is not installed (psycopg2-binary is), and the import failure
    # took every endpoint down with FUNCTION_INVOCATION_FAILED.
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    if "?" in url and url.startswith("postgresql"):
        base, _, query = url.partition("?")
        kept = [
            pair for pair in query.split("&")
            if pair and pair.split("=", 1)[0].lower() not in _NON_LIBPQ_PARAMS
        ]
        url = base + ("?" + "&".join(kept) if kept else "")
    return url


def build_engine():
    database_url = normalize_database_url(os.environ.get("DATABASE_URL", ""))
    if database_url:
        kwargs = {"pool_pre_ping": True, "future": True}
        if database_url.startswith("postgresql"):
            # Fail fast instead of hanging until the platform kills the request.
            kwargs["connect_args"] = {"connect_timeout": 10}
        if is_serverless():
            # A serverless instance is frozen between requests and may never
            # come back; a pooled connection it holds is a slot the database
            # (or Supabase/Neon's pgbouncer) cannot give anyone else. One
            # connection per request, closed at the end, is the safe shape.
            kwargs["poolclass"] = NullPool
            kwargs["pool_pre_ping"] = False  # every connection is brand new
        else:
            kwargs["pool_recycle"] = 300
        return create_engine(database_url, **kwargs)
    return create_engine(
        f"sqlite:///{sqlite_path()}",
        # FastAPI may serve a request on a different thread than the one that
        # opened the connection; SQLite's default guard would reject that.
        connect_args={"check_same_thread": False},
        future=True,
    )


def ensure_schema() -> None:
    """Run column migrations and create missing tables, once per engine."""
    global _schema_ready
    if _schema_ready:
        return
    _migrate_missing_columns()
    try:
        Base.metadata.create_all(engine)
    except Exception:
        # Two cold starts racing to CREATE TABLE on Postgres: the loser gets a
        # duplicate-object error although the table is now there. One retry
        # sees it and creates nothing.
        Base.metadata.create_all(engine)
    _schema_ready = True


def setup_db(url: Optional[str] = None):
    """Create the engine, run column migrations and create missing tables.

    With an explicit ``url`` (tests) a failure raises. Without one (the app at
    import time) an unreachable database is logged and retried on the next
    request instead of crashing the import, which would 500 every endpoint —
    /api/health included — until the instance recycles.
    """
    global engine, SessionLocal, _schema_ready
    if url:
        engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)
    else:
        engine = build_engine()
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    _schema_ready = False
    if url:
        ensure_schema()
    else:
        try:
            ensure_schema()
        except Exception as exc:  # pragma: no cover - exercised via test with a bad DSN
            print(f"[db] schema setup deferred: {type(exc).__name__}: {exc}")
    return engine


@contextmanager
def get_session():
    """Session scope that commits on success and always closes."""
    if SessionLocal is None:
        setup_db()
    ensure_schema()
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# Columns added after the first release; existing SQLite files predate them.
# (name, DDL type + default) per table.
_LATE_COLUMNS = {
    "guests": [
        ("guests", "INTEGER NOT NULL DEFAULT 1"),
        ("phone", "VARCHAR(30) NOT NULL DEFAULT ''"),
        ("whatsapp_sent_idan", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("whatsapp_sent_vered", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("dietary", "TEXT NOT NULL DEFAULT ''"),
        ("message", "TEXT NOT NULL DEFAULT ''"),
    ],
    "invites": [
        ("side", "VARCHAR(32) NOT NULL DEFAULT 'idan'"),
        ("phone", "VARCHAR(30) NOT NULL DEFAULT ''"),
        ("sent_at", "TIMESTAMP"),
        ("guest_id", "INTEGER"),
    ],
}


def _migrate_missing_columns() -> None:
    """Add columns an older database file is missing.

    A no-op on a fresh database (the tables do not exist yet — create_all
    builds them complete) and on Postgres, where the schema is managed by the
    same create_all. Each statement is guarded so one failure cannot stop
    startup.
    """
    try:
        insp = inspect(engine)
        existing_tables = set(insp.get_table_names())
    except Exception:
        return

    for table, columns in _LATE_COLUMNS.items():
        if table not in existing_tables:
            continue
        try:
            have = {c["name"] for c in insp.get_columns(table)}
        except Exception:
            continue
        for name, ddl in columns:
            if name in have:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
            except Exception:
                pass
