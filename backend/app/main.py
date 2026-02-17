from __future__ import annotations

import os
import re
import io
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
    Header,
    Query,
    UploadFile,
    File,
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
    Boolean,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session

# PDF
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


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
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    notes: Mapped[List["WorkOrderNote"]] = relationship(back_populates="author")


class Part(Base):
    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_number: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    content: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    uploaded_by: Mapped[Optional["User"]] = relationship()


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wo_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # WO-000001
    station: Mapped[str] = mapped_column(String(80), index=True)

    # legacy field kept
    part_number: Mapped[str] = mapped_column(String(80), index=True)

    part_id: Mapped[Optional[int]] = mapped_column(ForeignKey("parts.id"), nullable=True, index=True)
    part: Mapped[Optional["Part"]] = relationship()

    customer_order: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    is_stock: Mapped[bool] = mapped_column(Boolean, default=False)

    # open|in_progress|complete|closed
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    notes: Mapped[List["WorkOrderNote"]] = relationship(
        back_populates="work_order", cascade="all, delete-orphan"
    )


class WorkOrderNote(Base):
    __tablename__ = "work_order_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    station: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    work_order: Mapped["WorkOrder"] = relationship(back_populates="notes")
    author: Mapped["User"] = relationship(back_populates="notes")


class WorkOrderWorker(Base):
    __tablename__ = "work_order_workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
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


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])


def require_user(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
) -> User:
    token = parse_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    try:
        payload = decode_token(token)
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


# allow ?token=JWT
def require_user_from_header_or_query(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
) -> User:
    bearer = parse_bearer(authorization)
    raw = bearer or token
    if not raw:
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    try:
        payload = decode_token(raw)
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


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


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


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


class PartOut(BaseModel):
    id: int
    part_number: str
    has_file: bool
    filename: Optional[str] = None
    uploaded_at: Optional[datetime] = None


class CreatePartRequest(BaseModel):
    part_number: str


class UpdatePartRequest(BaseModel):
    part_number: str


class CreateWORequest(BaseModel):
    station: str
    part_id: Optional[int] = None
    part_number: Optional[str] = None
    customer_order: Optional[str] = None
    is_stock: bool = False


class UpdateWORequest(BaseModel):
    station: Optional[str] = None
    part_id: Optional[int] = None
    customer_order: Optional[str] = None
    is_stock: Optional[bool] = None
    status: Optional[str] = None  # allow admin edit


class WOOut(BaseModel):
    id: int
    wo_number: str
    station: str
    part_number: str
    part_id: Optional[int]
    customer_order: Optional[str]
    is_stock: bool
    status: str
    created_at: datetime
    instruction_url: Optional[str] = None


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
    is_checked_in: bool = True


class WorkerHistoryOut(BaseModel):
    id: int
    user_id: int
    name: str
    role: str
    started_at: datetime
    ended_at: Optional[datetime] = None


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


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)


@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# Bootstrap first admin
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
    user = db.execute(select(User).where(User.name == payload.name.strip())).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    if not verify_pin(payload.pin.strip(), user.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")

    return LoginResponse(token=create_token(user), name=user.name, role=user.role)


# -----------------------------
# Admin emergency reset
# -----------------------------
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


# -----------------------------
# Users CRUD
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


@app.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, req: UpdateUserRequest, _admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if req.name is not None:
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be blank")
        existing = db.execute(select(User).where(User.name == name, User.id != user_id)).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="User name already exists")
        u.name = name

    if req.role is not None:
        role = req.role.strip().lower()
        if role not in ("assembler", "supervisor", "admin"):
            raise HTTPException(status_code=400, detail="role must be assembler, supervisor, or admin")
        u.role = role

    if req.is_active is not None:
        u.is_active = bool(req.is_active)

    db.commit()
    db.refresh(u)
    return UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active)


@app.delete("/users/{user_id}", response_model=OkResponse)
def delete_user(user_id: int, _admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.role == "admin":
        admins = db.execute(select(func.count()).select_from(User).where(User.role == "admin")).scalar() or 0
        if admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin user")

    db.delete(u)
    db.commit()
    return OkResponse(ok=True)


# -----------------------------
# Stations
# -----------------------------
@app.get("/stations")
def stations(_user: User = Depends(require_user)):
    return {"stations": STATIONS}


# -----------------------------
# Parts CRUD + upload/download
# -----------------------------
@app.get("/parts", response_model=List[PartOut])
def list_parts(_u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    parts = db.execute(select(Part).order_by(Part.part_number.asc())).scalars().all()
    return [
        PartOut(
            id=p.id,
            part_number=p.part_number,
            has_file=bool(p.content),
            filename=p.filename,
            uploaded_at=p.uploaded_at,
        )
        for p in parts
    ]


@app.post("/parts", response_model=PartOut)
def create_part(req: CreatePartRequest, _u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    pn = req.part_number.strip()
    if not pn:
        raise HTTPException(status_code=400, detail="part_number is required")

    existing = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Part already exists")

    p = Part(part_number=pn)
    db.add(p)
    db.commit()
    db.refresh(p)
    return PartOut(id=p.id, part_number=p.part_number, has_file=False, filename=None, uploaded_at=None)


@app.patch("/parts/{part_id}", response_model=PartOut)
def update_part(part_id: int, req: UpdatePartRequest, _u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    pn = req.part_number.strip()
    if not pn:
        raise HTTPException(status_code=400, detail="part_number cannot be blank")

    existing = db.execute(select(Part).where(Part.part_number == pn, Part.id != part_id)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Another part already has that part_number")

    old_pn = p.part_number
    p.part_number = pn
    db.commit()

    wos = db.execute(select(WorkOrder).where(WorkOrder.part_id == part_id)).scalars().all()
    for wo in wos:
        if wo.part_number == old_pn:
            wo.part_number = pn
    db.commit()
    db.refresh(p)

    return PartOut(id=p.id, part_number=p.part_number, has_file=bool(p.content), filename=p.filename, uploaded_at=p.uploaded_at)


@app.delete("/parts/{part_id}", response_model=OkResponse)
def delete_part(part_id: int, _u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    db.delete(p)
    db.commit()
    return OkResponse(ok=True)


@app.post("/parts/{part_id}/upload", response_model=PartOut)
async def upload_part_instructions(
    part_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    p.filename = file.filename or "instructions"
    p.mime_type = file.content_type or "application/octet-stream"
    p.content = data
    p.uploaded_at = datetime.now(timezone.utc)
    p.uploaded_by_user_id = user.id

    db.commit()
    db.refresh(p)
    return PartOut(id=p.id, part_number=p.part_number, has_file=True, filename=p.filename, uploaded_at=p.uploaded_at)


@app.get("/parts/{part_id}/download")
def download_part_instructions(
    part_id: int,
    _user: User = Depends(require_user_from_header_or_query),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    if not p.content:
        raise HTTPException(status_code=404, detail="No file uploaded for this part")

    filename = p.filename or f"{p.part_number}.bin"
    mime = p.mime_type or "application/octet-stream"
    headers = {"Content-Disposition": f'inline; filename="{filename}"'}
    return StreamingResponse(iter([p.content]), media_type=mime, headers=headers)


# -----------------------------
# Work Orders CRUD + flow
# -----------------------------
def wo_to_out(wo: WorkOrder, token: Optional[str] = None) -> WOOut:
    instruction_url = None
    if wo.part_id:
        instruction_url = f"/parts/{wo.part_id}/download"
        if token:
            instruction_url = f"/parts/{wo.part_id}/download?token={token}"
    return WOOut(
        id=wo.id,
        wo_number=wo.wo_number,
        station=wo.station,
        part_number=wo.part_number,
        part_id=wo.part_id,
        customer_order=wo.customer_order,
        is_stock=wo.is_stock,
        status=wo.status,
        created_at=wo.created_at,
        instruction_url=instruction_url,
    )


@app.post("/work-orders", response_model=WOOut)
def create_work_order(
    req: CreateWORequest,
    _sup: User = Depends(require_role("admin", "supervisor")),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    if req.station not in STATIONS:
        raise HTTPException(status_code=400, detail="Invalid station")

    part_id = req.part_id
    pn = (req.part_number or "").strip()

    if part_id:
        p = db.get(Part, part_id)
        if not p:
            raise HTTPException(status_code=400, detail="Invalid part_id")
        pn = p.part_number
    else:
        if not pn:
            raise HTTPException(status_code=400, detail="part_id or part_number is required")
        p = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
        if not p:
            p = Part(part_number=pn)
            db.add(p)
            db.commit()
            db.refresh(p)
        part_id = p.id

    co = req.customer_order.strip() if req.customer_order else None
    if not req.is_stock and not co:
        raise HTTPException(status_code=400, detail="customer_order is required unless is_stock is true")

    wo = WorkOrder(
        wo_number=next_wo_number(db),
        station=req.station,
        part_number=pn,
        part_id=part_id,
        customer_order=(None if req.is_stock else co),
        is_stock=bool(req.is_stock),
        status="open",
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)

    token = parse_bearer(authorization)
    return wo_to_out(wo, token=token)


@app.get("/work-orders", response_model=List[WOOut])
def list_work_orders(
    _user: User = Depends(require_user),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    status: Optional[str] = Query(default=None),
):
    q = select(WorkOrder)
    if status:
        q = q.where(WorkOrder.status == status.strip().lower())

    wos = db.execute(q.order_by(WorkOrder.id.desc())).scalars().all()
    token = parse_bearer(authorization)
    return [wo_to_out(wo, token=token) for wo in wos]


@app.get("/work-orders/{wo_id}", response_model=WOOut)
def get_work_order(
    wo_id: int,
    _user: User = Depends(require_user),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    token = parse_bearer(authorization)
    return wo_to_out(wo, token=token)


@app.patch("/work-orders/{wo_id}", response_model=WOOut)
def update_work_order(
    wo_id: int,
    req: UpdateWORequest,
    _admin: User = Depends(require_role("admin")),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    if req.station is not None:
        if req.station not in STATIONS:
            raise HTTPException(status_code=400, detail="Invalid station")
        wo.station = req.station

    if req.is_stock is not None:
        wo.is_stock = bool(req.is_stock)
        if wo.is_stock:
            wo.customer_order = None

    if req.customer_order is not None:
        co = req.customer_order.strip()
        wo.customer_order = co if co else None

    if wo.is_stock is False and (wo.customer_order is None or wo.customer_order.strip() == ""):
        raise HTTPException(status_code=400, detail="customer_order is required unless is_stock is true")

    if req.part_id is not None:
        p = db.get(Part, req.part_id)
        if not p:
            raise HTTPException(status_code=400, detail="Invalid part_id")
        wo.part_id = p.id
        wo.part_number = p.part_number

    if req.status is not None:
        s = req.status.strip().lower()
        if s not in ("open", "in_progress", "complete", "closed"):
            raise HTTPException(status_code=400, detail="Invalid status")
        wo.status = s

    db.commit()
    db.refresh(wo)
    token = parse_bearer(authorization)
    return wo_to_out(wo, token=token)


@app.delete("/work-orders/{wo_id}", response_model=OkResponse)
def delete_work_order(
    wo_id: int,
    _admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    db.delete(wo)
    db.commit()
    return OkResponse(ok=True)


def set_status_open_or_in_progress(db: Session, wo: WorkOrder) -> None:
    active = db.execute(
        select(func.count())
        .select_from(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo.id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar() or 0
    wo.status = "in_progress" if active > 0 else "open"


@app.post("/work-orders/{wo_id}/mark-complete", response_model=OkResponse)
def mark_complete(
    wo_id: int,
    _u: User = Depends(require_role("assembler", "supervisor", "admin")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Work order is closed")
    wo.status = "complete"
    db.commit()
    return OkResponse(ok=True)


@app.post("/work-orders/{wo_id}/undo-complete", response_model=OkResponse)
def undo_complete(
    wo_id: int,
    _u: User = Depends(require_role("assembler", "supervisor", "admin")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Cannot undo complete on a closed WO. Reopen first.")
    set_status_open_or_in_progress(db, wo)
    db.commit()
    return OkResponse(ok=True)


@app.post("/work-orders/{wo_id}/close", response_model=OkResponse)
def close_work_order(
    wo_id: int,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    wo.status = "closed"
    db.commit()
    return OkResponse(ok=True)


@app.post("/work-orders/{wo_id}/reopen", response_model=OkResponse)
def reopen_work_order(
    wo_id: int,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    set_status_open_or_in_progress(db, wo)
    db.commit()
    return OkResponse(ok=True)


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
# Workers (check in/out)
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
        out.append(WorkerOut(user_id=u.id, name=u.name, role=u.role, started_at=w.started_at, is_checked_in=True))
    return out


@app.get("/work-orders/{wo_id}/workers/history", response_model=List[WorkerHistoryOut])
def worker_history(wo_id: int, _user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    rows = (
        db.execute(
            select(WorkOrderWorker, User)
            .join(User, User.id == WorkOrderWorker.user_id)
            .where(WorkOrderWorker.work_order_id == wo_id)
            .order_by(WorkOrderWorker.started_at.asc(), WorkOrderWorker.id.asc())
        )
        .all()
    )

    out: List[WorkerHistoryOut] = []
    for w, u in rows:
        out.append(
            WorkerHistoryOut(
                id=w.id,
                user_id=u.id,
                name=u.name,
                role=u.role,
                started_at=w.started_at,
                ended_at=w.ended_at,
            )
        )
    return out


@app.post("/work-orders/{wo_id}/workers/start", response_model=List[WorkerOut])
def start_working_on_wo(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Work order is closed")

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

    return list_workers(wo_id, user, db)


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

    if wo.status == "in_progress":
        active_count = db.execute(
            select(func.count())
            .select_from(WorkOrderWorker)
            .where(WorkOrderWorker.work_order_id == wo_id)
            .where(WorkOrderWorker.ended_at.is_(None))
        ).scalar() or 0
        if active_count == 0:
            wo.status = "open"

    db.commit()
    return OkResponse(ok=True)


@app.post("/work-orders/{wo_id}/check-in", response_model=List[WorkerOut])
def check_in_alias(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    return start_working_on_wo(wo_id, user, db)


@app.post("/work-orders/{wo_id}/check-out", response_model=OkResponse)
def check_out_alias(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    return stop_working_on_wo(wo_id, user, db)


# -----------------------------
# PDF Print / Pop-out
# -----------------------------
@app.get("/work-orders/{wo_id}/print")
def print_work_order_pdf(
    wo_id: int,
    _user: User = Depends(require_user_from_header_or_query),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    notes = db.execute(
        select(WorkOrderNote, User.name)
        .join(User, User.id == WorkOrderNote.author_user_id)
        .where(WorkOrderNote.work_order_id == wo_id)
        .order_by(WorkOrderNote.id.asc())
    ).all()

    history = db.execute(
        select(WorkOrderWorker, User)
        .join(User, User.id == WorkOrderWorker.user_id)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .order_by(WorkOrderWorker.started_at.asc(), WorkOrderWorker.id.asc())
    ).all()

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter

    def draw_line(text: str, x: float, y: float, font="Helvetica", size=10):
        c.setFont(font, size)
        c.drawString(x, y, text)

    y = height - 48
    draw_line("TRR Assembly Work Order", 48, y, font="Helvetica-Bold", size=16)
    y -= 22

    draw_line(f"WO: {wo.wo_number}", 48, y, font="Helvetica-Bold", size=12)
    y -= 16
    draw_line(f"Station: {wo.station}", 48, y)
    y -= 14
    draw_line(f"Part: {wo.part_number}", 48, y)
    y -= 14
    draw_line(f"Customer Order: {'Stock' if wo.is_stock else (wo.customer_order or '-')}", 48, y)
    y -= 14
    draw_line(f"Status: {wo.status}", 48, y)
    y -= 14
    draw_line(f"Created: {wo.created_at.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", 48, y)
    y -= 22

    draw_line("Worker Fingerprint (Check In / Out)", 48, y, font="Helvetica-Bold", size=12)
    y -= 16

    if not history:
        draw_line("No check-in history yet.", 48, y)
        y -= 14
    else:
        for w, u in history:
            start = w.started_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            end = w.ended_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if w.ended_at else "—"
            line = f"{u.name} ({u.role})  IN: {start}  OUT: {end}"
            if y < 80:
                c.showPage()
                y = height - 48
            draw_line(line[:120], 48, y)
            y -= 12

        y -= 8

    draw_line("Notes", 48, y, font="Helvetica-Bold", size=12)
    y -= 16

    if not notes:
        draw_line("No notes yet.", 48, y)
        y -= 14
    else:
        for n, author_name in notes:
            ts = n.created_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            header = f"{author_name} @ {ts} [{n.station or ''}]"
            if y < 90:
                c.showPage()
                y = height - 48
            draw_line(header[:120], 48, y, font="Helvetica-Bold", size=10)
            y -= 12
            # wrap note text
            text = (n.text or "").replace("\r", "")
            for raw_line in text.split("\n"):
                chunks = [raw_line[i:i+110] for i in range(0, len(raw_line), 110)] or [""]
                for ch in chunks:
                    if y < 70:
                        c.showPage()
                        y = height - 48
                    draw_line(ch, 58, y, font="Helvetica", size=10)
                    y -= 12
            y -= 6

    c.showPage()
    c.save()
    buf.seek(0)

    filename = f"{wo.wo_number}.pdf"
    headers = {"Content-Disposition": f'inline; filename="{filename}"'}
    return StreamingResponse(buf, media_type="application/pdf", headers=headers)
