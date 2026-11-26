import React, { useState, useEffect } from "react";
import {
  PhoneCall,
  FileText,
  RefreshCw,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  TrendingUp,
  Brain,
  ShieldAlert,
} from "lucide-react";
import { api } from "../services/api";
import { useToast } from "../components/Toast";

export default function CallLogs() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTranscript, setActiveTranscript] = useState(null);

  const { showToast } = useToast();

  useEffect(() => {
    fetchCalls();
    // Post-call analysis arrives a few seconds after hang-up: refresh quietly.
    const timer = setInterval(() => fetchCalls(true), 10000);
    return () => clearInterval(timer);
  }, []);

  const fetchCalls = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await api.getCalls();
      setCalls(data || []);
    } catch (err) {
      if (!silent) showToast(err.message, "error");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const parseSummary = (summaryStr) => {
    if (!summaryStr) return null;
    try {
      if (typeof summaryStr === "object") return summaryStr;
      return JSON.parse(summaryStr);
    } catch {
      return null;
    }
  };

  const getOutcomeBadge = (outcome) => {
    switch (outcome) {
      case "DEMO_BOOKED":
        return { bg: "var(--emerald-bg)", color: "#34d399", border: "rgba(16, 185, 129, 0.3)", label: "Demo Booked" };
      case "CALLBACK_REQUESTED":
        return { bg: "var(--amber-bg)", color: "#fbbf24", border: "rgba(245, 158, 11, 0.3)", label: "Callback Requested" };
      case "NOT_INTERESTED":
        return { bg: "var(--rose-bg)", color: "#f87171", border: "rgba(244, 63, 94, 0.3)", label: "Not Interested" };
      case "IVR_DETECTED":
        return { bg: "rgba(255, 255, 255, 0.05)", color: "var(--text-muted)", border: "var(--border)", label: "IVR / AMD" };
      default:
        return { bg: "rgba(79, 70, 229, 0.15)", color: "#a5b4fc", border: "rgba(79, 70, 229, 0.3)", label: outcome || "Completed" };
    }
  };

  const getSentimentPill = (sentiment) => {
    switch (sentiment) {
      case "POSITIVE":
        return { bg: "var(--emerald-bg)", color: "#34d399", label: "Positive Sentiment" };
      case "NEGATIVE":
        return { bg: "var(--rose-bg)", color: "#f87171", label: "Negative Sentiment" };
      default:
        return { bg: "rgba(255, 255, 255, 0.05)", color: "var(--text-muted)", label: "Neutral Sentiment" };
    }
  };

  return (
    <div>
      <div className="saas-card">
        <div className="saas-card-header">
          <div className="saas-card-title">
            <PhoneCall size={18} color="var(--sarvam-orange)" />
            <span>Voice Call Logs & Post-Call AI Summaries</span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={fetchCalls}>
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="table-wrap">
          <table className="saas-table">
            <thead>
              <tr>
                <th>Call Session SID</th>
                <th>Participant / Phone</th>
                <th>Status</th>
                <th>AI Outcome Summary</th>
                <th>Duration</th>
                <th>Date & Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    Loading call history...
                  </td>
                </tr>
              ) : !calls.length ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    No call logs recorded yet.
                  </td>
                </tr>
              ) : (
                calls.map((c) => {
                  const summary = parseSummary(c.summary);
                  const outcomeBadge = summary ? getOutcomeBadge(summary.outcome) : null;
                  return (
                    <tr key={c.id || c.call_sid}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-accent)" }}>
                        <strong>{c.call_sid}</strong>
                      </td>
                      <td style={{ fontWeight: 600 }}>{c.to_number || c.from_number || "Browser WebRTC"}</td>
                      <td>
                        <span className={`badge ${c.status === "COMPLETED" ? "badge-demo" : "badge-no-answer"}`}>
                          {c.status}
                        </span>
                      </td>
                      <td>
                        {summary ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                padding: "3px 9px",
                                borderRadius: "var(--radius-full)",
                                background: outcomeBadge.bg,
                                color: outcomeBadge.color,
                                border: `1px solid ${outcomeBadge.border}`,
                              }}
                            >
                              {outcomeBadge.label}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: "11px", color: "var(--text-light)" }}>Turn log only</span>
                        )}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}>
                        {c.duration_seconds || 0}s
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                        {new Date(c.start_time).toLocaleString()}
                      </td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setActiveTranscript(c)}
                        >
                          <FileText size={13} color="var(--sarvam-orange)" />
                          <span>View Analysis ({(c.turns || []).length})</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── TRANSCRIPT & AI SUMMARY MODAL ── */}
      {activeTranscript && (() => {
        const summary = parseSummary(activeTranscript.summary);
        const outcomeBadge = summary ? getOutcomeBadge(summary.outcome) : null;
        const sentimentPill = summary ? getSentimentPill(summary.sentiment) : null;

        return (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "680px" }}>
              <div className="modal-header">
                <div>
                  <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>Call Session: {activeTranscript.call_sid}</span>
                  </h3>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px", fontFamily: "var(--font-mono)" }}>
                    Duration: {activeTranscript.duration_seconds || 0}s • Started:{" "}
                    {new Date(activeTranscript.start_time).toLocaleString()}
                  </div>
                </div>
                <button className="modal-close" onClick={() => setActiveTranscript(null)}>
                  <X size={18} />
                </button>
              </div>

              {/* AI Post-Call Summary Card */}
              {summary && (
                <div
                  style={{
                    background: "linear-gradient(135deg, rgba(255, 107, 53, 0.08) 0%, rgba(79, 70, 229, 0.08) 100%)",
                    border: "1px solid rgba(255, 107, 53, 0.3)",
                    borderRadius: "var(--radius-lg)",
                    padding: "18px",
                    marginBottom: "18px",
                    boxShadow: "0 8px 24px -6px rgba(255, 107, 53, 0.15)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Brain size={17} color="var(--sarvam-orange)" />
                      <strong style={{ fontSize: "13.5px", color: "var(--text-accent)" }}>
                        AI Cognitive Post-Call Analysis
                      </strong>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: "var(--radius-full)",
                          background: outcomeBadge.bg,
                          color: outcomeBadge.color,
                          border: `1px solid ${outcomeBadge.border}`,
                        }}
                      >
                        {outcomeBadge.label}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: "var(--radius-full)",
                          background: sentimentPill.bg,
                          color: sentimentPill.color,
                          border: `1px solid ${sentimentPill.color}40`,
                        }}
                      >
                        {sentimentPill.label}
                      </span>
                    </div>
                  </div>

                  {summary.next_action && (
                    <div
                      style={{
                        fontSize: "12.5px",
                        marginBottom: "12px",
                        padding: "10px 14px",
                        background: "var(--bg-card-subtle)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <strong style={{ color: "var(--text-muted)" }}>Recommended Action: </strong>
                      <span style={{ color: "var(--sarvam-orange)", fontWeight: 600 }}>{summary.next_action}</span>
                    </div>
                  )}

                  {summary.key_points && summary.key_points.length > 0 && (
                    <div style={{ marginBottom: "10px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.5px" }}>
                        Key Discussion Points:
                      </span>
                      <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: "12.5px", color: "var(--text-main)" }}>
                        {summary.key_points.map((pt, i) => (
                          <li key={i} style={{ marginBottom: "3px" }}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.objections && summary.objections.length > 0 && (
                    <div>
                      <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#f87171", letterSpacing: "0.5px" }}>
                        Objections Raised:
                      </span>
                      <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: "12.5px", color: "#f87171" }}>
                        {summary.objections.map((obj, i) => (
                          <li key={i}>{obj}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Turn-by-Turn Audio Transcript */}
              <div style={{ maxHeight: "360px", overflowY: "auto", paddingRight: "6px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.5px", marginBottom: "10px" }}>
                  Turn-by-Turn Conversation Transcript:
                </div>
                {!(activeTranscript.turns || []).length ? (
                  <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                    No audio turns recorded for this session.
                  </p>
                ) : (
                  activeTranscript.turns.map((t, idx) => (
                    <div
                      key={idx}
                      style={{
                        marginBottom: "10px",
                        padding: "12px 16px",
                        borderRadius: "var(--radius-md)",
                        background:
                          t.speaker === "USER"
                            ? "var(--bg-card-subtle)"
                            : "linear-gradient(135deg, rgba(255, 107, 53, 0.08), rgba(79, 70, 229, 0.08))",
                        border:
                          t.speaker === "USER"
                            ? "1px solid var(--border)"
                            : "1px solid rgba(255, 107, 53, 0.25)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "4px",
                        }}
                      >
                        <strong
                          style={{
                            fontSize: "11px",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            color: t.speaker === "USER" ? "var(--text-accent)" : "var(--sarvam-orange)",
                          }}
                        >
                          {t.speaker === "USER" ? "Caller / Prospect" : "Sarah (Voice AI Agent)"}:
                        </strong>
                        <span style={{ fontSize: "10px", color: "var(--text-light)", fontFamily: "var(--font-mono)" }}>
                          {t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      <p style={{ fontSize: "13.5px", color: "var(--text-main)", lineHeight: "1.5", margin: 0 }}>
                        {t.text}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="modal-footer" style={{ marginTop: "20px" }}>
                <button className="btn btn-outline" onClick={() => setActiveTranscript(null)}>
                  Close Analysis
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
