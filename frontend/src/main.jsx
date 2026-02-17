import React from "react";
import { createRoot } from "react-dom/client";
import logo from "./assets/logo.png";

const API_BASE = (import.meta.env.VITE_API_BASE || "https://trr-assembly-api.onrender.com").replace(/\/+$/, "");
const IDLE_LOGOUT_MINUTES = 30;

/**
 * Robust API helper:
 * - Always parses FastAPI error bodies (detail)
 * - Avoids JSON parse crashes
 * - Sets Content-Type only when sending JSON
 */
async function api(path, { method = "GET", token, body } = {}) {
  const hasBody = body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    if (data && typeof data === "object") {
      if (typeof data.detail === "string") msg = data.detail;
      else if (data.detail) msg = JSON.stringify(data.detail);
      else msg = JSON.stringify(data);
    } else if (typeof data === "string" && data.trim()) {
      msg = data;
    }
    throw new Error(msg);
  }

  return data;
}

/**
 * Opens protected file endpoints using Authorization header.
 */
async function openFileWithAuth(fileUrl, token) {
  const absolute = fileUrl.startsWith("http") ? fileUrl : `${API_BASE}${fileUrl}`;
  const res = await fetch(absolute, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Idle logout
 */
function useIdleLogout(onLogout) {
  React.useEffect(() => {
    let t = null;
    const reset = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => onLogout(), IDLE_LOGOUT_MINUTES * 60 * 1000);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (t) clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [onLogout]);
}

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Timestamp formatting:
 * - Forces America/Chicago display
 * - If backend sends "naive" ISO (no Z / offset), assume UTC and append Z
 */
function normalizeIsoForDate(iso) {
  if (!iso) return "";
  const s = String(iso).trim();

  // If string already has timezone info (Z or +/-hh:mm), keep it
  if (/[zZ]$/.test(s) || /[+\-]\d{2}:\d{2}$/.test(s)) return s;

  // If it looks like ISO without timezone, treat as UTC by appending Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return `${s}Z`;

  return s;
}

function fmtDT(iso) {
  if (!iso) return "";
  try {
    const normalized = normalizeIsoForDate(iso);
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return String(iso);

    return d.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(iso);
  }
}

function Card({ title, right, children }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 14, overflow: "hidden", background: "white" }}>
      <div style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #eee", background: "#fafafa" }}>
        <div style={{ fontWeight: 950 }}>{title}</div>
        <div style={{ marginLeft: "auto" }}>{right || null}</div>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 9999,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ width: "min(720px, 96vw)", background: "white", borderRadius: 16, overflow: "hidden", border: "1px solid #eee" }}>
        <div style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #eee", background: "#fafafa" }}>
          <div style={{ fontWeight: 950 }}>{title}</div>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
          >
            X
          </button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

/**
 * STATUS helpers:
 * We do NOT break if backend sends different casing.
 * We'll show unknown status as a warning, not crash the page.
 */
const KNOWN_STATUSES = ["open", "in_progress", "complete", "closed", "completed"]; // allow "completed" just in case

function normStatus(s) {
  return String(s || "").trim().toLowerCase();
}

function App() {
  const [token, setToken] = React.useState(localStorage.getItem("trr_token") || "");
  const [user, setUser] = React.useState(() => safeParse(localStorage.getItem("trr_user")));
  const [page, setPage] = React.useState("workorders");
  const [error, setError] = React.useState("");

  useIdleLogout(() => {
    if (token) {
      localStorage.removeItem("trr_token");
      localStorage.removeItem("trr_user");
      setToken("");
      setUser(null);
      setPage("workorders");
      setError("Logged out due to inactivity.");
    }
  });

  async function onLogin(name, pin) {
    setError("");
    const data = await api("/auth/login", { method: "POST", body: { name, pin } });
    const u = { name: data.name, role: data.role };
    setToken(data.token);
    setUser(u);
    localStorage.setItem("trr_token", data.token);
    localStorage.setItem("trr_user", JSON.stringify(u));
  }

  function logout() {
    localStorage.removeItem("trr_token");
    localStorage.removeItem("trr_user");
    setToken("");
    setUser(null);
    setPage("workorders");
  }

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <Header user={user} onLogout={logout} page={page} setPage={setPage} />

      {error ? (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f2c2c2", background: "#fff5f5", borderRadius: 12, color: "#7a0000" }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {!token ? (
          <Login onLogin={onLogin} onError={setError} />
        ) : page === "inventory" && (user?.role === "admin" || user?.role === "supervisor") ? (
          <InventoryPage token={token} user={user} onError={setError} />
        ) : page === "admin" && (user?.role === "admin" || user?.role === "supervisor") ? (
          <AdminPanel token={token} user={user} onError={setError} />
        ) : (
          <WorkOrders token={token} user={user} onError={setError} />
        )}
      </div>
    </div>
  );
}

function Header({ user, onLogout, page, setPage }) {
  const role = user?.role || "";
  const canAdmin = role === "admin" || role === "supervisor";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, border: "1px solid #eee", borderRadius: 14, background: "white" }}>
      <img src={logo} alt="TRR" style={{ height: 44, width: "auto" }} />
      <div>
        <div style={{ fontWeight: 950, fontSize: 18, lineHeight: 1.1 }}>TRR Assembly Work Orders</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Texas Refuse Rigging</div>
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {user ? (
          <div style={{ opacity: 0.85, fontWeight: 700 }}>
            {user.name} ({user.role})
          </div>
        ) : null}

        {user && canAdmin ? (
          <>
            <button
              onClick={() => setPage("workorders")}
              style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: page === "workorders" ? "#f6f8ff" : "white", fontWeight: 900 }}
            >
              Work Orders
            </button>

            <button
              onClick={() => setPage("inventory")}
              style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: page === "inventory" ? "#f6f8ff" : "white", fontWeight: 900 }}
            >
              Inventory
            </button>

            <button
              onClick={() => setPage("admin")}
              style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: page === "admin" ? "#f6f8ff" : "white", fontWeight: 900 }}
            >
              Admin
            </button>
          </>
        ) : null}

        {user ? (
          <button onClick={onLogout} style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white" }}>
            Logout
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Login({ onLogin, onError }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");

  return (
    <div style={{ maxWidth: 440 }}>
      <Card title="Login">
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>PIN (4–6 digits)</div>
            <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
          </label>

          <button
            onClick={async () => {
              try {
                await onLogin(name, pin);
              } catch (e) {
                onError(e?.message || (typeof e === "string" ? e : JSON.stringify(e)));
              }
            }}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 900 }}
          >
            Sign In
          </button>
        </div>
      </Card>
    </div>
  );
}

// ---------------- Admin Panel ----------------
function AdminPanel({ token, user, onError }) {
  const isAdmin = user?.role === "admin";

  const [users, setUsers] = React.useState([]);
  const [parts, setParts] = React.useState([]);

  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState("assembler");
  const [newPin, setNewPin] = React.useState("");

  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  const [partNumber, setPartNumber] = React.useState("");
  const [partFile, setPartFile] = React.useState(null);

  const [editUser, setEditUser] = React.useState(null);
  const [editPart, setEditPart] = React.useState(null);

  async function refresh() {
    try {
      const u = await api("/users", { token });
      setUsers(u || []);
    } catch (e) {
      onError(e.message);
    }

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

  async function createUser() {
    try {
      await api("/users", { method: "POST", token, body: { name: newName, role: newRole, pin: newPin } });
      setNewName("");
      setNewRole("assembler");
      setNewPin("");
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  async function resetPinViaHeader() {
    try {
      const res = await fetch(`${API_BASE}/admin/reset-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Reset-Token": resetToken },
        body: JSON.stringify({ name: resetName, new_pin: resetPin }),
      });

      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const j = await res.json();
          if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        } catch {}
        throw new Error(msg);
      }

      setResetName("");
      setResetPin("");
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  async function createPart() {
    try {
      if (!partNumber.trim()) throw new Error("Part number is required");

      const created = await api("/parts", { method: "POST", token, body: { part_number: partNumber.trim() } });

      if (partFile) {
        const fd = new FormData();
        fd.append("file", partFile);

        const res = await fetch(`${API_BASE}/parts/${created.id}/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });

        if (!res.ok) {
          const text = await res.text();
          let msg = `${res.status} ${res.statusText}`;
          try {
            const j = text ? JSON.parse(text) : null;
            if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
          } catch {
            if (text) msg = text;
          }
          throw new Error(msg);
        }
      }

      setPartNumber("");
      setPartFile(null);
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Admin</h2>
        <button
          style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
          onClick={() => refresh()}
        >
          Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="Create User (Admin only)">
          <div style={{ display: "grid", gap: 10 }}>
            {!isAdmin ? <div style={{ opacity: 0.7 }}>Only admins can create users.</div> : null}

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Name</div>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Role</div>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
                <option value="assembler">assembler</option>
                <option value="supervisor">supervisor</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>PIN</div>
              <input value={newPin} onChange={(e) => setNewPin(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
            </label>

            <button
              disabled={!isAdmin}
              onClick={createUser}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #111",
                background: isAdmin ? "#111" : "#888",
                color: "white",
                cursor: isAdmin ? "pointer" : "not-allowed",
                fontWeight: 900,
              }}
            >
              Create User
            </button>
          </div>
        </Card>

        <Card title="Reset User PIN (Admin only)">
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>RESET_TOKEN</div>
              <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>User Name</div>
              <input value={resetName} onChange={(e) => setResetName(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>New PIN</div>
              <input value={resetPin} onChange={(e) => setResetPin(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
            </label>

            <button
              disabled={!isAdmin}
              onClick={resetPinViaHeader}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #111",
                background: isAdmin ? "#111" : "#888",
                color: "white",
                cursor: isAdmin ? "pointer" : "not-allowed",
                fontWeight: 900,
              }}
            >
              Reset PIN
            </button>
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="Users">
          <div style={{ display: "grid", gap: 8 }}>
            {users.map((u) => (
              <div key={u.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14, display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 950 }}>{u.name}</div>
                <div style={{ opacity: 0.85 }}>{u.role}</div>
                <div style={{ marginLeft: "auto", opacity: 0.8 }}>{u.is_active ? "active" : "inactive"}</div>

                {isAdmin ? (
                  <>
                    <button
                      onClick={() => setEditUser(u)}
                      style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}
                    >
                      Edit
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          if (!confirm(`Delete ${u.name}?`)) return;
                          await api(`/users/${u.id}`, { method: "DELETE", token });
                          await refresh();
                        } catch (e) {
                          onError(e.message);
                        }
                      }}
                      style={{ border: "1px solid #f2c2c2", color: "#7a0000", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "#fff5f5" }}
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            ))}
            {users.length === 0 ? <div style={{ opacity: 0.7 }}>No users yet.</div> : null}
          </div>
        </Card>

        <Card title="Parts Database (Supervisor/Admin)">
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Part Number</div>
              <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Instruction File (optional)</div>
              <input type="file" onChange={(e) => setPartFile(e.target.files?.[0] || null)} />
            </label>

            <button onClick={createPart} style={{ padding: 12, borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 900 }}>
              Add Part (and upload file if chosen)
            </button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {parts.map((p) => {
              const downloadUrl = p.has_file ? `/parts/${p.id}/download` : null;
              return (
                <div key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14, display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 950 }}>{p.part_number}</div>
                  <div style={{ opacity: 0.8, fontSize: 13 }}>{p.filename || (p.has_file ? "file uploaded" : "")}</div>

                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {downloadUrl ? (
                      <button
                        onClick={async () => {
                          try {
                            await openFileWithAuth(downloadUrl, token);
                          } catch (e) {
                            onError(e.message);
                          }
                        }}
                        style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}
                      >
                        Open
                      </button>
                    ) : (
                      <span style={{ opacity: 0.6, fontSize: 12 }}>No file</span>
                    )}

                    <button
                      onClick={() => setEditPart(p)}
                      style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}
                    >
                      Edit
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          if (!confirm(`Delete part ${p.part_number}?`)) return;
                          await api(`/parts/${p.id}`, { method: "DELETE", token });
                          await refresh();
                        } catch (e) {
                          onError(e.message);
                        }
                      }}
                      style={{ border: "1px solid #f2c2c2", color: "#7a0000", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "#fff5f5" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}

            {parts.length === 0 ? <div style={{ opacity: 0.7 }}>No parts yet.</div> : null}
          </div>
        </Card>
      </div>

      {editUser ? (
        <EditUserModal
          token={token}
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={async () => {
            setEditUser(null);
            await refresh();
          }}
          onError={onError}
        />
      ) : null}

      {editPart ? (
        <EditPartModal
          token={token}
          part={editPart}
          onClose={() => setEditPart(null)}
          onSaved={async () => {
            setEditPart(null);
            await refresh();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
} // ✅ AdminPanel ends

// ---------------- Inventory ----------------
function InventoryPage({ token, user, onError }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [qtyMap, setQtyMap] = React.useState({});
  const [txnsPart, setTxnsPart] = React.useState(null);
  const [txns, setTxns] = React.useState([]);

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
    return String(p.part_number || "").toLowerCase().includes(q.trim().toLowerCase());
  });

  function getQty(partId) {
    const raw = qtyMap[partId] ?? 1;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }

  async function receive(partId) {
    const qty = getQty(partId);
    await api(`/parts/${partId}/inventory/receive`, { method: "POST", token, body: { qty, note: "Received" } });
    await refresh();
  }

  async function issue(partId) {
    const qty = getQty(partId);
    await api(`/parts/${partId}/inventory/issue`, { method: "POST", token, body: { qty, note: "Issued/Sold" } });
    await refresh();
  }

  async function openTxns(part) {
    try {
      const rows = await api(`/parts/${part.id}/inventory/txns?limit=200`, { token });
      setTxns(rows || []);
      setTxnsPart(part);
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Inventory</h2>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search part number…"
          style={{ marginLeft: 10, padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", minWidth: 240 }}
        />

        <button
          style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
          onClick={() => refresh().catch((e) => onError(e.message))}
        >
          Refresh
        </button>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 14, overflow: "hidden", background: "white" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr .6fr 1fr", gap: 10, padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 900 }}>
          <div>Part</div>
          <div>On Hand</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {filtered.map((p) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1.3fr .6fr 1fr", gap: 10, padding: 12, borderBottom: "1px solid #eee", alignItems: "center" }}>
            <div style={{ fontWeight: 950 }}>{p.part_number}</div>

            <div style={{ fontWeight: 900 }}>{typeof p.qty_on_hand === "number" ? p.qty_on_hand : 0}</div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={() => openTxns(p)} style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}>
                History
              </button>

              {canManage ? (
                <>
                  <input
                    type="number"
                    min="1"
                    value={qtyMap[p.id] ?? 1}
                    onChange={(e) => setQtyMap((m) => ({ ...m, [p.id]: e.target.value }))}
                    style={{ width: 80, padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd" }}
                  />

                  <button
                    onClick={async () => {
                      try {
                        await receive(p.id);
                      } catch (e) {
                        onError(e.message);
                      }
                    }}
                    style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}
                  >
                    Receive
                  </button>

                  <button
                    onClick={async () => {
                      try {
                        await issue(p.id);
                      } catch (e) {
                        onError(e.message);
                      }
                    }}
                    style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}
                  >
                    Issue
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ))}

        {filtered.length === 0 ? <div style={{ padding: 12, opacity: 0.7 }}>No parts match.</div> : null}
      </div>

      {txnsPart ? (
        <Modal
          title={`Inventory History: ${txnsPart.part_number}`}
          onClose={() => {
            setTxnsPart(null);
            setTxns([]);
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            {txns.length === 0 ? <div style={{ opacity: 0.7 }}>No transactions yet.</div> : null}

            {txns.map((t) => (
              <div key={t.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14 }}>
                <div style={{ display: "flex", gap: 10, fontSize: 13, opacity: 0.85 }}>
                  <div>
                    <b>{t.txn_type}</b>
                  </div>
                  <div>{fmtDT(t.created_at)}</div>
                  <div style={{ marginLeft: "auto" }}>
                    <b>Δ</b> {t.qty_delta}
                  </div>
                </div>
                {t.note ? <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{t.note}</div> : null}
                {t.ref_wo_id ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>WO ID: {t.ref_wo_id}</div> : null}
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------------- Work Orders ----------------
function WorkOrders({ token, user, onError }) {
  const [view, setView] = React.useState("open");
  const [wos, setWos] = React.useState([]);
  const [selected, setSelected] = React.useState(null);

  async function refresh(nextView) {
    const v = nextView || view;
    const path = v === "closed" ? "/work-orders?status=closed" : "/work-orders";
    const data = await api(path, { token });
    setWos(data || []);
  }

  React.useEffect(() => {
    refresh().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const canCreate = user?.role === "admin" || user?.role === "supervisor";

  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1.2fr" : "1fr", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{view === "closed" ? "Closed Work Orders" : "Work Orders"}</h2>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setSelected(null);
                setView("open");
              }}
              style={{ padding: "6px 10px", borderRadius: 12, border: "1px solid #ddd", background: view === "open" ? "#f6f8ff" : "white", cursor: "pointer", fontWeight: 900 }}
            >
              Open
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setView("closed");
              }}
              style={{ padding: "6px 10px", borderRadius: 12, border: "1px solid #ddd", background: view === "closed" ? "#f6f8ff" : "white", cursor: "pointer", fontWeight: 900 }}
            >
              Closed
            </button>
          </div>

          {canCreate && view === "open" ? <CreateWOButton token={token} onCreated={async () => refresh("open")} onError={onError} /> : null}

          <button
            style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
            onClick={() => refresh().catch((e) => onError(e.message))}
          >
            Refresh
          </button>
        </div>

        <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 14, overflow: "hidden", background: "white" }}>
          {wos.map((wo) => (
            <div
              key={wo.id}
              onClick={() => setSelected(wo)}
              style={{
                padding: 12,
                borderBottom: "1px solid #eee",
                cursor: "pointer",
                background: selected?.id === wo.id ? "#f6f8ff" : "white",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontWeight: 950 }}>{wo.wo_number}</div>
                <div style={{ opacity: 0.8 }}>{wo.station}</div>
                <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.8 }}>{wo.status}</div>
              </div>
              <div style={{ marginTop: 6, fontSize: 14 }}>
                <b>Part:</b> {wo.part_number}{" "}
                {wo.is_stock ? <span style={{ opacity: 0.8 }}>(Stock)</span> : <span style={{ opacity: 0.8 }}>(Order: {wo.customer_order || "-"})</span>}
              </div>
            </div>
          ))}
          {wos.length === 0 ? <div style={{ padding: 12, opacity: 0.7 }}>No work orders yet.</div> : null}
        </div>
      </div>

      {selected ? (
        <WorkOrderDetail token={token} user={user} woId={selected.id} onClose={() => setSelected(null)} onError={onError} onRefresh={async () => refresh()} />
      ) : null}
    </div>
  );
}

function CreateWOButton({ token, onCreated, onError }) {
  const [open, setOpen] = React.useState(false);

  const [stations, setStations] = React.useState([]);
  const [station, setStation] = React.useState("");

  const [parts, setParts] = React.useState([]);
  const [partId, setPartId] = React.useState(null);

  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const s = await api("/stations", { token });
        setStations(s?.stations || []);
        setStation((s?.stations || [])[0] || "");

        const p = await api("/parts", { token });
        setParts(p || []);
        setPartId(p?.[0]?.id ?? null);
      } catch (e) {
        onError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return (
      <button style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white" }} onClick={() => setOpen(true)}>
        + New Work Order
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12, width: 380, background: "white" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ fontWeight: 950 }}>Create Work Order</div>
        <button style={{ marginLeft: "auto", border: "1px solid #ddd", borderRadius: 12, padding: "6px 10px", cursor: "pointer", background: "white" }} onClick={() => setOpen(false)}>
          X
        </button>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Station</div>
          <select value={station} onChange={(e) => setStation(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
            {stations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Part Number</div>
          <select value={partId ?? ""} onChange={(e) => setPartId(Number(e.target.value))} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_number}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          <div style={{ fontWeight: 800 }}>Stock (inventory)</div>
        </label>

        {!isStock ? (
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Customer Order #</div>
            <input value={customerOrder} onChange={(e) => setCustomerOrder(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
          </label>
        ) : null}

        <button
          onClick={async () => {
            try {
              await api("/work-orders", {
                method: "POST",
                token,
                body: { station, part_id: partId, customer_order: isStock ? null : customerOrder, is_stock: isStock },
              });
              setCustomerOrder("");
              setIsStock(false);
              setOpen(false);
              await onCreated();
            } catch (e) {
              onError(e.message);
            }
          }}
          style={{ padding: 12, borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 950 }}
        >
          Create
        </button>
      </div>
    </div>
  );
}

function WorkOrderDetail({ token, user, woId, onClose, onError, onRefresh }) {
  const [wo, setWo] = React.useState(null);
  const [notes, setNotes] = React.useState([]);
  const [workers, setWorkers] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [noteText, setNoteText] = React.useState("");
  const [editOpen, setEditOpen] = React.useState(false);

  async function load() {
    const w = await api(`/work-orders/${woId}`, { token });
    const n = await api(`/work-orders/${woId}/notes`, { token });
    const wk = await api(`/work-orders/${woId}/workers`, { token });
    const hist = await api(`/work-orders/${woId}/workers/history`, { token });
    setWo(w);
    setNotes(n || []);
    setWorkers(wk || []);
    setHistory(hist || []);
  }

  React.useEffect(() => {
    load().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  if (!wo) return <Card title="Work Order">Loading…</Card>;

  const myName = user?.name || "";
  const checkedInNames = workers.map((w) => w.name);
  const isMeCheckedIn = workers.some((w) => w.name === myName);
  const someoneElseCheckedIn = checkedInNames.some((n) => n !== myName);

  const isAdminOrSupervisor = user?.role === "admin" || user?.role === "supervisor";
  const isAdmin = user?.role === "admin";

  const statusNorm = normStatus(wo.status);
  const isClosed = statusNorm === "closed";
  const isComplete = statusNorm === "complete" || statusNorm === "completed";
  const isKnownStatus = KNOWN_STATUSES.includes(statusNorm);

  // IMPORTANT: Backend PATCH likely requires full body (your simple {status:"complete"} caused 400)
async function patchStatus(nextStatus) {
if (!wo) throw new Error("Work order not loaded yet");
if (!woId) throw new Error("Missing woId");
if (!token) throw new Error("Missing token");

  // Always send the full payload that PATCH expects
  const baseBody = {
    station: wo.station,
    part_id: wo.part_id,
    is_stock: !!wo.is_stock,
    // IMPORTANT: stock should be null, not ""
    customer_order: wo.is_stock ? null : (wo.customer_order ?? ""),
  };

  // Some backends use "complete", others use "completed"
  const tryStatuses =
    nextStatus === "complete" ? ["complete", "completed"] :
    nextStatus === "open" ? ["open"] :
    nextStatus === "closed" ? ["closed"] :
    [nextStatus];

  let lastErr = null;

  for (const s of tryStatuses) {
    try {
      await api(`/work-orders/${woId}`, {
        method: "PATCH",
        token,
        body: { ...baseBody, status: s },
      });
      return; // success
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to update work order status");
}


  return (
    <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 14, background: "white" }}>
      {!isKnownStatus ? (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #f2d08a", background: "#fff8e8", borderRadius: 14 }}>
          ⚠ Unknown status from API: <b>{String(wo.status)}</b> (UI will still work)
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>{wo.wo_number}</div>
        <div style={{ opacity: 0.8 }}>{wo.station}</div>
        <div style={{ marginLeft: "auto", opacity: 0.8 }}>{wo.status}</div>

        <button
          onClick={() => {
            const url = `${API_BASE}/work-orders/${woId}/print?token=${encodeURIComponent(token)}`;
            window.open(url, "_blank", "noopener,noreferrer");
          }}
          style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white", fontWeight: 900 }}
        >
          Pop Out / Print PDF
        </button>

        {isAdmin ? (
          <>
            <button onClick={() => setEditOpen(true)} style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}>
              Edit
            </button>
            <button
              onClick={async () => {
                try {
                  if (!confirm(`Delete ${wo.wo_number}? This cannot be undone.`)) return;
                  await api(`/work-orders/${woId}`, { method: "DELETE", token });
                  await onRefresh();
                  onClose();
                } catch (e) {
                  onError(e.message);
                }
              }}
              style={{ border: "1px solid #f2c2c2", color: "#7a0000", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "#fff5f5" }}
            >
              Delete
            </button>
          </>
        ) : null}

        <button style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }} onClick={onClose}>
          Close Panel
        </button>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        <div>
          <b>Part #:</b> {wo.part_number}
        </div>
        <div>
          <b>Customer Order:</b> {wo.is_stock ? "Stock" : wo.customer_order || "-"}
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 14, background: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 950 }}>Work Instructions</div>
          <div style={{ marginLeft: "auto" }}>
            {wo.instruction_url ? (
 <button
  onClick={async () => {
    try {
      await openInstructions();
    } catch (e) {
      onError(e?.message || String(e));
    }
  }}
  style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white" }}
>
  Open Instructions
</button>

              <span style={{ opacity: 0.7, fontSize: 13 }}>No instruction file attached for this part yet.</span>
            )}
          </div>
        </div>
      </div>

      {someoneElseCheckedIn ? (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f2d08a", background: "#fff8e8", borderRadius: 14 }}>
          ⚠ Someone else is currently working on this WO: <b>{checkedInNames.filter((n) => n !== myName).join(", ")}</b>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {!isClosed ? (
          <>
            <button
              onClick={async () => {
                try {
                  await api(`/work-orders/${woId}/workers/${isMeCheckedIn ? "check-out" : "check-in"}`, { method: "POST", token });
                  await load();
                  await onRefresh();
                } catch (e) {
                  onError(e.message);
                }
              }}
              style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white", fontWeight: 900 }}
            >
              {isMeCheckedIn ? "Check Out" : "Check In"}
            </button>

            {/* FIXED JSX: must be wrapped in { } */}
            {!isComplete ? (
              <button
                onClick={async () => {
                  try {
                    await patchStatus("complete");
                    await load();
                    await onRefresh();
                  } catch (e) {
                    onError(e?.message || String(e));
                  }
                }}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 950 }}
              >
                Mark Complete
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    await patchStatus("open");
                    await load();
                    await onRefresh();
                  } catch (e) {
                    onError(e?.message || String(e));
                  }
                }}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", background: "white", cursor: "pointer", fontWeight: 950 }}
              >
                Undo Complete
              </button>
            )}

            {isAdminOrSupervisor ? (
              <button
                onClick={async () => {
                  try {
                    await patchStatus("closed");
                    await load();
                    await onRefresh();
                  } catch (e) {
                    onError(e?.message || String(e));
                  }
                }}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #0b5", background: "#0b5", color: "white", cursor: "pointer", fontWeight: 950 }}
              >
                Close Work Order
              </button>
            ) : null}
          </>
        ) : null}

        {isAdminOrSupervisor && isClosed ? (
          <button
            onClick={async () => {
              try {
                await patchStatus("open");
                await load();
                await onRefresh();
              } catch (e) {
                onError(e?.message || String(e));
              }
            }}
            style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 950 }}
          >
            Reopen Work Order
          </button>
        ) : null}
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>Workers Checked In</div>
        {workers.length === 0 ? <div style={{ opacity: 0.7 }}>No one is checked in.</div> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {workers.map((w) => (
            <div key={w.user_id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14, display: "flex", gap: 10 }}>
              <div style={{ fontWeight: 950 }}>{w.name}</div>
              <div style={{ opacity: 0.8 }}>{w.role}</div>
              <div style={{ marginLeft: "auto", opacity: 0.8 }}>{fmtDT(w.started_at)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>Worker Fingerprint (Check In / Out)</div>
        {history.length === 0 ? <div style={{ opacity: 0.7 }}>No check-in history yet.</div> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {history.map((h) => (
            <div key={h.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 950 }}>{h.name}</div>
                <div style={{ opacity: 0.8 }}>{h.role}</div>
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                <b>IN:</b> {fmtDT(h.started_at) || "-"} &nbsp;&nbsp; <b>OUT:</b> {fmtDT(h.ended_at) || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>Notes</div>

        <div style={{ display: "grid", gap: 10 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note…"
            style={{ width: "100%", minHeight: 90, padding: 12, borderRadius: 14, border: "1px solid #ddd" }}
          />
          <button
            onClick={async () => {
              try {
                if (!noteText.trim()) return;
                await api(`/work-orders/${woId}/notes`, { method: "POST", token, body: { text: noteText } });
                setNoteText("");
                await load();
              } catch (e) {
                onError(e.message);
              }
            }}
            style={{ padding: 12, borderRadius: 14, border: "1px solid #ddd", cursor: "pointer", background: "white", fontWeight: 900 }}
          >
            Add Note
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14 }}>
              <div style={{ display: "flex", gap: 10, opacity: 0.85, fontSize: 13 }}>
                <div>
                  <b>{n.author_name}</b>
                </div>
                <div>{fmtDT(n.created_at)}</div>
                <div style={{ marginLeft: "auto" }}>{n.station || ""}</div>
              </div>
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{n.text}</div>
            </div>
          ))}
          {notes.length === 0 ? <div style={{ opacity: 0.7 }}>No notes yet.</div> : null}
        </div>
      </div>

      {editOpen ? (
        <EditWorkOrderModal
          token={token}
          wo={wo}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            await load();
            await onRefresh();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function EditWorkOrderModal({ token, wo, onClose, onSaved, onError }) {
  const [stations, setStations] = React.useState([]);
  const [parts, setParts] = React.useState([]);

  const [station, setStation] = React.useState(wo.station);
  const [partId, setPartId] = React.useState(wo.part_id ?? null);
  const [isStock, setIsStock] = React.useState(!!wo.is_stock);
  const [customerOrder, setCustomerOrder] = React.useState(wo.customer_order || "");
  const [status, setStatus] = React.useState(wo.status);

  React.useEffect(() => {
    (async () => {
      try {
        const s = await api("/stations", { token });
        setStations(s?.stations || []);
        const p = await api("/parts", { token });
        setParts(p || []);
      } catch (e) {
        onError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title={`Edit ${wo.wo_number}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Station</div>
          <select value={station} onChange={(e) => setStation(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
            {stations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Part Number</div>
          <select value={partId ?? ""} onChange={(e) => setPartId(Number(e.target.value))} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_number}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          <div style={{ fontWeight: 800 }}>Stock</div>
        </label>

        {!isStock ? (
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Customer Order</div>
            <input value={customerOrder} onChange={(e) => setCustomerOrder(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
          </label>
        ) : null}

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Status</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
            <option value="open">open</option>
            <option value="in_progress">in_progress</option>
            <option value="complete">complete</option>
            <option value="closed">closed</option>
          </select>
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={async () => {
              try {
                await api(`/work-orders/${wo.id}`, {
                  method: "PATCH",
                  token,
                  body: {
                    station,
                    part_id: partId,
                    is_stock: isStock,
                    customer_order: isStock ? "" : customerOrder,
                    status,
                  },
                });
                await onSaved();
              } catch (e) {
                onError(e.message);
              }
            }}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 900 }}
          >
            Save
          </button>

          <button onClick={onClose} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", background: "white", cursor: "pointer", fontWeight: 900 }}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Minimal modal implementations to avoid "not defined" crashes
 * (If you already have better versions in another file, remove these and keep your originals.)
 */
function EditUserModal({ token, user, onClose, onSaved, onError }) {
  const [role, setRole] = React.useState(user.role);
  const [isActive, setIsActive] = React.useState(!!user.is_active);

  return (
    <Modal title={`Edit User: ${user.name}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Role</div>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}>
            <option value="assembler">assembler</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <div style={{ fontWeight: 800 }}>Active</div>
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={async () => {
              try {
                await api(`/users/${user.id}`, { method: "PATCH", token, body: { role, is_active: isActive } });
                await onSaved();
              } catch (e) {
                onError(e.message);
              }
            }}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 900 }}
          >
            Save
          </button>
          <button onClick={onClose} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", background: "white", cursor: "pointer", fontWeight: 900 }}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditPartModal({ token, part, onClose, onSaved, onError }) {
  const [partNumber, setPartNumber] = React.useState(part.part_number || "");
  const [file, setFile] = React.useState(null);

  async function upload(partId) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/parts/${partId}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = text ? JSON.parse(text) : null;
        if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {
        if (text) msg = text;
      }
      throw new Error(msg);
    }
  }

  return (
    <Modal title={`Edit Part: ${part.part_number}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Part Number</div>
          <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Replace Instruction File (optional)</div>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={async () => {
              try {
                await api(`/parts/${part.id}`, { method: "PATCH", token, body: { part_number: partNumber.trim() } });
                await upload(part.id);
                await onSaved();
              } catch (e) {
                onError(e.message);
              }
            }}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer", fontWeight: 900 }}
          >
            Save
          </button>

          <button onClick={onClose} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", background: "white", cursor: "pointer", fontWeight: 900 }}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(<App />);
