from pony.orm import Database, Required, Optional, Set
from datetime import datetime
import os

db = Database()


class Guest(db.Entity):
    _table_ = "guests"
    name = Required(str, 255)
    attending = Required(bool)
    plus_one = Required(bool, default=False)
    dietary = Optional(str, default="")
    message = Optional(str, default="")
    phone = Optional(str, 30, default="")
    whatsapp_sent_idan = Required(bool, default=False)
    whatsapp_sent_vered = Required(bool, default=False)
    created_at = Required(datetime, default=datetime.utcnow)


def setup_db():
    database_url = os.environ.get("DATABASE_URL", "")
    if database_url:
        db.bind(provider="postgres", dsn=database_url)
    else:
        db_path = os.path.join(os.path.dirname(__file__), "..", "wedding.db")
        db.bind(provider="sqlite", filename=db_path, create_db=True)
    db.generate_mapping(create_tables=True)
