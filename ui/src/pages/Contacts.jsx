import React, { useState, useEffect, useRef } from "react";
import { Plus, Upload, Download, Trash2, Search, Users, X, PhoneCall, PhoneOff, Mic, Sparkles } from "lucide-react";
import { api } from "../services/api";
import { useToast } from "../components/Toast";

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [activeCall, setActiveCall] = useState(null);
  const [callDuration, setCallDuration] = useState(0);

  // Form states
  const [addForm, setAddForm] = useState({ name: "", phone_number: "", company: "", notes: "" });
  const [uploadForm, setUploadForm] = useState({ name: "", concurrency: 5, file: null });
  const [uploading, setUploading] = useState(false);

  const timerRef = useRef(null);
  const { showToast } = useToast();

  useEffect(() => {
    fetchContacts();
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    if (activeCall) {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeCall]);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const data = await api.getContacts(statusFilter, searchTerm);
      setContacts(data);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCallNow = async (contact) => {
    if (activeCall && (activeCall.status === "DIALING" || activeCall.status === "CONNECTED")) return;
    try {
      setActiveCall({
        contact,
        status: "DIALING",
        callSid: null,
      });

      const res = await api.triggerOutboundCall(
        contact.phone_number,
        `Direct Outbound Call to ${contact.name || "Lead"}`
      );

      setActiveCall({
        contact,
        status: "CONNECTED",
        callSid: res.callSid,
      });

      showToast(`Calling ${contact.name || contact.phone_number}...`, "success");
    } catch (err) {
      setActiveCall(null);
      showToast(`Failed to initiate call: ${err.message}`, "error");
    }
  };

  const handleEndCall = () => {
    if (activeCall) {
      showToast(`Call with ${activeCall.contact.name || activeCall.contact.phone_number} ended (${formatDuration(callDuration)}).`, "info");
      setActiveCall(null);
      fetchContacts();
    }
  };

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleAddContact = async (e) => {
    e.preventDefault();
    try {
      await api.createContact(addForm);
      showToast("Contact added successfully!", "success");
      setShowAddModal(false);
      setAddForm({ name: "", phone_number: "", company: "", notes: "" });
      fetchContacts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleDeleteContact = async (id) => {
    if (!window.confirm("Are you sure you want to delete this contact?")) return;
    try {
      await api.deleteContact(id);
      showToast("Contact deleted successfully", "success");
      fetchContacts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleUploadCSV = async (e) => {
    e.preventDefault();
    if (!uploadForm.file) {
      showToast("Please select a CSV file to upload", "error");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("name", uploadForm.name || "Bulk Leads Batch");
    formData.append("concurrency", uploadForm.concurrency);
    formData.append("file", uploadForm.file);

    try {
      await api.uploadCampaign(formData);
      showToast("CSV leads uploaded & campaign created!", "success");
      setShowUploadModal(false);
      setUploadForm({ name: "", concurrency: 5, file: null });
      fetchContacts();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const downloadSampleCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8,name,phone,company,city\nRajesh Kumar,9876543210,Kumar Enterprises,Bangalore\nPriya Sharma,9123456780,Sharma Logistics,Delhi\nAnkit Patel,9988776655,Patel Retail,Ahmedabad";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sample_leads.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div>
      <div className="saas-card">
        {/* Card Header & Controls */}
        <div className="saas-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search size={16} style={{ position: "absolute", left: "12px", color: "var(--text-light)" }} />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: "36px", width: "240px" }}
                placeholder="Search name, phone, company..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ width: "170px" }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="NEW">New Leads</option>
              <option value="INTERESTED">Interested</option>
              <option value="DEMO_SCHEDULED">Demo Scheduled</option>
              <option value="NOT_INTERESTED">Not Interested</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button className="btn btn-outline" onClick={downloadSampleCSV}>
              <Download size={15} />
              <span>Sample CSV</span>
            </button>
            <button className="btn btn-outline" onClick={() => setShowUploadModal(true)}>
              <Upload size={15} />
              <span>Bulk CSV Upload</span>
            </button>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={15} />
              <span>Add Contact</span>
            </button>
          </div>
        </div>

        {/* Contacts Table */}
        <div className="table-wrap">
          <table className="saas-table">
            <thead>
              <tr>
                <th>Lead / Contact Name</th>
                <th>Phone Number</th>
                <th>Company</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    Loading contacts...
                  </td>
                </tr>
              ) : !contacts.length ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    No contacts found. Add your first lead or upload a CSV above!
                  </td>
                </tr>
              ) : (
                contacts.map((c) => {
                  let badgeStyle = "badge-new";
                  if (c.status === "DEMO_SCHEDULED") badgeStyle = "badge-demo";
                  else if (c.status === "INTERESTED") badgeStyle = "badge-interested";
                  else if (c.status === "NOT_INTERESTED") badgeStyle = "badge-not-interested";

                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name || "Caller"}</strong>
                      </td>
                      <td>
                        <a
                          href={`tel:${c.phone_number}`}
                          style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}
                        >
                          {c.phone_number}
                        </a>
                      </td>
                      <td>{c.company || "—"}</td>
                      <td>
                        <span className={`badge ${badgeStyle}`}>{c.status.replace("_", " ")}</span>
                      </td>
                      <td style={{ maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)" }}>
                        {c.notes || "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleCallNow(c)}
                            title="Instant Call Now"
                            style={{
                              background: "linear-gradient(135deg, #10b981, #059669)",
                              borderColor: "#059669",
                              padding: "4px 10px",
                              fontSize: "12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <PhoneCall size={12} />
                            <span>Call Now</span>
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteContact(c.id)}
                            title="Delete contact"
                            style={{ padding: "4px 8px" }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Add New Contact</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddContact}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Rahul Verma"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Mobile Number</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 9876543210"
                  value={addForm.phone_number}
                  onChange={(e) => setAddForm({ ...addForm, phone_number: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Company Name (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Verma Enterprises"
                  value={addForm.company}
                  onChange={(e) => setAddForm({ ...addForm, company: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Notes / Requirements</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="e.g. Interested in customer support automation"
                  value={addForm.notes}
                  onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Bulk Upload Leads via CSV</h3>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUploadCSV}>
              <div className="form-group">
                <label className="form-label">Campaign / Batch Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Real Estate Bangalore Outreach"
                  value={uploadForm.name}
                  onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Parallel Dialing Concurrency</label>
                <input
                  type="number"
                  className="form-input"
                  value={uploadForm.concurrency}
                  min={1}
                  max={20}
                  onChange={(e) => setUploadForm({ ...uploadForm, concurrency: parseInt(e.target.value) || 5 })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Select CSV File</label>
                <input
                  type="file"
                  className="form-input"
                  accept=".csv"
                  onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files[0] })}
                  required
                />
                <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  Expected columns: <code>name, phone, company, city</code>
                </span>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowUploadModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={uploading}>
                  {uploading ? "Uploading..." : "Upload & Create Campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Active Call Overlay Modal */}
      {activeCall && (
        <div className="modal-overlay" style={{ backdropFilter: "blur(6px)" }}>
          <div
            className="modal-content"
            style={{
              maxWidth: "420px",
              textAlign: "center",
              padding: "32px 24px",
              boxShadow: "0 20px 40px -10px rgba(0,0,0,0.15)",
              borderRadius: "20px",
            }}
          >
            {/* Live Visual Pulse Animation */}
            <div
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "50%",
                background: "rgba(16, 185, 129, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px auto",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "var(--emerald-500)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  boxShadow: "0 0 20px rgba(16, 185, 129, 0.4)",
                }}
              >
                <PhoneCall size={26} />
              </div>
            </div>

            <div style={{ marginBottom: "8px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <span className="live-dot" style={{ background: "var(--emerald-500)" }}></span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--emerald-500)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {activeCall.status === "DIALING" ? "Initiating Call..." : "Call In Progress"}
              </span>
            </div>

            <h3 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "4px" }}>
              {activeCall.contact.name || "Lead / Caller"}
            </h3>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "16px", fontWeight: 600 }}>
              {activeCall.contact.phone_number} {activeCall.contact.company ? `• ${activeCall.contact.company}` : ""}
            </p>

            <div
              style={{
                fontSize: "28px",
                fontWeight: 800,
                fontFamily: "monospace",
                color: "var(--text-main)",
                marginBottom: "20px",
                letterSpacing: "1px",
              }}
            >
              {formatDuration(callDuration)}
            </div>

            <div
              style={{
                background: "var(--bg-card-subtle)",
                borderRadius: "10px",
                padding: "10px 14px",
                fontSize: "12px",
                color: "var(--text-muted)",
                marginBottom: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              <Sparkles size={14} color="var(--primary)" />
              <span>Sarah AI is pitching & qualifying for 5-min demo</span>
            </div>

            <button
              className="btn btn-danger"
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "14px",
                fontWeight: 700,
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              onClick={handleEndCall}
            >
              <PhoneOff size={16} />
              <span>End Call Session</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
