import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("trr_token") || "");
  const [me, setMe] = useState(() => {
    const raw = localStorage.getItem("trr_me");
    return raw ? JSON.parse(raw) : null;
  });

  // Auto-logout after 30 minutes of inactivity
  const idleMs = 30 * 60 * 1000;
  const idleTimer = useRef(null);

  function logout() {
    localStorage.removeItem("trr_token");
    localStorage.removeItem("trr_me");
    setToken("");
    setMe(null);
  }

  function resetIdleTimer() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      alert("Logged out due to inactivity (30 minutes).");
      logout();
    }, idleMs);
  }

  useEffect(() => {
    if (!token) return;

    resetIdleTimer();
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => resetIdleTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Screens
  const [screen, setScreen] = useState("workorders"); // login | workorders | details | admin
  const [wos, setWos] = useState([]);
  const [selectedWo, setSelectedWo] = useState(null);
  const [notes, setNotes] = useState([]);
  const [stations, setStations] = useState([]);
  const isSupervisor = me?.role === "supervisor" || me?.role === "admin";

  async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { ...authHeader(token) },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(token) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function refreshWorkOrders() {
    const data = await apiGet("/work-orders");
    setWos(data);
  }

  async function loadStations() {
    const data = await apiGet("/stations");
    setStations(data.stations || []);
  }

  async function openWO(wo) {
    setSelectedWo(wo);
    setScreen("details");
    const n = await apiGet(`/work-orders/${wo.id}/notes`);
    setNotes(n);
  }

  // Login
  const [loginName, setLoginName] = useState("");
  const [loginPin, setLoginPin] = useState("");

  async function doLogin() {
    try {
      const data = await apiPost("/auth/login", { name: loginName.trim(), pin: loginPin.trim() });
      localStorage.setItem("trr_token", data.token);
      localStorage.setItem("trr_me", JSON.stringify({ name: data.name, role: data.role }));
      setToken(data.token);
      setMe({ name: data.name, role: data.role });
      setLoginPin("");
      await loadStations();
      await refreshWorkOrders();
      setScreen("workorders");
    } catch (e) {
      alert("Login failed. Check name/PIN.");
    }
  }

  // Admin / Supervisor: create WO
  const [newStation, setNewStation] = useState("");
  const [newPart, setNewPart] = useState("");
  const [newCustOrder, setNewCustOrder] = useState("");
  const [newIsStock, setNewIsStock] = useState(false);

  async function createWO() {
    try {
      const body = {
        station: newStation,
        part_number: newPart,
        customer_order: newCustOrder ? newCustOrder : null,
        is_stock: !!newIsStock,
      };
      const wo = await apiPost("/work-orders", body);
      setNewPart("");
      setNewCustOrder("");
      setNewIsStock(false);
      await refreshWorkOrders();
      alert(`Created ${wo.wo_number}`);
    } catch (e) {
      alert("Failed to create WO. Make sure station/part are filled.");
    }
  }

  // Notes
  const [noteText, setNoteText] = useState("");

  async function addNote() {
    if (!selectedWo) return;
    try {
      await apiPost(`/work-orders/${selectedWo.id}/notes`, { text: noteText });
      setNoteText("");
      const n = await apiGet(`/work-orders/${selectedWo.id}/notes`);
      setNotes(n);
    } catch (e) {
      alert("Failed to add note.");
    }
  }

  // First load when already logged in
  useEffect(() => {
    if (!token) {
      setScreen("login");
      return;
    }
    (async () => {
      try {
        await loadStations();
        await refreshWorkOrders();
      } catch (e) {
        // Token might be invalid after redeploy
        logout();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const header = (
    <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>TRR Assembly Work Orders</div>
        {me && (
          <div style={{ color: "#444" }}>
            Logged in as <b>{me.name}</b> ({me.role})
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {token && (
          <>
            <button onClick={() => setScreen("workorders")} style={{ padding: "10px 12px" }}>
              Work Orders
            </button>
            {isSupervisor && (
              <button onClick={() => setScreen("admin")} style={{ padding: "10px 12px" }}>
                Supervisor
              </button>
            )}
            <button onClick={logout} style={{ padding: "10px 12px" }}>
              Logout
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: 18, fontFamily: "Arial", maxWidth: 1000, margin: "0 auto" }}>
      {header}
      <hr style={{ margin: "14px 0" }} />

      {!token && screen === "login" && (
        <div style={{ maxWidth: 420, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Login</h3>
          <div style={{ display: "grid", gap: 10 }}>
            <label>
              Name
              <input
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 4 }}
                placeholder="Your name (case sensitive)"
              />
            </label>
            <label>
              4-digit PIN
              <input
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 4 }}
                placeholder="1234"
                inputMode="numeric"
              />
            </label>
            <button onClick={doLogin} style={{ padding: 12, fontSize: 16 }}>
              Login
            </button>
            <div style={{ color: "#666", fontSize: 13 }}>
              If you haven’t created users yet, set <b>INIT_ADMIN_NAME</b> and <b>INIT_ADMIN_PIN</b> in Render for the backend.
            </div>
          </div>
        </div>
      )}

      {token && screen === "workorders" && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <h3 style={{ margin: 0 }}>Work Orders</h3>
            <button onClick={refreshWorkOrders} style={{ padding: "10px 12px" }}>
              Refresh
            </button>
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "140px 180px 1fr 1fr 120px", gap: 0, background: "#f6f6f6" }}>
              <div style={{ padding: 10, fontWeight: 700 }}>WO</div>
              <div style={{ padding: 10, fontWeight: 700 }}>Station</div>
              <div style={{ padding: 10, fontWeight: 700 }}>Part #</div>
              <div style={{ padding: 10, fontWeight: 700 }}>Cust/Stock</div>
              <div style={{ padding: 10, fontWeight: 700 }}>Status</div>
            </div>

            {wos.map((wo) => (
              <div
                key={wo.id}
                onClick={() => openWO(wo)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 180px 1fr 1fr 120px",
                  cursor: "pointer",
                  borderTop: "1px solid #eee",
                }}
              >
                <div style={{ padding: 10 }}>{wo.wo_number}</div>
                <div style={{ padding: 10 }}>{wo.station}</div>
                <div style={{ padding: 10 }}>{wo.part_number}</div>
                <div style={{ padding: 10 }}>
                  {wo.is_stock ? <b>STOCK</b> : wo.customer_order || "-"}
                </div>
                <div style={{ padding: 10 }}>{wo.status}</div>
              </div>
            ))}

            {wos.length === 0 && <div style={{ padding: 12, color: "#666" }}>No work orders yet.</div>}
          </div>
        </div>
      )}

      {token && screen === "admin" && isSupervisor && (
        <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
          <h3 style={{ margin: 0 }}>Supervisor</h3>

          <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Create Work Order</div>

            <div style={{ display: "grid", gap: 10 }}>
              <label>
                Station
                <select
                  value={newStation}
                  onChange={(e) => setNewStation(e.target.value)}
                  style={{ width: "100%", padding: 10, marginTop: 4 }}
                >
                  <option value="">Select…</option>
                  {stations.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Part Number
                <input
                  value={newPart}
                  onChange={(e) => setNewPart(e.target.value)}
                  style={{ width: "100%", padding: 10, marginTop: 4 }}
                  placeholder="TRR-12345"
                />
              </label>

              <label>
                Customer Order # (optional)
                <input
                  value={newCustOrder}
                  onChange={(e) => setNewCustOrder(e.target.value)}
                  style={{ width: "100%", padding: 10, marginTop: 4 }}
                  placeholder="SO-10027"
                />
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={newIsStock}
                  onChange={(e) => setNewIsStock(e.target.checked)}
                />
                Stock build (inventory)
              </label>

              <button onClick={createWO} style={{ padding: 12, fontSize: 16 }}>
                Create WO
              </button>
            </div>
          </div>
        </div>
      )}

      {token && screen === "details" && selectedWo && (
        <div style={{ display: "grid", gap: 12 }}>
          <button onClick={() => setScreen("workorders")} style={{ width: 140, padding: "10px 12px" }}>
            ← Back
          </button>

          <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{selectedWo.wo_number}</div>
                <div style={{ color: "#444" }}>
                  <b>Station:</b> {selectedWo.station} &nbsp; | &nbsp; <b>Part:</b> {selectedWo.part_number}
                </div>
                <div style={{ color: "#444" }}>
                  <b>Cust/Stock:</b> {selectedWo.is_stock ? "STOCK" : selectedWo.customer_order || "-"} &nbsp; | &nbsp;{" "}
                  <b>Status:</b> {selectedWo.status}
                </div>
              </div>
              <div style={{ color: "#666" }}>Created: {formatTime(selectedWo.created_at)}</div>
            </div>
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Notes</div>

            <div style={{ display: "grid", gap: 10 }}>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note…"
                style={{ width: "100%", minHeight: 90, padding: 10 }}
              />
              <button onClick={addNote} style={{ width: 160, padding: 12, fontSize: 16 }}>
                Add Note
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ borderTop: "1px solid #eee", paddingTop: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <b>{n.author_name}</b>
                    <span style={{ color: "#666" }}>{formatTime(n.created_at)}</span>
                    {n.station && (
                      <span style={{ color: "#666" }}>
                        (Station: {n.station})
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{n.text}</div>
                </div>
              ))}

              {notes.length === 0 && <div style={{ color: "#666" }}>No notes yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
