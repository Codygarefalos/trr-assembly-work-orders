import React from "react";
import { createRoot } from "react-dom/client";

const API_BASE = (import.meta?.env?.VITE_API_BASE || "https://trr-assembly-api.onrender.com").replace(/\/$/, "");

function cls(...a) { return a.filter(Boolean).join(" "); }

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
  const tones = { gray: "bg-gray", green: "bg-green", blue: "bg-blue", red: "bg-red", black: "bg-black" };
  return <span className={cls("pill", tones[tone] || "bg-gray")}>{children}</span>;
}

function Button({ children, onClick, tone = "default", disabled }) {
  return (
    <button className={cls("btn", tone !== "default" && `btn-${tone}`)} onClick={onClick} disabled={disabled}>
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
        <button key={k} className={cls("tab", tab === k && "tab-active")} onClick={() => setTab(k)}>
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
          <input className="input" style={{ width: 360 }} placeholder="Search WO / station / part / status..."
            value={q} onChange={(e) => setQ(e.target.value)} />
          <Button onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div className="table">
        <div className="thead">
          <div>WO</div><div>Station</div><div>Part</div><div>Customer / Stock</div><div>Status</div>
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
            <div>{w.is_stock ? <Pill tone="blue">Stock Job</Pill> : <span>{w.customer_order || ""}</span>}</div>
            <div>
              <Pill tone={w.status === "open" ? "green" : w.status === "in_progress" ? "blue" : w.status === "closed" ? "black" : "gray"}>
                {w.status}
              </Pill>
            </div>

            <div className="actions">
              <Button onClick={() => setOpenWO(w)}>Open</Button>
              {w.instruction_url ? <Button onClick={() => openInstructions(w)}>Instructions</Button> : <Button disabled>No Instructions</Button>}
              <Button onClick={() => printWO(w)}>Print</Button>

              <Button tone="black" onClick={() => action(`/work-orders/${w.id}/workers/check-in`, "POST")}>Check In</Button>
              <Button onClick={() => action(`/work-orders/${w.id}/workers/check-out`, "POST")}>Check Out</Button>

              <Button tone="green" onClick={() => action(`/work-orders/${w.id}/complete`, "POST")}>Complete</Button>
              <Button tone="black" onClick={() => action(`/work-orders/${w.id}/close`, "POST")}>Close</Button>
              <Button onClick={() => action(`/work-orders/${w.id}/reopen`, "POST")}>Reopen</Button>

              {(user.role === "admin" || user.role === "supervisor") ? (
                <Button tone="red" onClick={() => deleteWO(w)}>Delete</Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <WorkOrderModal open={!!openWO} onClose={() => setOpenWO(null)} token={token} wo={openWO} setError={setError} />
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

  React.useEffect(() => { if (open) refresh(); }, [open, wo?.id]);

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
                IN {formatDT(h.started_at)} {h.ended_at ? `• OUT ${formatDT(h.ended_at)}` : "• OUT (still checked in)"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-title">Notes</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" placeholder="Add a note..." value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} />
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
  const [parts, setParts] = React.useState([]);
  const [station, setStation] = React.useState("");
  const [partId, setPartId] = React.useState("");
  const [manualPart, setManualPart] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);

  async function loadParts() {
    try {
      const data = await api("/parts", { token });
      setParts(data || []);
    } catch (e) {
      setError(e.message);
    }
  }

  React.useEffect(() => { loadParts(); }, []);

  async function create() {
    try {
      const chosen = partId ? parseInt(partId, 10) : null;

      await api("/work-orders", {
        method: "POST",
        token,
        body: {
          station,
          part_id: chosen || null,
          part_number: chosen ? null : manualPart,
          customer_order: isStock ? null : customerOrder,
          is_stock: isStock,
        },
      });

      setStation("");
      setPartId("");
      setManualPart("");
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
          <div className="page-sub">Pick a part from the list or type one manually</div>
        </div>
        <div className="row">
          <Button onClick={loadParts}>Refresh Parts</Button>
        </div>
      </div>

      <div className="form-grid">
        <div>
          <label className="label">Station</label>
          <input className="input" value={station} onChange={(e) => setStation(e.target.value)} />
        </div>

        <div>
          <label className="label">Part (dropdown)</label>
          <select className="input" value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">— Select a part —</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_number}{p.description ? ` — ${p.description}` : ""}
              </option>
            ))}
          </select>
          <div className="muted" style={{ marginTop: 6 }}>
            If you select a part, it will auto-link instructions + inventory.
          </div>
        </div>

        <div>
          <label className="label">Or type Part Number (manual)</label>
          <input className="input" value={manualPart} onChange={(e) => setManualPart(e.target.value)} disabled={!!partId} />
        </div>

        <div>
          <label className="label">Customer Order</label>
          <input className="input" value={customerOrder} onChange={(e) => setCustomerOrder(e.target.value)} disabled={isStock} />
        </div>

        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          <div className="bold">Stock Job</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Button tone="black" onClick={create} disabled={!station.trim() || (!partId && !manualPart.trim())}>
          Create Work Order
        </Button>
      </div>
    </div>
  );
}

/* Inventory / Parts / Admin pages: unchanged from your previous version except they will now work with DB-stored files.
   To keep this message readable, I’m leaving them exactly as in your current file.
   IMPORTANT: keep your existing InventoryPage, PartsPage, AdminPage from the last working version
   OR tell me and I’ll paste the full combined file including them again in one shot.
*/
