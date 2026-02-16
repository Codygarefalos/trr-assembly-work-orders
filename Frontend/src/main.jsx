import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/+$/, "");

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("trr_token") || "");
  const [me, setMe] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("trr_me") || "null");
    } catch {
      return null;
    }
  });

  // simple "router"
  const [selectedWO, setSelectedWO] = useState(null);

  function logout() {
    setToken("");
    setMe(null);
    setSelectedWO(null);
    localStorage.removeItem("trr_token");
    localStorage.removeItem("trr_me");
  }

  if (!token || !me) {
    return (
      <Login
        onLogin={({ token, name, role }) => {
          setToken(token);
          const m = { name, role };
          setMe(m);
          localStorage.setItem("trr_token", token);
          localStorage.setItem("trr_me", JSON.stringify(m));
        }}
      />
    );
  }

  return (
    <div style={{ fontFamily: "system-ui, Arial", maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <Header me={me} onLogout={logout} />

      {!selectedWO ? (
        <WorkOrderList token={token} onOpenWO={(wo) => setSelectedWO(wo)} />
      ) : (
        <WorkOrderDetail
          token={token}
          wo={selectedWO}
          onBack={() => setSelectedWO(null)}
        />
      )}
    </div>
  );
}

function Header({ me, onLogout }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>TRR Assembly Work Orders</div>
      <div style={{ marginLeft: "auto", fontSize: 14, opacity: 0.9 }}>
        Logged in as <b>{me.name}</b> ({me.role})
      </div>
      <button onClick={onLogout} style={btn()}>
        Log out
      </button>
    </div>
  );
}

function Login({ onLogin }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), pin: pin.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Login failed");
      onLogin(data);
    } catch (ex) {
      setErr(ex.message || "Login failed");
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, Arial", maxWidth: 520, margin: "60px auto", padding: 16 }}>
      <h2 style={{ margin: 0, marginBottom: 8 }}>Log in</h2>
      <div style={{ opacity: 0.8, marginBottom: 16 }}>Select your name and enter your PIN.</div>

      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <label style={label()}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={input()} placeholder="Cody" />
        </label>
        <label style={label()}>
          PIN (4–6 digits)
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={input()}
            inputMode="numeric"
            placeholder="1234"
          />
        </label>
        <button type="submit" style={btn({ width: "100%" })}>
          Log in
        </button>
        {err && <div style={{ color: "#b00020" }}>{err}</div>}
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          API: <code>{API_BASE}</code>
        </div>
      </form>
    </div>
  );
}

function WorkOrderList({ token, onOpenWO }) {
  const [wos, setWOs] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API_BASE}/work-orders`, {
        headers: { ...authHeaders(token) },
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.detail || "Failed to load work orders");
      setWOs(data);
    } catch (ex) {
      setErr(ex.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // refresh list every 15 seconds
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Work Orders</h3>
        <button onClick={load} style={btn({ marginLeft: "auto" })}>
          Refresh
        </button>
      </div>

      {loading && <div>Loading…</div>}
      {err && <div style={{ color: "#b00020" }}>{err}</div>}

      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 140px", gap: 0, background: "#f7f7f7", padding: 10, fontWeight: 700 }}>
          <div>WO</div>
          <div>Station</div>
          <div>Part / Order</div>
          <div>Status</div>
        </div>

        {wos.map((wo) => (
          <div
            key={wo.id}
            onClick={() => onOpenWO(wo)}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr 1fr 140px",
              padding: 10,
              borderTop: "1px solid #eee",
              cursor: "pointer",
            }}
            title="Open work order"
          >
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{wo.wo_number}</div>
            <div>{wo.station}</div>
            <div>
              <div><b>{wo.part_number}</b></div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {wo.is_stock ? "Stock" : `Order: ${wo.customer_order || "—"}`}
              </div>
            </div>
            <div style={{ textTransform: "capitalize" }}>{wo.status.replaceAll("_", " ")}</div>
          </div>
        ))}

        {(!loading && wos.length === 0) && (
          <div style={{ padding: 10, opacity: 0.8 }}>No work orders yet.</div>
        )}
      </div>
    </div>
  );
}

function WorkOrderDetail({ token, wo, onBack }) {
  const [freshWO, setFreshWO] = useState(wo);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // Notes state
  const [notes, setNotes] = useState([]);
  const [notesErr, setNotesErr] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notesLoading, setNotesLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const title = useMemo(() => `${freshWO.wo_number} — ${freshWO.station}`, [freshWO]);

  async function loadWO() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API_BASE}/work-orders/${wo.id}`, {
        headers: { ...authHeaders(token) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed to load work order");
      setFreshWO(data);
    } catch (ex) {
      setErr(ex.message || "Failed to load work order");
    } finally {
      setLoading(false);
    }
  }

  async function loadNotes() {
    setNotesLoading(true);
    setNotesErr("");
    try {
      const res = await fetch(`${API_BASE}/work-orders/${wo.id}/notes`, {
        headers: { ...authHeaders(token) },
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.detail || "Failed to load notes");
      setNotes(Array.isArray(data) ? data : []);
    } catch (ex) {
      setNotesErr(ex.message || "Failed to load notes");
    } finally {
      setNotesLoading(false);
    }
  }

  async function addNote() {
    const text = noteText.trim();
    if (!text) return;

    setPosting(true);
    setNotesErr("");
    try {
      const res = await fetch(`${API_BASE}/work-orders/${wo.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed to add note");

      setNoteText("");
      // refresh list (or optimistically prepend)
      await loadNotes();
    } catch (ex) {
      setNotesErr(ex.message || "Failed to add note");
    } finally {
      setPosting(false);
    }
  }

  useEffect(() => {
    loadWO();
    loadNotes();

    // refresh WO + notes every 15 seconds while open
    const t = setInterval(() => {
      loadWO();
      loadNotes();
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo.id]);

  return (
    <div>
      <button onClick={onBack} style={btn({ marginBottom: 12 })}>
        ← Back
      </button>

      <h2 style={{ margin: 0 }}>{title}</h2>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>Work order details</div>

      {loading && <div>Loading…</div>}
      {err && <div style={{ color: "#b00020" }}>{err}</div>}

      <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <Row label="WO Number" value={freshWO.wo_number} mono />
        <Row label="Station" value={freshWO.station} />
        <Row label="Part Number" value={freshWO.part_number} />
        <Row
          label="Customer / Stock"
          value={freshWO.is_stock ? "Stock" : (freshWO.customer_order || "—")}
        />
        <Row label="Status" value={freshWO.status.replaceAll("_", " ")} />
        <Row label="Created" value={new Date(freshWO.created_at).toLocaleString()} />
      </div>

      {/* NOTES BOX AT BOTTOM */}
      <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Work Order Notes</h3>
          <button onClick={loadNotes} style={btn({ marginLeft: "auto" })}>
            Refresh Notes
          </button>
        </div>
        <div style={{ opacity: 0.75, marginBottom: 10 }}>
          Add notes for other team members (updates, issues, parts missing, etc.).
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Type a note…"
            rows={4}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ccc",
              fontFamily: "inherit",
              fontSize: 14,
            }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={addNote} disabled={posting || !noteText.trim()} style={btn()}>
              {posting ? "Adding…" : "Add Note"}
            </button>
            {notesErr && <div style={{ color: "#b00020" }}>{notesErr}</div>}
          </div>

          <div style={{ borderTop: "1px solid #eee", paddingTop: 10 }}>
            {notesLoading ? (
              <div>Loading notes…</div>
            ) : notes.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No notes yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {notes.map((n) => (
                  <div key={n.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 700 }}>{n.author_name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                      {n.station && (
                        <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>
                          {n.station}
                        </div>
                      )}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{n.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", padding: "6px 0" }}>
      <div style={{ fontWeight: 700, opacity: 0.85 }}>{label}</div>
      <div style={mono ? { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" } : {}}>
        {value}
      </div>
    </div>
  );
}

function btn(extra = {}) {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #bbb",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    ...extra,
  };
}

function label() {
  return { display: "grid", gap: 6, fontWeight: 700 };
}

function input() {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ccc",
    fontSize: 14,
    width: "100%",
  };
}

createRoot(document.getElementById("root")).render(<App />);
