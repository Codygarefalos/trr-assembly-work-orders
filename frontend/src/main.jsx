import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/**
 * TRR Assembly Work Orders - single-file App.jsx
 * - Tabs: Work Orders, Create WO, Inventory, Parts, Admin, Logout
 * - Popout: opens a WO detail view using hash route #/wo/:id
 * - Instructions/Print open in new tab using ?token=... so no "Missing token"
 */

const API_BASE =
  (import.meta?.env?.VITE_API_BASE || "").trim() ||
  "https://trr-assembly-api.onrender.com";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

async function api(path, { token, method = "GET", body, isForm = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!res.ok) {
    const msg =
      (data && data.detail) ||
      (typeof data === "string" ? data : "") ||
      `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function formatDT(s) {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return String(s);
  }
}

function useHashRoute() {
  const [hash, setHash] = React.useState(window.location.hash || "#/");

  React.useEffect(() => {
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Routes:
  // #/ -> main tabs
  // #/wo/123 -> popout detail page
  const m = hash.match(/^#\/wo\/(\d+)/);
  return { route: m ? { name: "wo", id: Number(m[1]) } : { name: "home" } };
}

function Button({ variant = "default", ...props }) {
  return (
    <button
      {...props}
      className={cx(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "danger" && "btn-danger",
        variant === "ghost" && "btn-ghost",
        props.className
      )}
    />
  );
}

function Pill({ children, tone = "gray" }) {
  return <span className={cx("pill", `pill-${tone}`)}>{children}</span>;
}

function Card({ title, right, children }) {
  return (
    <div className="card">
      {(title || right) && (
        <div className="card-h">
          <div className="card-title">{title}</div>
          <div>{right}</div>
        </div>
      )}
      <div className="card-b">{children}</div>
    </div>
  );
}

function TopNav({ tab, setTab, user, onLogout }) {
  const tabs = ["Work Orders", "Create WO", "Inventory", "Parts", "Admin"];
  return (
    <div className="top">
      <div>
        <div className="brand">TRR Assembly Work Orders</div>
        <div className="sub">
          Logged in as <b>{user?.name}</b> ({user?.role}) • API: {API_BASE}
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={cx("tab", tab === t && "tab-active")}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <button className="tab" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}

function Login({ onLoggedIn }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [err, setErr] = React.useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const r = await api("/auth/login", {
        method: "POST",
        body: { name, pin },
      });
      onLoggedIn(r);
    } catch (e2) {
      setErr(e2.message || "Login failed");
    }
  }

  return (
    <div className="center">
      <div className="login">
        <div className="brand" style={{ textAlign: "center" }}>
          TRR Assembly Work Orders
        </div>
        <div className="sub" style={{ textAlign: "center" }}>
          Sign in
        </div>
        {err ? <div className="banner error">{err}</div> : null}
        <form onSubmit={submit} className="form">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            PIN
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
            />
          </label>
          <Button variant="primary" type="submit">
            Login
          </Button>
        </form>
      </div>
    </div>
  );
}

function WorkOrdersPage({ token, user, parts, onError }) {
  const [wos, setWos] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [workersMap, setWorkersMap] = React.useState({}); // woId -> workers
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const data = await api("/work-orders", { token });
      setWos(data || []);
      // Prefetch workers for list (fast enough; can be changed)
      const map = {};
      await Promise.all(
        (data || []).slice(0, 80).map(async (w) => {
          try {
            map[w.id] = await api(`/work-orders/${w.id}/workers`, { token });
          } catch {
            map[w.id] = [];
          }
        })
      );
      setWorkersMap(map);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = wos.filter((w) => {
    const t = `${w.wo_number} ${w.station} ${w.part_number} ${w.customer_order || ""} ${w.status}`.toLowerCase();
    return t.includes(q.toLowerCase());
  });

  function openPopout(id) {
    window.open(`${window.location.origin}${window.location.pathname}#/wo/${id}`, "_blank");
  }

  function openInstructions(w) {
    if (!w.part_id) return;
    const url = `${API_BASE}/parts/${w.part_id}/file?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }

  function openPrint(w) {
    const url = `${API_BASE}/work-orders/${w.id}/print?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }

  async function act(path, method = "POST") {
    try {
      await api(path, { token, method });
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  async function checkIn(id) {
    await act(`/work-orders/${id}/workers/check-in`, "POST");
  }
  async function checkOut(id) {
    await act(`/work-orders/${id}/workers/check-out`, "POST");
  }

  async function delWO(id) {
    if (!confirm("Delete this work order? This cannot be undone.")) return;
    await act(`/work-orders/${id}`, "DELETE");
  }

  return (
    <Card
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>Work Orders</span>
          <Pill tone="blue">{filtered.length} shown</Pill>
        </div>
      }
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            className="search"
            placeholder="Search WO / station / part / status..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button onClick={refresh} disabled={busy}>
            Refresh
          </Button>
        </div>
      }
    >
      <div className="table">
        <div className="tr th">
          <div>WO</div>
          <div>Station</div>
          <div>Part</div>
          <div>Customer / Stock</div>
          <div>Status</div>
          <div>Actions</div>
        </div>

        {filtered.map((w) => {
          const workers = workersMap[w.id] || [];
          const meIn = workers.some((x) => x.user_id === user?.id);

          return (
            <div className="tr" key={w.id}>
              <div>
                <div className="wo">{w.wo_number}</div>
                <div className="muted">{formatDT(w.created_at)}</div>
              </div>

              <div className="station">{w.station}</div>

              <div>
                <div className="part">{w.part_number || "-"}</div>
                {w.part_id ? <div className="muted">Part ID: {w.part_id}</div> : null}
              </div>

              <div>
                {w.is_stock ? <Pill tone="green">Stock Job</Pill> : <span>{w.customer_order || ""}</span>}
              </div>

              <div>
                <Pill tone={w.status === "closed" ? "gray" : w.status === "complete" ? "green" : "blue"}>
                  {w.status}
                </Pill>
              </div>

              <div className="actions">
                <Button onClick={() => openPopout(w.id)}>Open</Button>

                <Button
                  onClick={() => openInstructions(w)}
                  disabled={!w.part_id}
                  variant={!w.part_id ? "ghost" : "default"}
                >
                  {w.part_id ? "Instructions" : "No Instructions"}
                </Button>

                <Button onClick={() => openPrint(w)}>Print</Button>

                <Button
                  onClick={() => (meIn ? checkOut(w.id) : checkIn(w.id))}
                  variant={meIn ? "default" : "primary"}
                >
                  {meIn ? "Check Out" : "Check In"}
                </Button>

                <Button variant="primary" onClick={() => act(`/work-orders/${w.id}/complete`, "POST")}>
                  Complete
                </Button>

                <Button onClick={() => act(`/work-orders/${w.id}/close`, "POST")}>Close</Button>

                <Button onClick={() => act(`/work-orders/${w.id}/reopen`, "POST")}>Reopen</Button>

                {(user?.role === "admin" || user?.role === "supervisor") ? (
                  <Button variant="danger" onClick={() => delWO(w.id)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CreateWOPage({ token, parts, onCreated, onError }) {
  const [station, setStation] = React.useState("");
  const [partId, setPartId] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        station,
        customer_order: isStock ? null : customerOrder || null,
        is_stock: !!isStock,
      };
      if (partId) body.part_id = Number(partId);
      else body.part_number = (partNumber || "").trim();

      await api("/work-orders", { token, method: "POST", body });
      setStation("");
      setPartId("");
      setPartNumber("");
      setCustomerOrder("");
      setIsStock(false);
      onCreated?.();
    } catch (e2) {
      onError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Create Work Order" right={<Pill tone="green">Clean tab</Pill>}>
      <form onSubmit={submit} className="form grid2">
        <label>
          Station
          <input value={station} onChange={(e) => setStation(e.target.value)} required />
        </label>

        <label>
          Part (dropdown)
          <select value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">-- choose part --</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_number}
              </option>
            ))}
          </select>
          <div className="muted">If you don’t pick a part, you can type a part number below.</div>
        </label>

        <label>
          Part Number (manual)
          <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="HAR-M100L-STD" />
        </label>

        <label>
          Customer Order
          <input
            value={customerOrder}
            onChange={(e) => setCustomerOrder(e.target.value)}
            disabled={isStock}
            placeholder={isStock ? "(stock job)" : "e.g. 45625"}
          />
        </label>

        <label className="row">
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          Stock Job
        </label>

        <div />
        <Button variant="primary" type="submit" disabled={busy}>
          Create Work Order
        </Button>
      </form>
    </Card>
  );
}

function PartsPage({ token, user, onError }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [pn, setPn] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [file, setFile] = React.useState(null);
  const canEdit = user?.role === "admin" || user?.role === "supervisor";

  async function refresh() {
    try {
      setParts(await api("/parts", { token }));
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = parts.filter((p) => {
    const t = `${p.part_number} ${p.description || ""}`.toLowerCase();
    return t.includes(q.toLowerCase());
  });

  async function addPart(e) {
    e.preventDefault();
    if (!canEdit) return;

    const fd = new FormData();
    fd.append("part_number", pn);
    if (desc) fd.append("description", desc);
    if (file) fd.append("file", file);

    try {
      await api("/parts", { token, method: "POST", body: fd, isForm: true });
      setPn("");
      setDesc("");
      setFile(null);
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  async function uploadTo(partId, f) {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      await api(`/parts/${partId}/upload`, { token, method: "POST", body: fd, isForm: true });
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  function openInstruction(partId) {
    const url = `${API_BASE}/parts/${partId}/file?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }

  return (
    <Card
      title="Parts"
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="search" placeholder="Search parts..." value={q} onChange={(e) => setQ(e.target.value)} />
          <Button onClick={refresh}>Refresh</Button>
        </div>
      }
    >
      {canEdit ? (
        <form onSubmit={addPart} className="form grid2" style={{ marginBottom: 16 }}>
          <label>
            Part Number
            <input value={pn} onChange={(e) => setPn(e.target.value)} required />
          </label>

          <label>
            Description (optional)
            <input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>

          <label>
            Instruction File (optional)
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

          <div />
          <Button variant="primary" type="submit">
            Add Part
          </Button>
        </form>
      ) : (
        <div className="muted" style={{ marginBottom: 12 }}>
          Parts upload is Supervisor/Admin only.
        </div>
      )}

      <div className="table">
        <div className="tr th">
          <div>Part</div>
          <div>Description</div>
          <div>Qty</div>
          <div>Instructions</div>
          <div>Upload/Replace</div>
        </div>

        {filtered.map((p) => (
          <div className="tr" key={p.id}>
            <div>
              <div className="part">{p.part_number}</div>
              <div className="muted">ID: {p.id}</div>
            </div>
            <div>{p.description || ""}</div>
            <div>
              <Pill tone="blue">{p.qty_on_hand || 0}</Pill>
            </div>
            <div>
              {p.has_file ? (
                <Button onClick={() => openInstruction(p.id)}>Open</Button>
              ) : (
                <Pill tone="gray">None</Pill>
              )}
            </div>
            <div>
              {canEdit ? (
                <input
                  type="file"
                  onChange={(e) => uploadTo(p.id, e.target.files?.[0] || null)}
                />
              ) : (
                <span className="muted">No access</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function InventoryPage({ token, user, onError }) {
  const [parts, setParts] = React.useState([]);
  const [sel, setSel] = React.useState("");
  const [qty, setQty] = React.useState(1);
  const [note, setNote] = React.useState("");
  const [txns, setTxns] = React.useState([]);
  const canManage = user?.role === "admin" || user?.role === "supervisor";

  async function refreshParts() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => {
    refreshParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTxns(partId) {
    try {
      const t = await api(`/parts/${partId}/inventory/txns?limit=200`, { token });
      setTxns(t || []);
    } catch (e) {
      onError(e.message);
    }
  }

  async function doTxn(kind) {
    if (!canManage || !sel) return;
    try {
      await api(`/parts/${sel}/inventory/${kind}`, {
        token,
        method: "POST",
        body: { qty: Number(qty), note: note || null },
      });
      setNote("");
      await refreshParts();
      await loadTxns(sel);
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => {
    if (sel) loadTxns(sel);
    else setTxns([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  return (
    <Card title="Inventory">
      <div className="form grid2">
        <label>
          Part
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">-- choose part --</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_number} (qty {p.qty_on_hand || 0})
              </option>
            ))}
          </select>
        </label>

        <label>
          Qty
          <input type="number" value={qty} min={1} onChange={(e) => setQty(e.target.value)} />
        </label>

        <label style={{ gridColumn: "1 / -1" }}>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <Button onClick={() => doTxn("receive")} disabled={!canManage || !sel}>
            Receive
          </Button>
          <Button onClick={() => doTxn("issue")} disabled={!canManage || !sel}>
            Issue
          </Button>
          <Button onClick={refreshParts}>Refresh</Button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ marginBottom: 8 }}>
          Latest transactions
        </div>
        <div className="table">
          <div className="tr th">
            <div>When</div>
            <div>Type</div>
            <div>Δ</div>
            <div>Note</div>
          </div>
          {txns.map((t) => (
            <div className="tr" key={t.id}>
              <div>{formatDT(t.created_at)}</div>
              <div>{t.txn_type}</div>
              <div>
                <Pill tone={t.qty_delta < 0 ? "red" : "green"}>{t.qty_delta}</Pill>
              </div>
              <div className="muted">{t.note || ""}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function AdminPage({ token, user, onError }) {
  const [users, setUsers] = React.useState([]);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("assembler");
  const [pin, setPin] = React.useState("");

  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  const canAdmin = user?.role === "admin";

  async function refresh() {
    try {
      setUsers(await api("/users", { token }));
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createUser(e) {
    e.preventDefault();
    try {
      await api("/users", { token, method: "POST", body: { name, role, pin } });
      setName("");
      setPin("");
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  async function doReset(e) {
    e.preventDefault();
    try {
      await fetch(`${API_BASE}/admin/reset-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Reset-Token": resetToken,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: resetName, new_pin: resetPin }),
      }).then(async (r) => {
        const t = await r.text();
        let d = null;
        try { d = t ? JSON.parse(t) : null; } catch { d = t; }
        if (!r.ok) throw new Error((d && d.detail) || `${r.status} ${r.statusText}`);
      });

      setResetName("");
      setResetPin("");
    } catch (e2) {
      onError(e2.message);
    }
  }

  return (
    <Card title="Admin">
      {!canAdmin ? (
        <div className="muted">Admin tab is admin-only.</div>
      ) : (
        <div className="grid2">
          <Card title="Create User (Admin only)">
            <form onSubmit={createUser} className="form">
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="assembler">assembler</option>
                  <option value="supervisor">supervisor</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label>
                PIN
                <input value={pin} onChange={(e) => setPin(e.target.value)} required />
              </label>
              <Button variant="primary" type="submit">
                Create User
              </Button>
            </form>
          </Card>

          <Card title="Reset User PIN (Admin only)">
            <form onSubmit={doReset} className="form">
              <label>
                RESET_TOKEN
                <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} />
              </label>
              <label>
                User Name
                <input value={resetName} onChange={(e) => setResetName(e.target.value)} />
              </label>
              <label>
                New PIN
                <input value={resetPin} onChange={(e) => setResetPin(e.target.value)} />
              </label>
              <Button variant="primary" type="submit">
                Reset PIN
              </Button>
            </form>
          </Card>

          <Card title="Users" right={<Button onClick={refresh}>Refresh</Button>}>
            <div className="table">
              <div className="tr th">
                <div>Name</div>
                <div>Role</div>
                <div>Status</div>
              </div>
              {users.map((u) => (
                <div className="tr" key={u.id}>
                  <div>
                    <b>{u.name}</b>
                  </div>
                  <div>{u.role}</div>
                  <div>{u.is_active ? <Pill tone="green">active</Pill> : <Pill tone="gray">inactive</Pill>}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}

function WorkOrderPopout({ token, user, woId, onError }) {
  const [wo, setWo] = React.useState(null);
  const [notes, setNotes] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [text, setText] = React.useState("");

  async function refresh() {
    try {
      const w = await api(`/work-orders/${woId}`, { token });
      setWo(w);
      setNotes(await api(`/work-orders/${woId}/notes`, { token }));
      setHistory(await api(`/work-orders/${woId}/workers/history`, { token }));
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  function openInstructions() {
    if (!wo?.part_id) return;
    window.open(`${API_BASE}/parts/${wo.part_id}/file?token=${encodeURIComponent(token)}`, "_blank");
  }

  function openPrint() {
    window.open(`${API_BASE}/work-orders/${woId}/print?token=${encodeURIComponent(token)}`, "_blank");
  }

  async function addNote(e) {
    e.preventDefault();
    try {
      await api(`/work-orders/${woId}/notes`, { token, method: "POST", body: { text } });
      setText("");
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  async function checkInOut() {
    try {
      const current = await api(`/work-orders/${woId}/workers`, { token });
      const meIn = (current || []).some((x) => x.user_id === user?.id);
      await api(`/work-orders/${woId}/workers/${meIn ? "check-out" : "check-in"}`, { token, method: "POST" });
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  if (!wo) return <div className="center"><div className="muted">Loading…</div></div>;

  return (
    <div className="pop">
      <div className="pop-top">
        <div>
          <div className="brand">{wo.wo_number}</div>
          <div className="sub">
            {wo.station} • {wo.part_number} • {wo.is_stock ? "Stock Job" : (wo.customer_order || "")} •{" "}
            <b>{wo.status}</b>
          </div>
        </div>
        <div className="tabs">
          <Button onClick={refresh}>Refresh</Button>
          <Button onClick={openPrint}>Print</Button>
          <Button onClick={checkInOut} variant="primary">Check In/Out</Button>
          <Button onClick={openInstructions} disabled={!wo.part_id}>
            Instructions
          </Button>
          <Button onClick={() => (window.location.hash = "#/")}>Back</Button>
        </div>
      </div>

      <div className="grid2">
        <Card title="Fingerprint (History)">
          <div className="table">
            <div className="tr th">
              <div>Name</div>
              <div>Role</div>
              <div>In</div>
              <div>Out</div>
            </div>
            {history.map((h, idx) => (
              <div className="tr" key={idx}>
                <div>{h.name}</div>
                <div className="muted">{h.role}</div>
                <div>{formatDT(h.started_at)}</div>
                <div>{h.ended_at ? formatDT(h.ended_at) : <Pill tone="green">checked in</Pill>}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Notes">
          <form onSubmit={addNote} className="form">
            <label>
              Add a note
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
            </label>
            <Button variant="primary" type="submit">
              Add Note
            </Button>
          </form>

          <div style={{ marginTop: 12 }}>
            {notes.map((n) => (
              <div key={n.id} className="note">
                <div className="muted">
                  {formatDT(n.created_at)} • <b>{n.author_name}</b>
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function App() {
  const { route } = useHashRoute();

  const [token, setToken] = React.useState(localStorage.getItem("trr_token") || "");
  const [user, setUser] = React.useState(
    (() => {
      try {
        return JSON.parse(localStorage.getItem("trr_user") || "null");
      } catch {
        return null;
      }
    })()
  );

  const [tab, setTab] = React.useState("Work Orders");
  const [banner, setBanner] = React.useState("");
  const [parts, setParts] = React.useState([]);

  function onError(msg) {
    setBanner(msg || "Error");
  }

  async function refreshParts() {
    if (!token) return;
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => {
    refreshParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onLoggedIn(r) {
    setToken(r.token);
    localStorage.setItem("trr_token", r.token);
    const u = { name: r.name, role: r.role };
    setUser(u);
    localStorage.setItem("trr_user", JSON.stringify(u));
    setBanner("");
  }

  function logout() {
    setToken("");
    setUser(null);
    localStorage.removeItem("trr_token");
    localStorage.removeItem("trr_user");
    window.location.hash = "#/";
  }

  if (!token || !user) {
    return (
      <>
        <Style />
        <Login onLoggedIn={onLoggedIn} />
      </>
    );
  }

  // Popout route view
  if (route.name === "wo") {
    return (
      <>
        <Style />
        {banner ? (
          <div className="banner error">
            <b>Internal Server Error</b> <span style={{ marginLeft: 10 }}>{banner}</span>
            <button className="x" onClick={() => setBanner("")}>x</button>
          </div>
        ) : null}
        <WorkOrderPopout token={token} user={user} woId={route.id} onError={onError} />
      </>
    );
  }

  return (
    <>
      <Style />

      <TopNav tab={tab} setTab={setTab} user={user} onLogout={logout} />

      {banner ? (
        <div className="banner error">
          <b>Internal Server Error</b> <span style={{ marginLeft: 10 }}>{banner}</span>
          <button className="x" onClick={() => setBanner("")}>x</button>
        </div>
      ) : null}

      <div className="wrap">
        {tab === "Work Orders" ? (
          <WorkOrdersPage token={token} user={user} parts={parts} onError={onError} />
        ) : null}

        {tab === "Create WO" ? (
          <CreateWOPage token={token} parts={parts} onCreated={() => setTab("Work Orders")} onError={onError} />
        ) : null}

        {tab === "Inventory" ? (
          <InventoryPage token={token} user={user} onError={onError} />
        ) : null}

        {tab === "Parts" ? (
          <PartsPage token={token} user={user} onError={onError} />
        ) : null}

        {tab === "Admin" ? (
          <AdminPage token={token} user={user} onError={onError} />
        ) : null}
      </div>
    </>
  );
}

function Style() {
  return (
    <style>{`
      :root {
        --bg: #f5f6f8;
        --card: #fff;
        --text: #101114;
        --muted: #6b7280;
        --line: #e6e7eb;
        --shadow: 0 10px 30px rgba(16,17,20,.06);
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; background: var(--bg); color: var(--text); }
      .wrap { max-width: 1220px; margin: 18px auto 60px; padding: 0 18px; }
      .top {
        max-width: 1220px; margin: 16px auto 0; padding: 14px 18px;
        display:flex; align-items:center; justify-content:space-between;
        border-radius: 18px; background: var(--card); box-shadow: var(--shadow);
      }
      .brand { font-weight: 800; font-size: 18px; }
      .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
      .tabs { display:flex; gap: 8px; align-items:center; }
      .tab {
        border: 1px solid var(--line); background:#fff; padding: 8px 12px; border-radius: 999px;
        cursor:pointer; font-weight: 700;
      }
      .tab-active { background:#111; color:#fff; border-color:#111; }

      .banner {
        max-width: 1220px; margin: 12px auto 0; padding: 14px 18px;
        border-radius: 14px; border: 1px solid #f2b7b7; background: #ffecec; color:#7a1111;
        display:flex; align-items:center; justify-content:space-between;
      }
      .banner .x {
        border: 0; background:#fff; border: 1px solid #f2b7b7; border-radius: 10px; width: 32px; height: 32px;
        cursor:pointer; font-weight: 900;
      }

      .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); }
      .card-h { display:flex; align-items:center; justify-content:space-between; padding: 16px 16px 0; }
      .card-title { font-size: 18px; font-weight: 900; }
      .card-b { padding: 16px; }

      .search { width: 360px; max-width: 48vw; padding: 10px 12px; border-radius: 12px; border:1px solid var(--line); }

      .btn {
        border: 1px solid var(--line); background:#fff; padding: 10px 12px; border-radius: 12px;
        cursor:pointer; font-weight: 800;
      }
      .btn:hover { filter: brightness(.98); }
      .btn-primary { background:#0f6; border-color:#0f6; color:#063; }
      .btn-danger { background:#e11d48; border-color:#e11d48; color:#fff; }
      .btn-ghost { background:#f3f4f6; }

      .pill { padding: 4px 10px; border-radius: 999px; font-weight: 900; font-size: 12px; border:1px solid var(--line); }
      .pill-gray { background:#f3f4f6; color:#374151; }
      .pill-blue { background:#eef2ff; color:#3730a3; border-color:#c7d2fe; }
      .pill-green { background:#ecfdf5; color:#065f46; border-color:#a7f3d0; }
      .pill-red { background:#fff1f2; color:#9f1239; border-color:#fecdd3; }

      .table { display:flex; flex-direction:column; gap: 10px; }
      .tr { display:grid; grid-template-columns: 140px 120px 220px 140px 90px 1fr; gap: 12px;
        padding: 14px; border:1px solid var(--line); border-radius: 16px; background:#fff;
      }
      .th { background:#f9fafb; font-weight: 900; color:#374151; }
      .wo { font-weight: 900; }
      .station { font-weight: 800; }
      .part { font-weight: 900; }
      .muted { color: var(--muted); font-size: 12px; }
      .actions { display:flex; flex-wrap:wrap; gap: 8px; align-items:center; }

      .form { display:flex; flex-direction:column; gap: 10px; }
      label { display:flex; flex-direction:column; gap: 6px; font-weight: 800; }
      input, select, textarea {
        padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; font: inherit;
      }
      textarea { resize: vertical; }
      .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .row { flex-direction: row; align-items:center; gap: 10px; }

      .center { min-height: 100vh; display:flex; align-items:center; justify-content:center; padding: 20px; }
      .login { width: 520px; max-width: 92vw; background:#fff; border:1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: var(--shadow); }

      .pop { max-width: 1220px; margin: 18px auto; padding: 0 18px; }
      .pop-top { display:flex; align-items:center; justify-content:space-between; gap: 12px;
        background:#fff; border:1px solid var(--line); border-radius: 18px; padding: 14px 16px; box-shadow: var(--shadow);
        margin-bottom: 14px;
      }
      .note { padding: 10px 12px; border:1px solid var(--line); border-radius: 14px; margin-top: 10px; background:#fff; }
      @media (max-width: 1100px) {
        .tr { grid-template-columns: 140px 120px 1fr; }
        .tr > div:nth-child(4), .tr > div:nth-child(5), .tr > div:nth-child(6) { grid-column: 1 / -1; }
        .grid2 { grid-template-columns: 1fr; }
        .search { width: 240px; }
      }
    `}</style>
  );
}
