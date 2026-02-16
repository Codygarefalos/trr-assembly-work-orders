import React from "react";
import { createRoot } from "react-dom/client";

const API_BASE = import.meta.env.VITE_API_URL || "https://trr-assembly-api.onrender.com").replace(/\/+$/,"");
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
    let msg = "Request failed";
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

function Header({ user, onLogout, onNav, nav }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #eee" }}>
      <img src="/logo.png" alt="TRR" style={{ height: 40 }} />
      <div style={{ fontWeight: 800, fontSize: 16 }}>TRR Assembly Work Orders</div>

      {user && (
        <div style={{ marginLeft: 16, display: "flex", gap: 8 }}>
          <button onClick={() => onNav("workorders")} disabled={nav === "workorders"}>Work Orders</button>
          {(user.role === "admin" || user.role === "supervisor") && (
            <button onClick={() => onNav("supervisor")} disabled={nav === "supervisor"}>Supervisor</button>
          )}
          {user.role === "admin" && (
            <button onClick={() => onNav("users")} disabled={nav === "users"}>Users</button>
          )}
        </div>
      )}

      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
        {user ? <div style={{ fontSize: 14, opacity: 0.8 }}>{user.name} ({user.role})</div> : null}
        {user ? <button onClick={onLogout}>Logout</button> : null}
      </div>
    </div>
  );
}

function App() {
  const [token, setToken] = React.useState(localStorage.getItem("token") || "");
  const [user, setUser] = React.useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  const [nav, setNav] = React.useState("workorders");
  const [err, setErr] = React.useState("");

  // Auto-logout after inactivity
  React.useEffect(() => {
    if (!token) return;

    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));

    const t = setInterval(() => {
      const mins = (Date.now() - last) / 1000 / 60;
      if (mins >= IDLE_LOGOUT_MINUTES) {
        doLogout();
      }
    }, 10_000);

    return () => {
      clearInterval(t);
      events.forEach(e => window.removeEventListener(e, bump));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function doLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken("");
    setUser(null);
    setNav("workorders");
  }

  async function doLogin(name, pin) {
    setErr("");
    const data = await api("/auth/login", { method: "POST", body: { name, pin } });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify({ name: data.name, role: data.role }));
    setToken(data.token);
    setUser({ name: data.name, role: data.role });
    setNav("workorders");
  }

  return (
    <div>
      <Header user={user} onLogout={doLogout} onNav={setNav} nav={nav} />
      <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
        {err ? <div style={{ background: "#ffe5e5", border: "1px solid #ffb3b3", padding: 10, borderRadius: 8, marginBottom: 12 }}>{err}</div> : null}

        {!token ? (
          <Login onLogin={doLogin} onError={setErr} />
        ) : (
          <>
            {nav === "workorders" && <WorkOrders token={token} user={user} onError={setErr} />}
            {nav === "users" && user?.role === "admin" && <UsersAdmin token={token} onError={setErr} />}
            {nav === "supervisor" && (user?.role === "admin" || user?.role === "supervisor") && (
              <Supervisor token={token} user={user} onError={setErr} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Login({ onLogin, onError }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>Login</h2>
      <div style={{ display: "grid", gap: 10 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>
        <label>
          PIN (4–6 digits)
          <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>
        <button
          onClick={async () => {
            try {
              await onLogin(name, pin);
            } catch (e) {
              onError(String(e.message || e));
            }
          }}
        >
          Sign In
        </button>
      </div>
    </div>
  );
}

function WorkOrders({ token, user, onError }) {
  const [wos, setWos] = React.useState([]);
  const [selected, setSelected] = React.useState(null);

  async function refresh() {
    const data = await api("/work-orders", { token });
    setWos(data);
  }

  React.useEffect(() => {
    refresh().catch(e => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1.2fr" : "1fr", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Work Orders</h2>
          {(user.role === "admin" || user.role === "supervisor") && (
            <CreateWOButton token={token} onCreated={async () => refresh()} onError={onError} />
          )}
          <button style={{ marginLeft: "auto" }} onClick={() => refresh().catch(e => onError(e.message))}>
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
                <div style={{ fontWeight: 800 }}>{wo.wo_number}</div>
                <div style={{ opacity: 0.8 }}>{wo.station}</div>
                <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.8 }}>{wo.status}</div>
              </div>
              <div style={{ marginTop: 6, fontSize: 14 }}>
                <b>Part:</b> {wo.part_number}{" "}
                {wo.is_stock ? <span style={{ opacity: 0.8 }}>(Stock)</span> : <span style={{ opacity: 0.8 }}>(Order: {wo.customer_order})</span>}
              </div>
            </div>
          ))}
          {wos.length === 0 ? <div style={{ padding: 12, opacity: 0.7 }}>No work orders yet.</div> : null}
        </div>
      </div>

      {selected && (
        <WorkOrderDetail
          token={token}
          user={user}
          woId={selected.id}
          onClose={() => setSelected(null)}
          onRefreshList={() => refresh()}
          onError={onError}
        />
      )}
    </div>
  );
}

function CreateWOButton({ token, onCreated, onError }) {
  const [open, setOpen] = React.useState(false);
  const [stations, setStations] = React.useState([]);
  const [station, setStation] = React.useState("");
  const [part, setPart] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    api("/stations", { token })
      .then((d) => {
        setStations(d.stations);
        setStation(d.stations[0] || "");
      })
      .catch((e) => onError(e.message));
  }, [open]);

  if (!open) return <button onClick={() => setOpen(true)}>+ New Work Order</button>;

  return (
    <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10, marginLeft: 10 }}>
      <div style={{ display: "grid", gap: 8, minWidth: 320 }}>
        <div style={{ fontWeight: 800 }}>Create Work Order</div>

        <label>
          Station
          <select value={station} onChange={(e) => setStation(e.target.value)} style={{ width: "100%", padding: 8 }}>
            {stations.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label>
          Part Number
          <input value={part} onChange={(e) => setPart(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} />
          Stock build (no customer order)
        </label>

        {!isStock && (
          <label>
            Customer Order #
            <input value={customerOrder} onChange={(e) => setCustomerOrder(e.target.value)} style={{ width: "100%", padding: 8 }} />
          </label>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={async () => {
              try {
                await api("/work-orders", {
                  method: "POST",
                  token,
                  body: {
                    station,
                    part_number: part,
                    customer_order: customerOrder || null,
                    is_stock: isStock,
                  },
                });
                setOpen(false);
                setPart("");
                setCustomerOrder("");
                setIsStock(false);
                await onCreated();
              } catch (e) {
                onError(e.message);
              }
            }}
          >
            Create
          </button>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function WorkOrderDetail({ token, user, woId, onClose, onRefreshList, onError }) {
  const [wo, setWo] = React.useState(null);
  const [notes, setNotes] = React.useState([]);
  const [workers, setWorkers] = React.useState([]);
  const [noteText, setNoteText] = React.useState("");

  async function refreshAll() {
    const [woData, noteData, workerData] = await Promise.all([
      api(`/work-orders/${woId}`, { token }),
      api(`/work-orders/${woId}/notes`, { token }),
      api(`/work-orders/${woId}/workers`, { token }),
    ]);
    setWo(woData);
    setNotes(noteData);
    setWorkers(workerData);
  }

  React.useEffect(() => {
    refreshAll().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  if (!wo) return <div>Loading...</div>;

  const otherWorkers = workers.filter((w) => w.name !== user.name);

  async function checkIn() {
    await api(`/work-orders/${woId}/workers/start`, { method: "POST", token });
    await refreshAll();
    await onRefreshList();
  }

  async function checkOut() {
    await api(`/work-orders/${woId}/workers/stop`, { method: "POST", token });
    await refreshAll();
  }

  async function closeWO() {
    await api(`/work-orders/${woId}/close`, { method: "POST", token });
    await refreshAll();
    await onRefreshList();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    await api(`/work-orders/${woId}/notes`, { method: "POST", token, body: { text: noteText } });
    setNoteText("");
    await refreshAll();
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{wo.wo_number}</h3>
        <div style={{ opacity: 0.8 }}>{wo.station}</div>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={onClose}>Close Panel</button>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 14 }}>
        <div><b>Status:</b> {wo.status}</div>
        <div><b>Part:</b> {wo.part_number}</div>
        <div><b>Customer/Stock:</b> {wo.is_stock ? "Stock" : `Order ${wo.customer_order}`}</div>
      </div>

      {otherWorkers.length > 0 && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffeeba", padding: 10, borderRadius: 8, marginTop: 12 }}>
          <b>Warning:</b> Someone else is currently working on this WO:
          <ul style={{ margin: "6px 0 0 18px" }}>
            {otherWorkers.map((w) => (
              <li key={w.user_id}>{w.name} ({w.role})</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={() => checkIn().catch(e => onError(e.message))}>Check In</button>
        <button onClick={() => checkOut().catch(e => onError(e.message))}>Check Out</button>

        {(user.role === "admin" || user.role === "supervisor") && (
          <button style={{ marginLeft: "auto" }} onClick={() => closeWO().catch(e => onError(e.message))}>
            Close Work Order
          </button>
        )}
      </div>

      {/* Notes box at bottom */}
      <div style={{ marginTop: 16 }}>
        <h4 style={{ marginBottom: 8 }}>Work Order Notes</h4>

        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note..."
            style={{ width: "100%", minHeight: 80, padding: 10 }}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => addNote().catch(e => onError(e.message))}>Add Note</button>
            <button onClick={() => refreshAll().catch(e => onError(e.message))}>Refresh</button>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
          {notes.length === 0 ? <div style={{ opacity: 0.7 }}>No notes yet.</div> : null}
          {notes.map((n) => (
            <div key={n.id} style={{ padding: "10px 0", borderBottom: "1px solid #f2f2f2" }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                <b>{n.author_name}</b> • {new Date(n.created_at).toLocaleString()}
              </div>
              <div style={{ marginTop: 4 }}>{n.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsersAdmin({ token, onError }) {
  const [users, setUsers] = React.useState([]);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("assembler");
  const [pin, setPin] = React.useState("");

  async function refresh() {
    const data = await api("/users", { token });
    setUsers(data);
  }

  React.useEffect(() => {
    refresh().catch(e => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createUser() {
    await api("/users", { method: "POST", token, body: { name, role, pin } });
    setName(""); setPin(""); setRole("assembler");
    await refresh();
  }

  async function resetPin(userId) {
    const newPin = prompt("Enter new PIN (4–6 digits):");
    if (!newPin) return;
    await api("/admin/users/reset-pin", { method: "POST", token, body: { user_id: userId, new_pin: newPin } });
    await refresh();
    alert("PIN reset.");
  }

  return (
    <div>
      <h2>Users (Admin)</h2>

      <div style={{ display: "grid", gap: 10, maxWidth: 480, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
        <div style={{ fontWeight: 800 }}>Create User</div>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: "100%", padding: 8 }}>
            <option value="assembler">assembler</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          PIN
          <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </label>
        <button onClick={() => createUser().catch(e => onError(e.message))}>Create</button>
      </div>

      <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
        {users.map((u) => (
          <div key={u.id} style={{ padding: 12, borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>{u.name}</div>
            <div style={{ opacity: 0.8 }}>{u.role}</div>
            <div style={{ marginLeft: "auto", opacity: 0.8 }}>{u.is_active ? "active" : "inactive"}</div>
            <button onClick={() => resetPin(u.id).catch(e => onError(e.message))}>Reset PIN</button>
          </div>
        ))}
        {users.length === 0 ? <div style={{ padding: 12, opacity: 0.7 }}>No users.</div> : null}
      </div>
    </div>
  );
}

function Supervisor({ token, user, onError }) {
  return (
    <div>
      <h2>Supervisor</h2>
      <div style={{ opacity: 0.8 }}>
        Drag/drop priority queue is the next step (we can add station lanes + ordering next).
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
