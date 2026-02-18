import React from "react";
import { createRoot } from "react-dom/client";

/**
 * Configure API base:
 * - Render: set VITE_API_URL to https://trr-assembly-api.onrender.com
 * - Local: http://127.0.0.1:8000
 */
const API_BASE = (import.meta.env.VITE_API_URL || "https://trr-assembly-api.onrender.com").replace(/\/+$/, "");

async function api(path, { token, method = "GET", body, isForm = false } = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && data.detail) ? data.detail : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function cls(...xs) { return xs.filter(Boolean).join(" "); }

const styles = {
  page: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", background: "#f6f7fb", minHeight: "100vh" },
  shell: { maxWidth: 1200, margin: "0 auto", padding: 18 },
  header: { background: "white", borderRadius: 18, padding: 16, boxShadow: "0 8px 30px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brand: { display: "flex", flexDirection: "column", gap: 2 },
  h1: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: 0.2 },
  sub: { margin: 0, color: "#666", fontSize: 12 },
  tabs: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  tab: (active) => ({
    border: "1px solid #e6e7ef",
    background: active ? "#111" : "white",
    color: active ? "white" : "#111",
    padding: "8px 12px",
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
  }),
  card: { background: "white", borderRadius: 18, padding: 16, marginTop: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.06)" },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  input: { padding: "10px 12px", borderRadius: 12, border: "1px solid #e6e7ef", outline: "none", fontSize: 14, width: 280, maxWidth: "100%" },
  select: { padding: "10px 12px", borderRadius: 12, border: "1px solid #e6e7ef", outline: "none", fontSize: 14, minWidth: 280, maxWidth: "100%" },
  btn: (variant = "default") => {
    const base = { padding: "10px 12px", borderRadius: 12, border: "1px solid #e6e7ef", cursor: "pointer", fontWeight: 800, fontSize: 13 };
    if (variant === "dark") return { ...base, background: "#111", color: "white", borderColor: "#111" };
    if (variant === "green") return { ...base, background: "#0b7a3b", color: "white", borderColor: "#0b7a3b" };
    if (variant === "danger") return { ...base, background: "#c72b2b", color: "white", borderColor: "#c72b2b" };
    return { ...base, background: "white", color: "#111" };
  },
  banner: { marginTop: 14, borderRadius: 16, padding: 12, background: "#ffecec", border: "1px solid #ffd0d0", color: "#7a1b1b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: "0 10px" },
  th: { textAlign: "left", fontSize: 12, color: "#666", padding: "0 10px" },
  trCard: { background: "#fbfbfe", border: "1px solid #ececf6" },
  td: { padding: "12px 10px", verticalAlign: "top" },
  pill: (bg, fg) => ({ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: bg, color: fg }),
};

function Login({ onLogin, error }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await api("/auth/login", { method: "POST", body: { name, pin } });
      onLogin(r);
    } catch (e) {
      onLogin(null, e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={{ marginTop: 0 }}>Login</h2>
      <div style={styles.row}>
        <input style={styles.input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={styles.input} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} type="password" />
        <button style={styles.btn("dark")} onClick={submit} disabled={busy || !name || !pin}>
          {busy ? "Logging in..." : "Login"}
        </button>
      </div>
      {error ? <div style={{ marginTop: 10, color: "#b00020", fontWeight: 700 }}>{error}</div> : null}
    </div>
  );
}

function WorkOrdersPage({ token, user, onError }) {
  const [wos, setWos] = React.useState([]);
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

  React.useEffect(() => { refresh(); }, []);

  const filtered = wos.filter((w) => {
    const s = `${w.wo_number} ${w.station} ${w.part_number} ${w.customer_order || ""} ${w.status}`.toLowerCase();
    return !q.trim() || s.includes(q.toLowerCase());
  });

  async function complete(id) { try { await api(`/work-orders/${id}/complete`, { token, method: "POST" }); refresh(); } catch (e) { onError(e.message); } }
  async function close(id) { try { await api(`/work-orders/${id}/close`, { token, method: "POST" }); refresh(); } catch (e) { onError(e.message); } }
  async function reopen(id) { try { await api(`/work-orders/${id}/reopen`, { token, method: "POST" }); refresh(); } catch (e) { onError(e.message); } }
  async function checkIn(id) { try { await api(`/work-orders/${id}/workers/check-in`, { token, method: "POST" }); refresh(); } catch (e) { onError(e.message); } }
  async function checkOut(id) { try { await api(`/work-orders/${id}/workers/check-out`, { token, method: "POST" }); refresh(); } catch (e) { onError(e.message); } }

  async function delWO(id) {
    if (!confirm("Delete this work order? This cannot be undone.")) return;
    try {
      await api(`/work-orders/${id}`, { token, method: "DELETE" });
      refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  function openInstructions(w) {
    if (!w.instruction_url) return;
    // open file in new tab
    window.open(`${API_BASE}${w.instruction_url}`, "_blank", "noopener,noreferrer");
  }

  function printWO(w) {
    // print uses token query param
    window.open(`${API_BASE}/work-orders/${w.id}/print?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={styles.card}>
      <div style={{ ...styles.row, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Work Orders</h2>
          <span style={styles.pill("#eef2ff", "#3b49df")}>{filtered.length} shown</span>
        </div>

        <div style={styles.row}>
          <input style={{ ...styles.input, width: 360 }} placeholder="Search WO / station / part / status..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button style={styles.btn()} onClick={refresh}>Refresh</button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>WO</th>
              <th style={styles.th}>Station</th>
              <th style={styles.th}>Part</th>
              <th style={styles.th}>Customer / Stock</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => (
              <tr key={w.id} style={styles.trCard}>
                <td style={styles.td}>
                  <div style={{ fontWeight: 900 }}>{w.wo_number}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{new Date(w.created_at).toLocaleString()}</div>
                </td>
                <td style={styles.td}>
                  <div style={{ fontWeight: 800 }}>{w.station}</div>
                </td>
                <td style={styles.td}>
                  <div style={{ fontWeight: 900 }}>{w.part_number}</div>
                  {w.part_id ? <div style={{ fontSize: 12, color: "#666" }}>Part ID: {w.part_id}</div> : null}
                </td>
                <td style={styles.td}>
                  {w.is_stock ? (
                    <span style={styles.pill("#e8fff1", "#0b7a3b")}>Stock Job</span>
                  ) : (
                    <div style={{ fontWeight: 800 }}>{w.customer_order || <span style={{ color: "#aaa" }}>—</span>}</div>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={styles.pill("#f0f0f0", "#222")}>{w.status}</span>
                </td>
                <td style={styles.td}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {w.instruction_url ? (
                      <button style={styles.btn()} onClick={() => openInstructions(w)}>Instructions</button>
                    ) : (
                      <button style={{ ...styles.btn(), opacity: 0.55 }} disabled>No Instructions</button>
                    )}
                    <button style={styles.btn()} onClick={() => printWO(w)}>Print</button>

                    <button style={styles.btn("dark")} onClick={() => checkIn(w.id)}>Check In</button>
                    <button style={styles.btn()} onClick={() => checkOut(w.id)}>Check Out</button>

                    {canManage && (
                      <>
                        <button style={styles.btn("green")} onClick={() => complete(w.id)}>Complete</button>
                        <button style={styles.btn("dark")} onClick={() => close(w.id)}>Close</button>
                        <button style={styles.btn()} onClick={() => reopen(w.id)}>Reopen</button>
                        <button style={styles.btn("danger")} onClick={() => delWO(w.id)}>Delete</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, color: "#666" }}>No work orders found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateWOPage({ token, user, onError }) {
  const [station, setStation] = React.useState("");
  const [parts, setParts] = React.useState([]);
  const [partId, setPartId] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function loadParts() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
      setParts([]);
    }
  }

  React.useEffect(() => { loadParts(); }, []);

  async function submit() {
    setBusy(true);
    try {
      const body = {
        station: station.trim(),
        is_stock: !!isStock,
      };
      if (partId) body.part_id = Number(partId);
      else body.part_number = (partNumber || "").trim();
      if (!isStock) body.customer_order = (customerOrder || "").trim() || null;

      await api("/work-orders", { token, method: "POST", body });
      setStation("");
      setPartId("");
      setPartNumber("");
      setCustomerOrder("");
      setIsStock(false);
      alert("Work order created!");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={{ marginTop: 0 }}>Create Work Order</h2>
      <div style={styles.row}>
        <input style={styles.input} placeholder="Station (e.g. Electrical)" value={station} onChange={(e) => setStation(e.target.value)} />
        <select style={styles.select} value={partId} onChange={(e) => { setPartId(e.target.value); }}>
          <option value="">Select Part by ID (optional)</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.part_number} (ID {p.id})
            </option>
          ))}
        </select>
        <input
          style={styles.input}
          placeholder="Or type Part Number"
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
          disabled={!!partId}
        />
      </div>

      <div style={{ ...styles.row, marginTop: 10 }}>
        <input
          style={styles.input}
          placeholder="Customer Order"
          value={customerOrder}
          onChange={(e) => setCustomerOrder(e.target.value)}
          disabled={isStock}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          Stock Job
        </label>
        <button style={styles.btn("green")} onClick={submit} disabled={busy || !station.trim() || (!partId && !partNumber.trim())}>
          {busy ? "Creating..." : "Create Work Order"}
        </button>
      </div>

      <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
        Tip: choose a Part from the dropdown for best consistency. If it’s a Stock Job, Customer Order will be blank.
      </div>
    </div>
  );
}

function PartsPage({ token, user, onError }) {
  const canManage = user?.role === "admin" || user?.role === "supervisor";
  const [parts, setParts] = React.useState([]);
  const [pn, setPn] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [file, setFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
      setParts([]);
    }
  }
  React.useEffect(() => { refresh(); }, []);

  async function addPart() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("part_number", pn.trim());
      if (desc.trim()) fd.append("description", desc.trim());
      if (file) fd.append("file", file);

      await api("/parts", { token, method: "POST", body: fd, isForm: true });
      setPn(""); setDesc(""); setFile(null);
      await refresh();
      alert("Part added!");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openFile(p) {
    window.open(`${API_BASE}/parts/${p.id}/file`, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={styles.card}>
      <h2 style={{ marginTop: 0 }}>Parts</h2>

      {canManage ? (
        <div style={{ ...styles.card, marginTop: 10, boxShadow: "none", border: "1px solid #ececf6" }}>
          <h3 style={{ marginTop: 0 }}>Add Part (optional instruction file)</h3>
          <div style={styles.row}>
            <input style={styles.input} placeholder="Part Number" value={pn} onChange={(e) => setPn(e.target.value)} />
            <input style={{ ...styles.input, width: 360 }} placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button style={styles.btn("green")} onClick={addPart} disabled={busy || !pn.trim()}>
              {busy ? "Saving..." : "Add Part"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ color: "#666", fontSize: 12 }}>Only Admin/Supervisor can add parts.</div>
      )}

      <div style={{ marginTop: 14 }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Part #</th>
              <th style={styles.th}>Description</th>
              <th style={styles.th}>File</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id} style={styles.trCard}>
                <td style={styles.td}><div style={{ fontWeight: 900 }}>{p.part_number}</div><div style={{ fontSize: 12, color: "#666" }}>ID {p.id}</div></td>
                <td style={styles.td}>{p.description || <span style={{ color: "#aaa" }}>—</span>}</td>
                <td style={styles.td}>{p.has_file ? (p.filename || "file") : <span style={{ color: "#aaa" }}>none</span>}</td>
                <td style={styles.td}><span style={styles.pill("#eef2ff", "#3b49df")}>{p.qty_on_hand || 0}</span></td>
                <td style={styles.td}>
                  {p.has_file ? (
                    <button style={styles.btn()} onClick={() => openFile(p)}>Open Instructions</button>
                  ) : (
                    <button style={{ ...styles.btn(), opacity: 0.55 }} disabled>No File</button>
                  )}
                </td>
              </tr>
            ))}
            {parts.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, color: "#666" }}>No parts yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryPage({ token, user, onError }) {
  const canManage = user?.role === "admin" || user?.role === "supervisor";
  const [parts, setParts] = React.useState([]);
  const [selected, setSelected] = React.useState("");
  const [qty, setQty] = React.useState(1);
  const [note, setNote] = React.useState("");
  const [txns, setTxns] = React.useState([]);

  async function refresh() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
      setParts([]);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  async function loadTxns(partId) {
    if (!partId) { setTxns([]); return; }
    try {
      const t = await api(`/parts/${partId}/inventory/txns`, { token });
      setTxns(t || []);
    } catch (e) {
      onError(e.message);
      setTxns([]);
    }
  }

  React.useEffect(() => { loadTxns(selected); }, [selected]);

  async function receive() {
    try {
      await api(`/parts/${selected}/inventory/receive`, { token, method: "POST", body: { qty: Number(qty), note: note || null } });
      setNote("");
      await refresh();
      await loadTxns(selected);
    } catch (e) { onError(e.message); }
  }

  async function issue() {
    try {
      await api(`/parts/${selected}/inventory/issue`, { token, method: "POST", body: { qty: Number(qty), note: note || null } });
      setNote("");
      await refresh();
      await loadTxns(selected);
    } catch (e) { onError(e.message); }
  }

  const currentPart = parts.find((p) => String(p.id) === String(selected));

  return (
    <div style={styles.card}>
      <h2 style={{ marginTop: 0 }}>Inventory</h2>

      <div style={styles.row}>
        <select style={styles.select} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Select Part</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{p.part_number} (Qty {p.qty_on_hand || 0})</option>
          ))}
        </select>

        <input style={{ ...styles.input, width: 120 }} type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input style={{ ...styles.input, width: 360 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

        <button style={styles.btn("green")} onClick={receive} disabled={!canManage || !selected}>Receive</button>
        <button style={styles.btn("dark")} onClick={issue} disabled={!canManage || !selected}>Issue</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "#666" }}>
          {currentPart ? <>Current Qty: <b>{currentPart.qty_on_hand || 0}</b></> : "Pick a part to view transactions."}
        </div>

        {selected ? (
          <div style={{ marginTop: 10 }}>
            <h3 style={{ margin: "10px 0" }}>Transactions</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Delta</th>
                  <th style={styles.th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} style={styles.trCard}>
                    <td style={styles.td}>{new Date(t.created_at).toLocaleString()}</td>
                    <td style={styles.td}><span style={styles.pill("#f0f0f0", "#222")}>{t.txn_type}</span></td>
                    <td style={styles.td} style={{ ...styles.td, fontWeight: 900 }}>{t.qty_delta}</td>
                    <td style={styles.td}>{t.note || <span style={{ color: "#aaa" }}>—</span>}</td>
                  </tr>
                ))}
                {txns.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 20, color: "#666" }}>No transactions.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AdminPage({ token, user, onError }) {
  const isAdmin = user?.role === "admin";
  const [users, setUsers] = React.useState([]);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("assembler");
  const [pin, setPin] = React.useState("");
  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [newPin, setNewPin] = React.useState("");

  async function refresh() {
    try {
      const u = await api("/users", { token });
      setUsers(u || []);
    } catch (e) {
      onError(e.message);
      setUsers([]);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  async function createUser() {
    try {
      await api("/users", { token, method: "POST", body: { name, role, pin } });
      setName(""); setPin("");
      refresh();
    } catch (e) { onError(e.message); }
  }

  async function doReset() {
    try {
      await api("/admin/reset-pin", {
        token,
        method: "POST",
        body: { name: resetName, new_pin: newPin },
        // RESET_TOKEN is sent as header:
        // We can’t set custom headers in the simple api() without extending; do it manually here:
      });
    } catch (e) {
      // fallback manual call with header
      try {
        const res = await fetch(`${API_BASE}/admin/reset-pin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "x-reset-token": resetToken,
          },
          body: JSON.stringify({ name: resetName, new_pin: newPin }),
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!res.ok) throw new Error((data && data.detail) ? data.detail : `HTTP ${res.status}`);
        alert("PIN reset!");
      } catch (e2) {
        onError(e2.message);
      }
      return;
    }
    alert("PIN reset!");
  }

  return (
    <div style={styles.card}>
      <h2 style={{ marginTop: 0 }}>Admin</h2>
      {!isAdmin ? <div style={{ color: "#666" }}>Admin-only features are restricted.</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
        <div style={{ ...styles.card, marginTop: 0, boxShadow: "none", border: "1px solid #ececf6" }}>
          <h3 style={{ marginTop: 0 }}>Create User</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <input style={styles.input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <select style={styles.select} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="assembler">assembler</option>
              <option value="supervisor">supervisor</option>
              <option value="admin">admin</option>
            </select>
            <input style={styles.input} placeholder="PIN (4-6 digits)" value={pin} onChange={(e) => setPin(e.target.value)} />
            <button style={styles.btn("dark")} onClick={createUser} disabled={!isAdmin || !name || !pin}>Create User</button>
          </div>
        </div>

        <div style={{ ...styles.card, marginTop: 0, boxShadow: "none", border: "1px solid #ececf6" }}>
          <h3 style={{ marginTop: 0 }}>Reset User PIN</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <input style={styles.input} placeholder="RESET_TOKEN" value={resetToken} onChange={(e) => setResetToken(e.target.value)} />
            <input style={styles.input} placeholder="User Name" value={resetName} onChange={(e) => setResetName(e.target.value)} />
            <input style={styles.input} placeholder="New PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
            <button style={styles.btn("dark")} onClick={doReset} disabled={!isAdmin || !resetToken || !resetName || !newPin}>Reset PIN</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ ...styles.row, justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Users</h3>
          <button style={styles.btn()} onClick={refresh}>Refresh</button>
        </div>
        <div style={{ marginTop: 10 }}>
          {users.map((u) => (
            <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, borderRadius: 12, border: "1px solid #ececf6", background: "#fbfbfe", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 900 }}>{u.name} <span style={{ fontWeight: 700, color: "#666" }}>({u.role})</span></div>
                <div style={{ fontSize: 12, color: "#666" }}>{u.is_active ? "active" : "inactive"}</div>
              </div>
            </div>
          ))}
          {users.length === 0 ? <div style={{ color: "#666" }}>No users loaded.</div> : null}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = React.useState(null); // {token,name,role}
  const [tab, setTab] = React.useState("work_orders");
  const [error, setError] = React.useState("");

  const user = session ? { name: session.name, role: session.role } : null;

  function onLogin(resp, err) {
    if (!resp) {
      setError(err || "Login failed");
      return;
    }
    setSession(resp);
    setError("");
    setTab("work_orders");
  }

  function logout() {
    setSession(null);
    setTab("work_orders");
    setError("");
  }

  const tabs = [
    { id: "work_orders", label: "Work Orders" },
    { id: "create_wo", label: "Create WO" },
    { id: "inventory", label: "Inventory" },
    { id: "parts", label: "Parts" },
    { id: "admin", label: "Admin" },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div style={styles.brand}>
            <div style={styles.h1}>TRR Assembly Work Orders</div>
            <div style={styles.sub}>
              {session ? `Logged in as ${session.name} (${session.role}) • API: ${API_BASE}` : `API: ${API_BASE}`}
            </div>
          </div>

          <div style={styles.tabs}>
            {tabs.map((t) => (
              <button key={t.id} style={styles.tab(tab === t.id)} onClick={() => setTab(t.id)} disabled={!session}>
                {t.label}
              </button>
            ))}
            <button style={styles.tab(false)} onClick={logout} disabled={!session}>Logout</button>
          </div>
        </div>

        {error ? (
          <div style={styles.banner}>
            <div style={{ fontWeight: 900 }}>Internal Server Error</div>
            <div style={{ flex: 1, paddingLeft: 10 }}>{error}</div>
            <button style={styles.btn()} onClick={() => setError("")}>X</button>
          </div>
        ) : null}

        {!session ? (
          <Login onLogin={onLogin} error={error} />
        ) : (
          <>
            {tab === "work_orders" && <WorkOrdersPage token={session.token} user={user} onError={setError} />}
            {tab === "create_wo" && <CreateWOPage token={session.token} user={user} onError={setError} />}
            {tab === "inventory" && <InventoryPage token={session.token} user={user} onError={setError} />}
            {tab === "parts" && <PartsPage token={session.token} user={user} onError={setError} />}
            {tab === "admin" && <AdminPage token={session.token} user={user} onError={setError} />}
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
