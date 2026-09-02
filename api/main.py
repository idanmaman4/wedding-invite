from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import Optional, List
from .database import get_db, init_db

app = FastAPI(
    title="Wedding RSVP API",
    description="Backend API for Idan & Vered's wedding invitation",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

ADMIN_PASSWORD = "wedding2027"


class RSVPRequest(BaseModel):
    name: str
    attending: bool
    plus_one: bool = False
    dietary: str = ""
    message: str = ""

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty.")
        return v


class RSVPResponse(BaseModel):
    id: int
    success: bool
    message: str


@app.post("/api/rsvp", response_model=RSVPResponse)
def submit_rsvp(data: RSVPRequest):
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO guests (name, attending, plus_one, dietary, message) VALUES (?, ?, ?, ?, ?)",
            (data.name, 1 if data.attending else 0, 1 if data.plus_one else 0, data.dietary, data.message),
        )
        conn.commit()
        row_id = cur.lastrowid
    finally:
        conn.close()
    return RSVPResponse(id=row_id, success=True, message="RSVP received!")


@app.get("/api/guests")
def get_guests(x_admin_password: Optional[str] = Header(None)):
    if x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM guests ORDER BY created_at DESC").fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.delete("/api/guests/{guest_id}")
def delete_guest(guest_id: int, x_admin_password: Optional[str] = Header(None)):
    if x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")
    conn = get_db()
    try:
        result = conn.execute("DELETE FROM guests WHERE id = ?", (guest_id,))
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Guest not found")
    finally:
        conn.close()
    return {"success": True}


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "wedding-rsvp-api"}
