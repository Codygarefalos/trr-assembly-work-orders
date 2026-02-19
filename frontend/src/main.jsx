import React from "react";
import { createRoot } from "react-dom/client";

/**
 * API base:
 * - set VITE_API_BASE in Render (Frontend) env vars to: https://trr-assembly-api.onrender.com
 * - local dev default: http://127.0.0.1:8000
 */
const API_BASE = (import.meta?.env?.VITE_API_BASE || "https://trr-assembly-api.onrender.com").replace(/\/$/, "");

function cls(...a) {
  return a.filter(Boolean).join(" ");
}

async function api(path, { method = "GET", token, body, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) data = await res.json().catch(() => null);
  else data = await res.text().catch(() => null);

  if (!res.ok) {
    const msg = (data && data.detail) ? data.detail : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function formatDT(s) {
  if (!s) return "";
  const d = new Date(s.endsWith("Z") ? s : s + "Z");
  return d.toLocaleString();
}

function Pill({ children, tone = "gray" }) {
  const tones = {
    gray: "bg-gray",
    green: "bg-green",
    blue: "bg-blue",
    red: "bg-red",
    black: "bg-black",
  };
  return <span className={cls("pill", tones[tone] || "bg-gray")}>{children}</span>;
}

function Button({ children, onClick, tone = "default", disabled }) {
  return (
    <button
      className={cls("btn", tone !== "default" && `btn-${tone}`)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

function Banner({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="banner">
      <div className="banner-text">{message}</div>
      <button className="icon-btn" onClick={onClose} title="Close">✕</button>
    </div>
  );
}

function Login({ onLogin, setError }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api("/auth/login", { method: "POST", body: { name, pin } });
      onLogin(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card login-card">
        <h1 className="title">TRR Assembly Work Orders</h1>
        <div className="sub">Login</div>

        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />

        <label className="label">PIN</label>
        <input className="input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />

        <Button tone="black" onClick={submit} disabled={busy || !name || !pin}>
          {busy ? "Logging in..." : "Login"}
        </Button>

        <div className="hint">API: {API_BASE}</div>
      </div>
    </div>
  );
}

function Tabs({ tab, setTab }) {
  const items = [
    ["work_orders", "Work Orders"],
    ["create_wo", "Create WO"],
    ["inventory", "Inventory"],
    ["parts", "Parts"],
    ["admin", "Admin"],
  ];

  return (
    <div className="tabs">
      {items.map(([k, label]) => (
        <button
          key={k}
          className={cls("tab", tab === k && "tab-active")}
          onClick={() => setTab(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function WorkOrdersPage({ token, user, setError }) {
  const [wos, setWos] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [openWO, setOpenWO] = React.useState(null);

  async function refresh() {
    try {
      const data = await api("/work-orders", { token });
      setWos(data || []);
    } catch (e) {
      setError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  const filtered = wos.filter((w) => {
    if (!q.trim()) return true;
    const s = `${w.wo_number} ${w.station} ${w.part_number} ${w.customer_order || ""} ${w.status}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  async function action(path, method = "POST") {
    try {
      await api(path, { method, token });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  function openInstructions(w) {
    if (!w.instruction_url) return;
    // token in query string so opening new tab works
    window.open(`${API_BASE}${w.instruction_url}?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  }

  function printWO(w) {
    window.open(`${API_BASE}/work-orders/${w.id}/print?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  }

  async function deleteWO(w) {
    if (!confirm(`Delete ${w.wo_number}? This cannot be undone.`)) return;
    await action(`/work-orders/${w.id}`, "DELETE");
  }

  return (
    <div className="card">
      <div className="page-head">
        <div>
          <div className="page-title">Work Orders</div>
          <div className="page-sub">{filtered.length} shown</div>
        </div>
        <div className="row">
          <input
            className="input"
            style={{ width: 360 }}
            placeholder="Search WO / station / part / status..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div className="table">
        <div className="thead">
          <div>WO</div>
          <div>Station</div>
          <div>Part</div>
          <div>Customer / Stock</div>
          <div>Status</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {filtered.map((w) => (
          <div className="trow" key={w.id}>
            <div>
              <div className="wo">{w.wo_number}</div>
              <div className="muted">{formatDT(w.created_at)}</div>
            </div>
            <div className="bold">{w.station}</div>
            <div>
              <div className="bold">{w.part_number}</div>
              {w.part_id ? <div className="muted">Part ID: {w.part_id}</div> : null}
            </div>
            <div>
              {w.is_stock ? <Pill tone="blue">Stock Job</Pill> : <span>{w.customer_order || ""}</span>}
            </div>
            <div>
              <Pill tone={w.status === "open" ? "green" : w.status === "closed" ? "black" : "gray"}>
                {w.status}
              </Pill>
            </div>

            <div className="actions">
              <Button onClick={() => setOpenWO(w)} tone="default">Open</Button>
              {w.instruction_url ? (
                <Button onClick={() => openInstructions(w)}>Instructions</Button>
              ) : (
                <Button disabled>No Instructions</Button>
              )}
              <Button onClick={() => printWO(w)}>Print</Button>

              <Button tone="black" onClick={() => action(`/work-orders/${w.id}/workers/check-in`, "POST")}>
                Check In
              </Button>
              <Button tone="default" onClick={() => action(`/work-orders/${w.id}/workers/check-out`, "POST")}>
                Check Out
              </Button>

              <Button tone="green" onClick={() => action(`/work-orders/${w.id}/complete`, "POST")}>
                Complete
              </Button>
              <Button tone="black" onClick={() => action(`/work-orders/${w.id}/close`, "POST")}>
                Close
              </Button>
              <Button onClick={() => action(`/work-orders/${w.id}/reopen`, "POST")}>
                Reopen
              </Button>

              {(user.role === "admin" || user.role === "supervisor") ? (
                <Button tone="red" onClick={() => deleteWO(w)}>Delete</Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <WorkOrderModal
        open={!!openWO}
        onClose={() => setOpenWO(null)}
        token={token}
        wo={openWO}
        setError={setError}
      />
    </div>
  );
}

function WorkOrderModal({ open, onClose, token, wo, setError }) {
  const [notes, setNotes] = React.useState([]);
  const [workers, setWorkers] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [newNote, setNewNote] = React.useState("");

  async function refresh() {
    if (!wo) return;
    try {
      const [n, w, h] = await Promise.all([
        api(`/work-orders/${wo.id}/notes`, { token }),
        api(`/work-orders/${wo.id}/workers`, { token }),
        api(`/work-orders/${wo.id}/workers/history`, { token }),
      ]);
      setNotes(n || []);
      setWorkers(w || []);
      setHistory(h || []);
    } catch (e) {
      setError(e.message);
    }
  }

  React.useEffect(() => {
    if (open) refresh();
  }, [open, wo?.id]);

  function openInstructions() {
    if (!wo?.instruction_url) return;
    window.open(`${API_BASE}${wo.instruction_url}?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  }

  function printWO() {
    window.open(`${API_BASE}/work-orders/${wo.id}/print?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  }

  async function addNote() {
    if (!newNote.trim()) return;
    try {
      await api(`/work-orders/${wo.id}/notes`, { method: "POST", token, body: { text: newNote } });
      setNewNote("");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal
      open={open}
      title={wo ? `${wo.wo_number} • ${wo.station} • ${wo.part_number}` : "Work Order"}
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
          <div className="row" style={{ gap: 8 }}>
            {wo?.instruction_url ? <Button onClick={openInstructions}>Instructions</Button> : null}
            <Button onClick={printWO}>Print</Button>
          </div>
          <Button tone="black" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="grid2">
        <div className="panel">
          <div className="panel-title">Active Workers</div>
          {workers.length === 0 ? <div className="muted">No one checked in.</div> : null}
          {workers.map((w) => (
            <div key={w.user_id} className="item">
              <div className="bold">{w.name} <span className="muted">({w.role})</span></div>
              <div className="muted">Since {formatDT(w.started_at)}</div>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-title">Fingerprint History</div>
          {history.length === 0 ? <div className="muted">No history yet.</div> : null}
          {history.map((h) => (
            <div key={h.id} className="item">
              <div className="bold">{h.name} <span className="muted">({h.role})</span></div>
              <div className="muted">
                IN {formatDT(h.started_at)}{" "}
                {h.ended_at ? `• OUT ${formatDT(h.ended_at)}` : "• OUT (still checked in)"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-title">Notes</div>

        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Add a note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
          />
          <Button tone="black" onClick={addNote}>Add</Button>
        </div>

        <div style={{ marginTop: 10 }}>
          {notes.length === 0 ? <div className="muted">No notes yet.</div> : null}
          {notes.map((n) => (
            <div key={n.id} className="note">
              <div className="note-head">
                <div className="bold">{n.author_name}</div>
                <div className="muted">{formatDT(n.created_at)}</div>
              </div>
              <div className="note-body">{n.text}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CreateWOPage({ token, setError }) {
  const [station, setStation] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);

  async function create() {
    try {
      await api("/work-orders", {
        method: "POST",
        token,
        body: {
          station,
          part_number: partNumber,
          customer_order: isStock ? null : customerOrder,
          is_stock: isStock,
        },
      });
      setStation("");
      setPartNumber("");
      setCustomerOrder("");
      setIsStock(false);
      alert("Work order created!");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <div className="page-head">
        <div>
          <div className="page-title">Create Work Order</div>
          <div className="page-sub">Fast entry screen</div>
        </div>
      </div>

      <div className="form-grid">
        <div>
          <label className="label">Station</label>
          <input className="input" value={station} onChange={(e) => setStation(e.target.value)} />
        </div>

        <div>
          <label className="label">Part Number</label>
          <input className="input" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
        </div>

        <div>
          <label className="label">Customer Order</label>
          <input
            className="input"
            value={customerOrder}
            onChange={(e) => setCustomerOrder(e.target.value)}
            disabled={isStock}
          />
        </div>

        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          <div className="bold">Stock Job</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Button tone="black" onClick={create} disabled={!station.trim() || !partNumber.trim()}>
          Create Work Order
        </Button>
      </div>
    </div>
  );
}

function InventoryPage({ token, setError }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [qtyMap, setQtyMap] = React.useState({});
  const [txnsPart, setTxnsPart] = React.useState(null);
  const [txns, setTxns] = React.useState([]);

  async function refresh() {
    try {
      const data = await api("/parts", { token });
      setParts(data || []);
    } catch (e) {
      setError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  const filtered = parts.filter((p) => {
    if (!q.trim()) return true;
    const s = `${p.part_number} ${p.description || ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  async function receive(p) {
    const qty = parseInt(qtyMap[p.id] || "0", 10);
    if (!qty || qty <= 0) return;
    try {
      await api(`/parts/${p.id}/inventory/receive`, { method: "POST", token, body: { qty } });
      setQtyMap((m) => ({ ...m, [p.id]: "" }));
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function issue(p) {
    const qty = parseInt(qtyMap[p.id] || "0", 10);
    if (!qty || qty <= 0) return;
    try {
      await api(`/parts/${p.id}/inventory/issue`, { method: "POST", token, body: { qty } });
      setQtyMap((m) => ({ ...m, [p.id]: "" }));
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function openTxns(p) {
    setTxnsPart(p);
    try {
      const data = await api(`/parts/${p.id}/inventory/txns?limit=200`, { token });
      setTxns(data || []);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <div className="page-head">
        <div>
          <div className="page-title">Inventory</div>
          <div className="page-sub">Receive / Issue and view transactions</div>
        </div>
        <div className="row">
          <input
            className="input"
            style={{ width: 360 }}
            placeholder="Search part..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div className="table">
        <div className="thead">
          <div>Part</div>
          <div>On Hand</div>
          <div>Update Qty</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {filtered.map((p) => (
          <div className="trow" key={p.id}>
            <div>
              <div className="bold">{p.part_number}</div>
              {p.description ? <div className="muted">{p.description}</div> : null}
            </div>
            <div className="bold">{p.qty_on_hand}</div>

            <div className="row">
              <input
                className="input"
                style={{ width: 120 }}
                placeholder="Qty"
                value={qtyMap[p.id] || ""}
                onChange={(e) => setQtyMap((m) => ({ ...m, [p.id]: e.target.value }))}
              />
            </div>

            <div className="actions">
              <Button tone="green" onClick={() => receive(p)}>Receive</Button>
              <Button tone="black" onClick={() => issue(p)}>Issue</Button>
              <Button onClick={() => openTxns(p)}>Txns</Button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={!!txnsPart}
        title={txnsPart ? `Transactions • ${txnsPart.part_number}` : "Transactions"}
        onClose={() => setTxnsPart(null)}
        footer={<Button tone="black" onClick={() => setTxnsPart(null)}>Done</Button>}
      >
        {txns.length === 0 ? <div className="muted">No transactions.</div> : null}
        {txns.map((t) => (
          <div className="item" key={t.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="bold">{t.txn_type.toUpperCase()} {t.qty_delta}</div>
              <div className="muted">{formatDT(t.created_at)}</div>
            </div>
            {t.note ? <div className="muted">{t.note}</div> : null}
          </div>
        ))}
      </Modal>
    </div>
  );
}

function PartsPage({ token, user, setError }) {
  const [parts, setParts] = React.useState([]);
  const [pn, setPn] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [file, setFile] = React.useState(null);
  const canManage = user.role === "admin" || user.role === "supervisor";

  async function refresh() {
    try {
      const data = await api("/parts", { token });
      setParts(data || []);
    } catch (e) {
      setError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  async function addPart() {
    if (!pn.trim()) return;
    try {
      const fd = new FormData();
      fd.append("part_number", pn.trim());
      if (desc.trim()) fd.append("description", desc.trim());
      if (file) fd.append("file", file);

      await api("/parts", { method: "POST", token, body: fd, isForm: true });
      setPn("");
      setDesc("");
      setFile(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function upload(p, f) {
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api(`/parts/${p.id}/upload`, { method: "POST", token, body: fd, isForm: true });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  function openFile(p) {
    window.open(`${API_BASE}/parts/${p.id}/file?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="card">
      <div className="page-head">
        <div>
          <div className="page-title">Parts</div>
          <div className="page-sub">Create parts and attach instruction PDFs</div>
        </div>
        <div className="row">
          <Button onClick={refresh}>Refresh</Button>
        </div>
      </div>

      {canManage ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">Add Part</div>
          <div className="form-grid">
            <div>
              <label className="label">Part Number</label>
              <input className="input" value={pn} onChange={(e) => setPn(e.target.value)} />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div>
              <label className="label">Instruction File (optional)</label>
              <input className="input" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Button tone="black" onClick={addPart} disabled={!pn.trim()}>
              Add Part
            </Button>
          </div>
        </div>
      ) : null}

      <div className="table">
        <div className="thead">
          <div>Part</div>
          <div>File</div>
          <div>Uploaded</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {parts.map((p) => (
          <div className="trow" key={p.id}>
            <div>
              <div className="bold">{p.part_number}</div>
              {p.description ? <div className="muted">{p.description}</div> : null}
            </div>
            <div>{p.has_file ? <span className="bold">{p.filename}</span> : <span className="muted">None</span>}</div>
            <div className="muted">{p.uploaded_at ? formatDT(p.uploaded_at) : ""}</div>

            <div className="actions">
              {p.has_file ? <Button onClick={() => openFile(p)}>Open</Button> : <Button disabled>Open</Button>}
              {canManage ? (
                <>
                  <label className="btn">
                    Upload
                    <input
                      type="file"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(p, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPage({ token, user, setError }) {
  const canAdmin = user.role === "admin";
  const [users, setUsers] = React.useState([]);

  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState("assembler");
  const [newPin, setNewPin] = React.useState("");

  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  async function refresh() {
    try {
      const data = await api("/users", { token });
      setUsers(data || []);
    } catch (e) {
      setError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  async function createUser() {
    try {
      await api("/users", { method: "POST", token, body: { name: newName, role: newRole, pin: newPin } });
      setNewName("");
      setNewPin("");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function resetUserPin() {
    try {
      await api("/admin/reset-pin", {
        method: "POST",
        token,
        body: { name: resetName, new_pin: resetPin },
        // reset token is a header:
        // (we can't pass headers in this api() helper directly, so we do raw fetch here)
      });
    } catch (e) {
      // We'll do proper raw fetch below
    }

    try {
      const res = await fetch(`${API_BASE}/admin/reset-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Reset-Token": resetToken,
        },
        body: JSON.stringify({ name: resetName, new_pin: resetPin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.detail) ? data.detail : `Failed (${res.status})`);
      alert("PIN reset!");
      setResetName("");
      setResetPin("");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <div className="page-head">
        <div>
          <div className="page-title">Admin</div>
          <div className="page-sub">Users + reset pins</div>
        </div>
        <div className="row">
          <Button onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="panel-title">Create User (Admin only)</div>
          {!canAdmin ? <div className="muted">Admins only.</div> : null}
          <label className="label">Name</label>
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={!canAdmin} />
          <label className="label">Role</label>
          <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)} disabled={!canAdmin}>
            <option value="assembler">assembler</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
          </select>
          <label className="label">PIN</label>
          <input className="input" value={newPin} onChange={(e) => setNewPin(e.target.value)} disabled={!canAdmin} />
          <div style={{ marginTop: 10 }}>
            <Button tone="black" onClick={createUser} disabled={!canAdmin || !newName || !newPin}>
              Create User
            </Button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Reset User PIN (Admin only)</div>
          {!canAdmin ? <div className="muted">Admins only.</div> : null}
          <label className="label">RESET_TOKEN</label>
          <input className="input" value={resetToken} onChange={(e) => setResetToken(e.target.value)} disabled={!canAdmin} />
          <label className="label">User Name</label>
          <input className="input" value={resetName} onChange={(e) => setResetName(e.target.value)} disabled={!canAdmin} />
          <label className="label">New PIN</label>
          <input className="input" value={resetPin} onChange={(e) => setResetPin(e.target.value)} disabled={!canAdmin} />
          <div style={{ marginTop: 10 }}>
            <Button tone="black" onClick={resetUserPin} disabled={!canAdmin || !resetToken || !resetName || !resetPin}>
              Reset PIN
            </Button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-title">Users</div>
        {users.map((u) => (
          <div key={u.id} className="item row" style={{ justifyContent: "space-between" }}>
            <div className="bold">
              {u.name} <span className="muted">{u.role}</span>
            </div>
            <div className={cls("muted", u.is_active ? "" : "danger")}>
              {u.is_active ? "active" : "inactive"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [error, setError] = React.useState("");
  const [auth, setAuth] = React.useState(() => {
    try {
      const raw = localStorage.getItem("trr_auth");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [tab, setTab] = React.useState("work_orders");

  function onLogin(r) {
    const a = { token: r.token, name: r.name, role: r.role };
    setAuth(a);
    localStorage.setItem("trr_auth", JSON.stringify(a));
    setTab("work_orders");
  }

  function logout() {
    setAuth(null);
    localStorage.removeItem("trr_auth");
  }

  React.useEffect(() => {
    // quick sanity ping on load (optional)
    (async () => {
      try {
        await fetch(`${API_BASE}/__health`);
      } catch {}
    })();
  }, []);

  if (!auth) return <Login onLogin={onLogin} setError={setError} />;

  const user = { name: auth.name, role: auth.role };
  const token = auth.token;

  return (
    <div className="app">
      <style>{`
        :root {
          --bg: #f5f6f8;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --shadow: 0 8px 30px rgba(0,0,0,0.08);
          --radius: 18px;
        }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background: var(--bg); color: var(--text); }
        .app { max-width: 1250px; margin: 18px auto; padding: 0 14px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; background: var(--card); border:1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; box-shadow: var(--shadow); }
        .brand { display:flex; flex-direction:column; gap:2px; }
        .brand .h { font-weight: 900; font-size: 20px; }
        .brand .s { color: var(--muted); font-size: 12px; }
        .tabs { display:flex; gap:8px; align-items:center; }
        .tab { border:1px solid var(--line); background:#fff; border-radius:999px; padding:10px 14px; cursor:pointer; font-weight:700; }
        .tab-active { background:#111; color:#fff; border-color:#111; }
        .right { display:flex; gap:10px; align-items:center; }
        .who { color: var(--muted); font-weight:700; }
        .card { background: var(--card); border:1px solid var(--line); border-radius: var(--radius); padding: 16px; margin-top: 14px; box-shadow: var(--shadow); }
        .page-head { display:flex; align-items:flex-start; justify-content:space-between; gap: 12px; margin-bottom: 12px; }
        .page-title { font-size: 22px; font-weight: 900; }
        .page-sub { color: var(--muted); font-size: 12px; font-weight: 700; }
        .row { display:flex; gap:10px; align-items:center; }
        .label { display:block; font-size: 12px; font-weight: 800; margin: 10px 0 6px; }
        .input { width:100%; border:1px solid var(--line); border-radius: 12px; padding: 10px 12px; outline:none; font-size: 14px; background:#fff; }
        .input:focus { border-color:#111; }
        .btn { border:1px solid var(--line); background:#fff; border-radius:12px; padding: 10px 12px; cursor:pointer; font-weight: 800; }
        .btn:disabled { opacity:0.5; cursor:not-allowed; }
        .btn-black { background:#111; color:#fff; border-color:#111; }
        .btn-green { background:#0b7a38; color:#fff; border-color:#0b7a38; }
        .btn-red { background:#c81e1e; color:#fff; border-color:#c81e1e; }
        .center { min-height: calc(100vh - 20px); display:flex; align-items:center; justify-content:center; padding: 20px; }
        .login-card { width: 520px; }
        .title { margin:0; font-size: 28px; font-weight: 950; }
        .sub { color: var(--muted); margin: 6px 0 10px; font-weight: 700; }
        .hint { margin-top: 10px; font-size: 12px; color: var(--muted); }
        .banner { margin-top: 14px; background:#ffe8e8; border:1px solid #f8b4b4; color:#7f1d1d; border-radius: 14px; padding: 12px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px; box-shadow: var(--shadow); }
        .banner-text { font-weight: 900; }
        .icon-btn { border:1px solid var(--line); background:#fff; border-radius: 10px; width: 34px; height: 34px; cursor:pointer; font-weight: 900; }
        .table { border: 1px solid var(--line); border-radius: 14px; overflow:hidden; }
        .thead { display:grid; grid-template-columns: 160px 140px 240px 160px 120px 1fr; gap: 10px; padding: 10px 12px; background:#f9fafb; border-bottom:1px solid var(--line); font-size:12px; font-weight: 900; color:#374151; }
        .trow { display:grid; grid-template-columns: 160px 140px 240px 160px 120px 1fr; gap: 10px; padding: 12px; border-bottom:1px solid var(--line); align-items:center; }
        .trow:last-child { border-bottom:none; }
        .wo { font-weight: 950; }
        .bold { font-weight: 900; }
        .muted { color: var(--muted); font-size: 12px; font-weight: 700; }
        .danger { color: #b91c1c; }
        .actions { display:flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .pill { display:inline-block; padding: 6px 10px; border-radius: 999px; font-weight: 900; font-size: 12px; border:1px solid var(--line); }
        .bg-gray { background:#f3f4f6; }
        .bg-green { background:#dcfce7; }
        .bg-blue { background:#dbeafe; }
        .bg-red { background:#fee2e2; }
        .bg-black { background:#111; color:#fff; border-color:#111; }
        .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .panel { border:1px solid var(--line); border-radius: 14px; padding: 12px; background:#fff; }
        .panel-title { font-weight: 950; margin-bottom: 8px; }
        .item { padding: 10px; border:1px solid var(--line); border-radius: 12px; margin-bottom: 8px; }
        .note { padding: 10px; border:1px solid var(--line); border-radius: 12px; margin-bottom: 8px; background:#fafafa; }
        .note-head { display:flex; justify-content:space-between; gap:10px; margin-bottom: 6px; }
        .note-body { white-space: pre-wrap; font-weight: 700; }
        .form-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; padding: 18px; z-index: 9999; }
        .modal { width: min(980px, 96vw); background:#fff; border-radius: 18px; border:1px solid var(--line); box-shadow: var(--shadow); overflow:hidden; }
        .modal-header { display:flex; align-items:center; justify-content:space-between; padding: 12px 14px; border-bottom:1px solid var(--line); background:#f9fafb; }
        .modal-title { font-weight: 950; }
        .modal-body { padding: 14px; }
        .modal-footer { padding: 12px 14px; border-top:1px solid var(--line); background:#f9fafb; display:flex; justify-content:flex-end; }
        @media (max-width: 980px) {
          .thead, .trow { grid-template-columns: 140px 120px 1fr; }
          .thead div:nth-child(n+4), .trow div:nth-child(n+4) { display:none; }
          .grid2 { grid-template-columns: 1fr; }
          .form-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="topbar">
        <div className="brand">
          <div className="h">TRR Assembly Work Orders</div>
          <div className="s">Logged in as {user.name} ({user.role}) • API: {API_BASE}</div>
        </div>

        <div className="right">
          <Tabs tab={tab} setTab={setTab} />
          <Button onClick={logout}>Logout</Button>
        </div>
      </div>

      <Banner message={error} onClose={() => setError("")} />

      {tab === "work_orders" ? <WorkOrdersPage token={token} user={user} setError={setError} /> : null}
      {tab === "create_wo" ? <CreateWOPage token={token} setError={setError} /> : null}
      {tab === "inventory" ? <InventoryPage token={token} setError={setError} /> : null}
      {tab === "parts" ? <PartsPage token={token} user={user} setError={setError} /> : null}
      {tab === "admin" ? <AdminPage token={token} user={user} setError={setError} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
