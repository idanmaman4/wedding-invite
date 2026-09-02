import sqlite3
import os
from datetime import datetime

# Resolve path relative to this file — wedding.db lives at project root
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'wedding.db')


def get_db() -> sqlite3.Connection:
    """Open a connection to the SQLite database with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the guests table if it does not already exist."""
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS guests (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            attending   INTEGER NOT NULL,
            plus_one    INTEGER DEFAULT 0,
            dietary     TEXT    DEFAULT '',
            message     TEXT    DEFAULT '',
            created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()
