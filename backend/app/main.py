from __future__ import annotations

import os
import re
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
    Form,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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

# Stable on Render
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
    role: Mapped[str] = mapped_column(String(20), index=True)  # assembler|supervisor|admin
    pin_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)

    notes: Mapped[List["WorkOrderNote"]] = relationship(back_populates="author")


class Part(Base):
    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_number: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    instruction_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    instruction_content_type: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    instruction_bytes: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wo_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # WO-000001
    station: Mapped[str] = mapped_column(String(80), index=True)

    # keep part_number string for display + searching
    part_number: Mapped[str] = mapped_column(String(80), index=True)

    # optional reference to parts table if it exists
    part_id: Mapped[Optional[int]] = mapped_column(ForeignKey("parts.id"), nullable=True, index=True)
    part: Mapped[Optional["Part"]] = relationship()

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


class CreateWORequest(BaseModel):
    station: str
    part_number: str
    customer_order: Optional[str] = None
    is_stock: bool = False


class UpdateWORequest(BaseModel):
    station: Optional[str] = None
    part_number: Optional[str] = None
    customer_order: Optional[str] = None
    is_stock: Optional[bool] = None
    status: Optional[str] = None  # allow admin/supervisor to set open|in_progress|complete|closed


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


class CloseWOResponse(BaseModel):
    ok: bool
    status: str


class PartOut(BaseModel):
    id: int
    part_number: str
    description: Optional[str] = None
    instruction_url: Optional[str] = None
    instruction_filename: Optional[str] = None


class UpdatePartRequest(BaseModel):
    part_number: Optional[str] = None
    description: Optional[str] = None


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


def wo_to_out(wo: WorkOrder) -> WOOut:
    instruction_url = None
    instruction_filename = None
    if wo.part_id:
        instruction_url = f"/parts/{wo.part_id}/file"
        if wo.part and wo.part.instruction_filename:
            instruction_filename = wo.part.instruction_filename
    return WOOut(
        id=wo.id,
        wo_number=wo.wo_number,
        station=wo.station,
        part_number=wo.part_number,
        customer_order=wo.customer_order,
        is_stock=wo.is_stock,
        status=wo.status,
        created_at=wo.created_at,
        instruction_url=instruction_url,
        instruction_filename=instruction_filename,
    )


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
    user = db.execute(select(User).where(User.name == payload.name.strip())).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    if not verify_pin(payload.pin.strip(), user.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")

    return LoginResponse(token=create_token(user), name=user.name, role=user.role)


# -----------------------------
# Users (Admin CRUD)
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
def update_user(
    user_id: int,
    req: UpdateUserRequest,
    _admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if req.name is not None:
        new_name = req.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Name cannot be blank")
        if new_name != u.name:
            exists = db.execute(select(User).where(User.name == new_name)).scalar_one_or_none()
            if exists:
                raise HTTPException(status_code=400, detail="User name already exists")
            u.name = new_name

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
def delete_user(
    user_id: int,
    _admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    # Safer than hard delete: deactivate
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = False
    db.commit()
    return OkResponse(ok=True)


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

    user = db.execute(select(User).where(User.name == req.name)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.pin_hash = hash_pin(req.new_pin)
    user.is_active = True
    db.commit()
    return OkResponse(ok=True)


@app.get("/stations")
def stations(_user: User = Depends(require_user)):
    return {"stations": STATIONS}


# -----------------------------
# Parts (Admin/Supervisor CRUD + file storage in DB)
# -----------------------------
@app.get("/parts", response_model=List[PartOut])
def list_parts(_u: User = Depends(require_role("admin", "supervisor")), db: Session = Depends(get_db)):
    parts = db.execute(select(Part).order_by(Part.part_number.asc())).scalars().all()
    out: List[PartOut] = []
    for p in parts:
        out.append(
            PartOut(
                id=p.id,
                part_number=p.part_number,
                description=p.description,
                instruction_url=(f"/parts/{p.id}/file" if p.instruction_bytes else None),
                instruction_filename=p.instruction_filename,
            )
        )
    return out


@app.post("/parts", response_model=PartOut)
async def create_part(
    part_number: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    _u: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    pn = part_number.strip()
    if not pn:
        raise HTTPException(status_code=400, detail="part_number is required")

    exists = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Part number already exists")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    p = Part(
        part_number=pn,
        description=(description.strip() or None),
        instruction_filename=file.filename,
        instruction_content_type=file.content_type or "application/octet-stream",
        instruction_bytes=content,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    return PartOut(
        id=p.id,
        part_number=p.part_number,
        description=p.description,
        instruction_url=f"/parts/{p.id}/file" if p.instruction_bytes else None,
        instruction_filename=p.instruction_filename,
    )


@app.patch("/parts/{part_id}", response_model=PartOut)
def update_part(
    part_id: int,
    req: UpdatePartRequest,
    _u: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    if req.part_number is not None:
        new_pn = req.part_number.strip()
        if not new_pn:
            raise HTTPException(status_code=400, detail="part_number cannot be blank")
        if new_pn != p.part_number:
            exists = db.execute(select(Part).where(Part.part_number == new_pn)).scalar_one_or_none()
            if exists:
                raise HTTPException(status_code=400, detail="Part number already exists")
            # also update any work orders that still hold old string
            old = p.part_number
            p.part_number = new_pn
            db.execute(select(WorkOrder))  # no-op to ensure mapper loaded
            wos = db.execute(select(WorkOrder).where(WorkOrder.part_number == old)).scalars().all()
            for wo in wos:
                wo.part_number = new_pn

    if req.description is not None:
        p.description = req.description.strip() or None

    db.commit()
    db.refresh(p)

    return PartOut(
        id=p.id,
        part_number=p.part_number,
        description=p.description,
        instruction_url=f"/parts/{p.id}/file" if p.instruction_bytes else None,
        instruction_filename=p.instruction_filename,
    )


@app.put("/parts/{part_id}/file", response_model=PartOut)
async def replace_part_file(
    part_id: int,
    file: UploadFile = File(...),
    _u: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    p.instruction_filename = file.filename
    p.instruction_content_type = file.content_type or "application/octet-stream"
    p.instruction_bytes = content

    db.commit()
    db.refresh(p)

    return PartOut(
        id=p.id,
        part_number=p.part_number,
        description=p.description,
        instruction_url=f"/parts/{p.id}/file" if p.instruction_bytes else None,
        instruction_filename=p.instruction_filename,
    )


@app.delete("/parts/{part_id}", response_model=OkResponse)
def delete_part(
    part_id: int,
    _u: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    # Keep work orders intact: just detach references
    wos = db.execute(select(WorkOrder).where(WorkOrder.part_id == part_id)).scalars().all()
    for wo in wos:
        wo.part_id = None  # keeps part_number string

    db.delete(p)
    db.commit()
    return OkResponse(ok=True)


@app.get("/parts/{part_id}/file")
def download_part_file(
    part_id: int,
    _u: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    p = db.get(Part, part_id)
    if not p or not p.instruction_bytes:
        raise HTTPException(status_code=404, detail="File not found")

    return Response(
        content=p.instruction_bytes,
        media_type=p.instruction_content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{p.instruction_filename or "instructions"}"'
        },
    )


# -----------------------------
# Work Orders CRUD + status transitions
# -----------------------------
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

    # attach part_id if exists in parts DB
    part = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()

    wo = WorkOrder(
        wo_number=next_wo_number(db),
        station=req.station,
        part_number=pn,
        part_id=(part.id if part else None),
        customer_order=(None if req.is_stock else co),
        is_stock=bool(req.is_stock),
        status="open",
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return wo_to_out(wo)


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
    # load related part
    for wo in wos:
        _ = wo.part
    return [wo_to_out(wo) for wo in wos]


@app.get("/work-orders/{wo_id}", response_model=WOOut)
def get_work_order(wo_id: int, _user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    _ = wo.part
    return wo_to_out(wo)


@app.patch("/work-orders/{wo_id}", response_model=WOOut)
def update_work_order(
    wo_id: int,
    req: UpdateWORequest,
    _sup: User = Depends(require_role("admin", "supervisor")),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    if req.station is not None:
        if req.station not in STATIONS:
            raise HTTPException(status_code=400, detail="Invalid station")
        wo.station = req.station

    if req.part_number is not None:
        pn = req.part_number.strip()
        if not pn:
            raise HTTPException(status_code=400, detail="part_number cannot be blank")
        wo.part_number = pn
        part = db.execute(select(Part).where(Part.part_number == pn)).scalar_one_or_none()
        wo.part_id = part.id if part else None

    if req.is_stock is not None:
        wo.is_stock = bool(req.is_stock)
        if wo.is_stock:
            wo.customer_order = None

    if req.customer_order is not None:
        # allow clearing if stock
        if not wo.is_stock:
            wo.customer_order = req.customer_order.strip() or None
        else:
            wo.customer_order = None

    if req.status is not None:
        s = req.status.strip().lower()
        if s not in ("open", "in_progress", "complete", "closed"):
            raise HTTPException(status_code=400, detail="status must be open, in_progress, complete, or closed")
        wo.status = s

    db.commit()
    db.refresh(wo)
    _ = wo.part
    return wo_to_out(wo)


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


# Status actions
@app.post("/work-orders/{wo_id}/mark-complete", response_model=CloseWOResponse)
def mark_complete(
    wo_id: int,
    _u: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Cannot mark complete: work order is closed")
    wo.status = "complete"
    db.commit()
    return CloseWOResponse(ok=True, status=wo.status)


@app.post("/work-orders/{wo_id}/undo-complete", response_model=CloseWOResponse)
def undo_complete(
    wo_id: int,
    _u: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status == "closed":
        raise HTTPException(status_code=400, detail="Cannot undo complete: work order is closed")
    # default back to in_progress if someone checked in, else open
    active = db.execute(
        select(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar_one_or_none()
    wo.status = "in_progress" if active else "open"
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
    # when reopening, go back to complete (safe) unless someone is checked in
    active = db.execute(
        select(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar_one_or_none()
    wo.status = "in_progress" if active else "complete"
    db.commit()
    return CloseWOResponse(ok=True, status=wo.status)


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
        out.append(WorkerOut(user_id=u.id, name=u.name, role=u.role, started_at=w.started_at))
    return out


@app.post("/work-orders/{wo_id}/workers/start", response_model=List[WorkerOut])
def start_working_on_wo(wo_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

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

    # if no one is checked in, and it's in_progress, fall back to open
    remaining = db.execute(
        select(WorkOrderWorker)
        .where(WorkOrderWorker.work_order_id == wo_id)
        .where(WorkOrderWorker.ended_at.is_(None))
    ).scalar_one_or_none()

    if not remaining and wo.status == "in_progress":
        wo.status = "open"

    db.commit()
    return OkResponse(ok=True)
