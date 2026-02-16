import React from "react";
import { createRoot } from "react-dom/client";
import logo from "./assets/logo.png";

const API_BASE = (import.meta.env.VITE_API_BASE || "https://trr-assembly-api.onrender.com").replace(/\/+$/, "");
const IDLE_LOGOUT_MINUTES = 30;

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = j.detail;
    } catch {}
    throw new Error(msg);
  }

  // some endpoints return {ok:true}
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

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

function App() {
  const [token, setToken] = React.useState(localStorage.getItem("trr_token") || "");
  const [user, setUser] = React.useState(() => {
    const raw = localStorage.getItem("trr_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [page, setPage] = React.useState("workorders"); // workorders | admin
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
    setToken(data.token);
    const u = { name: data.name, role: data.role };
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
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f2c2c2", background: "#fff5f5", borderRadius: 10, color: "#7a0000" }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {!token ? (
          <Login onLogin={onLogin} onError={setError} />
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
      <img src={logo} alt="TRR" style={{ height: 40, width: "auto" }} />
      <div style={{ fontWeight: 900, fontSize: 18 }}>TRR Assembly Work Orders</div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {user ? <div style={{ opacity: 0.85 }}>{user.name} ({user.role})</div> : null}

        {user && (user.role === "admin" || user.role === "supervisor") ? (
          <button
            onClick={() => setPage(page === "admin" ? "workorders" : "admin")}
            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
          >
            {page === "admin" ? "Work Orders" : "Admin"}
          </button>
        ) : null}

        {user ? (
          <button onClick={onLogout} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}>
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
    <div style={{ maxWidth: 420, border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Login</h2>
      <div style={{ display: "grid", gap: 10 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
        </label>
        <label>
          PIN (4–6 digits)
          <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
        </label>
        <button
          onClick={async () => {
            try {
              await onLogin(name, pin);
            } catch (e) {
              onError(String(e.message || e));
            }
          }}
          style={{ padding: 12, borderRadius: 10, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer" }}
        >
          Sign In
        </button>
      </div>
    </div>
  );
}

function AdminPanel({ token, user, onError }) {
  const [users, setUsers] = React.useState([]);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("assembler");
  const [pin, setPin] = React.useState("");

  // Reset PIN box
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");
  const [resetToken, setResetToken] = React.useState("");

  async function refresh() {
    const data = await api("/users", { token });
    setUsers(data);
  }

  React.useEffect(() => {
    refresh().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Admin</h2>
        <button style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }} onClick={() => refresh().catch((e) => onError(e.message))}>
          Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Create User (Admin only)</h3>
          {user.role !== "admin" ? <div style={{ opacity: 0.7 }}>Only admins can create users.</div> : null}

          <div style={{ display: "grid", gap: 10 }}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
                <option value="assembler">assembler</option>
                <option value="supervisor">supervisor</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label>
              PIN (4–6 digits)
              <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
            </label>

            <button
              disabled={user.role !== "admin"}
              onClick={async () => {
                try {
                  await api("/users", { method: "POST", token, body: { name, role, pin } });
                  setName("");
                  setRole("assembler");
                  setPin("");
                  await refresh();
                } catch (e) {
                  onError(e.message);
                }
              }}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #111", background: user.role === "admin" ? "#111" : "#888", color: "white", cursor: user.role === "admin" ? "pointer" : "not-allowed" }}
            >
              Create User
            </button>
          </div>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Reset User PIN (Admin only)</h3>
          <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 10 }}>
            You must enter the backend RESET_TOKEN (stored in Render) to reset PINs.
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <label>
              RESET_TOKEN
              <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
            </label>
            <label>
              User Name
              <input value={resetName} onChange={(e) => setResetName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
            </label>
            <label>
              New PIN (4–6 digits)
              <input value={resetPin} onChange={(e) => setResetPin(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
            </label>

            <button
              disabled={user.role !== "admin"}
              onClick={async () => {
                try {
                  // Reset endpoint uses X-Reset-Token header
                  const res = await fetch(`${API_BASE}/admin/reset-pin`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Reset-Token": resetToken,
                    },
                    body: JSON.stringify({ name: resetName, new_pin: resetPin }),
                  });
                  if (!res.ok) {
                    let msg = `${res.status} ${res.statusText}`;
                    try {
                      const j = await res.json();
                      if (j?.detail) msg = j.detail;
                    } catch {}
                    throw new Error(msg);
                  }

                  setResetName("");
                  setResetPin("");
                  await refresh();
                } catch (e) {
                  onError(e.message);
                }
              }}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #111", background: user.role === "admin" ? "#111" : "#888", color: "white", cursor: user.role === "admin" ? "pointer" : "not-allowed" }}
            >
              Reset PIN
            </button>
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, fontWeight: 800, background: "#fafafa", borderBottom: "1px solid #eee" }}>Users</div>
        {users.map((u) => (
          <div key={u.id} style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>{u.name}</div>
            <div style={{ opacity: 0.8 }}>{u.role}</div>
            <div style={{ marginLeft: "auto", opacity: 0.8 }}>{u.is_active ? "active" : "inactive"}</div>
          </div>
        ))}
        {users.length === 0 ? <div style={{ padding: 12, opacity: 0.7 }}>No users yet.</div> : null}
      </div>
    </div>
  );
}

function WorkOrders({ token, user, onError }) {
  const [view, setView] = React.useState("open"); // open | closed
  const [wos, setWos] = React.useState([]);
  const [selected, setSelected] = React.useState(null);

  async function refresh(nextView) {
    const v = nextView || view;
    const path = v === "closed" ? "/work-orders?status=closed" : "/work-orders";
    const data = await api(path, { token });
    setWos(data);
  }

  React.useEffect(() => {
    refresh().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: view === "open" ? "#f6f8ff" : "white",
                fontWeight: view === "open" ? 700 : 500,
                cursor: "pointer",
              }}
            >
              Open
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setView("closed");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: view === "closed" ? "#f6f8ff" : "white",
                fontWeight: view === "closed" ? 700 : 500,
                cursor: "pointer",
              }}
            >
              Closed
            </button>
          </div>

          {(user.role === "admin" || user.role === "supervisor") && view === "open" ? (
            <CreateWOButton token={token} onCreated={async () => refresh("open")} onError={onError} />
          ) : null}

          <button style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }} onClick={() => refresh().catch((e) => onError(e.message))}>
            Refresh
          </button>
        </div>

        <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
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
                <div style={{ fontWeight: 900 }}>{wo.wo_number}</div>
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
        <WorkOrderDetail
          token={token}
          user={user}
          woId={selected.id}
          onClose={() => setSelected(null)}
          onError={onError}
          onRefresh={async () => refresh()}
        />
      ) : null}
    </div>
  );
}

function CreateWOButton({ token, onCreated, onError }) {
  const [open, setOpen] = React.useState(false);
  const [stations, setStations] = React.useState([]);
  const [station, setStation] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api("/stations", { token })
      .then((d) => {
        setStations(d.stations || []);
        setStation((d.stations || [])[0] || "");
      })
      .catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return (
      <button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }} onClick={() => setOpen(true)}>
        + New Work Order
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, width: 360 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>Create Work Order</div>
        <button style={{ marginLeft: "auto", border: "1px solid #ddd", borderRadius: 10, padding: "6px 10px", cursor: "pointer" }} onClick={() => setOpen(false)}>
          X
        </button>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <label>
          Station
          <select value={station} onChange={(e) => setStation(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
            {stations.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label>
          Part Number
          <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          Stock (inventory)
        </label>

        {!isStock ? (
          <label>
            Customer Order #
            <input value={customerOrder} onChange={(e) => setCustomerOrder(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }} />
          </label>
        ) : null}

        <button
          onClick={async () => {
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
              setPartNumber("");
              setCustomerOrder("");
              setIsStock(false);
              setOpen(false);
              await onCreated();
            } catch (e) {
              onError(e.message);
            }
          }}
          style={{ padding: 12, borderRadius: 10, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer" }}
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
  const [noteText, setNoteText] = React.useState("");

  async function load() {
    const w = await api(`/work-orders/${woId}`, { token });
    const n = await api(`/work-orders/${woId}/notes`, { token });
    const wk = await api(`/work-orders/${woId}/workers`, { token });
    setWo(w);
    setNotes(n);
    setWorkers(wk);
  }

  React.useEffect(() => {
    load().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  if (!wo) return <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>Loading…</div>;

  const checkedInNames = workers.filter((w) => w.is_checked_in).map((w) => w.name);
  const isMeCheckedIn = workers.some((w) => w.name === user.name && w.is_checked_in);
  const someoneElseCheckedIn = checkedInNames.some((n) => n !== user.name);

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>{wo.wo_number}</div>
        <div style={{ opacity: 0.8 }}>{wo.station}</div>
        <div style={{ marginLeft: "auto", opacity: 0.8 }}>{wo.status}</div>
        <button style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 10px", cursor: "pointer" }} onClick={onClose}>
          Close Panel
        </button>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        <div><b>Part #:</b> {wo.part_number}</div>
        <div><b>Customer Order:</b> {wo.is_stock ? "Stock" : (wo.customer_order || "-")}</div>
      </div>

      {someoneElseCheckedIn ? (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f2d08a", background: "#fff8e8", borderRadius: 10 }}>
          ⚠ Someone else is currently working on this WO: <b>{checkedInNames.filter((n) => n !== user.name).join(", ")}</b>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {wo.status !== "closed" ? (
          <>
            <button
              onClick={async () => {
                try {
                  await api(`/work-orders/${woId}/${isMeCheckedIn ? "check-out" : "check-in"}`, { method: "POST", token });
                  await load();
                  await onRefresh();
                } catch (e) {
                  onError(e.message);
                }
              }}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
            >
              {isMeCheckedIn ? "Check Out" : "Check In"}
            </button>

            <button
              onClick={async () => {
                try {
                  await api(`/work-orders/${woId}/mark-complete`, { method: "POST", token });
                  await load();
                  await onRefresh();
                } catch (e) {
                  onError(e.message);
                }
              }}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer" }}
            >
              Mark Complete (Assembler)
            </button>

            {(user.role === "admin" || user.role === "supervisor") ? (
              <button
                onClick={async () => {
                  try {
                    await api(`/work-orders/${woId}/close`, { method: "POST", token });
                    await load();
                    await onRefresh();
                  } catch (e) {
                    onError(e.message);
                  }
                }}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #0b5", background: "#0b5", color: "white", cursor: "pointer" }}
              >
                Close Work Order (Supervisor)
              </button>
            ) : null}
          </>
        ) : (
          <div style={{ opacity: 0.8 }}>This work order is closed.</div>
        )}
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Workers</div>
        {workers.length === 0 ? <div style={{ opacity: 0.7 }}>No one has checked in yet.</div> : null}
        <div style={{ display: "grid", gap: 6 }}>
          {workers.map((w) => (
            <div key={w.user_id} style={{ padding: 10, border: "1px solid #eee", borderRadius: 10, display: "flex", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>{w.name}</div>
              <div style={{ marginLeft: "auto", opacity: 0.8 }}>{w.is_checked_in ? "Checked In" : "Checked Out"}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Notes</div>

        <div style={{ display: "grid", gap: 10 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note…"
            style={{ width: "100%", minHeight: 90, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
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
            style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
          >
            Add Note
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
              <div style={{ display: "flex", gap: 10, opacity: 0.85, fontSize: 13 }}>
                <div><b>{n.author_name}</b></div>
                <div>{new Date(n.created_at).toLocaleString()}</div>
                <div style={{ marginLeft: "auto" }}>{n.station || ""}</div>
              </div>
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{n.text}</div>
            </div>
          ))}
          {notes.length === 0 ? <div style={{ opacity: 0.7 }}>No notes yet.</div> : null}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
