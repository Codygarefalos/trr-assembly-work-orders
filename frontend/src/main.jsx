import React from "react";
import ReactDOM from "react-dom/client";

// -----------------------------
// CONFIG
// -----------------------------
const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
  "https://trr-assembly-api.onrender.com";

// -----------------------------
// Small helpers
// -----------------------------
function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

async function api(path, { method = "GET", token, body, isForm = false } = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {};

  if (!isForm) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  // try read json
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    const txt = await res.text().catch(() => "");
    data = txt ? { detail: txt } : null;
  }

  if (!res.ok) {
    const msg =
      (data && (data.detail || data.message)) ||
      `${res.status} ${res.statusText}` ||
      "Request failed";
    throw new Error(msg);
  }
  return data;
}

function fmtDT(d) {
  try {
    const x = new Date(d);
    return x.toLocaleString();
  } catch {
    return String(d || "");
  }
}

// -----------------------------
// UI atoms
// -----------------------------
const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f7f8fc, #ffffff)",
    color: "#111",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
  },
  shell: { maxWidth: 1180, margin: "0 auto", padding: 18 },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
    background: "rgba(255,255,255,0.9)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.08)",
    border: "1px solid rgba(0,0,0,0.06)",
    position: "sticky",
    top: 12,
    zIndex: 10,
    backdropFilter: "blur(8px)",
  },
  brand: { display: "flex", flexDirection: "column", lineHeight: 1.1 },
  title: { fontWeight: 950, fontSize: 18 },
  subtitle: { opacity: 0.7, fontSize: 12 },
  tabs: { display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" },
  tabBtn: (active) => ({
    border: "1px solid rgba(0,0,0,0.12)",
    background: active ? "#111" : "white",
    color: active ? "white" : "#111",
    borderRadius: 999,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 900,
    boxShadow: active ? "0 10px 20px rgba(0,0,0,0.18)" : "none",
    transition: "transform .08s ease",
  }),
  card: {
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 14px 40px rgba(0,0,0,0.07)",
    padding: 16,
  },
  h2: { margin: 0, fontSize: 18, fontWeight: 950 },
  row: { display: "flex", gap: 12, flexWrap: "wrap" },
  input: {
    width: "100%",
    border: "1px solid rgba(0,0,0,0.14)",
    borderRadius: 12,
    padding: "10px 12px",
    outline: "none",
    fontSize: 14,
  },
  label: { fontSize: 12, opacity: 0.75, fontWeight: 800, marginBottom: 6 },
  btn: (tone = "dark") => {
    const map = {
      dark: { bg: "#111", fg: "white", bd: "#111" },
      light: { bg: "white", fg: "#111", bd: "rgba(0,0,0,0.14)" },
      green: { bg: "#0b7a3b", fg: "white", bd: "#0b7a3b" },
      red: { bg: "#b42318", fg: "white", bd: "#b42318" },
    };
    const t = map[tone] || map.dark;
    return {
      border: `1px solid ${t.bd}`,
      background: t.bg,
      color: t.fg,
      borderRadius: 12,
      padding: "10px 12px",
      cursor: "pointer",
      fontWeight: 950,
    };
  },
  pill: (tone = "gray") => {
    const map = {
      gray: { bg: "#f2f4f7", fg: "#111" },
      green: { bg: "#eaf7ef", fg: "#0b7a3b" },
      blue: { bg: "#eef4ff", fg: "#1d4ed8" },
      red: { bg: "#ffecec", fg: "#b42318" },
    };
    const t = map[tone] || map.gray;
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      borderRadius: 999,
      background: t.bg,
      color: t.fg,
      fontSize: 12,
      fontWeight: 900,
      border: "1px solid rgba(0,0,0,0.06)",
    };
  },
  banner: (tone) => {
    const map = {
      error: { bg: "#fff1f2", bd: "#fecdd3", fg: "#9f1239" },
      ok: { bg: "#ecfdf5", bd: "#a7f3d0", fg: "#065f46" },
      info: { bg: "#eff6ff", bd: "#bfdbfe", fg: "#1e40af" },
    };
    const t = map[tone] || map.info;
    return {
      background: t.bg,
      border: `1px solid ${t.bd}`,
      color: t.fg,
      borderRadius: 16,
      padding: "10px 12px",
      fontWeight: 800,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 12,
    };
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    overflow: "hidden",
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.08)",
  },
  th: {
    textAlign: "left",
    fontSize: 12,
    opacity: 0.75,
    padding: "10px 12px",
    background: "#fafafa",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
  },
  td: { padding: "10px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)", verticalAlign: "top" },
  modalBack: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.32)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "min(980px, 100%)",
    maxHeight: "85vh",
    overflow: "auto",
    background: "white",
    borderRadius: 18,
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 20px 70px rgba(0,0,0,0.28)",
    padding: 16,
  },
};

// -----------------------------
// Main App
// -----------------------------
function App() {
  const [token, setToken] = React.useState(localStorage.getItem("trr_token") || "");
  const [user, setUser] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem("trr_user") || "null");
    } catch {
      return null;
    }
  });

  const [tab, setTab] = React.useState("work_orders"); // work_orders | create_wo | inventory | parts | admin
  const [banner, setBanner] = React.useState(null);

  function showError(msg) {
    setBanner({ tone: "error", msg: msg || "Something went wrong" });
  }
  function showOk(msg) {
    setBanner({ tone: "ok", msg: msg || "Done" });
  }

  function logout() {
    setToken("");
    setUser(null);
    localStorage.removeItem("trr_token");
    localStorage.removeItem("trr_user");
    setTab("work_orders");
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topbar}>
          <div style={styles.brand}>
            <div style={styles.title}>TRR Assembly Work Orders</div>
            <div style={styles.subtitle}>
              {user ? (
                <>
                  Logged in as <b>{user.name}</b> ({user.role}) • API: {API_BASE}
                </>
              ) : (
                <>API: {API_BASE}</>
              )}
            </div>
          </div>

          {user ? (
            <div style={styles.tabs}>
              <button style={styles.tabBtn(tab === "work_orders")} onClick={() => setTab("work_orders")}>Work Orders</button>
              <button style={styles.tabBtn(tab === "create_wo")} onClick={() => setTab("create_wo")}>Create WO</button>
              <button style={styles.tabBtn(tab === "inventory")} onClick={() => setTab("inventory")}>Inventory</button>
              <button style={styles.tabBtn(tab === "parts")} onClick={() => setTab("parts")}>Parts</button>
              <button style={styles.tabBtn(tab === "admin")} onClick={() => setTab("admin")}>Admin</button>
              <button style={styles.tabBtn(false)} onClick={logout}>Logout</button>
            </div>
          ) : null}
        </div>

        {banner ? (
          <div style={styles.banner(banner.tone)}>
            <div>{banner.msg}</div>
            <button style={styles.btn("light")} onClick={() => setBanner(null)}>✕</button>
          </div>
        ) : null}

        {!user ? (
          <Login
            onLogin={(t, u) => {
              setToken(t);
              setUser(u);
              localStorage.setItem("trr_token", t);
              localStorage.setItem("trr_user", JSON.stringify(u));
              showOk("Welcome back.");
            }}
            onError={showError}
          />
        ) : (
          <>
            {tab === "work_orders" ? <WorkOrders token={token} user={user} onError={showError} onOk={showOk} /> : null}
            {tab === "create_wo" ? <CreateWorkOrder token={token} user={user} onError={showError} onOk={showOk} /> : null}
            {tab === "inventory" ? <Inventory token={token} user={user} onError={showError} onOk={showOk} /> : null}
            {tab === "parts" ? <Parts token={token} user={user} onError={showError} onOk={showOk} /> : null}
            {tab === "admin" ? <Admin token={token} user={user} onError={showError} onOk={showOk} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

// -----------------------------
// Login
// -----------------------------
function Login({ onLogin, onError }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  return (
    <div style={{ ...styles.card, marginTop: 16, maxWidth: 560, marginInline: "auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={styles.h2}>Login</h2>
        <span style={styles.pill("blue")}>TRR</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={styles.label}>Name</div>
        <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cody" />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={styles.label}>PIN</div>
        <input
          style={styles.input}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="1234"
          type="password"
        />
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <button
          style={styles.btn("dark")}
          disabled={busy}
          onClick={async () => {
            try {
              setBusy(true);
              const res = await api("/auth/login", { method: "POST", body: { name, pin } });
              onLogin(res.token, { name: res.name, role: res.role });
            } catch (e) {
              onError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Logging in..." : "Login"}
        </button>
        <div style={{ marginLeft: "auto", opacity: 0.7, fontSize: 12, alignSelf: "center" }}>
          Tip: if you get “connection refused”, your API_BASE is wrong.
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Work Orders List + Modal
// -----------------------------
function WorkOrders({ token, user, onError, onOk }) {
  const [wos, setWos] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [openWO, setOpenWO] = React.useState(null);

  const canManage = user.role === "admin" || user.role === "supervisor";

  async function refresh() {
    try {
      setBusy(true);
      const rows = await api("/work-orders", { token });
      setWos(rows || []);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  const filtered = wos.filter((w) => {
    if (!q.trim()) return true;
    const s = `${w.wo_number} ${w.station} ${w.part_number} ${w.customer_order || ""} ${w.status}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  async function setStatus(woId, nextStatus) {
    try {
      if (!canManage) return;
      await api(`/work-orders/${woId}`, { method: "PATCH", token, body: { status: nextStatus } });
      onOk(`Work order set to ${nextStatus}`);
      await refresh();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={styles.h2}>Work Orders</h2>
          <span style={styles.pill("gray")}>{busy ? "Loading..." : `${filtered.length} shown`}</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <input
              style={{ ...styles.input, width: 380, maxWidth: "100%" }}
              placeholder="Search WO / station / part / status..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button style={styles.btn("light")} onClick={refresh}>Refresh</button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
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
              {filtered.map((w) => {
                const tone =
                  w.status === "complete" ? "green" :
                  w.status === "closed" ? "gray" :
                  w.status === "in_progress" ? "blue" : "gray";

                return (
                  <tr key={w.id}>
                    <td style={styles.td}><b>{w.wo_number}</b><div style={{ opacity: 0.65, fontSize: 12 }}>{fmtDT(w.created_at)}</div></td>
                    <td style={styles.td}>{w.station}</td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 900 }}>{w.part_number}</div>
                      {w.part_id ? <div style={{ opacity: 0.7, fontSize: 12 }}>Part ID: {w.part_id}</div> : null}
                    </td>
                    <td style={styles.td}>
                      {w.is_stock ? <span style={styles.pill("blue")}>Stock Job</span> : (w.customer_order || <span style={{ opacity: 0.6 }}>—</span>)}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.pill(tone)}>{w.status}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button style={styles.btn("light")} onClick={() => setOpenWO(w)}>Open</button>

                        {w.part_id ? (
                          <button
                            style={styles.btn("light")}
                            onClick={() => {
                              const url = `${API_BASE}/parts/${w.part_id}/file`;
                              window.open(url, "_blank", "noopener,noreferrer");
                            }}
                          >
                            Instructions
                          </button>
                        ) : null}

                        {canManage ? (
                          <>
                            <button style={styles.btn("green")} onClick={() => setStatus(w.id, "complete")}>Complete</button>
                            <button style={styles.btn("dark")} onClick={() => setStatus(w.id, "closed")}>Close</button>
                            <button style={styles.btn("light")} onClick={() => setStatus(w.id, "open")}>Reopen</button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td style={styles.td} colSpan={6}>
                    <div style={{ opacity: 0.75 }}>No work orders found.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {openWO ? (
        <WorkOrderModal
          token={token}
          user={user}
          wo={openWO}
          onClose={() => setOpenWO(null)}
          onError={onError}
          onOk={onOk}
          onRefresh={refresh}
        />
      ) : null}
    </div>
  );
}

function WorkOrderModal({ token, user, wo, onClose, onError, onOk, onRefresh }) {
  const [notes, setNotes] = React.useState([]);
  const [workers, setWorkers] = React.useState([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canManage = user.role === "admin" || user.role === "supervisor";

  async function load() {
    try {
      setBusy(true);
      const n = await api(`/work-orders/${wo.id}/notes`, { token });
      const w = await api(`/work-orders/${wo.id}/workers`, { token });
      setNotes(n || []);
      setWorkers(w || []);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => { load(); }, [wo.id]);

  const isCheckedIn = workers.some((x) => x.user_id === user.id);

  return (
    <div style={styles.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={styles.modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>{wo.wo_number}</div>
          <span style={styles.pill("gray")}>{wo.station}</span>
          <span style={styles.pill("blue")}>{wo.part_number}</span>
          <span style={{ marginLeft: "auto" }} />
          <button style={styles.btn("light")} onClick={load}>{busy ? "Loading..." : "Refresh"}</button>
          <button style={styles.btn("light")} onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 12 }}>
          <div style={styles.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950 }}>Actions</div>

              <button
                style={styles.btn("light")}
                onClick={() => {
                  const url = `${API_BASE}/work-orders/${wo.id}/print?token=${encodeURIComponent(token)}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                Pop Out / Print PDF
              </button>

              {wo.part_id ? (
                <button
                  style={styles.btn("light")}
                  onClick={() => window.open(`${API_BASE}/parts/${wo.part_id}/file`, "_blank", "noopener,noreferrer")}
                >
                  Open Instructions
                </button>
              ) : null}

              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button
                  style={styles.btn(isCheckedIn ? "dark" : "green")}
                  onClick={async () => {
                    try {
                      if (isCheckedIn) {
                        await api(`/work-orders/${wo.id}/workers/check-out`, { method: "POST", token });
                        onOk("Checked out.");
                      } else {
                        await api(`/work-orders/${wo.id}/workers/check-in`, { method: "POST", token });
                        onOk("Checked in.");
                      }
                      await load();
                      await onRefresh();
                    } catch (e) {
                      onError(e.message);
                    }
                  }}
                >
                  {isCheckedIn ? "Check Out" : "Check In"}
                </button>

                {canManage ? (
                  <>
                    <button
                      style={styles.btn("green")}
                      onClick={async () => {
                        try {
                          await api(`/work-orders/${wo.id}/complete`, { method: "POST", token });
                          onOk("Work order marked complete.");
                          await onRefresh();
                        } catch (e) {
                          onError(e.message);
                        }
                      }}
                    >
                      Complete
                    </button>
                    <button
                      style={styles.btn("dark")}
                      onClick={async () => {
                        try {
                          await api(`/work-orders/${wo.id}/close`, { method: "POST", token });
                          onOk("Work order closed.");
                          await onRefresh();
                        } catch (e) {
                          onError(e.message);
                        }
                      }}
                    >
                      Close WO
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 950, marginBottom: 8 }}>Currently Checked In</div>
              {workers.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {workers.map((w) => (
                    <span key={w.user_id} style={styles.pill("green")}>
                      {w.name} • {w.role}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ opacity: 0.7 }}>No one checked in.</div>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 950, marginBottom: 8 }}>Add Note</div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a note..."
                style={{ ...styles.input, minHeight: 90, resize: "vertical" }}
              />
              <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                <button
                  style={styles.btn("dark")}
                  onClick={async () => {
                    try {
                      const t = text.trim();
                      if (!t) return;
                      await api(`/work-orders/${wo.id}/notes`, { method: "POST", token, body: { text: t } });
                      setText("");
                      onOk("Note added.");
                      await load();
                    } catch (e) {
                      onError(e.message);
                    }
                  }}
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>

          <div style={styles.card}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>Notes</div>
            {notes.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {notes.slice().reverse().map((n) => (
                  <div key={n.id} style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 950 }}>{n.author_name}</div>
                      <div style={{ opacity: 0.65, fontSize: 12 }}>{fmtDT(n.created_at)}</div>
                    </div>
                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{n.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.7 }}>No notes yet.</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10, opacity: 0.6, fontSize: 12 }}>
          Tip: The PDF button uses <code>?token=</code> so it works in a pop-out window.
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Create Work Order (its own tab)
// -----------------------------
function CreateWorkOrder({ token, user, onError, onOk }) {
  const [parts, setParts] = React.useState([]);
  const [station, setStation] = React.useState("");
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
    }
  }

  React.useEffect(() => { loadParts(); }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Create Work Order</h2>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={styles.label}>Station</div>
            <input style={styles.input} value={station} onChange={(e) => setStation(e.target.value)} placeholder="Electrical" />
          </div>

          <div>
            <div style={styles.label}>Pick a Part (optional)</div>
            <select
              style={styles.input}
              value={partId}
              onChange={(e) => {
                setPartId(e.target.value);
                if (e.target.value) setPartNumber("");
              }}
            >
              <option value="">— choose —</option>
              {parts.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.part_number}{p.description ? ` — ${p.description}` : ""}{p.has_file ? " (📄)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={styles.label}>Or type Part Number (if not in parts list)</div>
            <input
              style={styles.input}
              value={partNumber}
              onChange={(e) => {
                setPartNumber(e.target.value);
                if (e.target.value) setPartId("");
              }}
              placeholder="HAR-M100L-STD"
            />
          </div>

          <div>
            <div style={styles.label}>Customer Order</div>
            <input
              style={styles.input}
              value={customerOrder}
              onChange={(e) => setCustomerOrder(e.target.value)}
              placeholder="45625"
              disabled={isStock}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={isStock}
              onChange={(e) => setIsStock(e.target.checked)}
              id="stock"
            />
            <label htmlFor="stock" style={{ fontWeight: 900 }}>Stock Job</label>
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <button
            style={styles.btn("dark")}
            disabled={busy}
            onClick={async () => {
              try {
                setBusy(true);
                const body = {
                  station,
                  is_stock: !!isStock,
                  customer_order: isStock ? null : (customerOrder || null),
                };
                if (partId) body.part_id = Number(partId);
                if (!partId) body.part_number = partNumber;

                const res = await api("/work-orders", { method: "POST", token, body });
                onOk(`Created ${res.wo_number}`);
                setStation("");
                setPartId("");
                setPartNumber("");
                setCustomerOrder("");
                setIsStock(false);
              } catch (e) {
                onError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating..." : "Create Work Order"}
          </button>

          <button style={styles.btn("light")} onClick={loadParts}>Refresh Parts</button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Parts Tab
// -----------------------------
function Parts({ token, user, onError, onOk }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");

  const [pn, setPn] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [file, setFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const canManage = user.role === "admin" || user.role === "supervisor";

  async function refresh() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  const filtered = parts.filter((p) => {
    if (!q.trim()) return true;
    const s = `${p.part_number} ${p.description || ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={styles.h2}>Parts</h2>
          <span style={styles.pill("gray")}>{filtered.length} parts</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <input
              style={{ ...styles.input, width: 340, maxWidth: "100%" }}
              placeholder="Search part number / description..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button style={styles.btn("light")} onClick={refresh}>Refresh</button>
          </div>
        </div>

        {canManage ? (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 18, border: "1px dashed rgba(0,0,0,0.18)" }}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>Add Part (optional instruction PDF)</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={styles.label}>Part Number</div>
                <input style={styles.input} value={pn} onChange={(e) => setPn(e.target.value)} placeholder="HAR-M100L-STD" />
              </div>

              <div>
                <div style={styles.label}>Description (optional)</div>
                <input style={styles.input} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Main harness..." />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={styles.label}>Instruction File (optional)</div>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button
                style={styles.btn("dark")}
                disabled={busy}
                onClick={async () => {
                  try {
                    setBusy(true);
                    const form = new FormData();
                    form.append("part_number", pn);
                    if (desc) form.append("description", desc);
                    if (file) form.append("file", file);

                    await api("/parts", { method: "POST", token, body: form, isForm: true });
                    onOk("Part added.");
                    setPn("");
                    setDesc("");
                    setFile(null);
                    await refresh();
                  } catch (e) {
                    onError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving..." : "Add Part"}
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Part</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Instructions</th>
                <th style={styles.th}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 950 }}>{p.part_number}</div>
                    <div style={{ opacity: 0.65, fontSize: 12 }}>ID: {p.id}</div>
                  </td>
                  <td style={styles.td}>{p.description || <span style={{ opacity: 0.6 }}>—</span>}</td>
                  <td style={styles.td}>
                    {p.has_file ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button style={styles.btn("light")} onClick={() => window.open(`${API_BASE}/parts/${p.id}/file`, "_blank", "noopener,noreferrer")}>
                          View
                        </button>
                        <button style={styles.btn("light")} onClick={() => window.open(`${API_BASE}/parts/${p.id}/download`, "_blank", "noopener,noreferrer")}>
                          Download
                        </button>
                      </div>
                    ) : (
                      <span style={{ opacity: 0.65 }}>No file</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.pill("gray")}>{p.qty_on_hand || 0}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td style={styles.td} colSpan={4}>No parts found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Inventory Tab
// -----------------------------
function Inventory({ token, user, onError, onOk }) {
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [qtyMap, setQtyMap] = React.useState({});
  const [noteMap, setNoteMap] = React.useState({});
  const [txnsPart, setTxnsPart] = React.useState(null);
  const [txns, setTxns] = React.useState([]);

  const canManage = user.role === "admin" || user.role === "supervisor";

  async function refresh() {
    try {
      const p = await api("/parts", { token });
      setParts(p || []);
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  const filtered = parts.filter((p) => {
    if (!q.trim()) return true;
    const s = `${p.part_number} ${p.description || ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  async function loadTxns(partId) {
    try {
      const rows = await api(`/inventory/${partId}/txns?limit=200`, { token });
      setTxns(rows || []);
      setTxnsPart(partId);
    } catch (e) {
      onError(e.message);
    }
  }

  async function change(partId, type) {
    try {
      if (!canManage) return;
      const qty = Number(qtyMap[partId] || 0);
      if (!qty || qty <= 0) throw new Error("Enter a quantity > 0");

      const note = noteMap[partId] || null;
      const path = type === "add" ? `/inventory/${partId}/add` : `/inventory/${partId}/remove`;

      await api(path, { method: "POST", token, body: { qty, note } });
      onOk(type === "add" ? "Added inventory." : "Removed inventory.");
      setQtyMap((m) => ({ ...m, [partId]: "" }));
      setNoteMap((m) => ({ ...m, [partId]: "" }));
      await refresh();
      if (txnsPart === partId) await loadTxns(partId);
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={styles.h2}>Inventory</h2>
          <span style={styles.pill("gray")}>{filtered.length} parts</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <input
              style={{ ...styles.input, width: 340, maxWidth: "100%" }}
              placeholder="Search parts..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button style={styles.btn("light")} onClick={refresh}>Refresh</button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 0.9fr", gap: 12 }}>
          <div style={styles.card}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>Parts</div>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Part</th>
                  <th style={styles.th}>On Hand</th>
                  <th style={styles.th}>Change</th>
                  <th style={styles.th}>History</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 950 }}>{p.part_number}</div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>{p.description || ""}</div>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.pill("gray")}>{p.qty_on_hand || 0}</span>
                    </td>
                    <td style={styles.td}>
                      {canManage ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <input
                            style={{ ...styles.input, padding: "8px 10px" }}
                            placeholder="Qty"
                            value={qtyMap[p.id] ?? ""}
                            onChange={(e) => setQtyMap((m) => ({ ...m, [p.id]: e.target.value }))}
                          />
                          <input
                            style={{ ...styles.input, padding: "8px 10px" }}
                            placeholder="Note (optional)"
                            value={noteMap[p.id] ?? ""}
                            onChange={(e) => setNoteMap((m) => ({ ...m, [p.id]: e.target.value }))}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={styles.btn("green")} onClick={() => change(p.id, "add")}>Add</button>
                            <button style={styles.btn("red")} onClick={() => change(p.id, "remove")}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ opacity: 0.6 }}>Supervisor/Admin only</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <button style={styles.btn("light")} onClick={() => loadTxns(p.id)}>View</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr><td style={styles.td} colSpan={4}>No parts found.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={styles.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 950 }}>Transaction History</div>
              {txnsPart ? <span style={styles.pill("blue")}>Part ID: {txnsPart}</span> : null}
            </div>

            <div style={{ marginTop: 10 }}>
              {txnsPart ? (
                txns.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {txns.map((t) => (
                      <div key={t.id} style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontWeight: 950 }}>{t.txn_type} ({t.qty_delta})</div>
                          <div style={{ opacity: 0.65, fontSize: 12 }}>{fmtDT(t.created_at)}</div>
                        </div>
                        {t.note ? <div style={{ marginTop: 6, opacity: 0.9 }}>{t.note}</div> : <div style={{ marginTop: 6, opacity: 0.6 }}>No note</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.7 }}>No transactions yet.</div>
                )
              ) : (
                <div style={{ opacity: 0.7 }}>Pick a part and click “View”.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Admin Tab
// -----------------------------
function Admin({ token, user, onError, onOk }) {
  const isAdmin = user.role === "admin";
  const [users, setUsers] = React.useState([]);

  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState("assembler");
  const [newPin, setNewPin] = React.useState("");

  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  async function refresh() {
    try {
      const rows = await api("/users", { token });
      setUsers(rows || []);
    } catch (e) {
      onError(e.message);
    }
  }

  React.useEffect(() => { refresh(); }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={styles.h2}>Admin</h2>
          <span style={styles.pill(isAdmin ? "green" : "gray")}>{isAdmin ? "Admin" : "Supervisor"}</span>
          <button style={{ ...styles.btn("light"), marginLeft: "auto" }} onClick={refresh}>Refresh</button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={styles.card}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>Create User (Admin only)</div>
            {!isAdmin ? (
              <div style={{ opacity: 0.7 }}>Only admins can create users.</div>
            ) : (
              <>
                <div style={styles.label}>Name</div>
                <input style={styles.input} value={newName} onChange={(e) => setNewName(e.target.value)} />

                <div style={{ marginTop: 10, ...styles.label }}>Role</div>
                <select style={styles.input} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                  <option value="assembler">assembler</option>
                  <option value="supervisor">supervisor</option>
                  <option value="admin">admin</option>
                </select>

                <div style={{ marginTop: 10, ...styles.label }}>PIN</div>
                <input style={styles.input} value={newPin} onChange={(e) => setNewPin(e.target.value)} />

                <div style={{ marginTop: 12 }}>
                  <button
                    style={styles.btn("dark")}
                    onClick={async () => {
                      try {
                        await api("/users", { method: "POST", token, body: { name: newName, role: newRole, pin: newPin } });
                        onOk("User created.");
                        setNewName(""); setNewPin(""); setNewRole("assembler");
                        await refresh();
                      } catch (e) { onError(e.message); }
                    }}
                  >
                    Create User
                  </button>
                </div>
              </>
            )}
          </div>

          <div style={styles.card}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>Reset User PIN (Uses RESET_TOKEN)</div>

            <div style={styles.label}>RESET_TOKEN</div>
            <input style={styles.input} value={resetToken} onChange={(e) => setResetToken(e.target.value)} />

            <div style={{ marginTop: 10, ...styles.label }}>User Name</div>
            <input style={styles.input} value={resetName} onChange={(e) => setResetName(e.target.value)} />

            <div style={{ marginTop: 10, ...styles.label }}>New PIN</div>
            <input style={styles.input} value={resetPin} onChange={(e) => setResetPin(e.target.value)} />

            <div style={{ marginTop: 12 }}>
              <button
                style={styles.btn("dark")}
                onClick={async () => {
                  try {
                    await api("/admin/reset-pin", {
                      method: "POST",
                      token,
                      body: { name: resetName, new_pin: resetPin },
                      // header handled in backend via x-reset-token, easiest is fetch manually:
                    });
                    // Above API helper can't set custom header, so do raw fetch:
                  } catch (e) {}
                }}
              />
              <button
                style={styles.btn("dark")}
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/admin/reset-pin`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`,
                        "x-reset-token": resetToken,
                      },
                      body: JSON.stringify({ name: resetName, new_pin: resetPin }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.detail || "Reset failed");
                    onOk("PIN reset.");
                    setResetName(""); setResetPin("");
                  } catch (e) {
                    onError(e.message);
                  }
                }}
              >
                Reset PIN
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 950, marginBottom: 10 }}>Users</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={styles.td}><b>{u.name}</b></td>
                  <td style={styles.td}><span style={styles.pill(u.role === "admin" ? "green" : u.role === "supervisor" ? "blue" : "gray")}>{u.role}</span></td>
                  <td style={styles.td}>{u.is_active ? "active" : "inactive"}</td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr><td style={styles.td} colSpan={3}>No users.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, opacity: 0.65, fontSize: 12 }}>
          Admin reset uses your backend env var <code>RESET_TOKEN</code>.
        </div>
      </div>
    </div>
  );
}

// -----------------------------
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
