from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from typing import Optional, List
from datetime import datetime
import os
import json
import uuid
import httpx

from .models import Guest, Invite, Subscriber, BotState, setup_db, get_session
from .notify import notify_rsvp

setup_db()

app = FastAPI(title="Wedding RSVP API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "wedding2027")
WHATSAPP_SERVICE_URL = os.environ.get("WHATSAPP_SERVICE_URL", "http://localhost:3001")
SITE_URL = os.environ.get("SITE_URL", "https://wedding-invite-sand-kappa.vercel.app")

# The four "camps" an invite can belong to. Keys stay English (they are stored
# and travel over the wire); the Hebrew labels live in the admin panel.
SIDES = ("vered_parents", "idan_parents", "vered", "idan")
SIDE_ALIASES = {
    "הורי ורד": "vered_parents",
    "הורי עידן": "idan_parents",
    "ורד": "vered",
    "עידן": "idan",
}


def normalize_side(value: str) -> str:
    """Accept either the stored key or the Hebrew label; reject anything else."""
    v = (value or "").strip()
    v = SIDE_ALIASES.get(v, v)
    if v not in SIDES:
        raise ValueError(f"side must be one of {', '.join(SIDES)}")
    return v


def check_admin(password: Optional[str]):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")


def invite_url(token: str) -> str:
    return f"{SITE_URL.rstrip('/')}/?i={token}"


def iso(value) -> Optional[str]:
    """Serialise a datetime defensively — legacy rows can hold plain strings.

    Stored datetimes are naive UTC (``datetime.utcnow``). Without an offset,
    JavaScript's ``new Date()`` reads them as *local* time, so the admin panel
    and the bot's export showed every answer three hours early in Israel.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat() + "+00:00"
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


# Column widths from api.models. Postgres enforces VARCHAR lengths: an
# over-long value is a DataError and the RSVP would be lost with a 500.
NAME_MAX = 255
PHONE_MAX = 30


def clip(value: Optional[str], limit: int) -> str:
    return (value or "").strip()[:limit]


class RSVPRequest(BaseModel):
    name: str
    attending: bool
    guests: int = 1
    dietary: str = ""
    message: str = ""
    phone: str = ""
    invite_token: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty.")
        return v[:NAME_MAX]

    @field_validator("phone")
    @classmethod
    def phone_fits(cls, v: str) -> str:
        return clip(v, PHONE_MAX)

    @field_validator("guests")
    @classmethod
    def guests_in_range(cls, v: int) -> int:
        if not 1 <= v <= 20:
            raise ValueError("guests must be between 1 and 20.")
        return v


class WhatsAppSendRequest(BaseModel):
    sender: str   # "idan" or "vered"
    guest_id: int


class InviteCreate(BaseModel):
    name: str
    side: str
    phone: str = ""

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty.")
        return v[:NAME_MAX]

    @field_validator("phone")
    @classmethod
    def phone_fits(cls, v: str) -> str:
        return clip(v, PHONE_MAX)

    @field_validator("side")
    @classmethod
    def side_known(cls, v: str) -> str:
        return normalize_side(v)


class InviteBulkCreate(BaseModel):
    rows: List[InviteCreate]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/rsvp")
def submit_rsvp(data: RSVPRequest):
    with get_session() as session:
        invite = None
        if data.invite_token:
            # Row-locked: a double-tapped submit
            # from the same personal link must not create two guest rows.
            invite = session.scalar(
                select(Invite).where(Invite.token == data.invite_token).with_for_update()
            )

        # A personal link answers once. Re-opening it shows the invitation and
        # the answer already given (see RSVPForm); a second submit — another
        # tab, a double tap that lost the row-lock race — is refused, never
        # applied. Deleting the answer in the admin panel re-opens the link.
        if invite is not None and invite.guest_id and session.get(Guest, invite.guest_id) is not None:
            raise HTTPException(status_code=409, detail="כבר השבתם להזמנה הזו — תודה!")

        guest = Guest(
            name=data.name,
            attending=data.attending,
            guests=data.guests,
            plus_one=data.guests > 1,  # legacy flag, derived from party size
            dietary=data.dietary or "",
            message=data.message or "",
            phone=data.phone or "",
        )
        session.add(guest)
        session.flush()  # assigns guest.id
        updated = False
        if invite is not None:
            invite.guest_id = guest.id

        session.flush()
        result = {
            "id": guest.id,
            "success": True,
            "updated": updated,
            "message": "RSVP updated!" if updated else "RSVP received!",
        }
        side = invite.side if invite is not None else ""

    # After the session (and its commit) closed: a side channel must never be
    # able to fail or delay a saved RSVP — notify_rsvp swallows everything.
    notify_rsvp({
        "name": data.name,
        "attending": data.attending,
        "guests": data.guests,
        "phone": data.phone,
        "side": side,
        "message": data.message,
        "updated": updated,
    })
    return result


@app.get("/api/diag")
def diag(x_admin_password: Optional[str] = Header(None)):
    """Admin-only: what the serverless instance actually sees.

    A blank 500 from the guest list is impossible to chase through the
    platform logs, so surface the failure to the authenticated admin.
    """
    check_admin(x_admin_password)
    import sys, traceback
    import sqlalchemy
    out = {
        "python": sys.version.split()[0],
        "sqlalchemy": sqlalchemy.__version__,
        "database_url_set": bool(os.environ.get("DATABASE_URL")),
        "vercel": bool(os.environ.get("VERCEL")),
    }
    try:
        with get_session() as session:
            rows = session.scalars(select(Guest)).all()
            out["row_count"] = len(rows)
            out["invite_count"] = len(session.scalars(select(Invite)).all())
            out["sample"] = [
                {"id": r.id, "created_at_type": type(r.created_at).__name__}
                for r in rows[:2]
            ]
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        out["traceback"] = traceback.format_exc()[-900:]
    return out


@app.get("/api/guests")
def get_guests(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        guests = session.scalars(
            select(Guest).order_by(Guest.created_at.desc(), Guest.id.desc())
        ).all()
        return [
            {
                "id": g.id,
                "name": g.name,
                "attending": g.attending,
                "plus_one": g.plus_one,
                "guests": g.guests,
                "dietary": g.dietary,
                "message": g.message,
                "phone": g.phone,
                "whatsapp_sent_idan": g.whatsapp_sent_idan,
                "whatsapp_sent_vered": g.whatsapp_sent_vered,
                # Rows written by an older deployment can hold a plain string.
                "created_at": iso(g.created_at) or "",
            }
            for g in guests
        ]


@app.delete("/api/guests/{guest_id}")
def delete_guest(guest_id: int, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        guest = session.get(Guest, guest_id)
        if guest is None:
            raise HTTPException(status_code=404, detail="Guest not found")
        # Free the invite so its personal link goes back to "not responded".
        for inv in session.scalars(select(Invite).where(Invite.guest_id == guest_id)).all():
            inv.guest_id = None
        session.delete(guest)
        return {"success": True}


# ── Personalised invite links ────────────────────────────────────────────────

def _invite_dict(session, inv: Invite) -> dict:
    """Shape one invite for the admin list, folding in its RSVP state."""
    guest = session.get(Guest, inv.guest_id) if inv.guest_id else None
    return {
        "id": inv.id,
        "token": inv.token,
        "name": inv.name,
        "side": inv.side,
        "phone": inv.phone or "",
        "url": invite_url(inv.token),
        "created_at": iso(inv.created_at),
        "sent_at": iso(inv.sent_at),
        "responded": guest is not None,
        "attending": bool(guest.attending) if guest is not None else None,
        "guests": (
            int(guest.guests or 1) if guest is not None and guest.attending else None
        ),
        "guest_id": guest.id if guest is not None else None,
    }


def _new_invite(name: str, side: str, phone: str) -> Invite:
    return Invite(
        token=str(uuid.uuid4()),
        name=name.strip(),
        side=side,
        phone=(phone or "").strip(),
    )


@app.post("/api/invites")
def create_invite(data: InviteCreate, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        inv = _new_invite(data.name, data.side, data.phone)
        session.add(inv)
        session.flush()
        return _invite_dict(session, inv)


@app.post("/api/invites/bulk")
def create_invites_bulk(data: InviteBulkCreate, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        created = []
        for row in data.rows:
            inv = _new_invite(row.name, row.side, row.phone)
            session.add(inv)
            created.append(inv)
        session.flush()
        return [_invite_dict(session, inv) for inv in created]


@app.get("/api/invites")
def list_invites(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        invites = session.scalars(
            select(Invite).order_by(Invite.created_at.desc(), Invite.id.desc())
        ).all()
        return [_invite_dict(session, inv) for inv in invites]


@app.delete("/api/invites/{token}")
def delete_invite(token: str, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        inv = session.scalar(select(Invite).where(Invite.token == token))
        if inv is None:
            raise HTTPException(status_code=404, detail="Invite not found")
        session.delete(inv)
        return {"success": True}


class InviteUpdate(BaseModel):
    name: Optional[str] = None
    side: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty.")
        return v[:NAME_MAX]

    @field_validator("side")
    @classmethod
    def side_known(cls, v: Optional[str]) -> Optional[str]:
        return v if v is None else normalize_side(v)


@app.patch("/api/invites/{token}")
def update_invite(token: str, data: InviteUpdate, x_admin_password: Optional[str] = Header(None)):
    """Rename an invite or move it to another side. The token (and so the
    personal link already sent) stays the same."""
    check_admin(x_admin_password)
    with get_session() as session:
        inv = session.scalar(select(Invite).where(Invite.token == token))
        if inv is None:
            raise HTTPException(status_code=404, detail="Invite not found")
        if data.name is not None:
            inv.name = data.name
        if data.side is not None:
            inv.side = data.side
        session.flush()
        return _invite_dict(session, inv)


@app.post("/api/invites/{token}/sent")
def mark_invite_sent(token: str, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        inv = session.scalar(select(Invite).where(Invite.token == token))
        if inv is None:
            raise HTTPException(status_code=404, detail="Invite not found")
        # Toggle, so a mis-click is undoable from the same button.
        inv.sent_at = None if inv.sent_at else datetime.utcnow()
        return {"success": True, "sent_at": iso(inv.sent_at)}


@app.get("/api/invite/{token}")
def get_invite_public(token: str):
    """PUBLIC prefill for the RSVP form.

    Deliberately narrow: only this invite's own name/phone/answer, never
    anything about any other guest.
    """
    with get_session() as session:
        inv = session.scalar(select(Invite).where(Invite.token == token))
        if inv is None:
            raise HTTPException(status_code=404, detail="Invite not found")
        guest = session.get(Guest, inv.guest_id) if inv.guest_id else None
        return {
            "name": inv.name,
            "phone": inv.phone or "",
            "responded": guest is not None,
            "attending": bool(guest.attending) if guest is not None else None,
            "guests": int(guest.guests or 1) if guest is not None else None,
        }


@app.get("/api/stats")
def get_stats(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        guests = session.scalars(select(Guest)).all()
        invites = session.scalars(select(Invite)).all()

        by_id = {g.id: g for g in guests}
        attending = [g for g in guests if g.attending]

        by_side = {}
        for key in SIDES:
            rows = [i for i in invites if i.side == key]
            side_guests = [by_id[i.guest_id] for i in rows if i.guest_id in by_id]
            by_side[key] = {
                "invites": len(rows),
                "responded": len(side_guests),
                "attending": sum(1 for g in side_guests if g.attending),
                "declined": sum(1 for g in side_guests if not g.attending),
                "total_people": sum(
                    int(g.guests or 1) for g in side_guests if g.attending
                ),
            }

        # Anyone who answered without a personal link belongs to no side. They
        # are still guests, so they get their own bucket rather than vanishing
        # from the breakdown.
        claimed = {i.guest_id for i in invites if i.guest_id is not None}
        others = [g for g in guests if g.id not in claimed]
        by_side["other"] = {
            "invites": 0,
            "responded": len(others),
            "attending": sum(1 for g in others if g.attending),
            "declined": sum(1 for g in others if not g.attending),
            "total_people": sum(int(g.guests or 1) for g in others if g.attending),
        }

        return {
            "responses": len(guests),
            "attending_responses": len(attending),
            "declined": len(guests) - len(attending),
            "total_people": sum(int(g.guests or 1) for g in attending),
            "invites": len(invites),
            "not_responded": sum(1 for i in invites if i.guest_id not in by_id),
            "by_side": by_side,
        }


# ── WhatsApp microservice bridge ─────────────────────────────────────────────

@app.post("/api/whatsapp/send")
def send_whatsapp(data: WhatsAppSendRequest, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    if data.sender not in ("idan", "vered"):
        raise HTTPException(status_code=400, detail="sender must be 'idan' or 'vered'")

    with get_session() as session:
        guest = session.get(Guest, data.guest_id)
        if guest is None:
            raise HTTPException(status_code=404, detail="Guest not found")
        if not guest.phone:
            raise HTTPException(status_code=400, detail="Guest has no phone number")

        # A personal link, when one exists, beats the generic site URL.
        inv = session.scalar(select(Invite).where(Invite.guest_id == guest.id))
        website_url = invite_url(inv.token) if inv is not None else SITE_URL

        try:
            resp = httpx.post(
                f"{WHATSAPP_SERVICE_URL}/send-invitation",
                json={
                    "sender": data.sender,
                    "guestName": guest.name,
                    "phone": guest.phone,
                    "websiteUrl": website_url,
                },
                timeout=15,
            )
            resp.raise_for_status()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"WhatsApp service error: {str(e)}")

        if data.sender == "idan":
            guest.whatsapp_sent_idan = True
        else:
            guest.whatsapp_sent_vered = True
        return {"success": True}


@app.get("/api/whatsapp/status")
def whatsapp_status(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    try:
        resp = httpx.get(f"{WHATSAPP_SERVICE_URL}/status", timeout=5)
        return resp.json()
    except Exception:
        return {"idan": "offline", "vered": "offline"}


@app.get("/api/whatsapp/qr/{sender}")
def whatsapp_qr(sender: str, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    if sender not in ("idan", "vered"):
        raise HTTPException(status_code=400, detail="sender must be 'idan' or 'vered'")
    try:
        resp = httpx.get(f"{WHATSAPP_SERVICE_URL}/qr/{sender}", timeout=5)
        return resp.json()
    except Exception:
        return {"qr": None, "status": "offline"}


# ── Telegram bot storage ─────────────────────────────────────────────────────
# The bot runs as a serverless function with no persistent disk, so its
# subscriber registry and its per-chat flow state live in the database, behind
# the admin password it already carries on every call.

class SubscriberIn(BaseModel):
    chat_id: str
    first_name: str = ""
    username: str = ""

    @field_validator("chat_id")
    @classmethod
    def chat_id_present(cls, v: str) -> str:
        v = str(v or "").strip()
        if not v:
            raise ValueError("chat_id must not be empty.")
        if len(v) > 32:
            raise ValueError("chat_id is too long.")
        return v

    @field_validator("first_name", "username")
    @classmethod
    def names_fit(cls, v: str) -> str:
        return clip(v, NAME_MAX)


def subscriber_dict(s: Subscriber) -> dict:
    return {
        "chat_id": s.chat_id,
        "first_name": s.first_name,
        "username": s.username,
        "default_side": s.default_side or "",
        "subscribed_at": iso(s.subscribed_at),
    }


@app.get("/api/bot/subscribers")
def list_subscribers(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        rows = session.scalars(select(Subscriber).order_by(Subscriber.subscribed_at)).all()
        return [subscriber_dict(s) for s in rows]


@app.post("/api/bot/subscribers")
def add_subscriber(data: SubscriberIn, x_admin_password: Optional[str] = Header(None)):
    """Add a subscriber, or refresh their name. `created` says which happened."""
    check_admin(x_admin_password)
    with get_session() as session:
        existing = session.get(Subscriber, data.chat_id)
        if existing is None:
            sub = Subscriber(chat_id=data.chat_id, first_name=data.first_name, username=data.username)
            session.add(sub)
            try:
                session.flush()
                return {"created": True, "subscriber": subscriber_dict(sub)}
            except IntegrityError:
                # Telegram delivers updates concurrently: a double-tapped
                # /start can race another request inserting the same chat.
                session.rollback()
                existing = session.get(Subscriber, data.chat_id)
                if existing is None:
                    raise
        # A blank name must not erase one we already know.
        if data.first_name:
            existing.first_name = data.first_name
        if data.username:
            existing.username = data.username
        session.flush()
        return {"created": False, "subscriber": subscriber_dict(existing)}


class DefaultSideIn(BaseModel):
    side: str = ""

    @field_validator("side")
    @classmethod
    def side_known_or_blank(cls, v: str) -> str:
        # Blank clears the default: the bot goes back to asking every time.
        return normalize_side(v) if (v or "").strip() else ""


@app.put("/api/bot/subscribers/{chat_id}/side")
def set_default_side(chat_id: str, data: DefaultSideIn, x_admin_password: Optional[str] = Header(None)):
    """The side this chat's new invites go to without the bot asking."""
    check_admin(x_admin_password)
    with get_session() as session:
        sub = session.get(Subscriber, chat_id)
        if sub is None:
            raise HTTPException(status_code=404, detail="Not subscribed")
        sub.default_side = data.side
        session.flush()
        return {"subscriber": subscriber_dict(sub)}


@app.delete("/api/bot/subscribers/{chat_id}")
def remove_subscriber(chat_id: str, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        sub = session.get(Subscriber, chat_id)
        if sub is None:
            return {"removed": False}
        session.delete(sub)
        # Their half-finished flow, if any, goes with them.
        state = session.get(BotState, chat_id)
        if state is not None:
            session.delete(state)
        return {"removed": True}


class BotStateIn(BaseModel):
    data: dict


@app.get("/api/bot/state/{chat_id}")
def get_bot_state(chat_id: str, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        state = session.get(BotState, chat_id)
        if state is None:
            raise HTTPException(status_code=404, detail="No state for this chat")
        try:
            data = json.loads(state.data or "{}")
        except ValueError:
            data = {}
        return {"chat_id": chat_id, "data": data, "updated_at": iso(state.updated_at)}


@app.put("/api/bot/state/{chat_id}")
def put_bot_state(chat_id: str, body: BotStateIn, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        state = session.get(BotState, chat_id)
        encoded = json.dumps(body.data, ensure_ascii=False)
        if state is None:
            session.add(BotState(chat_id=chat_id, data=encoded))
            try:
                session.flush()
                return {"ok": True}
            except IntegrityError:
                # Two updates from the same chat racing to open its first flow.
                session.rollback()
                state = session.get(BotState, chat_id)
                if state is None:
                    raise
        state.data = encoded
        state.updated_at = datetime.utcnow()
        return {"ok": True}


@app.delete("/api/bot/state/{chat_id}")
def delete_bot_state(chat_id: str, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    with get_session() as session:
        state = session.get(BotState, chat_id)
        if state is None:
            return {"removed": False}
        session.delete(state)
        return {"removed": True}
