import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

function Lobby({ onStart }: { onStart: () => void }) {
  return (
    <div className="lobby">
      <div className="logo">
        <span className="logo-icon">&#9670;</span>
        <h1>ChatWave</h1>
      </div>
      <p className="subtitle">Meet new people. One video at a time.</p>
      <button className="start-btn" onClick={onStart}>Start Chatting</button>
      <p className="hint">Click to find a random stranger</p>
    </div>
  );
}

function Waiting({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="waiting">
      <div className="waiting-content">
        <div className="pulse-ring" />
        <p className="waiting-text">Finding someone for you...</p>
        <div className="dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
        <button className="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function PartnerLeft({ onFindNew, onStop }: { onFindNew: () => void; onStop: () => void }) {
  return (
    <div className="partner-left">
      <div className="partner-left-content">
        <span className="disconnected-icon">&#9888;</span>
        <p>Stranger disconnected</p>
        <div className="partner-left-actions">
          <button className="find-new-btn" onClick={onFindNew}>Find New</button>
          <button className="cancel-btn" onClick={onStop}>Stop</button>
        </div>
      </div>
    </div>
  );
}

function Chat({ messages, onSend }: { messages: any[]; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) { onSend(text.trim()); setText(""); }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">Chat</div>
      <div className="chat-messages">
        {messages.length === 0 && <p className="chat-empty">Say hello!</p>}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.isOwn ? "own" : ""}`}>
            <span className="chat-sender">{msg.isOwn ? "You" : "Stranger"}</span>
            <p>{msg.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={handleSubmit}>
        <input type="text" placeholder="Type a message..." value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}

type Phase = "lobby" | "waiting" | "call" | "partner-left";

export default function App() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<any>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("partner-found", ({ initiator }) => {
      startCall(initiator);
    });

    socket.on("signal", ({ data }) => {
      if (peerRef.current) peerRef.current.signal(data);
    });

    socket.on("partner-left", () => {
      if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
      setPhase("partner-left");
    });

    socket.on("waiting", () => {
      setPhase("waiting");
    });

    socket.on("chat-message", (msg) => {
      setChatMessages((prev) => [...prev, { ...msg, isOwn: false }]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const cleanupPeer = useCallback(() => {
    if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
  }, []);

  const startCall = useCallback(async (initiator: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      const Peer = (await import("simple-peer")).default;
      const peer = new Peer({ initiator, trickle: false, stream });
      peer.on("signal", (data) => socketRef.current?.emit("signal", { data }));
      peer.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      });
      peerRef.current = peer;
      setChatMessages([]);
      setPhase("call");
    } catch (err) {
      console.error("Failed to start call:", err);
    }
  }, []);

  const findPartner = useCallback(() => {
    cleanupPeer();
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); setLocalStream(null); }
    setChatMessages([]);
    socketRef.current?.emit("find-partner");
    setPhase("waiting");
  }, [cleanupPeer, localStream]);

  const nextPartner = useCallback(() => {
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); setLocalStream(null); }
    cleanupPeer();
    setChatMessages([]);
    socketRef.current?.emit("next-partner");
  }, [cleanupPeer, localStream]);

  const stopCall = useCallback(() => {
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); setLocalStream(null); }
    cleanupPeer();
    socketRef.current?.emit("next-partner");
    setChatMessages([]);
    setPhase("lobby");
  }, [cleanupPeer, localStream]);

  const toggleMic = () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) { track.enabled = !track.enabled; setMicOn(track.enabled); }
    }
  };

  const toggleCamera = () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      if (track) { track.enabled = !track.enabled; setCameraOn(track.enabled); }
    }
  };

  const sendChat = (text: string) => {
    setChatMessages((prev) => [...prev, { id: Date.now().toString(), content: text, sender: "You", isOwn: true, createdAt: new Date().toISOString() }]);
    socketRef.current?.emit("chat-message", text);
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  if (phase === "waiting") return <Waiting onCancel={() => { stopCall(); setPhase("lobby"); }} />;
  if (phase === "partner-left") return <PartnerLeft onFindNew={findPartner} onStop={() => { cleanupPeer(); setPhase("lobby"); }} />;

  if (phase === "call") {
    return (
      <div className="call-screen">
        <div className="video-grid two-person">
          <div className="video-wrapper">
            <video ref={localVideoRef} autoPlay playsInline muted />
            <span className="video-label">You</span>
          </div>
          <div className="video-wrapper">
            <video ref={remoteVideoRef} autoPlay playsInline />
            <span className="video-label">Stranger</span>
          </div>
        </div>
        <div className="controls">
          <button className={`control-btn toggle ${micOn ? "" : "off"}`} onClick={toggleMic}>{micOn ? "Mic" : "Muted"}</button>
          <button className={`control-btn toggle ${cameraOn ? "" : "off"}`} onClick={toggleCamera}>{cameraOn ? "Camera" : "Cam Off"}</button>
          <button className={`control-btn toggle ${chatOpen ? "active" : ""}`} onClick={() => setChatOpen((o) => !o)}>Chat</button>
          <button className="control-btn next" onClick={nextPartner}>Next &#8594;</button>
          <button className="control-btn leave" onClick={stopCall}>Stop</button>
        </div>
        {chatOpen && <Chat messages={chatMessages} onSend={sendChat} />}
      </div>
    );
  }

  return <Lobby onStart={findPartner} />;
}
