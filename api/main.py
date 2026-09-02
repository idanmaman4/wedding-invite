from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from pony.orm import db_session, select, commit
from typing import Optional
import os
import httpx

from .models import db, Guest, setup_db

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
SITE_URL = os.environ.get("SITE_URL", "https://your-domain.vercel.app")


def check_admin(password: Optional[str]):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")


class RSVPRequest(BaseModel):
    name: str
    attending: bool
    plus_one: bool = False
    dietary: str = ""
    message: str = ""
    phone: str = ""

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty.")
        return v


class WhatsAppSendRequest(BaseModel):
    sender: str   # "idan" or "vered"
    guest_id: int


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/rsvp")
@db_session
def submit_rsvp(data: RSVPRequest):
    guest = Guest(
        name=data.name,
        attending=data.attending,
        plus_one=data.plus_one,
        dietary=data.dietary or "",
        message=data.message or "",
        phone=data.phone or "",
    )
    commit()
    return {"id": guest.id, "success": True, "message": "RSVP received!"}


@app.get("/api/guests")
@db_session
def get_guests(x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    guests = select(g for g in Guest).order_by(Guest.created_at.desc())[:]
    return [
        {
            "id": g.id,
            "name": g.name,
            "attending": g.attending,
            "plus_one": g.plus_one,
            "dietary": g.dietary,
            "message": g.message,
            "phone": g.phone,
            "whatsapp_sent_idan": g.whatsapp_sent_idan,
            "whatsapp_sent_vered": g.whatsapp_sent_vered,
            "created_at": g.created_at.isoformat(),
        }
        for g in guests
    ]


@app.delete("/api/guests/{guest_id}")
@db_session
def delete_guest(guest_id: int, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    guest = Guest.get(id=guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    guest.delete()
    commit()
    return {"success": True}


@app.post("/api/whatsapp/send")
@db_session
def send_whatsapp(data: WhatsAppSendRequest, x_admin_password: Optional[str] = Header(None)):
    check_admin(x_admin_password)
    if data.sender not in ("idan", "vered"):
        raise HTTPException(status_code=400, detail="sender must be 'idan' or 'vered'")

    guest = Guest.get(id=data.guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    if not guest.phone:
        raise HTTPException(status_code=400, detail="Guest has no phone number")

    try:
        resp = httpx.post(
            f"{WHATSAPP_SERVICE_URL}/send-invitation",
            json={
                "sender": data.sender,
                "guestName": guest.name,
                "phone": guest.phone,
                "websiteUrl": SITE_URL,
            },
            timeout=15,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"WhatsApp service error: {str(e)}")

    if data.sender == "idan":
        guest.whatsapp_sent_idan = True
    else:
        guest.whatsapp_sent_vered = True
    commit()
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
