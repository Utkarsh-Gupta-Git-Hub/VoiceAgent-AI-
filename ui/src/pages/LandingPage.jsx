import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Radio,
  Sparkles,
  Zap,
  ShieldCheck,
  PhoneCall,
  Volume2,
  VolumeX,
  Play,
  Pause,
  ExternalLink,
  ArrowRight,
  Sun,
  Moon,
  Activity,
  CheckCircle2,
  Lock,
  Cpu,
  Layers,
  CalendarCheck,
  Smile,
  Mic,
  X,
  Loader2,
} from "lucide-react";
import { Room, RoomEvent } from "livekit-client";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import VoiceOrb3D from "../components/VoiceOrb3D";

export default function LandingPage({ onLaunchConsole }) {
  const { isAuthenticated, user, setShowAuthModal } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [activeDialect, setActiveDialect] = useState("b2b");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showWebRTCDemo, setShowWebRTCDemo] = useState(false);
  const [demoDuration, setDemoDuration] = useState(0);
  const [demoActive, setDemoActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Ready to test speech pipeline");
  const [errorMessage, setErrorMessage] = useState(null);

  const timerRef = useRef(null);
  const roomRef = useRef(null);
  const audioElementsRef = useRef([]);

  const sampleAudios = {
    b2b: {
      title: "Indian Enterprise B2B (English)",
      description: "Fast-paced, professional qualification for SaaS decision makers.",
      dialogue:
        "“Hi! This is Sarah calling from VoiceAgent AI. I noticed your team is managing outbound customer callbacks. We help Indian enterprises automate calls with under 120ms latency. Would you be open to a quick 5-minute phone demo this Thursday?”",
    },
    hinglish: {
      title: "Hinglish Conversational (Hindi + English)",
      description: "Natural colloquial Hindi-English mixed dialect for high-trust qualification.",
      dialogue:
        "“Namaste! Sarah baat kar rahi hoon VoiceAgent AI se. Sir, aapke business ke outbound customer leads ke liye hamara AI agent directly phone call karke qualified bookings karwa deta hai. Kya aapko Thursday 3 baje 5-minute ka quick phone demo check karna hai?”",
    },
    holiday: {
      title: "Seasonal Campaign (New Year / Christmas)",
      description: "Custom holiday greetings and targeted festive promotion pitch.",
      dialogue:
        "“Happy New Year! This is Sarah from VoiceAgent AI. We are rolling out our 2026 festive voice automation bundle with zero per-minute telecom overhead. Can I book a quick 5-minute demo to show you how our agents qualify leads in real time?”",
    },
  };

  const handleTogglePlay = () => {
    setIsPlayingAudio((prev) => !prev);
  };

  const startDemoCall = async () => {
    try {
      setIsConnecting(true);
      setErrorMessage(null);
      setConnectionStatus("Requesting LiveKit connection...");

      // 1. Fetch token
      const roomName = `room_landing_${Date.now().toString(36)}`;
      const participantName = user?.full_name || "Demo Visitor";
      const tokenData = await api.getLiveKitToken(roomName, participantName);

      if (!tokenData || !tokenData.token) {
        throw new Error("Could not retrieve LiveKit connection token");
      }

      setConnectionStatus("Connecting to LiveKit WebRTC...");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === "audio") {
          const el = track.attach();
          el.autoplay = true;
          document.body.appendChild(el);
          audioElementsRef.current.push(el);

          // Block microphone while agent is speaking to prevent disruption/echo
          el.onplaying = () => {
            setIsAgentSpeaking(true);
            setConnectionStatus("Sarah is speaking...");
            if (room.localParticipant) {
              room.localParticipant.setMicrophoneEnabled(false);
            }
          };

          // Quick turn on microphone after agent finishes delivery
          el.onended = () => {
            setIsAgentSpeaking(false);
            setConnectionStatus("Listening to your mic...");
            if (room.localParticipant) {
              room.localParticipant.setMicrophoneEnabled(true);
            }
          };

          el.onpause = () => {
            setIsAgentSpeaking(false);
            setConnectionStatus("Listening to your mic...");
            if (room.localParticipant) {
              room.localParticipant.setMicrophoneEnabled(true);
            }
          };
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => {
          try {
            el.pause();
            el.remove();
          } catch (_) {}
        });
        setIsAgentSpeaking(false);
        setConnectionStatus("Listening to your mic...");
        if (room.localParticipant) {
          room.localParticipant.setMicrophoneEnabled(true);
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const hasAgent = speakers.some((s) => !s.isLocal);
        setIsAgentSpeaking(hasAgent);
        if (room.localParticipant) {
          if (hasAgent) {
            // Block mic while agent speaks
            room.localParticipant.setMicrophoneEnabled(false);
            setConnectionStatus("Sarah is speaking...");
          } else {
            // Instantly re-enable mic once agent finishes speaking
            room.localParticipant.setMicrophoneEnabled(true);
            setConnectionStatus("Listening to your mic...");
          }
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        endDemoCall();
      });

      // 2. Connect to room & enable microphone
      await room.connect(tokenData.serverUrl, tokenData.token);
      setConnectionStatus("Activating microphone...");
      await room.localParticipant.setMicrophoneEnabled(true);

      roomRef.current = room;
      setDemoActive(true);
      setIsConnecting(false);
      setConnectionStatus("Connected • Speak in English or Hinglish");

      setDemoDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setDemoDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error("LiveKit connection error:", err);
      endDemoCall();
      setIsConnecting(false);
      const isMicDenied =
        err.name === "NotAllowedError" ||
        (err.message && err.message.toLowerCase().includes("permission denied"));

      if (isMicDenied) {
        setErrorMessage(
          "Microphone access blocked: Please click the lock or settings icon next to http://localhost:5173 in your address bar and allow Microphone access."
        );
      } else {
        setErrorMessage(err.message || "Failed to connect to Sarah's voice stream");
      }
    }
  };

  const endDemoCall = () => {
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch (_) {}
      roomRef.current = null;
    }
    audioElementsRef.current.forEach((el) => {
      try {
        el.pause();
        el.remove();
      } catch (_) {}
    });
    audioElementsRef.current = [];
    setDemoActive(false);
    setIsConnecting(false);
    setIsAgentSpeaking(false);
    setConnectionStatus("Ready to test speech pipeline");
    if (timerRef.current) clearInterval(timerRef.current);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (roomRef.current) {
        try {
          roomRef.current.disconnect();
        } catch (_) {}
      }
      audioElementsRef.current.forEach((el) => {
        try {
          el.pause();
          el.remove();
        } catch (_) {}
      });
      audioElementsRef.current = [];
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-main)", color: "var(--text-main)", position: "relative", overflowX: "hidden" }}>
      {/* ── TOP NAV BAR ── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          height: "72px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 40px",
          background: "var(--bg-topbar)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Brand Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, var(--sarvam-orange) 0%, #ea580c 40%, var(--sarvam-indigo) 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              boxShadow: "0 0 16px var(--sarvam-orange-glow)",
            }}
          >
            <Radio size={20} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: "19px", fontWeight: 800, color: "var(--text-accent)" }}>
                VoiceAgent
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: "4px",
                  background: "linear-gradient(135deg, var(--sarvam-orange), var(--sarvam-indigo))",
                  color: "#ffffff",
                  letterSpacing: "0.5px",
                }}
              >
                AI
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 500, letterSpacing: "0.3px" }}>
              Sovereign Indic Voice Stack
            </div>
          </div>
        </div>

        {/* Center Nav Links */}
        <nav style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <a href="#technology" style={{ textDecoration: "none", color: "var(--text-muted)", fontSize: "13.5px", fontWeight: 600, transition: "var(--transition)" }}>
            Technology
          </a>
          <a href="#audio-demo" style={{ textDecoration: "none", color: "var(--text-muted)", fontSize: "13.5px", fontWeight: 600, transition: "var(--transition)" }}>
            Speech AI Demo
          </a>
          <a href="#features" style={{ textDecoration: "none", color: "var(--text-muted)", fontSize: "13.5px", fontWeight: 600, transition: "var(--transition)" }}>
            Platform Features
          </a>
          <a href="#architecture" style={{ textDecoration: "none", color: "var(--text-muted)", fontSize: "13.5px", fontWeight: 600, transition: "var(--transition)" }}>
            Architecture
          </a>
          <a href="/docs" target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "var(--text-muted)", fontSize: "13.5px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
            <span>API Docs</span>
            <ExternalLink size={12} />
          </a>
        </nav>

        {/* Right CTA Area */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Theme Toggle */}
          <button
            className="btn btn-outline btn-sm"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            style={{
              padding: "7px 12px",
              borderRadius: "var(--radius-full)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {theme === "dark" ? (
              <>
                <Sun size={14} color="#f59e0b" />
                <span style={{ fontSize: "11.5px", fontWeight: 700 }}>Light</span>
              </>
            ) : (
              <>
                <Moon size={14} color="#6366f1" />
                <span style={{ fontSize: "11.5px", fontWeight: 700 }}>Dark</span>
              </>
            )}
          </button>

          {isAuthenticated ? (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="btn btn-primary btn-sm"
              onClick={onLaunchConsole}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px" }}
            >
              <span>Launch Console</span>
              <ArrowRight size={14} />
            </motion.button>
          ) : (
            <>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setShowAuthModal(true)}
                style={{ padding: "8px 16px" }}
              >
                Sign In
              </button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="btn btn-primary btn-sm"
                onClick={() => setShowAuthModal(true)}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 18px" }}
              >
                <Sparkles size={14} />
                <span>Get Started</span>
              </motion.button>
            </>
          )}
        </div>
      </header>

      {/* ── HERO SECTION ── */}
      <section
        style={{
          padding: "70px 40px 90px 40px",
          maxWidth: "1240px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1.15fr 0.85fr",
          alignItems: "center",
          gap: "50px",
          position: "relative",
        }}
      >
        {/* Subtle Ambient Glow */}
        <div
          style={{
            position: "absolute",
            top: "5%",
            left: "20%",
            width: "500px",
            height: "300px",
            background: "radial-gradient(circle, rgba(255, 107, 53, 0.15) 0%, rgba(79, 70, 229, 0.1) 50%, transparent 80%)",
            filter: "blur(80px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        {/* Hero Left Content */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "5px 14px",
              borderRadius: "var(--radius-full)",
              background: "rgba(255, 107, 53, 0.12)",
              border: "1px solid rgba(255, 107, 53, 0.3)",
              color: "var(--sarvam-orange)",
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.8px",
              marginBottom: "20px",
            }}
          >
            <Radio size={13} className="pulse" />
            <span>Sovereign Voice AI Stack for India & Enterprise</span>
          </div>

          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "52px",
              fontWeight: 800,
              color: "var(--text-accent)",
              letterSpacing: "-1.5px",
              lineHeight: 1.12,
              marginBottom: "20px",
            }}
          >
            Conversational Voice AI Built for{" "}
            <span
              style={{
                background: "linear-gradient(135deg, var(--sarvam-orange) 0%, #f59e0b 50%, var(--sarvam-indigo) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Indian Business Dialects
            </span>
          </h1>

          <p
            style={{
              fontSize: "17px",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              marginBottom: "32px",
              maxWidth: "560px",
            }}
          >
            Sub-120ms conversational speech intelligence capable of fluent English and Hinglish nuance. Automated B2B lead qualification, instant 5-minute phone callback scheduling, and enterprise dual-layer prompt security.
          </p>

          {/* Action CTAs */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", marginBottom: "40px" }}>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="btn btn-primary"
              onClick={() => setShowWebRTCDemo(true)}
              style={{ padding: "13px 26px", fontSize: "14.5px" }}
            >
              <Mic size={16} />
              <span>Test Live Voice (WebRTC)</span>
            </motion.button>

            {isAuthenticated ? (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="btn btn-indigo"
                onClick={onLaunchConsole}
                style={{ padding: "13px 24px", fontSize: "14.5px" }}
              >
                <span>Enter Admin Console</span>
                <ArrowRight size={16} />
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="btn btn-outline"
                onClick={() => setShowAuthModal(true)}
                style={{ padding: "13px 24px", fontSize: "14.5px" }}
              >
                <span>Sign In / Create Account</span>
              </motion.button>
            )}
          </div>

          {/* Key Assurance Badges */}
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--text-muted)" }}>
              <CheckCircle2 size={16} color="#10b981" />
              <span>Sub-120ms Time-to-First-Audio</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--text-muted)" }}>
              <ShieldCheck size={16} color="var(--sarvam-orange)" />
              <span>PromptGuard Dual-Layer Immunity</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--text-muted)" }}>
              <Zap size={16} color="#06b6d4" />
              <span>Zero Virtual DIDs needed via WebRTC</span>
            </div>
          </div>
        </div>

        {/* Hero Right Visual: 3D Neural Voice Orb with Floating Telemetry */}
        <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div
            style={{
              padding: "20px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255, 107, 53, 0.12) 0%, rgba(79, 70, 229, 0.08) 60%, transparent 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <VoiceOrb3D size={320} isActive={true} isSpeaking={demoActive} />
          </div>

          {/* Floating Pill 1: Latency */}
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            style={{
              position: "absolute",
              top: "10%",
              right: "0",
              background: "var(--bg-glass)",
              backdropFilter: "blur(16px)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 10px #10b981" }} />
            <div>
              <div style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>Streaming Latency</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--text-accent)" }}>~118ms (FastAPI Opus)</div>
            </div>
          </motion.div>

          {/* Floating Pill 2: Security */}
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            style={{
              position: "absolute",
              bottom: "10%",
              left: "0",
              background: "var(--bg-glass)",
              backdropFilter: "blur(16px)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <ShieldCheck size={18} color="var(--sarvam-orange)" />
            <div>
              <div style={{ fontSize: "11px", color: "var(--text-light)", fontWeight: 600 }}>PromptGuard Active</div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-accent)" }}>Zero Injection Leaks</div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── METRICS STRIP ── */}
      <section style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
        <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "32px 40px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "36px", fontWeight: 800, color: "var(--sarvam-orange)" }}>
              &lt; 120ms
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
              Time-to-First-Audio voice turnaround
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "36px", fontWeight: 800, color: "var(--sarvam-indigo)" }}>
              10+
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
              Indic dialects & conversational Hinglish
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "36px", fontWeight: 800, color: "#10b981" }}>
              100%
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
              Prompt injection immunity (Regex & heuristics)
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "36px", fontWeight: 800, color: "#06b6d4" }}>
              99.98%
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
              Dual WebRTC + Exotel carrier uptime
            </div>
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE SPEECH & DIALECT SHOWCASE ── */}
      <section id="audio-demo" style={{ padding: "90px 40px", maxWidth: "1240px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--sarvam-orange)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
            <Sparkles size={14} />
            <span>Interactive Audio Demonstrator</span>
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "38px", fontWeight: 800, color: "var(--text-accent)", letterSpacing: "-1px", margin: "0 0 12px 0" }}>
            Experience Sarah's Conversational Nuance
          </h2>
          <p style={{ fontSize: "16px", color: "var(--text-muted)", maxWidth: "620px", margin: "0 auto" }}>
            Listen to how Sarah navigates business dialect switches, natural pauses, and holiday campaign scripts.
          </p>
        </div>

        {/* Dialect Selector Tabs */}
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "32px", flexWrap: "wrap" }}>
          {Object.keys(sampleAudios).map((key) => {
            const isSel = activeDialect === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setActiveDialect(key);
                  setIsPlayingAudio(false);
                }}
                className={`btn ${isSel ? "btn-primary" : "btn-outline"}`}
                style={{ borderRadius: "var(--radius-full)", padding: "10px 22px" }}
              >
                {sampleAudios[key].title}
              </button>
            );
          })}
        </div>

        {/* Audio Player Card */}
        <div
          className="saas-card"
          style={{
            maxWidth: "760px",
            margin: "0 auto",
            padding: "36px",
            border: "1px solid rgba(255, 107, 53, 0.3)",
            boxShadow: "var(--shadow-glow)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", margin: "0 0 4px 0" }}>
                {sampleAudios[activeDialect].title}
              </h3>
              <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
                {sampleAudios[activeDialect].description}
              </div>
            </div>

            {/* Play/Pause Button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleTogglePlay}
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--sarvam-orange), #ea580c)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                cursor: "pointer",
                boxShadow: "0 0 20px var(--sarvam-orange-glow)",
              }}
            >
              {isPlayingAudio ? <Pause size={20} /> : <Play size={20} style={{ marginLeft: "3px" }} />}
            </motion.button>
          </div>

          {/* Dialogue Transcript Bubble */}
          <div
            style={{
              padding: "20px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-card-subtle)",
              border: "1px solid var(--border)",
              fontStyle: "italic",
              fontSize: "15px",
              lineHeight: 1.6,
              color: "var(--text-main)",
              marginBottom: "20px",
            }}
          >
            {sampleAudios[activeDialect].dialogue}
          </div>

          {/* Sound Wave Animation Strip */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.2)", padding: "12px 18px", borderRadius: "var(--radius-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div className="soundwave-box" style={{ height: "20px" }}>
                <div className="soundwave-bar" style={{ animationPlayState: isPlayingAudio ? "running" : "paused" }}></div>
                <div className="soundwave-bar" style={{ animationPlayState: isPlayingAudio ? "running" : "paused" }}></div>
                <div className="soundwave-bar" style={{ animationPlayState: isPlayingAudio ? "running" : "paused" }}></div>
                <div className="soundwave-bar" style={{ animationPlayState: isPlayingAudio ? "running" : "paused" }}></div>
                <div className="soundwave-bar" style={{ animationPlayState: isPlayingAudio ? "running" : "paused" }}></div>
                <div className="soundwave-bar" style={{ animationPlayState: isPlayingAudio ? "running" : "paused" }}></div>
              </div>
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                {isPlayingAudio ? "Simulating Indian Neural Voice Synthesizer..." : "Click play to listen to speech sample"}
              </span>
            </div>

            <button className="btn btn-outline btn-sm" onClick={() => setShowWebRTCDemo(true)}>
              <Mic size={12} />
              <span>Talk Live Now</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── CORE CAPABILITY MODULES ── */}
      <section id="features" style={{ padding: "90px 40px", maxWidth: "1240px", margin: "0 auto", borderTop: "1px solid var(--border)" }}>
        <div style={{ textAlign: "center", marginBottom: "56px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--sarvam-indigo)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
            <Cpu size={14} />
            <span>Built For Production Scale</span>
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "38px", fontWeight: 800, color: "var(--text-accent)", letterSpacing: "-1px", margin: "0 0 12px 0" }}>
            Architected for Sovereign Indian Enterprise
          </h2>
          <p style={{ fontSize: "16px", color: "var(--text-muted)", maxWidth: "620px", margin: "0 auto" }}>
            Enterprise-grade modules designed to replace brittle telephony hacks with resilient, high-speed AI pipelines.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
          {/* Card 1 */}
          <div className="saas-card" style={{ padding: "28px" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(255, 107, 53, 0.15)", color: "var(--sarvam-orange)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
              <Zap size={20} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", marginBottom: "8px" }}>
              Sub-120ms Neural Streaming
            </h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              Full duplex audio streaming over WebSocket Opus frames. Eliminates unnatural dead air, allowing real-time barge-in and human turn-taking.
            </p>
          </div>

          {/* Card 2 */}
          <div className="saas-card" style={{ padding: "28px" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(79, 70, 229, 0.15)", color: "var(--sarvam-indigo)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
              <ShieldCheck size={20} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", marginBottom: "8px" }}>
              Dual-Layer PromptGuard
            </h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              Layer 1 neutralizes prompt injections, role-overrides, and DAN exploits in &lt;1ms. Layer 2 restricts output leaks, preventing credential disclosure.
            </p>
          </div>

          {/* Card 3 */}
          <div className="saas-card" style={{ padding: "28px" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
              <Sparkles size={20} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", marginBottom: "8px" }}>
              Seasonal Campaign Scripts
            </h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              1-click script activation for New Year, Diwali, Christmas, or custom launches. Dynamically adjusts the agent's greeting and pitch on the fly.
            </p>
          </div>

          {/* Card 4 */}
          <div className="saas-card" style={{ padding: "28px" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(6, 182, 212, 0.15)", color: "#06b6d4", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
              <Smile size={20} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", marginBottom: "8px" }}>
              Sentiment & Resistance Analytics
            </h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              Post-call cognitive AI analysis distinguishes genuine interest from early drop-offs (&lt;12s) and callers who pushed back against AI bots.
            </p>
          </div>

          {/* Card 5 */}
          <div className="saas-card" style={{ padding: "28px" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
              <Layers size={20} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", marginBottom: "8px" }}>
              Redis Event Bus & Live Telemetry
            </h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              Real-time WebSocket event fan-out with Redis caching and pub/sub. Decouples heavy SQLite/Postgres reads with graceful degradation.
            </p>
          </div>

          {/* Card 6 */}
          <div className="saas-card" style={{ padding: "28px" }}>
            <div style={{ width: "42px", height: "42px", borderRadius: "10px", background: "rgba(244, 63, 94, 0.15)", color: "#f43f5e", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "18px" }}>
              <PhoneCall size={20} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-accent)", marginBottom: "8px" }}>
              SIP Trunk Concurrency
            </h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              Overcomes single-DID retail locking. Supports 50+ concurrent channels per pilot number or zero-telephony-cost WebRTC direct audio.
            </p>
          </div>
        </div>
      </section>

      {/* ── CALL-TO-ACTION SECTION ── */}
      <section style={{ padding: "80px 40px", maxWidth: "1240px", margin: "0 auto" }}>
        <div
          style={{
            background: "linear-gradient(135deg, rgba(255, 107, 53, 0.15) 0%, rgba(79, 70, 229, 0.15) 100%)",
            border: "1px solid rgba(255, 107, 53, 0.35)",
            borderRadius: "var(--radius-xl)",
            padding: "50px",
            textAlign: "center",
            boxShadow: "var(--shadow-glow)",
          }}
        >
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "36px", fontWeight: 800, color: "var(--text-accent)", margin: "0 0 12px 0" }}>
            Ready to deploy Sovereign Voice AI?
          </h2>
          <p style={{ fontSize: "16px", color: "var(--text-muted)", maxWidth: "560px", margin: "0 auto 32px auto", lineHeight: 1.6 }}>
            Launch automated campaigns, qualify inbound leads, and protect your brand with dual-layer prompt security.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
            {isAuthenticated ? (
              <button className="btn btn-primary" onClick={onLaunchConsole} style={{ padding: "13px 28px", fontSize: "15px" }}>
                <span>Open Voice Console</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setShowAuthModal(true)} style={{ padding: "13px 28px", fontSize: "15px" }}>
                <span>Create Free Account / Sign In</span>
                <ArrowRight size={16} />
              </button>
            )}
            <button className="btn btn-outline" onClick={() => setShowWebRTCDemo(true)} style={{ padding: "13px 24px", fontSize: "15px" }}>
              <Mic size={16} />
              <span>Test Live Agent Mic</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "40px", background: "var(--bg-card)" }}>
        <div style={{ maxWidth: "1240px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, var(--sarvam-orange), var(--sarvam-indigo))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <Radio size={16} />
            </div>
            <span style={{ fontWeight: 800, color: "var(--text-accent)", fontSize: "15px" }}>VoiceAgent AI</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>• Inspired by Sarvam Sovereign Stack</span>
          </div>
          <div style={{ display: "flex", gap: "24px", fontSize: "13px", color: "var(--text-muted)" }}>
            <a href="/docs" target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>Documentation</a>
            <a href="#features" style={{ textDecoration: "none", color: "inherit" }}>Security Guardrails</a>
            <span style={{ cursor: "pointer" }} onClick={() => setShowAuthModal(true)}>Sign In / Register</span>
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-light)" }}>
            © 2026 VoiceAgent AI Platform. Built with Python, React 19 & WebGL.
          </div>
        </div>
      </footer>

      {/* ── LIVE WEBRTC DEMO STUDIO MODAL ── */}
      {showWebRTCDemo && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: "520px", textAlign: "center", padding: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Radio size={18} color="var(--sarvam-orange)" />
                <h3 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "var(--text-accent)" }}>
                  Sarah Live Voice WebRTC Test
                </h3>
              </div>
              <button
                className="modal-close"
                onClick={() => {
                  endDemoCall();
                  setShowWebRTCDemo(false);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
              <VoiceOrb3D size={180} isActive={true} isSpeaking={isAgentSpeaking} />
            </div>

            <h4 style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-accent)", margin: "0 0 6px 0" }}>
              Sarah (VoiceAgent AI)
            </h4>

            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
              {demoActive && (
                <span
                  className="live-dot"
                  style={{ background: isAgentSpeaking ? "var(--sarvam-orange)" : "#34d399" }}
                ></span>
              )}
              <p style={{ fontSize: "13px", color: isAgentSpeaking ? "var(--sarvam-orange)" : (demoActive ? "#34d399" : "var(--text-muted)"), margin: 0, fontWeight: demoActive ? 600 : 400 }}>
                {connectionStatus}
              </p>
            </div>

            {errorMessage && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#ef4444",
                  fontSize: "12px",
                  marginBottom: "16px",
                  textAlign: "center",
                }}
              >
                {errorMessage}
              </div>
            )}

            {demoActive && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "28px", fontWeight: 700, color: "var(--sarvam-orange)", marginBottom: "20px" }}>
                {Math.floor(demoDuration / 60)}:{(demoDuration % 60).toString().padStart(2, "0")}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
              {!demoActive ? (
                <button
                  className="btn btn-primary"
                  onClick={startDemoCall}
                  disabled={isConnecting}
                  style={{ padding: "12px 28px" }}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Mic size={16} />
                      <span>Start Conversation</span>
                    </>
                  )}
                </button>
              ) : (
                <button className="btn btn-danger" onClick={endDemoCall} style={{ padding: "12px 28px" }}>
                  <PhoneCall size={16} />
                  <span>End Live Call</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

