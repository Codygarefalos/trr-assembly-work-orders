from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine, String, DateTime, Integer, Text, ForeignKey, select, func
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session


# -----------------------------
# Config
# -----------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
JWT_ALG = "HS256"
TOKEN_TTL_HOURS = 12

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL env var is required")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET env var is required")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# -----------------------------
# DB setup
# -----------------------------
class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), index=True)  # assembler | supervisor | admin
    pin_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)

    notes: Mapped[List["WorkOrderNote"]] = relationship(back_populates="author")


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wo_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # WO-000001
    station: Mapped[str] = mapped_column(String(80), index=True)

    part_number: Mapped[str] = mapped_column(String(80), index=True)
    customer_order: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    is_stock: Mapped[bool] = mapped_column(default=False)

    status: Mapped[str] = mapped_column(String(30), default="open", index=True)  # open|in_progress|complete
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    notes: Mapped[List["WorkOrderNote"]] = relationship(back_populates="work_order", cascade="all, delete-orphan")



class WorkOrderWorker(Base):
    __tablename__ = "work_order_workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    work_order: Mapped["WorkOrder"] = relationship()
    user: Mapped["User"] = relationship()

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    station: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    work_order: Mapped["WorkOrder"] = relationship(back_populates="notes")
    author: Mapped["User"] = relationship(back_populates="notes")


engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)


def get_db():
    with Session(engine) as s:
        yield s


# -----------------------------
# Auth helpers
# -----------------------------
def normalize_pin(pin: str) -> str:
    # Remove spaces or hidden characters and keep only digits
    p = (pin or "").strip()
    p = re.sub(r"\D", "", p)
    return p


def hash_pin(pin: str) -> str:
    p = normalize_pin(pin)
    if not re.fullmatch(r"\d{4,6}", p):
        raise HTTPException(status_code=400, detail="PIN must be 4–6 digits")
    return pwd_context.hash(p)


def verify_pin(pin: str, pin_hash: str) -> bool:
    p = normalize_pin(pin)
    if not re.fullmatch(r"\d{4,6}", p):
        return False
    return pwd_context.verify(p, pin_hash)



def create_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "name": user.name,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=TOKEN_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def parse_bearer(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    m = re.match(r"^Bearer\s+(.+)$", auth_header.strip(), re.IGNORECASE)
    return m.group(1) if m else None


def require_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
) -> User:
    token = parse_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_role(*roles: str):
    def _dep(user: User = Depends(require_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return _dep


# -----------------------------
# Pydantic schemas
# -----------------------------
class LoginRequest(BaseModel):
    name: str
    pin: str = Field(min_length=4, max_length=6)


class LoginResponse(BaseModel):
    token: str
    name: str
    role: str


class BootstrapAdminRequest(BaseModel):
    name: str
    pin: str = Field(min_length=4, max_length=6)


class CreateUserRequest(BaseModel):
    name: str
    role: str  # assembler|supervisor|admin
    pin: str = Field(min_length=4, max_length=6)


class UserOut(BaseModel):
    id: int
    name: str
    role: str
    is_active: bool


class CreateWORequest(BaseModel):
    station: str
    part_number: str
    customer_order: Optional[str] = None
    is_stock: bool = False


class WOOut(BaseModel):
    id: int
    wo_number: str
    station: str
    part_number: str
    customer_order: Optional[str]
    is_stock: bool
    status: str
    created_at: datetime


class AddNoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class NoteOut(BaseModel):

    user_id: int
    name: str
    role: str
    started_at: datetime

    id: int
    work_order_id: int
    author_name: str
    station: Optional[str]
    text: str
    created_at: datetime


# -----------------------------
# App
# -----------------------------
app = FastAPI(title="TRR Assembly Work Orders")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


STATIONS = [
    "Electrical",
    "Fabrication",
    "Pump/PTO install",
    "Hose Making",
    "Loader Install",
    "Underbody Hoist/dump cylinder install",
    "Cable Hoist Install",
    "Hooklift Install",
    "Body Install",
]


def next_wo_number(db: Session) -> str:
    # WO-000001 style
    last = db.execute(select(func.max(WorkOrder.id))).scalar()
    n = (last or 0) + 1
    return f"WO-{n:06d}"


@app.on_event("startup")
def startup():
    # Create tables
    Base.metadata.create_all(engine)


@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# Auth endpoints
# -----------------------------
@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.name == payload.name)).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    if not verify_pin(payload.pin, user.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")

    return LoginResponse(token=create_token(user), name=user.name, role=user.role)


@app.post("/bootstrap/admin", response_model=UserOut)
def bootstrap_first_admin(req: BootstrapAdminRequest, db: Session = Depends(get_db)):
raise HTTPException(status_code=403, detail="Bootstrap disabled")
    """
    One-time endpoint to create the first admin user.
    Only works if there are 0 users in the database.
    """
    existing_count = db.execute(select(func.count()).select_from(User)).scalar_one()
    if existing_count != 0:
        raise HTTPException(status_code=403, detail="Bootstrap disabled (users already exist)")

    pin = req.pin.strip()
    if not re.fullmatch(r"\d{4,6}", pin):
        raise HTTPException(status_code=400, detail="PIN must be 4–6 digits")

    u = User(
        name=req.name.strip(),
        role="admin",
        pin_hash=hash_pin(pin),
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active)


@app.get("/users", response_model=List[UserOut])
def list_users(_admin: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    users = db.execute(select(User).order_by(User.name.asc())).scalars().all()
    return [UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active) for u in users]


@app.post("/users", response_model=UserOut)
def create_user(req: CreateUserRequest, _admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    role = req.role.strip().lower()
    if role not in ("assembler", "supervisor", "admin"):
        raise HTTPException(status_code=400, detail="role must be assembler, supervisor, or admin")

    existing = db.execute(select(User).where(User.name == req.name)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="User name already exists")

    pin = req.pin.strip()
    if not re.fullmatch(r"\d{4,6}", pin):
        raise HTTPException(status_code=400, detail="PIN must be 4–6 digits")

    u = User(name=req.name.strip(), role=role, pin_hash=hash_pin(pin), is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active)


@app.get("/stations")
def stations(_user: User = Depends(require_user)):
    return {"stations": STATIONS}


# -----------------------------
# Work Orders + Notes
# -----------------------------
@app.post("/work-orders", response_model=WOOut)
def create_work_order(
    req: CreateWORequest,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    if req.station not in STATIONS:
        raise HTTPException(status_code=400, detail="Invalid station")

    wo = WorkOrder(
        wo_number=next_wo_number(db),
        station=req.station,
        part_number=req.part_number.strip(),
        customer_order=(req.customer_order.strip() if req.customer_order else None),
        is_stock=bool(req.is_stock),
        status="open",
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return WOOut(
        id=wo.id,
        wo_number=wo.wo_number,
        station=wo.station,
        part_number=wo.part_number,
        customer_order=wo.customer_order,
        is_stock=wo.is_stock,
        status=wo.status,
        created_at=wo.created_at,
    )


@app.get("/work-orders", response_model=List[WOOut])
def list_work_orders(_user: User = Depends(require_user), db: Session = Depends(get_db)):
    wos = db.execute(select(WorkOrder).order_by(WorkOrder.id.desc())).scalars().all()
    return [
        WOOut(
            id=wo.id,
            wo_number=wo.wo_number,
            station=wo.station,
            part_number=wo.part_number,
            customer_order=wo.customer_order,
            is_stock=wo.is_stock,
            status=wo.status,
            created_at=wo.created_at,
        )
        for wo in wos
    ]


@app.get("/work-orders/{wo_id}", response_model=WOOut)
def get_work_order(wo_id: int, _user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    return WOOut(
        id=wo.id,
        wo_number=wo.wo_number,
        station=wo.station,
        part_number=wo.part_number,
        customer_order=wo.customer_order,
        is_stock=wo.is_stock,
        status=wo.status,
        created_at=wo.created_at,
    )


@app.post("/work-orders/{wo_id}/notes", response_model=NoteOut)
def add_note(
    wo_id: int,
    req: AddNoteRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    note = WorkOrderNote(
        work_order_id=wo.id,
        author_user_id=user.id,
        station=wo.station,
        text=req.text.strip(),
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    return NoteOut(
        id=note.id,
        work_order_id=note.work_order_id,
        author_name=user.name,
        station=note.station,
        text=note.text,
        created_at=note.created_at,
    )


@app.get("/work-orders/{wo_id}/notes", response_model=List[NoteOut])
def list_notes(wo_id: int, _user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    notes = (
        db.execute(
            select(WorkOrderNote, User.name)
            .join(User, User.id == WorkOrderNote.author_user_id)
            .where(WorkOrderNote.work_order_id == wo_id)
            .order_by(WorkOrderNote.id.desc())
        )
        .all()
    )

    out: List[NoteOut] = []
    for n, author_name in notes:
        out.append(
            NoteOut(
                id=n.id,
                work_order_id=n.work_order_id,
                author_name=author_name,
                station=n.station,
                text=n.text,
                created_at=n.created_at,
            )
        )
    return out

@app.get("/work-orders/{wo_id}/workers", response_model=List[WorkerOut])
def list_workers(wo_id: int, _user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    rows = (
        db.execute(
            select(WorkOrderWorker, User)
            .join(User, User.id == WorkOrderWorker.user_id)
            .where(WorkOrderWorker.work_order_id == wo_id)
            .where(WorkOrderWorker.ended_at.is_(None))
            .order_by(WorkOrderWorker.started_at.asc())
        )
        .all()
    )

    out: List[WorkerOut] = []
    for w, u in rows:
        out.append(WorkerOut(user_id=u.id, name=u.name, role=u.role, started_at=w.started_at))
    return out


@app.post("/work-orders/{wo_id}/workers/start", response_model=List[WorkerOut])
def start_working_on_wo(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    # If the user is already active on this WO, do nothing
    existing = db.execute(
        select(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.user_id == user.id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar_one_or_none()

    if not existing:
        db.add(WorkOrderWorker(work_order_id=wo_id, user_id=user.id))
        db.commit()

    # Return current active workers (so UI can warn immediately)
    return list_workers(wo_id, user, db)


@app.post("/work-orders/{wo_id}/workers/stop")
def stop_working_on_wo(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    now = datetime.now(timezone.utc)

    active_rows = db.execute(
        select(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.user_id == user.id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalars().all()

    for r in active_rows:
        r.ended_at = now

    db.commit()
    return {"ok": True}

