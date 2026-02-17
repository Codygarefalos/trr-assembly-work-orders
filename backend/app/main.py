import os
import io
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
)
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session

from passlib.context import CryptContext
from jose import jwt, JWTError

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


# -------------------------
# Config
# -------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me")
JWT_ALG = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

RESET_TOKEN = os.getenv("RESET_TOKEN", "")  # for /admin/reset-pin header

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# -------------------------
# DB
# -------------------------
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


# -------------------------
# Models
# -------------------------
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), unique=True, index=True, nullable=False)
    role = Column(String(32), nullable=False, default="assembler")  # assembler|supervisor|admin
    pin_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class Part(Base):
    __tablename__ = "parts"
    id = Column(Integer, primary_key=True)
    part_number = Column(String(120), unique=True, index=True, nullable=False)

    filename = Column(String(255), nullable=True)
    uploaded_at = Column(DateTime, nullable=True)

    qty_on_hand = Column(Integer, default=0, nullable=False)
    inventory_updated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class InventoryTxn(Base):
    __tablename__ = "inventory_txns"
    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    txn_type = Column(String(32), nullable=False)  # add|remove|set
    qty_delta = Column(Integer, nullable=False)

    note = Column(String(500), nullable=True)
    ref_wo_id = Column(Integer, ForeignKey("work_orders.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    part = relationship("Part")
    user = relationship("User")
    work_order = relationship("WorkOrder", back_populates="inventory_txns")


class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = Column(Integer, primary_key=True)
    wo_number = Column(String(64), unique=True, index=True, nullable=False)
    station = Column(String(64), nullable=False)

    part_id = Column(Integer, ForeignKey("parts.id"), nullable=True)
    part_number = Column(String(120), nullable=False, default="")
    customer_order = Column(String(120), nullable=True)
    is_stock = Column(Boolean, default=False)

    status = Column(String(32), default="open")  # open|closed|hold

    created_at = Column(DateTime, default=datetime.utcnow)

    part = relationship("Part")
    notes = relationship("Note", back_populates="work_order", cascade="all, delete-orphan")
    workers = relationship("WorkerSession", back_populates="work_order", cascade="all, delete-orphan")
    inventory_txns = relationship("InventoryTxn", back_populates="work_order")


class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)

    author_name = Column(String(120), nullable=False)
    station = Column(String(64), nullable=True)

    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    work_order = relationship("WorkOrder", back_populates="notes")


class WorkerSession(Base):
    """
    One row per check-in session.
    If ended_at is null => currently checked in.
    """
    __tablename__ = "worker_sessions"
    id = Column(Integer, primary_key=True)
    work_order_id = Column(Integer, ForeignKey("work_orders.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)

    work_order = relationship("WorkOrder", back_populates="workers")
    user = relationship("User")


Base.metadata.create_all(bind=engine)


# -------------------------
# Schemas
# -------------------------
class LoginRequest(BaseModel):
    name: str
    pin: str = Field(min_length=4, max_length=6)


class LoginResponse(BaseModel):
    token: str
    name: str
    role: str


class CreateUserRequest(BaseModel):
    name: str
    role: str
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

    class Config:
        from_attributes = True


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

    qty_on_hand: int = 0
    inventory_updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


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

    class Config:
        from_attributes = True


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
    status: Optional[str] = None


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
    instruction_url: Optional[str] = None  # part file URL if exists

    class Config:
        from_attributes = True


class AddNoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class NoteOut(BaseModel):
    id: int
    work_order_id: int
    author_name: str
    station: Optional[str]
    text: str
    created_at: datetime

    class Config:
        from_attributes = True


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


# -------------------------
# Helpers
# -------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def normalize_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def hash_pin(pin: str) -> str:
    return pwd_context.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    return pwd_context.verify(pin, pin_hash)


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "name": user.name,
        "role": user.role,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def auth_user(token: str = Header(..., alias="Authorization"), db: Session = Depends(get_db)) -> User:
    """
    Expect header: Authorization: Bearer <token>
    """
    if not token.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    raw = token.split(" ", 1)[1].strip()
    data = decode_token(raw)
    uid = int(data["sub"])
    user = db.get(User, uid)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or missing")
    return user


def require_role(user: User, allowed: List[str]):
    if user.role not in allowed:
        raise HTTPException(status_code=403, detail="Forbidden")


def part_to_out(p: Part) -> PartOut:
    return PartOut(
        id=p.id,
        part_number=p.part_number,
        has_file=bool(p.filename),
        filename=p.filename,
        uploaded_at=p.uploaded_at,
        qty_on_hand=p.qty_on_hand or 0,
        inventory_updated_at=p.inventory_updated_at,
    )


def wo_to_out(wo: WorkOrder) -> WOOut:
    instruction_url = None
    if wo.part and wo.part.filename:
        instruction_url = f"/parts/{wo.part_id}/file"
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


def next_wo_number() -> str:
    # Simple unique WO number (you can replace later)
    return f"WO-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"


def write_work_order_pdf(db: Session, wo: WorkOrder) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    w, h = letter

    y = h - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, "TRR Assembly Work Order")
    y -= 25

    c.setFont("Helvetica", 11)
    c.drawString(40, y, f"WO Number: {wo.wo_number}")
    y -= 16
    c.drawString(40, y, f"Station: {wo.station}")
    y -= 16
    c.drawString(40, y, f"Part: {wo.part_number or ''}")
    y -= 16
    c.drawString(40, y, f"Customer Order: {wo.customer_order or ''}")
    y -= 16
    c.drawString(40, y, f"Stock: {'Yes' if wo.is_stock else 'No'}")
    y -= 16
    c.drawString(40, y, f"Status: {wo.status}")
    y -= 16
    c.drawString(40, y, f"Created: {wo.created_at.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    y -= 22

    c.setFont("Helvetica-Bold", 12)
    c.drawString(40, y, "Notes")
    y -= 16
    c.setFont("Helvetica", 10)

    notes = (
        db.query(Note)
        .filter(Note.work_order_id == wo.id)
        .order_by(Note.created_at.asc())
        .all()
    )
    if not notes:
        c.drawString(40, y, "(none)")
        y -= 14
    else:
        for n in notes[-30:]:
            line = f"[{n.created_at.strftime('%Y-%m-%d %H:%M:%S')} UTC] {n.author_name}: {n.text}"
            for chunk in [line[i:i+110] for i in range(0, len(line), 110)]:
                if y < 60:
                    c.showPage()
                    y = h - 50
                    c.setFont("Helvetica", 10)
                c.drawString(40, y, chunk)
                y -= 12
            y -= 4

    c.setFont("Helvetica-Bold", 12)
    c.drawString(40, y, "Worker Fingerprint (Check-in / Check-out)")
    y -= 16
    c.setFont("Helvetica", 10)

    sessions = (
        db.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo.id)
        .order_by(WorkerSession.started_at.asc())
        .all()
    )
    if not sessions:
        c.drawString(40, y, "(none)")
        y -= 14
    else:
        for s in sessions[-50:]:
            u = db.get(User, s.user_id)
            name = u.name if u else f"User {s.user_id}"
            started = s.started_at.strftime("%Y-%m-%d %H:%M:%S")
            ended = s.ended_at.strftime("%Y-%m-%d %H:%M:%S") if s.ended_at else "—"
            c.drawString(40, y, f"{name} | IN: {started} UTC | OUT: {ended} UTC")
            y -= 12
            if y < 60:
                c.showPage()
                y = h - 50
                c.setFont("Helvetica", 10)

    c.showPage()
    c.save()
    return buf.getvalue()


# -------------------------
# App
# -------------------------
app = FastAPI(title="TRR Assembly API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # you can lock later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


# -------------------------
# Auth
# -------------------------
@app.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    name = normalize_name(req.name)
    user = db.query(User).filter(User.name == name).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid login")
    if not verify_pin(req.pin, user.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid login")
    token = create_token(user)
    return LoginResponse(token=token, name=user.name, role=user.role)


# -------------------------
# Users (admin/supervisor)
# -------------------------
@app.get("/users", response_model=List[UserOut])
def list_users(me: User = Depends(auth_user), db: Session = Depends(get_db)):
    require_role(me, ["admin", "supervisor"])
    return db.query(User).order_by(User.name.asc()).all()


@app.post("/users", response_model=UserOut)
def create_user(req: CreateUserRequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    require_role(me, ["admin"])
    name = normalize_name(req.name)
    if db.query(User).filter(User.name == name).first():
        raise HTTPException(status_code=400, detail="User already exists")
    u = User(name=name, role=req.role, pin_hash=hash_pin(req.pin), is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@app.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, req: UpdateUserRequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    require_role(me, ["admin"])
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="Not found")
    if req.name is not None:
        u.name = normalize_name(req.name)
    if req.role is not None:
        u.role = req.role
    if req.is_active is not None:
        u.is_active = req.is_active
    db.commit()
    db.refresh(u)
    return u


@app.post("/admin/reset-pin", response_model=OkResponse)
def reset_pin(req: ResetPinRequest, x_reset_token: str = Header("", alias="X-Reset-Token"), db: Session = Depends(get_db)):
    if not RESET_TOKEN or x_reset_token != RESET_TOKEN:
        raise HTTPException(status_code=403, detail="Bad reset token")

    name = normalize_name(req.name)
    u = db.query(User).filter(User.name == name).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.pin_hash = hash_pin(req.new_pin)
    db.commit()
    return OkResponse(ok=True)


# -------------------------
# Parts + File
# -------------------------
@app.get("/parts", response_model=List[PartOut])
def list_parts(me: User = Depends(auth_user), db: Session = Depends(get_db)):
    parts = db.query(Part).order_by(Part.part_number.asc()).all()
    return [part_to_out(p) for p in parts]


@app.post("/parts", response_model=PartOut)
def create_part(
    part_number: str = Form(...),
    description: str = Form(""),  # currently unused but keeps your frontend compatible
    file: UploadFile = File(...),
    me: User = Depends(auth_user),
    db: Session = Depends(get_db),
):
    require_role(me, ["admin", "supervisor"])

    pn = (part_number or "").strip()
    if not pn:
        raise HTTPException(status_code=400, detail="Part number required")
    if db.query(Part).filter(Part.part_number == pn).first():
        raise HTTPException(status_code=400, detail="Part already exists")

    p = Part(part_number=pn)
    db.add(p)
    db.commit()
    db.refresh(p)

    # Save file
    ext = os.path.splitext(file.filename or "")[1].lower()
    safe_name = f"part_{p.id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, safe_name)

    with open(path, "wb") as f:
        f.write(file.file.read())

    p.filename = safe_name
    p.uploaded_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return part_to_out(p)


@app.patch("/parts/{part_id}", response_model=PartOut)
def update_part(part_id: int, req: UpdatePartRequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    require_role(me, ["admin", "supervisor"])
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    pn = (req.part_number or "").strip()
    if not pn:
        raise HTTPException(status_code=400, detail="Part number required")
    # enforce uniqueness
    exists = db.query(Part).filter(Part.part_number == pn, Part.id != part_id).first()
    if exists:
        raise HTTPException(status_code=400, detail="Part number already used")
    p.part_number = pn
    db.commit()
    db.refresh(p)
    return part_to_out(p)


@app.get("/parts/{part_id}/file")
def download_part_file(part_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    p = db.get(Part, part_id)
    if not p or not p.filename:
        raise HTTPException(status_code=404, detail="No file")
    path = os.path.join(UPLOAD_DIR, p.filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing on server")
    def iterfile():
        with open(path, "rb") as f:
            yield from f
    return StreamingResponse(iterfile(), media_type="application/octet-stream")


# -------------------------
# Inventory
# -------------------------
def log_inventory(db: Session, part: Part, txn_type: str, qty_delta: int, note: Optional[str], ref_wo_id: Optional[int], user_id: Optional[int]):
    txn = InventoryTxn(
        part_id=part.id,
        txn_type=txn_type,
        qty_delta=qty_delta,
        note=note,
        ref_wo_id=ref_wo_id,
        user_id=user_id,
        created_at=datetime.utcnow(),
    )
    db.add(txn)


@app.get("/inventory", response_model=List[PartOut])
def inventory_list(me: User = Depends(auth_user), db: Session = Depends(get_db)):
    parts = db.query(Part).order_by(Part.part_number.asc()).all()
    return [part_to_out(p) for p in parts]


@app.get("/inventory/txns", response_model=List[InventoryTxnOut])
def inventory_txns(me: User = Depends(auth_user), db: Session = Depends(get_db), limit: int = 200):
    limit = max(1, min(limit, 500))
    txns = db.query(InventoryTxn).order_by(InventoryTxn.created_at.desc()).limit(limit).all()
    return txns


@app.post("/parts/{part_id}/inventory/add", response_model=PartOut)
def inventory_add(part_id: int, req: InventoryChangeRequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    require_role(me, ["admin", "supervisor"])
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    p.qty_on_hand = int(p.qty_on_hand or 0) + int(req.qty)
    p.inventory_updated_at = datetime.utcnow()
    log_inventory(db, p, "add", int(req.qty), req.note, req.ref_wo_id, me.id)
    db.commit()
    db.refresh(p)
    return part_to_out(p)


@app.post("/parts/{part_id}/inventory/remove", response_model=PartOut)
def inventory_remove(part_id: int, req: InventoryChangeRequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    require_role(me, ["admin", "supervisor"])
    p = db.get(Part, part_id)
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    cur = int(p.qty_on_hand or 0)
    if req.qty > cur:
        raise HTTPException(status_code=400, detail=f"Not enough on hand (have {cur})")
    p.qty_on_hand = cur - int(req.qty)
    p.inventory_updated_at = datetime.utcnow()
    log_inventory(db, p, "remove", -int(req.qty), req.note, req.ref_wo_id, me.id)
    db.commit()
    db.refresh(p)
    return part_to_out(p)


# -------------------------
# Work Orders
# -------------------------
@app.get("/work-orders", response_model=List[WOOut])
def list_work_orders(me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wos = db.query(WorkOrder).order_by(WorkOrder.created_at.desc()).limit(500).all()
    return [wo_to_out(wo) for wo in wos]


@app.post("/work-orders", response_model=WOOut)
def create_work_order(req: CreateWORequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    station = (req.station or "").strip()
    if not station:
        raise HTTPException(status_code=400, detail="Station required")

    part_id = req.part_id
    part_number = (req.part_number or "").strip()

    part = None
    if part_id is not None:
        part = db.get(Part, part_id)
        if not part:
            raise HTTPException(status_code=404, detail="Part not found")
        part_number = part.part_number
    elif part_number:
        part = db.query(Part).filter(Part.part_number == part_number).first()
        if part:
            part_id = part.id

    wo = WorkOrder(
        wo_number=next_wo_number(),
        station=station,
        part_id=part_id,
        part_number=part_number or "",
        customer_order=(req.customer_order or "").strip() or None,
        is_stock=bool(req.is_stock),
        status="open",
    )
    db.add(wo)
    db.commit()
    db.refresh(wo)
    return wo_to_out(wo)


@app.get("/work-orders/{wo_id}", response_model=WOOut)
def get_work_order(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")
    return wo_to_out(wo)


@app.patch("/work-orders/{wo_id}", response_model=WOOut)
def update_work_order(wo_id: int, req: UpdateWORequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    # allow assembler to update station/customer/is_stock; status only for admin/supervisor
    if req.station is not None:
        wo.station = req.station.strip()
    if req.customer_order is not None:
        wo.customer_order = req.customer_order.strip() or None
    if req.is_stock is not None:
        wo.is_stock = bool(req.is_stock)

    if req.part_id is not None:
        p = db.get(Part, req.part_id)
        if not p:
            raise HTTPException(status_code=404, detail="Part not found")
        wo.part_id = p.id
        wo.part_number = p.part_number

    if req.status is not None:
        require_role(me, ["admin", "supervisor"])
        wo.status = req.status

    db.commit()
    db.refresh(wo)
    return wo_to_out(wo)


# -------------------------
# Notes
# -------------------------
@app.get("/work-orders/{wo_id}/notes", response_model=List[NoteOut])
def list_notes(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")
    notes = db.query(Note).filter(Note.work_order_id == wo_id).order_by(Note.created_at.asc()).all()
    return notes


@app.post("/work-orders/{wo_id}/notes", response_model=NoteOut)
def add_note(wo_id: int, req: AddNoteRequest, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    n = Note(
        work_order_id=wo_id,
        author_name=me.name,
        station=wo.station,
        text=req.text,
        created_at=datetime.utcnow(),
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


# -------------------------
# Worker fingerprint (check-in/out)
# -------------------------
@app.get("/work-orders/{wo_id}/workers", response_model=List[WorkerOut])
def current_workers(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    active = (
        db.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.ended_at.is_(None))
        .order_by(WorkerSession.started_at.asc())
        .all()
    )
    out: List[WorkerOut] = []
    for s in active:
        u = db.get(User, s.user_id)
        if not u:
            continue
        out.append(WorkerOut(user_id=u.id, name=u.name, role=u.role, started_at=s.started_at, is_checked_in=True))
    return out


@app.get("/work-orders/{wo_id}/workers/history", response_model=List[WorkerHistoryOut])
def worker_history(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    sessions = (
        db.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id)
        .order_by(WorkerSession.started_at.asc())
        .all()
    )
    out: List[WorkerHistoryOut] = []
    for s in sessions:
        u = db.get(User, s.user_id)
        if not u:
            continue
        out.append(
            WorkerHistoryOut(
                id=s.id,
                user_id=u.id,
                name=u.name,
                role=u.role,
                started_at=s.started_at,
                ended_at=s.ended_at,
            )
        )
    return out


@app.post("/work-orders/{wo_id}/workers/check-in", response_model=OkResponse)
def check_in(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    existing = (
        db.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.user_id == me.id, WorkerSession.ended_at.is_(None))
        .first()
    )
    if existing:
        return OkResponse(ok=True)

    s = WorkerSession(work_order_id=wo_id, user_id=me.id, started_at=datetime.utcnow(), ended_at=None)
    db.add(s)
    db.commit()
    return OkResponse(ok=True)


@app.post("/work-orders/{wo_id}/workers/check-out", response_model=OkResponse)
def check_out(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    existing = (
        db.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.user_id == me.id, WorkerSession.ended_at.is_(None))
        .first()
    )
    if not existing:
        return OkResponse(ok=True)

    existing.ended_at = datetime.utcnow()
    db.commit()
    return OkResponse(ok=True)


# -------------------------
# PDF print endpoint
# -------------------------
@app.get("/work-orders/{wo_id}/print")
def print_work_order_pdf(wo_id: int, me: User = Depends(auth_user), db: Session = Depends(get_db)):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Not found")

    pdf = write_work_order_pdf(db, wo)
    filename = f"{wo.wo_number}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
