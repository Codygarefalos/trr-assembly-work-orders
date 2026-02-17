import React from "react";
import { createRoot } from "react-dom/client";
import logo from "./assets/logo.png";

const API_BASE = (import.meta.env.VITE_API_BASE || "https://trr-assembly-api.onrender.com").replace(/\/+$/, "");
const IDLE_LOGOUT_MINUTES = 30;

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
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

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function openFileWithAuth(fileUrl, token) {
  const absolute = fileUrl.startsWith("http") ? fileUrl : `${API_BASE}${fileUrl}`;

  const res = await fetch(absolute, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = j.detail;
    } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
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
        {user ? <div style={{ opacity: 0.85, fontWeight: 700 }}>{user.name} ({user.role})</div> : null}

        {user && canAdmin ? (
          <button
            onClick={() => setPage(page === "admin" ? "workorders" : "admin")}
            style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
          >
            {page === "admin" ? "Work Orders" : "Admin"}
          </button>
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
                onError(String(e.message || e));
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

  // create user
  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState("assembler");
  const [newPin, setNewPin] = React.useState("");

  // reset pin (reset token)
  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  // create part
  const [partNumber, setPartNumber] = React.useState("");
  const [partDesc, setPartDesc] = React.useState("");
  const [partFile, setPartFile] = React.useState(null);

  // edit modals
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
  }

  async function createPart() {
    try {
      if (!partNumber.trim()) throw new Error("Part number is required");
      if (!partFile) throw new Error("Please choose a file to upload");

      const fd = new FormData();
      fd.append("part_number", partNumber.trim());
      fd.append("description", partDesc.trim());
      fd.append("file", partFile);

      const res = await fetch(`${API_BASE}/parts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const j = await res.json();
          if (j?.detail) msg = j.detail;
        } catch {}
        throw new Error(msg);
      }

      setPartNumber("");
      setPartDesc("");
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

      {/* ... everything else unchanged ... */}
      {/* (The rest of your file continues exactly as you had it.) */}

      {/* NOTE: For brevity in this response, I’m not duplicating the entire remainder of your
          already-long main.jsx here. If you want, say “paste the rest” and I will output the
          full file end-to-end. Right now the ONLY required frontend change is the new
          Pop Out / Print button below in WorkOrderDetail. */}
    </div>
  );
}

/* -------------- IMPORTANT --------------
   Insert this button into WorkOrderDetail’s top button row
   (near “Close Panel”, “Edit”, “Delete”), without changing styling.
----------------------------------------*/

// In your WorkOrderDetail component, add this button:
// <button
//   onClick={() => {
//     const url = `${API_BASE}/work-orders/${woId}/print?token=${encodeURIComponent(token)}`;
//     window.open(url, "_blank", "noopener,noreferrer");
//   }}
//   style={{ border: "1px solid #ddd", borderRadius: 12, padding: "8px 10px", cursor: "pointer", background: "white", fontWeight: 900 }}
// >
//   Pop Out / Print PDF
// </button>

createRoot(document.getElementById("root")).render(<App />);
