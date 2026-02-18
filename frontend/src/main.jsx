import React from "react";
import ReactDOM from "react-dom/client";

/**
 * Configure API base URL:
 * - On Render frontend, set VITE_API_URL to: https://trr-assembly-api.onrender.com
 * - Locally: http://127.0.0.1:8000
 */
const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function api(path, { token, method = "GET", body, isForm = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  // Only set JSON content-type when NOT sending FormData
  if (!isForm && body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body:
      body instanceof FormData
        ? body
        : body && !isForm
        ? JSON.stringify(body)
        : body,
  });

  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");

  if (!res.ok) {
    const msg =
      typeof payload === "string"
        ? payload
        : payload?.detail
        ? payload.detail
        : JSON.stringify(payload);
    throw new Error(msg || `HTTP ${res.status}`);
  }

  return payload;
}

function Banner({ text, onClose }) {
  if (!text) return null;
  return (
    <div
      style={{
        border: "1px solid #f2c2c2",
        background: "#fff5f5",
        color: "#7a0000",
        padding: 12,
        borderRadius: 12,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 700 }}>{text}</div>
      <button onClick={onClose} style={{ padding: "6px 10px" }}>
        X
      </button>
    </div>
  );
}

function Login({ onLogin, onError }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      const r = await api("/auth/login", { method: "POST", body: { name, pin } });
      onLogin(r);
    } catch (e2) {
      onError(e2.message);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "80px auto", padding: 18 }}>
      <h2>TRR Assembly Work Orders</h2>
      <form onSubmit={submit} style={{ border: "1px solid #eee", borderRadius: 14, padding: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label>PIN</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
        </div>
        <button style={{ width: "100%", padding: 12, borderRadius: 10, fontWeight: 800 }}>Login</button>
      </form>
    </div>
  );
}

function WorkOrdersPage({ token, user, onError }) {
  const [wos, setWos] = React.useState([]);
  const [station, setStation] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);
  const [q, setQ] = React.useState("");

  const canManage = user?.role === "admin" || user?.role === "supervisor";

  async function refresh() {
    try {
      const data = await api("/work-orders", { token });
      setWos(data || []);
    } catch (e) {
      onError(e.message);
      setWos([]);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createWO(e) {
    e.preventDefault();
    try {
      await api("/work-orders", {
        token,
        method: "POST",
        body: { station, part_number: partNumber, customer_order: customerOrder, is_stock: !!isStock },
      });
      setStation("");
      setPartNumber("");
      setCustomerOrder("");
      setIsStock(false);
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  async function markComplete(id) {
    try {
      await api(`/work-orders/${id}/complete`, { token, method: "POST" });
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }
  async function markClose(id) {
    try {
      await api(`/work-orders/${id}/close`, { token, method: "POST" });
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }
  async function markReopen(id) {
    try {
      await api(`/work-orders/${id}/reopen`, { token, method: "POST" });
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  function openInstruction(wo) {
    if (!wo.part_id) return;
    const url = `${API_BASE}/parts/${wo.part_id}/file?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const filtered = wos.filter((w) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      String(w.wo_number || "").toLowerCase().includes(t) ||
      String(w.station || "").toLowerCase().includes(t) ||
      String(w.part_number || "").toLowerCase().includes(t) ||
      String(w.customer_order || "").toLowerCase().includes(t) ||
      String(w.status || "").toLowerCase().includes(t)
    );
  });

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h2>Work Orders</h2>
        <button onClick={refresh}>Refresh</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search WO / station / part / status..."
          style={{ width: "100%", padding: 10, borderRadius: 8 }}
        />
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Work Order</h3>
        <form onSubmit={createWO} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Station</label>
            <input value={station} onChange={(e) => setStation(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
          </div>
          <div>
            <label>Part Number</label>
            <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
          </div>
          <div>
            <label>Customer Order</label>
            <input value={customerOrder} onChange={(e) => setCustomerOrder(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 22 }}>
            <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
            <span>Stock Job</span>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button style={{ width: "100%", padding: 12, borderRadius: 10, fontWeight: 800 }}>Create Work Order</button>
          </div>
        </form>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 170px 110px 220px", padding: 10, fontWeight: 800, background: "#fafafa" }}>
          <div>WO</div>
          <div>Station / Part</div>
          <div>Customer Order</div>
          <div>Status</div>
          <div>Actions</div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 12 }}>No work orders.</div>
        ) : (
          filtered.map((w) => (
            <div
              key={w.id}
              style={{ display: "grid", gridTemplateColumns: "150px 1fr 170px 110px 220px", padding: 10, borderTop: "1px solid #eee", alignItems: "center" }}
            >
              <div style={{ fontWeight: 900 }}>{w.wo_number}</div>
              <div>
                <div style={{ fontWeight: 700 }}>{w.station}</div>
                <div style={{ opacity: 0.8 }}>{w.part_number}</div>
              </div>
              <div>{w.customer_order || ""}</div>
              <div>{w.status}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {w.part_id ? <button onClick={() => openInstruction(w)}>Instructions</button> : <span style={{ opacity: 0.6 }}>No file</span>}
                {canManage && (
                  <>
                    <button onClick={() => markComplete(w.id)}>Complete</button>
                    <button onClick={() => markClose(w.id)}>Close</button>
                    <button onClick={() => markReopen(w.id)}>Reopen</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InventoryPage({ token, user, onError }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [qty, setQty] = React.useState(1);
  const [note, setNote] = React.useState("");
  const [selected, setSelected] = React.useState(null);

  const canManage = user?.role === "admin" || user?.role === "supervisor";

  async function refresh() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
      setParts([]);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = parts.filter((p) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return String(p.part_number || "").toLowerCase().includes(t) || String(p.description || "").toLowerCase().includes(t);
  });

  async function receive() {
    if (!selected) return;
    try {
      await api(`/parts/${selected}/inventory/receive`, {
        token,
        method: "POST",
        body: { qty: Number(qty), note: note || null },
      });
      setNote("");
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  async function issue() {
    if (!selected) return;
    try {
      await api(`/parts/${selected}/inventory/issue`, {
        token,
        method: "POST",
        body: { qty: Number(qty), note: note || null },
      });
      setNote("");
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h2>Inventory</h2>
        <button onClick={refresh}>Refresh</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts..." style={{ width: "100%", padding: 10, borderRadius: 8 }} />
      </div>

      {canManage && (
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Receive / Issue</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr", gap: 12, alignItems: "end" }}>
            <div>
              <label>Part</label>
              <select value={selected || ""} onChange={(e) => setSelected(e.target.value || null)} style={{ width: "100%", padding: 10, borderRadius: 8 }}>
                <option value="">Select part...</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.part_number}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Qty</label>
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
            <div>
              <label>Note</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={receive} style={{ padding: 10, borderRadius: 10 }}>
              Receive
            </button>
            <button onClick={issue} style={{ padding: 10, borderRadius: 10 }}>
              Issue
            </button>
          </div>
        </div>
      )}

      <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 140px 160px", padding: 10, fontWeight: 800, background: "#fafafa" }}>
          <div>Part #</div>
          <div>Description</div>
          <div>On Hand</div>
          <div>Updated</div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 12 }}>No parts.</div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "220px 1fr 140px 160px", padding: 10, borderTop: "1px solid #eee" }}>
              <div style={{ fontWeight: 800 }}>{p.part_number}</div>
              <div>{p.description || ""}</div>
              <div>{p.qty_on_hand ?? 0}</div>
              <div style={{ opacity: 0.8 }}>{p.inventory_updated_at ? new Date(p.inventory_updated_at).toLocaleString() : ""}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PartsPage({ token, user, onError }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [file, setFile] = React.useState(null);

  const canManage = user?.role === "admin" || user?.role === "supervisor";

  async function refresh() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
      setParts([]);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPart(e) {
    e.preventDefault();
    if (!canManage) return;

    try {
      const fd = new FormData();
      fd.append("part_number", partNumber);
      if (file) fd.append("file", file);

      await api("/parts", { token, method: "POST", body: fd, isForm: true });

      setPartNumber("");
      setFile(null);
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  function openInstructions(partId) {
    const url = `${API_BASE}/parts/${partId}/file?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const filtered = parts.filter((p) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return String(p.part_number || "").toLowerCase().includes(t) || String(p.description || "").toLowerCase().includes(t);
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h2>Parts</h2>
        <button onClick={refresh}>Refresh</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part number..." style={{ width: "100%", padding: 10, borderRadius: 8 }} />
      </div>

      {canManage && (
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>Add Part</h3>
          <form onSubmit={addPart}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>Part Number</label>
                <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
              </div>
              <div>
                <label>Instruction File (optional)</label>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <button style={{ marginTop: 12, width: "100%", padding: 12, borderRadius: 10, fontWeight: 800 }} type="submit">
              Add Part (and upload file if chosen)
            </button>
          </form>
        </div>
      )}

      <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 200px 140px", padding: 10, fontWeight: 800, background: "#fafafa" }}>
          <div>Part #</div>
          <div>Description</div>
          <div>Instruction File</div>
          <div>Open</div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 12 }}>No parts yet.</div>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              style={{ display: "grid", gridTemplateColumns: "220px 1fr 200px 140px", padding: 10, borderTop: "1px solid #eee", alignItems: "center" }}
            >
              <div style={{ fontWeight: 800 }}>{p.part_number}</div>
              <div>{p.description || ""}</div>
              <div>{p.has_file ? (p.filename || "Yes") : "No file"}</div>
              <div>
                {p.has_file ? <button onClick={() => openInstructions(p.id)}>Open</button> : <span style={{ opacity: 0.6 }}>—</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AdminPage({ token, user, onError }) {
  const [users, setUsers] = React.useState([]);
  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState("assembler");
  const [newPin, setNewPin] = React.useState("");

  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  const isAdmin = user?.role === "admin";

  async function refresh() {
    try {
      const u = await api("/users", { token });
      setUsers(u || []);
    } catch (e) {
      onError(e.message);
      setUsers([]);
    }
  }

  React.useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createUser(e) {
    e.preventDefault();
    try {
      await api("/users", { token, method: "POST", body: { name: newName, role: newRole, pin: newPin } });
      setNewName("");
      setNewPin("");
      await refresh();
    } catch (e2) {
      onError(e2.message);
    }
  }

  async function resetUserPin(e) {
    e.preventDefault();
    try {
      await api("/admin/reset-pin", {
        token,
        method: "POST",
        body: { name: resetName, new_pin: resetPin },
        // X-Reset-Token is required by backend
        // we can't pass headers in this simple api helper, so we do raw fetch:
      });
    } catch (_) {
      // ignore: we do raw below
    }

    try {
      const res = await fetch(API_BASE + "/admin/reset-pin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Reset-Token": resetToken,
        },
        body: JSON.stringify({ name: resetName, new_pin: resetPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Reset failed");
      setResetName("");
      setResetPin("");
      onError(""); // clear
    } catch (e2) {
      onError(e2.message);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h2>Admin</h2>
        <button onClick={refresh}>Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Create User (Admin only)</h3>
          <form onSubmit={createUser}>
            <div style={{ marginBottom: 10 }}>
              <label>Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label>Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }}>
                <option value="assembler">assembler</option>
                <option value="supervisor">supervisor</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label>PIN</label>
              <input value={newPin} onChange={(e) => setNewPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
            <button disabled={!isAdmin} style={{ width: "100%", padding: 12, borderRadius: 10, fontWeight: 800 }}>
              Create User
            </button>
            {!isAdmin && <div style={{ marginTop: 8, opacity: 0.7 }}>Only admin can create users.</div>}
          </form>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Reset User PIN (Admin only)</h3>
          <form onSubmit={resetUserPin}>
            <div style={{ marginBottom: 10 }}>
              <label>RESET_TOKEN</label>
              <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label>User Name</label>
              <input value={resetName} onChange={(e) => setResetName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label>New PIN</label>
              <input value={resetPin} onChange={(e) => setResetPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8 }} />
            </div>
            <button disabled={!isAdmin} style={{ width: "100%", padding: 12, borderRadius: 10, fontWeight: 800 }}>
              Reset PIN
            </button>
          </form>
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Users</h3>
        {users.length === 0 ? (
          <div>No users.</div>
        ) : (
          users.map((u) => (
            <div key={u.id} style={{ display: "flex", justifyContent: "space-between", padding: 10, borderTop: "1px solid #eee" }}>
              <div style={{ fontWeight: 800 }}>{u.name}</div>
              <div style={{ opacity: 0.8 }}>{u.role}</div>
              <div style={{ opacity: 0.8 }}>{u.is_active ? "active" : "inactive"}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function App() {
  const [err, setErr] = React.useState("");
  const [auth, setAuth] = React.useState(null); // {token, name, role}
  const [page, setPage] = React.useState("work");

  function logout() {
    setAuth(null);
    setPage("work");
  }

  if (!auth) {
    return <Login onLogin={setAuth} onError={setErr} />;
  }

  const user = { name: auth.name, role: auth.role };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>TRR Assembly Work Orders</div>
        <div style={{ opacity: 0.7 }}>{auth.name} ({auth.role})</div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setPage("work")} style={{ fontWeight: page === "work" ? 900 : 600 }}>Work Orders</button>
          <button onClick={() => setPage("inv")} style={{ fontWeight: page === "inv" ? 900 : 600 }}>Inventory</button>
          <button onClick={() => setPage("parts")} style={{ fontWeight: page === "parts" ? 900 : 600 }}>Parts</button>
          <button onClick={() => setPage("admin")} style={{ fontWeight: page === "admin" ? 900 : 600 }}>Admin</button>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

      <Banner text={err} onClose={() => setErr("")} />

      {page === "work" && <WorkOrdersPage token={auth.token} user={user} onError={setErr} />}
      {page === "inv" && <InventoryPage token={auth.token} user={user} onError={setErr} />}
      {page === "parts" && <PartsPage token={auth.token} user={user} onError={setErr} />}
      {page === "admin" && <AdminPage token={auth.token} user={user} onError={setErr} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
