import os
import io
import uuid
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Response, Header
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://trr-assembly-work-orders.onrender.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session

from passlib.context import CryptContext
from jose import jwt, JWTError

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


# -----------------------------
# Config
# -----------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if not DATABASE_URL:
    # Local fallback (docker-compose, etc.)
    DATABASE_URL = "sqlite:///./dev.db"

# Render Postgres URLs often start with postgres:// which SQLAlchemy wants as postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "168"))  # 7 days

# Used for admin pin reset endpoint
RESET_TOKEN = os.getenv("RESET_TOKEN", "change-me")

# CORS: allow your Render frontend + localhost
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://trr-assembly-work-orders.onrender.com").strip()
ALLOWED_ORIGINS = [
    FRONTEND_ORIGIN,
    "http://localhost:5173",
]

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")  # in Render container
os.makedirs(UPLOAD_DIR, exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
auth_scheme = HTTPBearer(auto_error=False)


# -----------------------------
# DB
# -----------------------------
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


def db() -> Session:
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


# -----------------------------
# Models
# -----------------------------
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), unique=True, nullable=False)
    role = Column(String(30), nullable=False, default="assembler")  # assembler|supervisor|admin
    pin_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)


class Part(Base):
    __tablename__ = "parts"
    id = Column(Integer, primary_key=True)
    part_number = Column(String(120), unique=True, nullable=False)
    description = Column(String(255), nullable=True)

    # file
    file_path = Column(String(500), nullable=True)
    filename = Column(String(255), nullable=True)
    uploaded_at = Column(DateTime, nullable=True)

    # inventory
    qty_on_hand = Column(Integer, default=0)
    inventory_updated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class InventoryTxn(Base):
    __tablename__ = "inventory_txns"
    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    txn_type = Column(String(20), nullable=False)  # add|remove|set
    qty_delta = Column(Integer, nullable=False)
    note = Column(String(500), nullable=True)
    ref_wo_id = Column(Integer, ForeignKey("work_orders.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    part = relationship("Part")
    user = relationship("User")


class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = Column(Integer, primary_key=True)
    wo_number = Column(String(50), unique=True, nullable=False)
    station = Column(String(120), nullable=False)

    part_id = Column(Integer, ForeignKey("parts.id"), nullable=True)
    part_number = Column(String(120), nullable=False, default="")

    customer_order = Column(String(120), nullable=True)
    is_stock = Column(Boolean, default=False)
    status = Column(String(30), default="open")  # open|closed|hold
    created_at = Column(DateTime, default=datetime.utcnow)

    part = relationship("Part")


class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)
    author_name = Column(String(120), nullable=False)
    station = Column(String(120), nullable=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkerSession(Base):
    __tablename__ = "worker_sessions"
    id = Column(Integer, primary_key=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)

    user = relationship("User")


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
    description: Optional[str] = None
    has_file: bool
    filename: Optional[str] = None
    uploaded_at: Optional[datetime] = None

    qty_on_hand: int = 0
    inventory_updated_at: Optional[datetime] = None


class InventoryChangeRequest(BaseModel):
    qty: int = Field(ge=1, le=1_000_000)
    note: Optional[str] = None
    ref_wo_id: Optional[int] = None


class InventoryTxnOut(BaseModel):
    id: int
    part_id: int
    txn_type: str
    qty_delta: int
    note: Optional[str]
    ref_wo_id: Optional[int]
    user_id: Optional[int]
    created_at: datetime


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
    status: Optional[str] = None  # allow admin/supervisor edit


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
# Auth helpers
# -----------------------------
def hash_pin(pin: str) -> str:
    return pwd_context.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return pwd_context.verify(pin, pin_hash)
    except Exception:
        return False


def make_token(u: User) -> str:
    exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": str(u.id), "name": u.name, "role": u.role, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
    s: Session = Depends(db),
) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing token")

    token = creds.credentials
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = int(data.get("sub"))
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    u = s.query(User).filter(User.id == uid, User.is_active == True).first()
    if not u:
        raise HTTPException(status_code=401, detail="Invalid token")
    return u


def require_role(*roles: str):
    def _dep(u: User = Depends(get_current_user)) -> User:
        if u.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return u
    return _dep


# -----------------------------
# App
# -----------------------------
app = FastAPI(title="TRR Assembly API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)



# -----------------------------
# Auth endpoints
# -----------------------------
@app.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, s: Session = Depends(db)):
    u = s.query(User).filter(User.name == req.name, User.is_active == True).first()
    if not u or not verify_pin(req.pin, u.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    return LoginResponse(token=make_token(u), name=u.name, role=u.role)


# -----------------------------
# Admin: reset pin
# -----------------------------
@app.post("/admin/reset-pin", response_model=OkResponse)
def reset_pin(req: ResetPinRequest, x_reset_token: Optional[str] = Header(default=None), s: Session = Depends(db)):
    if not x_reset_token or x_reset_token != RESET_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid reset token")

    u = s.query(User).filter(User.name == req.name).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    u.pin_hash = hash_pin(req.new_pin)
    s.commit()
    return OkResponse()


# -----------------------------
# Users
# -----------------------------
@app.get("/users", response_model=List[UserOut])
def list_users(_: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(db)):
    users = s.query(User).order_by(User.name.asc()).all()
    return [UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active) for u in users]


@app.post("/users", response_model=OkResponse)
def create_user(req: CreateUserRequest, _: User = Depends(require_role("admin")), s: Session = Depends(db)):
    if req.role not in ("assembler", "supervisor", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")

    exists = s.query(User).filter(User.name == req.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="User already exists")

    u = User(name=req.name, role=req.role, pin_hash=hash_pin(req.pin), is_active=True)
    s.add(u)
    s.commit()
    return OkResponse()


@app.patch("/users/{user_id}", response_model=OkResponse)
def update_user(user_id: int, req: UpdateUserRequest, _: User = Depends(require_role("admin")), s: Session = Depends(db)):
    u = s.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if req.name is not None:
        u.name = req.name
    if req.role is not None:
        if req.role not in ("assembler", "supervisor", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        u.role = req.role
    if req.is_active is not None:
        u.is_active = req.is_active

    s.commit()
    return OkResponse()


# -----------------------------
# Parts
# -----------------------------
@app.get("/parts", response_model=List[PartOut])
def list_parts(_: User = Depends(get_current_user), s: Session = Depends(db)):
    parts = s.query(Part).order_by(Part.part_number.asc()).all()
    out = []
    for p in parts:
        out.append(
            PartOut(
                id=p.id,
                part_number=p.part_number,
                description=p.description,
                has_file=bool(p.file_path),
                filename=p.filename,
                uploaded_at=p.uploaded_at,
                qty_on_hand=p.qty_on_hand or 0,
                inventory_updated_at=p.inventory_updated_at,
            )
        )
    return out


@app.post("/parts", response_model=OkResponse)
def create_part(
    part_number: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    _: User = Depends(require_role("admin", "supervisor")),
    s: Session = Depends(db),
):
    pn = part_number.strip()
    if not pn:
        raise HTTPException(status_code=400, detail="part_number is required")

    existing = s.query(Part).filter(Part.part_number == pn).first()
    if existing:
        raise HTTPException(status_code=400, detail="Part already exists")

    # Save file
    safe_name = file.filename or "upload.bin"
    ext = os.path.splitext(safe_name)[1]
    disk_name = f"{uuid.uuid4().hex}{ext}"
    disk_path = os.path.join(UPLOAD_DIR, disk_name)

    content = file.file.read()
    with open(disk_path, "wb") as f:
        f.write(content)

    p = Part(
        part_number=pn,
        description=description.strip() or None,
        file_path=disk_path,
        filename=safe_name,
        uploaded_at=datetime.utcnow(),
        qty_on_hand=0,
        inventory_updated_at=datetime.utcnow(),
    )
    s.add(p)
    s.commit()
    return OkResponse()


@app.get("/parts/{part_id}/file")
def download_part_file(part_id: int, _: User = Depends(get_current_user), s: Session = Depends(db)):
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    if not p.file_path or not os.path.exists(p.file_path):
        raise HTTPException(status_code=404, detail="No file for this part")

    with open(p.file_path, "rb") as f:
        data = f.read()

    headers = {
        "Content-Disposition": f'inline; filename="{p.filename or "part.pdf"}"'
    }
    return Response(content=data, media_type="application/octet-stream", headers=headers)


# -----------------------------
# Inventory
# -----------------------------
def record_inventory_txn(
    s: Session,
    part: Part,
    txn_type: str,
    qty_delta: int,
    note: Optional[str],
    ref_wo_id: Optional[int],
    user_id: Optional[int],
):
    tx = InventoryTxn(
        part_id=part.id,
        txn_type=txn_type,
        qty_delta=qty_delta,
        note=note,
        ref_wo_id=ref_wo_id,
        user_id=user_id,
        created_at=datetime.utcnow(),
    )
    s.add(tx)


@app.post("/inventory/{part_id}/add", response_model=OkResponse)
def inventory_add(part_id: int, req: InventoryChangeRequest, u: User = Depends(get_current_user), s: Session = Depends(db)):
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    p.qty_on_hand = int(p.qty_on_hand or 0) + int(req.qty)
    p.inventory_updated_at = datetime.utcnow()
    record_inventory_txn(s, p, "add", int(req.qty), req.note, req.ref_wo_id, u.id)
    s.commit()
    return OkResponse()


@app.post("/inventory/{part_id}/remove", response_model=OkResponse)
def inventory_remove(part_id: int, req: InventoryChangeRequest, u: User = Depends(get_current_user), s: Session = Depends(db)):
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    new_qty = int(p.qty_on_hand or 0) - int(req.qty)
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Not enough inventory on hand")

    p.qty_on_hand = new_qty
    p.inventory_updated_at = datetime.utcnow()
    record_inventory_txn(s, p, "remove", -int(req.qty), req.note, req.ref_wo_id, u.id)
    s.commit()
    return OkResponse()


@app.get("/inventory/{part_id}/txns", response_model=List[InventoryTxnOut])
def inventory_txns(part_id: int, _: User = Depends(get_current_user), s: Session = Depends(db)):
    rows = (
        s.query(InventoryTxn)
        .filter(InventoryTxn.part_id == part_id)
        .order_by(InventoryTxn.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        InventoryTxnOut(
            id=r.id,
            part_id=r.part_id,
            txn_type=r.txn_type,
            qty_delta=r.qty_delta,
            note=r.note,
            ref_wo_id=r.ref_wo_id,
            user_id=r.user_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


# -----------------------------
# Work Orders
# -----------------------------
def next_wo_number(s: Session) -> str:
    # simple WO numbering: WO-000001 etc.
    last = s.query(WorkOrder).order_by(WorkOrder.id.desc()).first()
    n = (last.id + 1) if last else 1
    return f"WO-{n:06d}"


@app.get("/work-orders", response_model=List[WOOut])
def list_work_orders(_: User = Depends(get_current_user), s: Session = Depends(db)):
    wos = s.query(WorkOrder).order_by(WorkOrder.created_at.desc()).limit(500).all()
    out = []
    for w in wos:
        out.append(
            WOOut(
                id=w.id,
                wo_number=w.wo_number,
                station=w.station,
                part_number=w.part_number,
                part_id=w.part_id,
                customer_order=w.customer_order,
                is_stock=w.is_stock,
                status=w.status,
                created_at=w.created_at,
                instruction_url=(f"/parts/{w.part_id}/file" if w.part_id else None),
            )
        )
    return out


@app.post("/work-orders", response_model=WOOut)
def create_work_order(req: CreateWORequest, _: User = Depends(get_current_user), s: Session = Depends(db)):
    part_id = req.part_id
    part_number = (req.part_number or "").strip()

    if part_id:
        p = s.query(Part).filter(Part.id == part_id).first()
        if not p:
            raise HTTPException(status_code=400, detail="Invalid part_id")
        part_number = p.part_number

    if not part_number:
        raise HTTPException(status_code=400, detail="part_number is required")

    w = WorkOrder(
        wo_number=next_wo_number(s),
        station=req.station.strip(),
        part_id=part_id,
        part_number=part_number,
        customer_order=req.customer_order,
        is_stock=bool(req.is_stock),
        status="open",
        created_at=datetime.utcnow(),
    )
    s.add(w)
    s.commit()
    s.refresh(w)

    return WOOut(
        id=w.id,
        wo_number=w.wo_number,
        station=w.station,
        part_number=w.part_number,
        part_id=w.part_id,
        customer_order=w.customer_order,
        is_stock=w.is_stock,
        status=w.status,
        created_at=w.created_at,
        instruction_url=(f"/parts/{w.part_id}/file" if w.part_id else None),
    )


@app.get("/work-orders/{wo_id}", response_model=WOOut)
def get_work_order(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(db)):
    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    return WOOut(
        id=w.id,
        wo_number=w.wo_number,
        station=w.station,
        part_number=w.part_number,
        part_id=w.part_id,
        customer_order=w.customer_order,
        is_stock=w.is_stock,
        status=w.status,
        created_at=w.created_at,
        instruction_url=(f"/parts/{w.part_id}/file" if w.part_id else None),
    )


@app.patch("/work-orders/{wo_id}", response_model=OkResponse)
def update_work_order(wo_id: int, req: UpdateWORequest, u: User = Depends(get_current_user), s: Session = Depends(db)):
    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    if req.station is not None:
        w.station = req.station.strip()
    if req.customer_order is not None:
        w.customer_order = req.customer_order
    if req.is_stock is not None:
        w.is_stock = bool(req.is_stock)

    if req.part_id is not None:
        if req.part_id:
            p = s.query(Part).filter(Part.id == req.part_id).first()
            if not p:
                raise HTTPException(status_code=400, detail="Invalid part_id")
            w.part_id = p.id
            w.part_number = p.part_number
        else:
            w.part_id = None

    if req.status is not None:
        if u.role not in ("admin", "supervisor"):
            raise HTTPException(status_code=403, detail="Forbidden")
        if req.status not in ("open", "closed", "hold"):
            raise HTTPException(status_code=400, detail="Invalid status")
        w.status = req.status

    s.commit()
    return OkResponse()


# -----------------------------
# Notes
# -----------------------------
@app.get("/work-orders/{wo_id}/notes", response_model=List[NoteOut])
def list_notes(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(db)):
    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    notes = s.query(Note).filter(Note.work_order_id == wo_id).order_by(Note.created_at.asc()).all()
    return [
        NoteOut(
            id=n.id,
            work_order_id=n.work_order_id,
            author_name=n.author_name,
            station=n.station,
            text=n.text,
            created_at=n.created_at,
        )
        for n in notes
    ]


@app.post("/work-orders/{wo_id}/notes", response_model=OkResponse)
def add_note(wo_id: int, req: AddNoteRequest, u: User = Depends(get_current_user), s: Session = Depends(db)):
    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    n = Note(
        work_order_id=wo_id,
        author_name=u.name,
        station=w.station,
        text=req.text.strip(),
        created_at=datetime.utcnow(),
    )
    s.add(n)
    s.commit()
    return OkResponse()


# -----------------------------
# Workers (Fingerprint)
# -----------------------------
@app.get("/work-orders/{wo_id}/workers", response_model=List[WorkerOut])
def current_workers(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(db)):
    rows = (
        s.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.ended_at.is_(None))
        .order_by(WorkerSession.started_at.asc())
        .all()
    )
    out = []
    for r in rows:
        out.append(
            WorkerOut(
                user_id=r.user_id,
                name=r.user.name,
                role=r.user.role,
                started_at=r.started_at,
                is_checked_in=True,
            )
        )
    return out


@app.get("/work-orders/{wo_id}/workers/history", response_model=List[WorkerHistoryOut])
def workers_history(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(db)):
    rows = (
        s.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id)
        .order_by(WorkerSession.started_at.desc())
        .limit(300)
        .all()
    )
    return [
        WorkerHistoryOut(
            id=r.id,
            user_id=r.user_id,
            name=r.user.name,
            role=r.user.role,
            started_at=r.started_at,
            ended_at=r.ended_at,
        )
        for r in rows
    ]


@app.post("/work-orders/{wo_id}/workers/check-in", response_model=OkResponse)
def worker_check_in(wo_id: int, u: User = Depends(get_current_user), s: Session = Depends(db)):
    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    existing_open = (
        s.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.user_id == u.id, WorkerSession.ended_at.is_(None))
        .first()
    )
    if existing_open:
        return OkResponse()

    sess = WorkerSession(work_order_id=wo_id, user_id=u.id, started_at=datetime.utcnow(), ended_at=None)
    s.add(sess)

    # Optional: also drop a note automatically
    s.add(Note(
        work_order_id=wo_id,
        author_name=u.name,
        station=w.station,
        text=f"[CHECK-IN] {u.name} checked in at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
        created_at=datetime.utcnow(),
    ))

    s.commit()
    return OkResponse()


@app.post("/work-orders/{wo_id}/workers/check-out", response_model=OkResponse)
def worker_check_out(wo_id: int, u: User = Depends(get_current_user), s: Session = Depends(db)):
    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    existing_open = (
        s.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.user_id == u.id, WorkerSession.ended_at.is_(None))
        .first()
    )
    if not existing_open:
        return OkResponse()

    existing_open.ended_at = datetime.utcnow()

    # Optional: also drop a note automatically
    s.add(Note(
        work_order_id=wo_id,
        author_name=u.name,
        station=w.station,
        text=f"[CHECK-OUT] {u.name} checked out at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
        created_at=datetime.utcnow(),
    ))

    s.commit()
    return OkResponse()


# -----------------------------
# PDF print endpoint
# -----------------------------
@app.get("/work-orders/{wo_id}/print")
def print_work_order_pdf(
    wo_id: int,
    token: Optional[str] = None,  # allow "pop-out" link style
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
    s: Session = Depends(db),
):
    # Support either:
    # 1) Authorization: Bearer <token>
    # 2) /print?token=<token> (your frontend button)
    jwt_token = None
    if token:
        jwt_token = token
    elif creds and creds.credentials:
        jwt_token = creds.credentials

    if not jwt_token:
        raise HTTPException(status_code=401, detail="Missing token")

    try:
        jwt.decode(jwt_token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    w = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Work order not found")

    notes = s.query(Note).filter(Note.work_order_id == wo_id).order_by(Note.created_at.asc()).all()
    history = (
        s.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id)
        .order_by(WorkerSession.started_at.asc())
        .all()
    )

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter

    y = height - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, y, f"Work Order: {w.wo_number}")
    y -= 24

    c.setFont("Helvetica", 11)
    c.drawString(50, y, f"Station: {w.station}")
    y -= 16
    c.drawString(50, y, f"Part: {w.part_number}")
    y -= 16
    c.drawString(50, y, f"Customer Order: {w.customer_order or ''}")
    y -= 16
    c.drawString(50, y, f"Stock: {'YES' if w.is_stock else 'NO'}   Status: {w.status}")
    y -= 16
    c.drawString(50, y, f"Created: {w.created_at.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    y -= 24

    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "Worker Fingerprint (Check-in/out):")
    y -= 18
    c.setFont("Helvetica", 10)

    for ws in history:
        line = f"{ws.user.name} ({ws.user.role}) IN: {ws.started_at.strftime('%Y-%m-%d %H:%M:%S')} UTC"
        if ws.ended_at:
            line += f"  OUT: {ws.ended_at.strftime('%Y-%m-%d %H:%M:%S')} UTC"
        else:
            line += "  OUT: (still checked in)"
        c.drawString(60, y, line)
        y -= 14
        if y < 80:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 10)

    y -= 10
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "Notes:")
    y -= 18
    c.setFont("Helvetica", 10)

    for n in notes:
        stamp = n.created_at.strftime("%Y-%m-%d %H:%M:%S")
        header = f"{stamp} UTC - {n.author_name}:"
        c.drawString(60, y, header)
        y -= 14

        # wrap note text
        text = (n.text or "").replace("\r", "")
        for raw_line in text.split("\n"):
            line = raw_line.strip()
            while line:
                chunk = line[:95]
                line = line[95:]
                c.drawString(70, y, chunk)
                y -= 12
                if y < 80:
                    c.showPage()
                    y = height - 50
                    c.setFont("Helvetica", 10)

        y -= 8
        if y < 80:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 10)

    c.showPage()
    c.save()
    buf.seek(0)

    pdf = buf.getvalue()
    headers = {"Content-Disposition": f'inline; filename="{w.wo_number}.pdf"'}
    return Response(content=pdf, media_type="application/pdf", headers=headers)
