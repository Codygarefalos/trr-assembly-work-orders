from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict

from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
    Header,
    Query,
    UploadFile,
    File,
    Form,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import (
    create_engine,
    String,
    DateTime,
    Integer,
    Text,
    ForeignKey,
    select,
    func,
    LargeBinary,
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
RESET_TOKEN = os.getenv("RESET_TOKEN", "").strip()

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL env var is required")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET env var is required")

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


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


class Part(Base):
    """
    Part “database” with an instruction file stored in Postgres.
    """
    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_number: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120))
    content: Mapped[bytes] = mapped_column(LargeBinary)

    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    uploaded_by: Mapped["User"] = relationship()


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wo_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # WO-000001
    station: Mapped[str] = mapped_column(String(80), index=True)

    part_number: Mapped[str] = mapped_column(String(80), index=True)
    customer_order: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    is_stock: Mapped[bool] = mapped_column(default=False)

    # open | in_progress | complete | closed
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    notes: Mapped[List["WorkOrderNote"]] = relationship(back_populates="work_order", cascade="all, delete-orphan")


class WorkOrderNote(Base):
    __tablename__ = "work_order_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    station: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    work_order: Mapped["WorkOrder"] = relationship(back_populates="notes")
    author: Mapped["User"] = relationship(back_populates="notes")


class WorkOrderWorker(Base):
    __tablename__ = "work_order_workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    work_order: Mapped["WorkOrder"] = relationship()
    user: Mapped["User"] = relationship()


engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)


def get_db():
    with Session(engine) as s:
        yield s


# -----------------------------
# Auth helpers
# -----------------------------
def hash_pin(pin: str) -> str:
    return pwd_context.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    return pwd_context.verify(pin, pin_hash)


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
# Schemas
# -----------------------------
class LoginRequest(BaseModel):
    name: str
    pin: str = Field(min_length=4, max_length=6)


class LoginResponse(BaseModel):
    token: str
    name: str
    role: str


class CreateUserRequest(BaseModel):
    name: str
    role: str  # assembler|supervisor|admin
    pin: str = Field(min_length=4, max_length=6)


class UserOut(BaseModel):
    id: int
    name: str
    role: str
    is_active: bool


class ResetPinRequest(BaseModel):
    name: str
    new_pin: str = Field(min_length=4, max_length=6)


class OkResponse(BaseModel):
    ok: bool = True


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
    instruction_url: Optional[str] = None
    instruction_filename: Optional[str] = None


class CloseWOResponse(BaseModel):
    ok: bool
    status: str


class AddNoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class NoteOut(BaseModel):
    id: int
    work_order_id: int
    author_name: str
    station: Optional[str]
    text: str
    created_at: datetime


class WorkerOut(BaseModel):
    user_id: int
    name: str
    role: str
    started_at: datetime
    is_checked_in: bool


class PartOut(BaseModel):
    id: int
    part_number: str
    filename: str
    uploaded_at: datetime
    uploaded_by: str
    instruction_url: str


# -----------------------------
# App
# -----------------------------
app = FastAPI(title="TRR Assembly Work Orders API")

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
    last = db.execute(select(func.max(WorkOrder.id))).scalar()
    n = (last or 0) + 1
    return f"WO-{n:06d}"


def instruction_url_for_part(part_number: str) -> str:
    # Relative URL (frontend will prefix API_BASE)
    return f"/parts/{part_number}/instruction"


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)


@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# Bootstrap first admin (one-time)
# -----------------------------
@app.post("/bootstrap/admin", response_model=UserOut)
def bootstrap_first_admin(payload: CreateUserRequest, db: Session = Depends(get_db)):
    existing_any = db.execute(select(User).limit(1)).scalar_one_or_none()
    if existing_any:
        raise HTTPException(status_code=403, detail="Bootstrap disabled")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    u = User(
        name=name,
        role="admin",
        pin_hash=hash_pin(payload.pin.strip()),
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active)


# -----------------------------
# Auth
# -----------------------------
@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    name = payload.name.strip()
    pin = payload.pin.strip()

    user = db.execute(select(User).where(User.name == name)).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    if not verify_pin(pin, user.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")

    return LoginResponse(token=create_token(user), name=user.name, role=user.role)


# -----------------------------
# Users
# -----------------------------
@app.get("/users", response_model=List[UserOut])
def list_users(_u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    users = db.execute(select(User).order_by(User.name.asc())).scalars().all()
    return [UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active) for u in users]


@app.post("/users", response_model=UserOut)
def create_user(req: CreateUserRequest, _admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    role = req.role.strip().lower()
    if role not in ("assembler", "supervisor", "admin"):
        raise HTTPException(status_code=400, detail="role must be assembler, supervisor, or admin")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    existing = db.execute(select(User).where(User.name == name)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="User name already exists")

    u = User(name=name, role=role, pin_hash=hash_pin(req.pin.strip()), is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active)


@app.post("/admin/reset-pin", response_model=OkResponse)
def admin_reset_pin(
    req: ResetPinRequest,
    x_reset_token: Optional[str] = Header(default=None, alias="X-Reset-Token"),
    db: Session = Depends(get_db),
):
    if not RESET_TOKEN:
        raise HTTPException(status_code=500, detail="RESET_TOKEN not set on server")

    if not x_reset_token or x_reset_token.strip() != RESET_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid reset token")

    user = db.execute(select(User).where(User.name == req.name.strip())).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.pin_hash = hash_pin(req.new_pin.strip())
    user.is_active = True
    db.commit()
    return OkResponse(ok=True)


@app.get("/stations")
def stations(_user: User = Depends(require_user)):
    return {"stations": STATIONS}


# -----------------------------
# Parts / Work Instructions
# -----------------------------
@app.get("/parts", response_model=List[PartOut])
def list_parts(_u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(Part, User.name)
            .join(User, User.id == Part.uploaded_by_user_id)
            .order_by(Part.part_number.asc())
        )
        .all()
    )

    out: List[PartOut] = []
    for p, uploader_name in rows:
        out.append(
            PartOut(
                id=p.id,
                part_number=p.part_number,
                filename=p.filename,
                uploaded_at=p.uploaded_at,
                uploaded_by=uploader_name,
                instruction_url=instruction_url_for_part(p.part_number),
            )
        )
    return out


@app.post("/parts/upload", response_model=PartOut)
async def upload_part_instruction(
    part_number: str = Form(...),
    file: UploadFile = File(...),
    _u: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    pn = part_number.strip()
    if not pn:
        raise HTTPException(status_code=400, detail="part_number is required")

    if not file.filename:
        raise HTTPException(status_code=400, detail="file is required")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    mime = file.content_type or "application/octet-stream"
    filename = file.filename

    existing: Optional[Part] = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
    if existing:
        existing.filename = filename
        existing.mime_type = mime
        existing.content = content
        existing.uploaded_at = datetime.now(timezone.utc)
        existing.uploaded_by_user_id = _u.id
        db.commit()
        db.refresh(existing)
        uploader = _u.name
        p = existing
    else:
        p = Part(
            part_number=pn,
            filename=filename,
            mime_type=mime,
            content=content,
            uploaded_by_user_id=_u.id,
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        uploader = _u.name

    return PartOut(
        id=p.id,
        part_number=p.part_number,
        filename=p.filename,
        uploaded_at=p.uploaded_at,
        uploaded_by=uploader,
        instruction_url=instruction_url_for_part(p.part_number),
    )


@app.get("/parts/{part_number}/instruction")
def download_part_instruction(
    part_number: str,
    _user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    pn = part_number.strip()
    p: Optional[Part] = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="No instructions found for that part number")

    def iter_bytes():
        yield p.content

    headers = {"Content-Disposition": f'inline; filename="{p.filename}"'}
    return StreamingResponse(iter_bytes(), media_type=p.mime_type or "application/octet-stream", headers=headers)


@app.delete("/parts/{part_id}", response_model=OkResponse)
def delete_part(
    part_id: int,
    _u: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    db.delete(p)
    db.commit()
    return OkResponse(ok=True)


# -----------------------------
# Work Orders
# -----------------------------
def _parts_map_for_numbers(db: Session, part_numbers: List[str]) -> Dict[str, Part]:
    if not part_numbers:
        return {}
    rows = db.execute(select(Part).where(Part.part_number.in_(part_numbers))).scalars().all()
    return {r.part_number: r for r in rows}


@app.post("/work-orders", response_model=WOOut)
def create_work_order(
    req: CreateWORequest,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    if req.station not in STATIONS:
        raise HTTPException(status_code=400, detail="Invalid station")

    pn = req.part_number.strip()
    if not pn:
        raise HTTPException(status_code=400, detail="part_number is required")

    co = req.customer_order.strip() if req.customer_order else None
    if not req.is_stock and not co:
        raise HTTPException(status_code=400, detail="customer_order is required unless is_stock is true")

    wo = WorkOrder(
        wo_number=next_wo_number(db),
        station=req.station,
        part_number=pn,
        customer_order=(None if req.is_stock else co),
        is_stock=bool(req.is_stock),
        status="open",
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)

    part = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
    return WOOut(
        id=wo.id,
        wo_number=wo.wo_number,
        station=wo.station,
        part_number=wo.part_number,
        customer_order=wo.customer_order,
        is_stock=wo.is_stock,
        status=wo.status,
        created_at=wo.created_at,
        instruction_url=instruction_url_for_part(pn) if part else None,
        instruction_filename=part.filename if part else None,
    )


@app.get("/work-orders", response_model=List[WOOut])
def list_work_orders(
    _user: User = Depends(require_user),
    db: Session = Depends(get_db),
    status: Optional[str] = Query(default=None),
):
    q = select(WorkOrder)
    if status:
        q = q.where(WorkOrder.status == status.strip().lower())

    wos = db.execute(q.order_by(WorkOrder.id.desc())).scalars().all()
    pmap = _parts_map_for_numbers(db, list({w.part_number for w in wos}))

    out: List[WOOut] = []
    for wo in wos:
        part = pmap.get(wo.part_number)
        out.append(
            WOOut(
                id=wo.id,
                wo_number=wo.wo_number,
                station=wo.station,
                part_number=wo.part_number,
                customer_order=wo.customer_order,
                is_stock=wo.is_stock,
                status=wo.status,
                created_at=wo.created_at,
                instruction_url=instruction_url_for_part(wo.part_number) if part else None,
                instruction_filename=part.filename if part else None,
            )
        )
    return out


@app.get("/work-orders/{wo_id}", response_model=WOOut)
def get_work_order(wo_id: int, _user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    part = db.execute(select(Part).where(Part.part_number == wo.part_number)).scalar_one_or_none()
    return WOOut(
        id=wo.id,
        wo_number=wo.wo_number,
        station=wo.station,
        part_number=wo.part_number,
        customer_order=wo.customer_order,
        is_stock=wo.is_stock,
        status=wo.status,
        created_at=wo.created_at,
        instruction_url=instruction_url_for_part(wo.part_number) if part else None,
        instruction_filename=part.filename if part else None,
    )


# -----------------------------
# Notes
# -----------------------------
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

    rows = (
        db.execute(
            select(WorkOrderNote, User.name)
            .join(User, User.id == WorkOrderNote.author_user_id)
            .where(WorkOrderNote.work_order_id == wo_id)
            .order_by(WorkOrderNote.id.desc())
        )
        .all()
    )

    out: List[NoteOut] = []
    for n, author_name in rows:
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


# -----------------------------
# Workers (check in/out + warning)
# -----------------------------
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
        out.append(
            WorkerOut(
                user_id=u.id,
                name=u.name,
                role=u.role,
                started_at=w.started_at,
                is_checked_in=True,
            )
        )
    return out


@app.post("/work-orders/{wo_id}/workers/start", response_model=OkResponse)
def start_working_on_wo(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Work order is closed. Reopen first.")

    existing = db.execute(
        select(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.user_id == user.id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar_one_or_none()

    if not existing:
        db.add(WorkOrderWorker(work_order_id=wo_id, user_id=user.id))
        if wo.status == "open":
            wo.status = "in_progress"
        db.commit()

    return OkResponse(ok=True)


@app.post("/work-orders/{wo_id}/workers/stop", response_model=OkResponse)
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
    return OkResponse(ok=True)


# Compatibility endpoints (frontend calls these)
@app.post("/work-orders/{wo_id}/check-in", response_model=OkResponse)
def check_in(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    return start_working_on_wo(wo_id, user, db)


@app.post("/work-orders/{wo_id}/check-out", response_model=OkResponse)
def check_out(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    return stop_working_on_wo(wo_id, user, db)


# -----------------------------
# Status actions (complete/close + undo/reopen)
# -----------------------------
@app.post("/work-orders/{wo_id}/mark-complete", response_model=CloseWOResponse)
def mark_complete(
    wo_id: int,
    _u: User = Depends(require_role("admin", "supervisor", "assembler")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Work order is closed. Reopen first.")

    wo.status = "complete"
    db.commit()
    return CloseWOResponse(ok=True, status=wo.status)


@app.post("/work-orders/{wo_id}/uncomplete", response_model=CloseWOResponse)
def uncomplete(
    wo_id: int,
    _u: User = Depends(require_role("admin", "supervisor", "assembler")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status != "complete":
        raise HTTPException(status_code=400, detail="Work order is not marked complete")

    active = db.execute(
        select(func.count(WorkOrderWorker.id))
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar() or 0

    wo.status = "in_progress" if active > 0 else "open"
    db.commit()
    return CloseWOResponse(ok=True, status=wo.status)


@app.post("/work-orders/{wo_id}/close", response_model=CloseWOResponse)
def close_work_order(
    wo_id: int,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status != "complete":
        raise HTTPException(status_code=400, detail="Work order must be marked complete before closing")

    wo.status = "closed"
    db.commit()
    return CloseWOResponse(ok=True, status=wo.status)


@app.post("/work-orders/{wo_id}/reopen", response_model=CloseWOResponse)
def reopen_work_order(
    wo_id: int,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status != "closed":
        raise HTTPException(status_code=400, detail="Work order is not closed")

    active = db.execute(
        select(func.count(WorkOrderWorker.id))
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar() or 0

    wo.status = "in_progress" if active > 0 else "open"
    db.commit()
    return CloseWOResponse(ok=True, status=wo.status)
