import React from "react";
import { createRoot } from "react-dom/client";

/**
 * IMPORTANT:
 * - In production, set Render env var: VITE_API_URL=https://trr-assembly-api.onrender.com
 * - Fallback is your Render API to avoid the 127.0.0.1 problem
 */
const API_BASE =
  import.meta.env.VITE_API_URL ||
  "https://trr-assembly-api.onrender.com";

async function api(path, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let fetchBody = undefined;
  if (formData) {
    fetchBody = formData; // browser sets multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: fetchBody,
  });

  const contentType = res.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const msg =
      (data && data.detail) ||
      (typeof data === "string" && data) ||
      `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return data;
}

function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontWeight: 800,
        fontSize: 12,
        background: "#fff",
      }}
    >
      {children}
    </span>
  );
}

function Button({ children, onClick, variant = "primary", disabled }) {
  const styles =
    variant === "primary"
      ? {
          background: "linear-gradient(180deg,#111,#000)",
          color: "white",
          border: "1px solid #000",
        }
      : variant === "danger"
      ? {
          background: "#fff5f5",
          color: "#7a0000",
          border: "1px solid #f2c2c2",
        }
      : {
          background: "white",
          color: "#111",
          border: "1px solid #ddd",
        };

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles,
        borderRadius: 12,
        padding: "10px 12px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 900,
        boxShadow: "0 6px 16px rgba(0,0,0,0.06)",
      }}
    >
      {children}
    </button>
  );
}

function Card({ title, right, children }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e9e9e9",
        borderRadius: 18,
        padding: 16,
        boxShadow: "0 10px 24px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 950 }}>{title}</div>
        <div style={{ marginLeft: "auto" }}>{right}</div>
      </div>
      {children}
    </div>
  );
}

function Banner({ text, onClose }) {
  if (!text) return null;
  return (
    <div
      style={{
        border: "1px solid #f1c4c4",
        background: "#fff1f1",
        color: "#7a0000",
        padding: 12,
        borderRadius: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 900 }}>⚠ {text}</div>
      <div style={{ marginLeft: "auto" }}>
        <Button variant="secondary" onClick={onClose}>
          X
        </Button>
      </div>
    </div>
  );
}

function Layout({ user, tab, setTab, onLogout, children }) {
  const tabs = [
    { key: "workOrders", label: "Work Orders" },
    { key: "inventory", label: "Inventory" },
    { key: "parts", label: "Parts" },
    { key: "admin", label: "Admin" },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(1200px 600px at 30% 0%, #f2f5ff, #f7f7f7 60%)",
        padding: 18,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 12px",
          borderRadius: 18,
          background: "rgba(255,255,255,0.85)",
          border: "1px solid #eee",
          boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ fontWeight: 950, fontSize: 18 }}>TRR Assembly Work Orders</div>
        <Pill>{user.name} ({user.role})</Pill>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "primary" : "secondary"}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
          <Button variant="danger" onClick={onLogout}>
            Logout
          </Button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "16px auto 0" }}>{children}</div>

      <div style={{ maxWidth: 1200, margin: "12px auto 0", opacity: 0.55, fontSize: 12 }}>
        API: {API_BASE}
      </div>
    </div>
  );
}

function Login({ onLogin, onError }) {
  const [name, setName] = React.useState("");
  const [pin, setPin] = React.useState("");

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f6f6", padding: 18 }}>
      <div style={{ width: "min(520px, 100%)" }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 26, fontWeight: 950 }}>TRR Assembly Work Orders</div>
          <div style={{ opacity: 0.7, fontWeight: 700 }}>Login</div>
        </div>

        <Card title="Enter your credentials">
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontWeight: 900 }}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", fontSize: 16 }}
            />

            <label style={{ fontWeight: 900 }}>PIN</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
              style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", fontSize: 16 }}
            />

            <Button
              onClick={async () => {
                try {
                  const resp = await api("/auth/login", { method: "POST", body: { name, pin } });
                  onLogin(resp);
                } catch (e) {
                  onError(e.message);
                }
              }}
            >
              Login
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function WorkOrders({ token, user, onError }) {
  const [wos, setWos] = React.useState([]);
  const [parts, setParts] = React.useState([]);
  const [q, setQ] = React.useState("");

  const [station, setStation] = React.useState("");
  const [partNumber, setPartNumber] = React.useState("");
  const [customerOrder, setCustomerOrder] = React.useState("");
  const [isStock, setIsStock] = React.useState(false);

  const [openWO, setOpenWO] = React.useState(null);
  const [notes, setNotes] = React.useState([]);
  const [workers, setWorkers] = React.useState([]);

  async function refreshAll() {
    const [woList, partList] = await Promise.all([
      api("/work-orders", { token }),
      api("/parts", { token }),
    ]);
    setWos(woList || []);
    setParts(partList || []);
  }

  React.useEffect(() => {
    refreshAll().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function partIdFromPartNumber(pn) {
    const p = parts.find((x) => String(x.part_number).toLowerCase() === String(pn).toLowerCase());
    return p ? p.id : null;
  }

  const filtered = wos.filter((w) => {
    if (!q.trim()) return true;
    const hay = `${w.wo_number} ${w.station} ${w.part_number} ${w.customer_order || ""} ${w.status}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  async function openDetails(wo) {
    setOpenWO(wo);
    try {
      const [n, w] = await Promise.all([
        api(`/work-orders/${wo.id}/notes`, { token }),
        api(`/work-orders/${wo.id}/workers`, { token }),
      ]);
      setNotes(n || []);
      setWorkers(w || []);
    } catch (e) {
      onError(e.message);
    }
  }

  async function patchWO(id, patch) {
    await api(`/work-orders/${id}`, { method: "PATCH", token, body: patch });
    await refreshAll();
    if (openWO && openWO.id === id) {
      const updated = (await api(`/work-orders/${id}`, { token })) || openWO;
      await openDetails(updated);
    }
  }

  async function checkInOut(woId, action) {
    await api(`/work-orders/${woId}/workers/${action}`, { method: "POST", token });
    const w = await api(`/work-orders/${woId}/workers`, { token });
    setWorkers(w || []);
  }

  function openInstruction(wo) {
    if (!wo.part_id) {
      onError("No part linked to this work order.");
      return;
    }
    // open in new tab (FileResponse)
    const url = `${API_BASE}/parts/${wo.part_id}/file`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function popoutPrint(wo) {
    const url = `${API_BASE}/work-orders/${wo.id}/print?token=${encodeURIComponent(token)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search WO / station / part / status..."
          style={{
            flex: 1,
            minWidth: 260,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            fontSize: 14,
            fontWeight: 700,
          }}
        />
        <Button variant="secondary" onClick={() => refreshAll().catch((e) => onError(e.message))}>
          Refresh
        </Button>
      </div>

      <Card title="Create Work Order">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Station</div>
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
            />
          </div>
          <div>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Part Number</div>
            <input
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Customer Order</div>
              <input
                value={customerOrder}
                onChange={(e) => setCustomerOrder(e.target.value)}
                disabled={isStock}
                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900 }}>
              <input checked={isStock} onChange={(e) => setIsStock(e.target.checked)} type="checkbox" />
              Stock Job
            </label>

            <Button
              onClick={async () => {
                try {
                  const pid = partIdFromPartNumber(partNumber.trim());
                  await api("/work-orders", {
                    method: "POST",
                    token,
                    body: {
                      station: station.trim(),
                      part_id: pid || null,
                      part_number: pid ? null : partNumber.trim(),
                      customer_order: isStock ? null : (customerOrder || ""),
                      is_stock: !!isStock,
                    },
                  });
                  setStation("");
                  setPartNumber("");
                  setCustomerOrder("");
                  setIsStock(false);
                  await refreshAll();
                } catch (e) {
                  onError(e.message);
                }
              }}
            >
              Create Work Order
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Work Orders">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
                <th style={{ padding: 10 }}>WO</th>
                <th style={{ padding: 10 }}>Station / Part</th>
                <th style={{ padding: 10 }}>Customer Order</th>
                <th style={{ padding: 10 }}>Status</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10, fontWeight: 950 }}>{w.wo_number}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>{w.station}</div>
                    <div style={{ opacity: 0.75 }}>{w.part_number}</div>
                  </td>
                  <td style={{ padding: 10 }}>{w.customer_order || ""}</td>
                  <td style={{ padding: 10 }}>
                    <Pill>{w.status}</Pill>
                  </td>
                  <td style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button variant="secondary" onClick={() => openDetails(w)}>
                        Open
                      </Button>
                      <Button variant="secondary" onClick={() => openInstruction(w)}>
                        Instructions
                      </Button>
                      <Button variant="secondary" onClick={() => popoutPrint(w)}>
                        Popout / Print
                      </Button>
                      {(user.role === "admin" || user.role === "supervisor") && (
                        <>
                          <Button onClick={() => patchWO(w.id, { status: "complete" })}>
                            Complete
                          </Button>
                          <Button onClick={() => patchWO(w.id, { status: "closed" })}>
                            Close
                          </Button>
                          <Button variant="secondary" onClick={() => patchWO(w.id, { status: "open" })}>
                            Reopen
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 16, opacity: 0.7 }}>
                    No work orders found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {openWO ? (
        <Card
          title={`WO Details — ${openWO.wo_number}`}
          right={<Button variant="secondary" onClick={() => setOpenWO(null)}>Close</Button>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 950, marginBottom: 6 }}>Workers checked in</div>
              <div style={{ display: "grid", gap: 8 }}>
                {workers.length ? (
                  workers.map((w) => (
                    <div key={w.user_id} style={{ padding: 10, border: "1px solid #eee", borderRadius: 12 }}>
                      <div style={{ fontWeight: 900 }}>{w.name} <span style={{ opacity: 0.7 }}>({w.role})</span></div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>IN: {new Date(w.started_at).toLocaleString()}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.7 }}>No one is currently checked in.</div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                  <Button onClick={() => checkInOut(openWO.id, "check-in").catch(e => onError(e.message))}>
                    Check In
                  </Button>
                  <Button variant="secondary" onClick={() => checkInOut(openWO.id, "check-out").catch(e => onError(e.message))}>
                    Check Out
                  </Button>
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 950, marginBottom: 6 }}>Notes</div>
              <div style={{ display: "grid", gap: 8 }}>
                {notes.length ? (
                  notes.map((n) => (
                    <div key={n.id} style={{ padding: 10, border: "1px solid #eee", borderRadius: 12 }}>
                      <div style={{ fontWeight: 900 }}>
                        {n.author_name} <span style={{ opacity: 0.6, fontSize: 12 }}>{new Date(n.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{n.text}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.7 }}>No notes yet.</div>
                )}

                <textarea
                  placeholder="Add a note..."
                  rows={3}
                  style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
                  onKeyDown={async (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      const text = e.currentTarget.value.trim();
                      if (!text) return;
                      try {
                        await api(`/work-orders/${openWO.id}/notes`, { method: "POST", token, body: { text } });
                        e.currentTarget.value = "";
                        const n = await api(`/work-orders/${openWO.id}/notes`, { token });
                        setNotes(n || []);
                      } catch (err) {
                        onError(err.message);
                      }
                    }
                  }}
                />
                <div style={{ opacity: 0.6, fontSize: 12 }}>
                  Tip: Press <b>Ctrl+Enter</b> to post note
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Parts({ token, user, onError }) {
  const [parts, setParts] = React.useState([]);
  const [partNumber, setPartNumber] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [file, setFile] = React.useState(null);
  const canManage = user.role === "admin" || user.role === "supervisor";

  async function refresh() {
    const p = await api("/parts", { token });
    setParts(p || []);
  }

  React.useEffect(() => {
    refresh().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="Parts Database" right={<Button variant="secondary" onClick={() => refresh().catch(e => onError(e.message))}>Refresh</Button>}>
        {canManage ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Part Number</div>
              <input
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Description (optional)</div>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
              />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Instruction File (optional)</div>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <Button
                onClick={async () => {
                  try {
                    const fd = new FormData();
                    fd.append("part_number", partNumber.trim());
                    if (description.trim()) fd.append("description", description.trim());
                    if (file) fd.append("file", file);

                    await api("/parts", { method: "POST", token, formData: fd });

                    setPartNumber("");
                    setDescription("");
                    setFile(null);
                    await refresh();
                  } catch (e) {
                    onError(e.message);
                  }
                }}
              >
                Add Part (and upload file if chosen)
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ opacity: 0.7, marginBottom: 10 }}>You don’t have permission to add parts.</div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
                <th style={{ padding: 10 }}>Part #</th>
                <th style={{ padding: 10 }}>Description</th>
                <th style={{ padding: 10 }}>Instructions</th>
                <th style={{ padding: 10 }}>On Hand</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 10, fontWeight: 950 }}>{p.part_number}</td>
                  <td style={{ padding: 10 }}>{p.description || ""}</td>
                  <td style={{ padding: 10 }}>
                    {p.has_file ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button variant="secondary" onClick={() => window.open(`${API_BASE}/parts/${p.id}/file`, "_blank", "noopener,noreferrer")}>
                          Open
                        </Button>
                        <Button variant="secondary" onClick={() => window.open(`${API_BASE}/parts/${p.id}/download`, "_blank", "noopener,noreferrer")}>
                          Download
                        </Button>
                        {canManage ? (
                          <Button
                            onClick={async () => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.onchange = async () => {
                                const f = input.files?.[0];
                                if (!f) return;
                                const fd = new FormData();
                                fd.append("file", f);
                                try {
                                  await api(`/parts/${p.id}/upload`, { method: "POST", token, formData: fd });
                                  await refresh();
                                } catch (e) {
                                  onError(e.message);
                                }
                              };
                              input.click();
                            }}
                          >
                            Replace File
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <span style={{ opacity: 0.7 }}>No file</span>
                    )}
                  </td>
                  <td style={{ padding: 10 }}>{p.qty_on_hand || 0}</td>
                </tr>
              ))}
              {parts.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 16, opacity: 0.7 }}>
                    No parts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Inventory({ token, user, onError }) {
  // Lightweight placeholder (you already have inventory endpoints; can expand later)
  return (
    <Card title="Inventory">
      <div style={{ opacity: 0.75 }}>
        Inventory tools are available via Parts → On Hand and transaction history endpoints.
        If you want, I’ll expand this tab into a full receive/issue screen with history filters.
      </div>
    </Card>
  );
}

function Admin({ token, user, onError }) {
  const [users, setUsers] = React.useState([]);
  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState("assembler");
  const [newPin, setNewPin] = React.useState("");

  const [resetToken, setResetToken] = React.useState("");
  const [resetName, setResetName] = React.useState("");
  const [resetPin, setResetPin] = React.useState("");

  const isAdmin = user.role === "admin";

  async function refresh() {
    if (!isAdmin) return;
    const u = await api("/users", { token });
    setUsers(u || []);
  }

  React.useEffect(() => {
    refresh().catch((e) => onError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return <Card title="Admin"><div style={{ opacity: 0.7 }}>Admins only.</div></Card>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <Card title="Create User">
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontWeight: 900 }}>Name</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }} />

          <label style={{ fontWeight: 900 }}>Role</label>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }}>
            <option value="assembler">assembler</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
          </select>

          <label style={{ fontWeight: 900 }}>PIN</label>
          <input value={newPin} onChange={(e) => setNewPin(e.target.value)} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }} />

          <Button
            onClick={async () => {
              try {
                await api("/users", { method: "POST", token, body: { name: newName, role: newRole, pin: newPin } });
                setNewName(""); setNewPin(""); setNewRole("assembler");
                await refresh();
              } catch (e) {
                onError(e.message);
              }
            }}
          >
            Create User
          </Button>
        </div>
      </Card>

      <Card title="Reset User PIN">
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontWeight: 900 }}>RESET_TOKEN</label>
          <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }} />

          <label style={{ fontWeight: 900 }}>User Name</label>
          <input value={resetName} onChange={(e) => setResetName(e.target.value)} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }} />

          <label style={{ fontWeight: 900 }}>New PIN</label>
          <input value={resetPin} onChange={(e) => setResetPin(e.target.value)} style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd" }} />

          <Button
            onClick={async () => {
              try {
                await api("/admin/reset-pin", {
                  method: "POST",
                  token,
                  body: { name: resetName, new_pin: resetPin },
                // reset token must be header, so we call fetch directly:
                });
              } catch (e) {
                // We'll do it correctly below
              }
            }}
            disabled
          >
            (Disabled — use button below)
          </Button>

          <Button
            onClick={async () => {
              try {
                const res = await fetch(`${API_BASE}/admin/reset-pin`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "x-reset-token": resetToken,
                  },
                  body: JSON.stringify({ name: resetName, new_pin: resetPin }),
                });
                const j = await res.json().catch(() => null);
                if (!res.ok) throw new Error((j && j.detail) || `${res.status} ${res.statusText}`);
                setResetName(""); setResetPin("");
                await refresh();
              } catch (e) {
                onError(e.message);
              }
            }}
          >
            Reset PIN
          </Button>
        </div>
      </Card>

      <div style={{ gridColumn: "1 / -1" }}>
        <Card title="Users" right={<Button variant="secondary" onClick={() => refresh().catch(e => onError(e.message))}>Refresh</Button>}>
          <div style={{ display: "grid", gap: 10 }}>
            {users.map((u) => (
              <div key={u.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 950 }}>{u.name}</div>
                <Pill>{u.role}</Pill>
                <span style={{ opacity: 0.7 }}>{u.is_active ? "active" : "inactive"}</span>
              </div>
            ))}
            {users.length === 0 ? <div style={{ opacity: 0.7 }}>No users yet.</div> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function App() {
  const [err, setErr] = React.useState("");
  const [auth, setAuth] = React.useState(null);
  const [tab, setTab] = React.useState("workOrders");

  function onLogout() {
    setAuth(null);
    setTab("workOrders");
  }

  if (!auth) {
    return <Login onLogin={setAuth} onError={setErr} />;
  }

  return (
    <Layout user={{ name: auth.name, role: auth.role }} tab={tab} setTab={setTab} onLogout={onLogout}>
      <div style={{ display: "grid", gap: 14 }}>
        <Banner text={err} onClose={() => setErr("")} />

        {tab === "workOrders" ? <WorkOrders token={auth.token} user={auth} onError={setErr} /> : null}
        {tab === "inventory" ? <Inventory token={auth.token} user={auth} onError={setErr} /> : null}
        {tab === "parts" ? <Parts token={auth.token} user={auth} onError={setErr} /> : null}
        {tab === "admin" ? <Admin token={auth.token} user={auth} onError={setErr} /> : null}
      </div>
    </Layout>
  );
}

createRoot(document.getElementById("root")).render(<App />);
