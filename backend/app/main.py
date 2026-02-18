import os
import io
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import (
    FastAPI, Request, Depends, HTTPException,
    UploadFile, File, Form, Response, Header, Query
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel, Field

from sqlalchemy import (
    create_engine, Column, Integer, String, Boolean,
    DateTime, ForeignKey, Text
)
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
    DATABASE_URL = "sqlite:///./dev.db"

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "168"))  # 7 days
RESET_TOKEN = os.getenv("RESET_TOKEN", "change-me")

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_ORIGINS = [
    "https://trr-assembly-work-orders.onrender.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
auth_scheme = HTTPBearer(auto_error=False)


# -----------------------------
# FastAPI App + CORS (ONE app ONLY)
# -----------------------------
app = FastAPI(title="TRR Assembly API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

@app.get("/__health")
def __health():
    return {"ok": True, "service": "trr-assembly-api"}


@app.options("/{path:path}")
async def preflight(path: str, request: Request):
    # Makes debugging easier, and guarantees PATCH preflight works
    origin = request.headers.get("origin")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Access-Control-Allow-Methods"] = "GET,POST,PATCH,PUT,DELETE,OPTIONS"
        headers["Access-Control-Allow-Headers"] = request.headers.get(
            "access-control-request-headers",
            "Authorization,Content-Type",
        )
        headers["Access-Control-Max-Age"] = "86400"
    return Response(status_code=200, headers=headers)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Ensures browser can READ the JSON error instead of just "CORS blocked"
    origin = request.headers.get("origin")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    # If you want the real stack trace in Render logs, it still goes there.
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"}, headers=headers)


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

def get_db() -> Session:
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

    filename = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    uploaded_at = Column(DateTime, nullable=True)

    qty_on_hand = Column(Integer, default=0)
    inventory_updated_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class InventoryTxn(Base):
    __tablename__ = "inventory_txns"
    id = Column(Integer, primary_key=True)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    txn_type = Column(String(20), nullable=False)  # receive|issue
    qty_delta = Column(Integer, nullable=False)
    note = Column(String(500), nullable=True)
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
    status = Column(String(30), default="open")  # open|in_progress|complete|closed
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


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)


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

class InventoryTxnOut(BaseModel):
    id: int
    part_id: int
    txn_type: str
    qty_delta: int
    note: Optional[str]
    user_id: Optional[int]
    created_at: datetime

class CreateWORequest(BaseModel):
    station: str
    part_id: Optional[int] = None
    part_number: Optional[str] = None
    customer_order: Optional[str] = None
    is_stock: bool = False

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
    s: Session = Depends(get_db),
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
# Auth endpoints
# -----------------------------
@app.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, s: Session = Depends(get_db)):
    u = s.query(User).filter(User.name == req.name, User.is_active == True).first()
    if not u or not verify_pin(req.pin, u.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid name or PIN")
    return LoginResponse(token=make_token(u), name=u.name, role=u.role)


# -----------------------------
# Admin reset pin
# -----------------------------
@app.post("/admin/reset-pin", response_model=OkResponse)
def reset_pin(
    req: ResetPinRequest,
    x_reset_token: Optional[str] = Header(default=None),
    _: User = Depends(require_role("admin")),
    s: Session = Depends(get_db),
):
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
def list_users(_: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    users = s.query(User).order_by(User.name.asc()).all()
    return [UserOut(id=u.id, name=u.name, role=u.role, is_active=u.is_active) for u in users]

@app.post("/users", response_model=OkResponse)
def create_user(req: CreateUserRequest, _: User = Depends(require_role("admin")), s: Session = Depends(get_db)):
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
def update_user(user_id: int, req: UpdateUserRequest, _: User = Depends(require_role("admin")), s: Session = Depends(get_db)):
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
# Parts (FIXED: FormData OR JSON, file optional)
# -----------------------------
@app.get("/parts", response_model=List[PartOut])
def list_parts(_: User = Depends(get_current_user), s: Session = Depends(get_db)):
    parts = s.query(Part).order_by(Part.part_number.asc()).all()
    return [
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
        for p in parts
    ]


@app.post("/parts")
async def create_part(
    request: Request,
    _: User = Depends(require_role("admin", "supervisor")),
    s: Session = Depends(get_db),
):
    """
    Accepts:
    - multipart/form-data: part_number(required), file(optional)
    - application/json: {"part_number": "..."}  (no file)
    """
    ct = (request.headers.get("content-type") or "").lower()
    part_number = ""
    upload: Optional[UploadFile] = None

    if "multipart/form-data" in ct:
        form = await request.form()
        part_number = (form.get("part_number") or "").strip()
        f = form.get("file")
        if isinstance(f, UploadFile):
            upload = f
    else:
        data = await request.json()
        part_number = (data.get("part_number") or "").strip()

    if not part_number:
        raise HTTPException(status_code=400, detail="part_number required")

    exists = s.query(Part).filter(Part.part_number == part_number).first()
    if exists:
        raise HTTPException(status_code=400, detail="Part already exists")

    p = Part(part_number=part_number, created_at=datetime.utcnow())

    if upload is not None:
        original_name = upload.filename or f"{part_number}.pdf"
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        stored_name = f"{part_number}_{stamp}_{original_name}"
        path = os.path.join(UPLOAD_DIR, stored_name)

        try:
            with open(path, "wb") as out:
                out.write(await upload.read())
        finally:
            try:
                await upload.close()
            except Exception:
                pass

        p.filename = original_name
        p.file_path = path
        p.uploaded_at = datetime.utcnow()

    s.add(p)
    s.commit()
    s.refresh(p)

    return {"id": p.id, "part_number": p.part_number, "has_file": bool(p.file_path), "filename": p.filename}


@app.post("/parts/{part_id}/upload", response_model=OkResponse)
async def upload_part_file(
    part_id: int,
    file: UploadFile = File(...),
    _: User = Depends(require_role("admin", "supervisor")),
    s: Session = Depends(get_db),
):
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")

    original_name = file.filename or f"{p.part_number}.pdf"
    stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    stored_name = f"{p.part_number}_{stamp}_{original_name}"
    path = os.path.join(UPLOAD_DIR, stored_name)

    try:
        with open(path, "wb") as out:
            out.write(await file.read())
    finally:
        try:
            await file.close()
        except Exception:
            pass

    p.filename = original_name
    p.file_path = path
    p.uploaded_at = datetime.utcnow()
    s.commit()
    return OkResponse()


def _file_response_for_part(p: Part):
    if not p.file_path or not os.path.exists(p.file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p.file_path, filename=p.filename or "instructions.pdf")


def _verify_token_from_header_or_query(
    token: Optional[str],
    creds: Optional[HTTPAuthorizationCredentials],
):
    jwt_token = token or (creds.credentials if creds else None)
    if not jwt_token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        jwt.decode(jwt_token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.get("/parts/{part_id}/file")
def get_part_file(
    part_id: int,
    token: Optional[str] = None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
    s: Session = Depends(get_db),
):
    _verify_token_from_header_or_query(token, creds)
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    return _file_response_for_part(p)


@app.get("/parts/{part_id}/download")
def download_part_file(
    part_id: int,
    token: Optional[str] = None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
    s: Session = Depends(get_db),
):
    _verify_token_from_header_or_query(token, creds)
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    return _file_response_for_part(p)


# -----------------------------
# Inventory
# -----------------------------
def record_inventory_txn(
    s: Session,
    part: Part,
    txn_type: str,
    qty_delta: int,
    note: Optional[str],
    user_id: Optional[int],
):
    tx = InventoryTxn(
        part_id=part.id,
        txn_type=txn_type,
        qty_delta=qty_delta,
        note=note,
        user_id=user_id,
        created_at=datetime.utcnow(),
    )
    s.add(tx)

@app.post("/parts/{part_id}/inventory/receive", response_model=OkResponse)
def inventory_receive(part_id: int, req: InventoryChangeRequest, u: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    p.qty_on_hand = int(p.qty_on_hand or 0) + int(req.qty)
    p.inventory_updated_at = datetime.utcnow()
    record_inventory_txn(s, p, "receive", int(req.qty), req.note, u.id)
    s.commit()
    return OkResponse()

@app.post("/parts/{part_id}/inventory/issue", response_model=OkResponse)
def inventory_issue(part_id: int, req: InventoryChangeRequest, u: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    p = s.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Part not found")
    new_qty = int(p.qty_on_hand or 0) - int(req.qty)
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Not enough inventory on hand")
    p.qty_on_hand = new_qty
    p.inventory_updated_at = datetime.utcnow()
    record_inventory_txn(s, p, "issue", -int(req.qty), req.note, u.id)
    s.commit()
    return OkResponse()

@app.get("/parts/{part_id}/inventory/txns", response_model=List[InventoryTxnOut])
def inventory_txns(part_id: int, limit: int = Query(200, ge=1, le=1000), _: User = Depends(get_current_user), s: Session = Depends(get_db)):
    rows = (
        s.query(InventoryTxn)
        .filter(InventoryTxn.part_id == part_id)
        .order_by(InventoryTxn.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        InventoryTxnOut(
            id=r.id,
            part_id=r.part_id,
            txn_type=r.txn_type,
            qty_delta=r.qty_delta,
            note=r.note,
            user_id=r.user_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


# -----------------------------
# Work Orders
# -----------------------------
def next_wo_number(s: Session) -> str:
    last = s.query(WorkOrder).order_by(WorkOrder.id.desc()).first()
    n = (last.id + 1) if last else 1
    return f"WO-{n:06d}"

@app.get("/work-orders", response_model=List[WOOut])
def list_work_orders(_: User = Depends(get_current_user), s: Session = Depends(get_db)):
    wos = s.query(WorkOrder).order_by(WorkOrder.created_at.desc()).limit(500).all()
    return [
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
        for w in wos
    ]

@app.post("/work-orders", response_model=WOOut)
def create_work_order(req: CreateWORequest, _: User = Depends(get_current_user), s: Session = Depends(get_db)):
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
def get_work_order(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(get_db)):
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

def _set_wo_status(s: Session, wo_id: int, new_status: str):
    wo = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    wo.status = new_status
    s.commit()
    return OkResponse()

@app.post("/work-orders/{wo_id}/complete", response_model=OkResponse)
def wo_complete(wo_id: int, _: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    return _set_wo_status(s, wo_id, "complete")

@app.post("/work-orders/{wo_id}/close", response_model=OkResponse)
def wo_close(wo_id: int, _: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    return _set_wo_status(s, wo_id, "closed")

@app.post("/work-orders/{wo_id}/reopen", response_model=OkResponse)
def wo_reopen(wo_id: int, _: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    return _set_wo_status(s, wo_id, "open")

@app.patch("/work-orders/{wo_id}", response_model=OkResponse)
def update_work_order(wo_id: int, payload: dict, _: User = Depends(require_role("admin", "supervisor")), s: Session = Depends(get_db)):
    wo = s.query(WorkOrder).filter(WorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    if "station" in payload and payload["station"] is not None:
        wo.station = str(payload["station"])

    if "part_id" in payload and payload["part_id"] is not None:
        pid = int(payload["part_id"])
        p = s.query(Part).filter(Part.id == pid).first()
        if not p:
            raise HTTPException(status_code=400, detail="Invalid part_id")
        wo.part_id = pid
        wo.part_number = p.part_number

    if "is_stock" in payload and payload["is_stock"] is not None:
        wo.is_stock = bool(payload["is_stock"])

    if "customer_order" in payload:
        wo.customer_order = payload["customer_order"] or None

    if "status" in payload and payload["status"] is not None:
        new_status = str(payload["status"]).lower()
        aliases = {"done": "complete", "completed": "complete", "finish": "complete", "finished": "complete"}
        new_status = aliases.get(new_status, new_status)
        if new_status not in {"open", "in_progress", "complete", "closed"}:
            raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
        wo.status = new_status

    s.commit()
    return OkResponse()


# -----------------------------
# Notes
# -----------------------------
@app.get("/work-orders/{wo_id}/notes", response_model=List[NoteOut])
def list_notes(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(get_db)):
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
def add_note(wo_id: int, req: AddNoteRequest, u: User = Depends(get_current_user), s: Session = Depends(get_db)):
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
def current_workers(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(get_db)):
    rows = (
        s.query(WorkerSession)
        .filter(WorkerSession.work_order_id == wo_id, WorkerSession.ended_at.is_(None))
        .order_by(WorkerSession.started_at.asc())
        .all()
    )
    return [
        WorkerOut(
            user_id=r.user_id,
            name=r.user.name,
            role=r.user.role,
            started_at=r.started_at,
            is_checked_in=True,
        )
        for r in rows
    ]

@app.get("/work-orders/{wo_id}/workers/history", response_model=List[WorkerHistoryOut])
def workers_history(wo_id: int, _: User = Depends(get_current_user), s: Session = Depends(get_db)):
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
def worker_check_in(wo_id: int, u: User = Depends(get_current_user), s: Session = Depends(get_db)):
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
    s.commit()
    return OkResponse()

@app.post("/work-orders/{wo_id}/workers/check-out", response_model=OkResponse)
def worker_check_out(wo_id: int, u: User = Depends(get_current_user), s: Session = Depends(get_db)):
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
    s.commit()
    return OkResponse()


# -----------------------------
# PDF print endpoint
# -----------------------------
@app.get("/work-orders/{wo_id}/print")
def print_work_order_pdf(
    wo_id: int,
    token: Optional[str] = None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
    s: Session = Depends(get_db),
):
    jwt_token = token or (creds.credentials if creds else None)
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
    history = s.query(WorkerSession).filter(WorkerSession.work_order_id == wo_id).order_by(WorkerSession.started_at.asc()).all()

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter

    y = height - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, y, f"Work Order: {w.wo_number}")
    y -= 24

    c.setFont("Helvetica", 11)
    c.drawString(50, y, f"Station: {w.station}"); y -= 16
    c.drawString(50, y, f"Part: {w.part_number}"); y -= 16
    c.drawString(50, y, f"Customer Order: {w.customer_order or ''}"); y -= 16
    c.drawString(50, y, f"Stock: {'YES' if w.is_stock else 'NO'}   Status: {w.status}"); y -= 16
    c.drawString(50, y, f"Created: {w.created_at.strftime('%Y-%m-%d %H:%M:%S')} UTC"); y -= 24

    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "Worker Fingerprint (Check-in/out):"); y -= 18
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
    c.drawString(50, y, "Notes:"); y -= 18
    c.setFont("Helvetica", 10)

    for n in notes:
        stamp = n.created_at.strftime("%Y-%m-%d %H:%M:%S")
        c.drawString(60, y, f"{stamp} UTC - {n.author_name}:"); y -= 14
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
