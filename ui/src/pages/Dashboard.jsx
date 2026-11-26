import React, { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import {
  Users,
  CalendarCheck,
  PhoneCall,
  PhoneOff,
  TrendingUp,
  Sparkles,
  ArrowRight,
  Radio,
  Zap,
  Smile,
  Meh,
  Frown,
  HeartHandshake,
  Clock,
  UserX,
  Activity,
  Cpu,
  Layers,
  Mic,
} from "lucide-react";
import { api } from "../services/api";
import VoiceOrb3D from "../components/VoiceOrb3D";

export default function Dashboard({ setActiveTab }) {
  const [stats, setStats] = useState({
    total_leads: 0,
    demos_booked: 0,
    total_calls: 0,
    calls_connected: 0,
    calls_not_picked: 0,
    conversion_rate: 0,
    sentiment: {
      total_analyzed: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      positive_pct: 0,
      neutral_pct: 0,
      negative_pct: 0,
      genuine_connections: 0,
      early_dropoffs: 0,
      ai_resistance: 0,
      connection_health: "Analyzing...",
    },
  });
  const [recentCalls, setRecentCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastLiveEvent, setLastLiveEvent] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    fetchDashboardData();
    setupWebSocket();

    return () => {
      // Stop the onclose handler from scheduling a reconnect after leaving the page.
      unmountedRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [s, c] = await Promise.all([api.getStats(), api.getCalls()]);
      setStats(s);
      setRecentCalls((c || []).slice(0, 8));
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const setupWebSocket = () => {
    const token = localStorage.getItem("voice_agent_jwt");
    if (!token) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws/dashboard?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === "STATS_UPDATE" && data.payload) {
            setStats(data.payload);
            setLastLiveEvent("KPIs & Sentiment Updated");
          } else if (data.event === "DEMO_BOOKED") {
            setStats((prev) => ({
              ...prev,
              demos_booked: (prev.demos_booked || 0) + 1,
            }));
            setLastLiveEvent(`🎉 Demo booked for ${data.payload?.name || "Caller"}!`);
            fetchDashboardData();
          } else if (data.event === "CALL_STARTED") {
            setLastLiveEvent(`📞 Call started: ${data.payload?.to || "Browser"}`);
            fetchDashboardData();
          } else if (data.event === "CALL_ENDED" || data.event === "CALL_UPDATED") {
            setLastLiveEvent("Call ended & sentiment analyzed");
            fetchDashboardData();
          } else if (data.event === "LEAD_ADDED" || data.event === "LEAD_DELETED") {
            fetchDashboardData();
          }
        } catch (e) {
          console.debug("WS parse error:", e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (unmountedRef.current) return;
        reconnectTimeoutRef.current = setTimeout(() => {
          setupWebSocket();
        }, 5000);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    } catch (err) {
      console.error("WebSocket setup error:", err);
    }
  };

  const sentiment = stats.sentiment || {
    total_analyzed: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
    positive_pct: 0,
    neutral_pct: 0,
    negative_pct: 0,
    genuine_connections: 0,
    early_dropoffs: 0,
    ai_resistance: 0,
    connection_health: "Analyzing...",
  };

  const kpis = [
    {
      label: "Total Leads",
      value: stats.total_leads,
      badge: "In Database",
      icon: Users,
      color: "var(--sarvam-indigo)",
      bg: "rgba(79, 70, 229, 0.15)",
    },
    {
      label: "5-Min Demos Booked",
      value: stats.demos_booked,
      badge: "Phone Callbacks",
      icon: CalendarCheck,
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.15)",
    },
    {
      label: "Calls Connected",
      value: stats.calls_connected,
      badge: "Answered",
      icon: PhoneCall,
      color: "var(--sarvam-cyan)",
      bg: "rgba(6, 182, 212, 0.15)",
    },
    {
      label: "Calls Not Picked / Busy",
      value: stats.calls_not_picked,
      badge: "AMD Filtered",
      icon: PhoneOff,
      color: "var(--sarvam-amber)",
      bg: "rgba(245, 158, 11, 0.15)",
    },
    {
      label: "Conversion Rate",
      value: `${stats.conversion_rate}%`,
      badge: "Demo / Lead",
      icon: TrendingUp,
      color: "var(--sarvam-orange)",
      bg: "rgba(255, 107, 53, 0.15)",
    },
  ];

  const parseCallSummary = (summaryStr) => {
    if (!summaryStr) return null;
    try {
      if (typeof summaryStr === "object") return summaryStr;
      return JSON.parse(summaryStr);
    } catch {
      return null;
    }
  };

  const getCallReactionBadge = (call) => {
    const summary = parseCallSummary(call.summary);
    const duration = call.duration_seconds || 0;

    if (summary) {
      if (summary.ai_hesitation || summary.connection_status === "DISMISSED_AS_AI") {
        return {
          label: "Dismissed as AI",
          bg: "rgba(244, 63, 94, 0.15)",
          color: "#f87171",
          icon: UserX,
        };
      }
      if (summary.connection_status === "EARLY_HANGUP" || duration < 12) {
        return {
          label: `Cut Early (${duration}s)`,
          bg: "rgba(245, 158, 11, 0.15)",
          color: "#fbbf24",
          icon: Clock,
        };
      }
      if (summary.sentiment === "POSITIVE" || summary.outcome === "DEMO_BOOKED") {
        return {
          label: "Genuine Connection",
          bg: "rgba(16, 185, 129, 0.15)",
          color: "#34d399",
          icon: Smile,
        };
      }
      if (summary.sentiment === "NEGATIVE") {
        return {
          label: "Not Interested",
          bg: "rgba(255, 255, 255, 0.05)",
          color: "var(--text-muted)",
          icon: Frown,
        };
      }
      return {
        label: "Neutral Inquiry",
        bg: "rgba(79, 70, 229, 0.12)",
        color: "#a5b4fc",
        icon: Meh,
      };
    }

    if (duration > 25 && call.status === "COMPLETED") {
      return {
        label: "Engaged Talk",
        bg: "rgba(16, 185, 129, 0.15)",
        color: "#34d399",
        icon: Smile,
      };
    }
    if (duration > 0 && duration < 12) {
      return {
        label: `Quick Drop (${duration}s)`,
        bg: "rgba(245, 158, 11, 0.15)",
        color: "#fbbf24",
        icon: Clock,
      };
    }
    return {
      label: call.status === "COMPLETED" ? "Connected" : "No Answer",
      bg: "rgba(255, 255, 255, 0.05)",
      color: "var(--text-light)",
      icon: Meh,
    };
  };

  return (
    <div>
      {/* ── TOP LIVE INFRASTRUCTURE STREAM STATUS ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          padding: "10px 18px",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-glass)",
          backdropFilter: "blur(16px)",
          border: "1px solid var(--border)",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: wsConnected ? "#10b981" : "#f59e0b",
              boxShadow: wsConnected ? "0 0 10px #10b981" : "none",
            }}
          />
          <span style={{ fontWeight: 700, color: "var(--text-accent)", letterSpacing: "0.2px" }}>
            {wsConnected ? "Live Redis Pub/Sub WebSocket: Connected" : "Connecting to Live Event Bus..."}
          </span>
          <span style={{ color: "var(--text-light)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
            • Redis Cached (30s TTL)
          </span>
        </div>
        {lastLiveEvent && (
          <div
            style={{
              color: "var(--sarvam-orange)",
              fontWeight: 700,
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontFamily: "var(--font-mono)",
            }}
          >
            <Activity size={12} />
            <span>{lastLiveEvent}</span>
          </div>
        )}
      </div>

      {/* ── SARVAM-INSPIRED HERO ACTION BANNER ── */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255, 107, 53, 0.12) 0%, rgba(245, 158, 11, 0.08) 25%, rgba(79, 70, 229, 0.15) 70%, rgba(6, 182, 212, 0.08) 100%)",
          borderRadius: "var(--radius-xl)",
          padding: "28px 32px",
          border: "1px solid rgba(255, 107, 53, 0.3)",
          boxShadow: "0 20px 40px -15px rgba(255, 107, 53, 0.15)",
          marginBottom: "28px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient Top Glow */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: "10%",
            width: "300px",
            height: "100px",
            background: "radial-gradient(circle, rgba(255, 107, 53, 0.25) 0%, transparent 70%)",
            filter: "blur(40px)",
            pointerEvents: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "20px", position: "relative", zIndex: 2 }}>
          <div style={{ maxWidth: "680px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "var(--radius-full)", background: "rgba(255, 107, 53, 0.15)", border: "1px solid rgba(255, 107, 53, 0.3)", color: "var(--sarvam-orange)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "10px" }}>
              <Radio size={12} className="pulse" />
              <span>Sovereign Voice AI Infrastructure</span>
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-0.5px",
                margin: "0 0 6px 0",
              }}
            >
              Sarah — Ultra-Low Latency Indian B2B Voice Calling Engine
            </h2>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", margin: 0, lineHeight: "1.5" }}>
              Sub-120ms conversational AI trained for Indian business dialects (English + Hinglish). Connects via WebRTC UDP/Opus & Exotel PSTN, qualifies owners, and books 5-minute phone demos automatically.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
            <div style={{ filter: "drop-shadow(0 0 25px rgba(255, 107, 53, 0.35))" }}>
              <VoiceOrb3D size={130} isActive={true} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="btn btn-primary"
                onClick={() => window.dispatchEvent(new CustomEvent("open:voice-studio"))}
                style={{
                  background: "linear-gradient(135deg, var(--sarvam-orange), #ea580c)",
                  boxShadow: "0 4px 16px var(--sarvam-orange-glow)",
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  fontWeight: 700,
                }}
              >
                <Mic size={15} />
                <span>Test Voice Agent (Live)</span>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="btn btn-outline"
                onClick={() => setActiveTab("content")}
              >
                <Zap size={14} />
                <span>Customize Script</span>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="btn btn-outline"
                onClick={() => setActiveTab("contacts")}
              >
                <span>Manage Leads</span>
                <ArrowRight size={14} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI METRICS CARDS ── */}
      <div className="kpi-grid">
        {kpis.map((k, idx) => {
          const Icon = k.icon;
          return (
            <motion.div
              key={idx}
              className="kpi-card"
              whileHover={{ scale: 1.025, translateY: -3 }}
              transition={{ type: "spring", stiffness: 350, damping: 20 }}
            >
              <div>
                <span className="kpi-label">{k.label}</span>
                <div className="kpi-value">{loading ? "..." : k.value}</div>
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: "var(--radius-full)",
                    background: k.bg,
                    color: k.color,
                    border: `1px solid ${k.color}33`,
                    letterSpacing: "0.3px",
                  }}
                >
                  {k.badge}
                </span>
              </div>
              <div
                className="kpi-icon"
                style={{
                  background: k.bg,
                  color: k.color,
                  borderColor: `${k.color}40`,
                  boxShadow: `0 0 16px ${k.color}25`,
                }}
              >
                <Icon size={20} />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── 🧠 CUSTOMER SENTIMENT & AI CONNECTION INTELLIGENCE PANEL (SARVAM STYLE) ── */}
      <div
        className="saas-card"
        style={{
          border: "1px solid rgba(79, 70, 229, 0.35)",
          background: "linear-gradient(180deg, rgba(18, 24, 38, 0.95) 0%, rgba(13, 17, 26, 0.95) 100%)",
          boxShadow: "0 12px 30px -10px rgba(79, 70, 229, 0.15)",
        }}
      >
        <div className="saas-card-header" style={{ borderBottomColor: "rgba(255, 255, 255, 0.06)" }}>
          <div>
            <div className="saas-card-title">
              <HeartHandshake size={19} color="var(--sarvam-orange)" />
              <span>Caller Sentiment & Real Connection Quality</span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
              Cognitive telemetry analyzing whether business owners are genuinely connecting with Sarah or hanging up / resisting the AI voice.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                padding: "4px 12px",
                borderRadius: "var(--radius-full)",
                background: sentiment.positive_pct >= 50 ? "var(--emerald-bg)" : "var(--amber-bg)",
                color: sentiment.positive_pct >= 50 ? "#34d399" : "#fbbf24",
                border: `1px solid ${sentiment.positive_pct >= 50 ? "#10b98140" : "#f59e0b40"}`,
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <span className="live-dot" style={{ width: "6px", height: "6px", background: sentiment.positive_pct >= 50 ? "#10b981" : "#f59e0b" }}></span>
              <span>Health: {sentiment.connection_health}</span>
            </span>
          </div>
        </div>

        <div style={{ padding: "24px 28px" }}>
          {/* Multi-Segment Sentiment Distribution Bar */}
          <div style={{ marginBottom: "22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 700, marginBottom: "8px", flexWrap: "wrap", gap: "10px" }}>
              <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                <Smile size={14} /> Genuine Connection: {sentiment.positive_pct}% ({sentiment.positive} calls)
              </span>
              <span style={{ color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                <Meh size={14} /> Neutral Inquiry: {sentiment.neutral_pct}% ({sentiment.neutral} calls)
              </span>
              <span style={{ color: "#f87171", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                <Frown size={14} /> Early Cut / Resistance: {sentiment.negative_pct}% ({sentiment.negative} calls)
              </span>
            </div>

            <div
              style={{
                height: "10px",
                width: "100%",
                borderRadius: "var(--radius-full)",
                background: "rgba(255, 255, 255, 0.05)",
                overflow: "hidden",
                display: "flex",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  width: `${sentiment.positive_pct}%`,
                  background: "linear-gradient(90deg, #10b981, #059669)",
                  boxShadow: "0 0 10px rgba(16, 185, 129, 0.4)",
                  transition: "width 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
              <div
                style={{
                  width: `${sentiment.neutral_pct}%`,
                  background: "rgba(255, 255, 255, 0.2)",
                  transition: "width 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
              <div
                style={{
                  width: `${sentiment.negative_pct}%`,
                  background: "linear-gradient(90deg, #f43f5e, #e11d48)",
                  boxShadow: "0 0 10px rgba(244, 63, 94, 0.4)",
                  transition: "width 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
            </div>
          </div>

          {/* 4 Connection Diagnostic Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "14px" }}>
            <div style={{ padding: "16px", borderRadius: "var(--radius-lg)", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#34d399", marginBottom: "6px" }}>
                <Smile size={16} />
                <span style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Deep Engagement
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-accent)" }}>
                {sentiment.genuine_connections} calls
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-light)", marginTop: "2px" }}>
                Callers actively discussing value & demos
              </div>
            </div>

            <div style={{ padding: "16px", borderRadius: "var(--radius-lg)", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#fbbf24", marginBottom: "6px" }}>
                <Clock size={16} />
                <span style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Early Drops (&lt;15s)
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-accent)" }}>
                {sentiment.early_dropoffs} calls
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-light)", marginTop: "2px" }}>
                Hung up immediately before pitch
              </div>
            </div>

            <div style={{ padding: "16px", borderRadius: "var(--radius-lg)", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#f87171", marginBottom: "6px" }}>
                <UserX size={16} />
                <span style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  AI Bot Pushback
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-accent)" }}>
                {sentiment.ai_resistance} calls
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-light)", marginTop: "2px" }}>
                Asked "Is this AI?" or dismissed bot
              </div>
            </div>

            <div style={{ padding: "16px", borderRadius: "var(--radius-lg)", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--sarvam-orange)", marginBottom: "6px" }}>
                <TrendingUp size={16} />
                <span style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Connection Ratio
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-accent)" }}>
                {sentiment.positive_pct}% : {sentiment.negative_pct}%
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-light)", marginTop: "2px" }}>
                Positive engagement vs AI resistance
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── RECENT CALL SESSIONS TABLE ── */}
      <div className="saas-card">
        <div className="saas-card-header">
          <div className="saas-card-title">
            <PhoneCall size={18} color="var(--sarvam-orange)" />
            <span>Recent Voice Call Sessions & Telemetry</span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setActiveTab("calls")}>
            View All Calls & Transcripts
          </button>
        </div>

        <div className="table-wrap">
          <table className="saas-table">
            <thead>
              <tr>
                <th>Call Session SID</th>
                <th>Participant / Phone</th>
                <th>Call Status</th>
                <th>Caller Reaction & Sentiment</th>
                <th>Duration</th>
                <th>Date & Time</th>
              </tr>
            </thead>
            <tbody>
              {!recentCalls.length ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    No call sessions recorded yet. Click "Live Agent Studio" in the navbar to test Sarah in real time!
                  </td>
                </tr>
              ) : (
                recentCalls.map((c) => {
                  const badge = getCallReactionBadge(c);
                  const Icon = badge.icon;
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
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "4px 10px",
                            borderRadius: "var(--radius-full)",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.color}33`,
                          }}
                        >
                          <Icon size={12} />
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}>
                        {c.duration_seconds || 0}s
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                        {new Date(c.start_time).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
