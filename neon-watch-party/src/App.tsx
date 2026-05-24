import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { io, Socket } from "socket.io-client";
import { playMessageSentSound } from "./sound";
import {
  darkenHex,
  lightenHex,
  loadSavedTheme,
  saveCustomTheme,
  saveThemePreset,
  type NeonPreset,
} from "./theme";
import { ThemePicker } from "./ThemePicker";
import { ChatPanel } from "./ChatPanel";

type Member = { socketId: string; name: string };
type Playback = {
  type: "none" | "youtube" | "upload";
  videoId: string | null;
  src: string | null;
  t: number;
  playing: boolean;
  updatedAt: number;
};
type LibraryItem = { id: string; type: "youtube" | "upload"; title: string; ref: string };
type ChatMsg = { id: string; senderId: string; name: string; text: string; at: number };
type TypingUser = { socketId: string; name: string };
type MobileTab = "watch" | "library" | "voice";

function normalizeRoomInput(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const REACTIONS = ["🔥", "😂", "😮", "👏", "❤️", "💀", "🍿", "✨"];

function estimatedPlaybackTime(p: Playback): number {
  if (!p.playing) return p.t;
  return p.t + (Date.now() - p.updatedAt) / 1000;
}

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const hostSyncTimerRef = useRef<number | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const typingStopTimerRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const myNameRef = useRef("");

  const [connected, setConnected] = useState(false);
  const [name, setName] = useState("");
  const [createRoomCode, setCreateRoomCode] = useState("");
  const [createLibraryPin, setCreateLibraryPin] = useState(() => localStorage.getItem("neonLibraryPin") || "");
  const [roomInput, setRoomInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"lobby" | "room">("lobby");
  const [mobileTab, setMobileTab] = useState<MobileTab>("watch");
  const [typers, setTypers] = useState<TypingUser[]>([]);
  const [themePreset, setThemePreset] = useState<NeonPreset>(() => loadSavedTheme());
  const [customNeonHex, setCustomNeonHex] = useState(() => loadSavedTheme().primary);
  const [libraryUploading, setLibraryUploading] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [libraryPin, setLibraryPin] = useState<string | null>(null);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback>({
    type: "none",
    videoId: null,
    src: null,
    t: 0,
    playing: false,
    updatedAt: Date.now(),
  });
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<
    { id: string; title: string; author: string; thumbnail: string; duration: string }[]
  >([]);
  const [libraryPinInput, setLibraryPinInput] = useState(() => localStorage.getItem("neonLibraryPin") || "");
  const [libraryUnlocked, setLibraryUnlocked] = useState(false);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);

  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const hostIsMe = Boolean(hostId && mySocketId && hostId === mySocketId);
  const hostIsMeRef = useRef(hostIsMe);
  hostIsMeRef.current = hostIsMe;

  useEffect(() => {
    const s = io("https://neon-watch-party.onrender.com", {
  path: "/socket.io",
  transports: ["websocket", "polling"],
});
    socketRef.current = s;
    s.on("connect", () => {
      setConnected(true);
      setMySocketId(s.id ?? null);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("room:state", (st: { room: string; hostId: string | null; members: Member[]; playback: Playback }) => {
      setRoomCode(st.room);
      setHostId(st.hostId);
      setMembers(st.members);
      setPlayback(st.playback);
    });
    s.on("chat:message", (m: ChatMsg) => {
      setChat((c) => [...c.slice(-200), m]);
      setTypers((t) => t.filter((x) => x.socketId !== m.senderId));
    });
    s.on("chat:typing", ({ socketId, name, typing }: { socketId: string; name: string; typing: boolean }) => {
      if (socketId === s.id) return;
      setTypers((prev) => {
        if (!typing) return prev.filter((x) => x.socketId !== socketId);
        if (prev.some((x) => x.socketId === socketId)) return prev;
        return [...prev, { socketId, name }];
      });
    });
    s.on("reaction:burst", ({ emoji }: { emoji: string }) => {
      const id = `${Date.now()}-${Math.random()}`;
      const x = 12 + Math.random() * 76;
      const y = 55 + Math.random() * 30;
      setReactions((r) => [...r.slice(-40), { id, emoji, x, y }]);
      setTimeout(() => {
        setReactions((r) => r.filter((x) => x.id !== id));
      }, 2300);
    });
    s.on("library:updated", (lib: LibraryItem[]) => setLibrary(lib));
    s.on("voice:signal", async ({ from, data }: { from: string; data: any }) => {
      await handleVoiceSignal(from, data);
    });
    return () => {
      s.removeAllListeners();
      s.close();
    };
  }, []);

  const handleVoiceSignal = async (from: string, data: any) => {
    const socket = socketRef.current;
    if (!socket) return;
    const localStream = localStreamRef.current;
    if (!localStream) return;

    const ensurePc = () => {
      let pc = pcsRef.current.get(from);
      if (!pc) {
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
        });
        pcsRef.current.set(from, pc);
        localStream.getTracks().forEach((t) => pc!.addTrack(t, localStream));
        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            socket.emit("voice:signal", { to: from, data: { type: "ice", candidate: ev.candidate } });
          }
        };
        pc.ontrack = (ev) => {
          let el = remoteAudiosRef.current.get(from);
          if (!el) {
            el = document.createElement("audio");
            el.autoplay = true;
            el.setAttribute("playsinline", "");
            document.body.appendChild(el);
            remoteAudiosRef.current.set(from, el);
          }
          el.srcObject = ev.streams[0];
        };
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === "failed" || pc?.connectionState === "disconnected") {
            /* noop */
          }
        };
      }
      return pc;
    };

    if (data.type === "offer") {
      const pc = ensurePc();
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("voice:signal", { to: from, data: { type: "answer", sdp: pc.localDescription } });
    } else if (data.type === "answer") {
      const pc = pcsRef.current.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === "ice" && data.candidate) {
      const pc = pcsRef.current.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {
          /* ignore */
        }
      }
    }
  };

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onSync = (p: Playback) => {
      if (socket.id === hostId) return;
      applyPlaybackToMedia(p, false);
    };
    socket.on("playback:sync", onSync);
    return () => {
      socket.off("playback:sync", onSync);
    };
  }, [hostId]);

  const myDisplayName = useMemo(() => {
    const me = members.find((m) => m.socketId === mySocketId);
    return me?.name || name || "You";
  }, [members, mySocketId, name]);

  myNameRef.current = myDisplayName;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, typers]);

  const emitTyping = useCallback((typing: boolean) => {
    socketRef.current?.emit("chat:typing", { typing });
  }, []);

  const onChatDraftChange = (value: string) => {
    setChatDraft(value);
    if (!value.trim()) {
      emitTyping(false);
      return;
    }
    emitTyping(true);
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => emitTyping(false), 2000);
  };

  const destroyYt = useCallback(() => {
    const player = ytPlayerRef.current;
    ytPlayerRef.current = null;
    if (player) {
      try {
        player.stopVideo?.();
      } catch {
        /* ignore */
      }
      try {
        player.destroy?.();
      } catch {
        /* ignore */
      }
    }
    if (ytContainerRef.current) {
      ytContainerRef.current.innerHTML = "";
    }
  }, []);

  const applyPlaybackToMedia = useCallback((p: Playback, _isLocalHostDrive: boolean) => {
    const t = estimatedPlaybackTime(p);
    if (p.type === "upload" && p.src && videoRef.current) {
      const v = videoRef.current;
      if (playback.type === "upload" && Math.abs(v.currentTime - t) > 1.2)
  v.currentTime = t;
      if (p.playing) void v.play().catch(() => {});
      else v.pause();
    }
    if (p.type === "youtube" && p.videoId && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === "function") {
  const pl = ytPlayerRef.current;

  try {
    const current = pl.getCurrentTime?.() || 0;

    // only correct BIG desyncs
    if (Math.abs(current - t) > 5) {
      pl.seekTo?.(t, true);
    }

    const state = pl.getPlayerState?.();

    // sync play/pause only
    if (p.playing && state !== 1) {
      pl.playVideo?.();
    } else if (!p.playing && state === 1) {
      pl.pauseVideo?.();
    }

  } catch {
    /* ignore */
  }
}
  }, []);

  useEffect(() => {
    if (!hostIsMe) return;
    if (playback.type === "none") return;
    if (hostSyncTimerRef.current)
  window.clearInterval(hostSyncTimerRef.current);
    if (mediaType !== "youtube") {
  hostSyncTimerRef.current = window.setInterval(() => {
      const s = socketRef.current;
      if (!s || !hostIsMe) return;
      let t = 0;
      let playing = false;
      if (playback.type === "upload" && videoRef.current) {
        t = videoRef.current.currentTime;
        playing = !videoRef.current.paused;
      } else if (playback.type === "youtube" && ytPlayerRef.current?.getCurrentTime) {
        t = ytPlayerRef.current.getCurrentTime() || 0;
        playing = ytPlayerRef.current.getPlayerState?.() === 1;
      } else return;
      s.emit(
        "playback:set",
        { ...playbackRef.current, t, playing },
        () => {},
      );
    }, 1000);
    return () => {
      if (hostSyncTimerRef.current) window.clearInterval(hostSyncTimerRef.current);
    };
  }, [hostIsMe, playback.type, playback.videoId, playback.src]);

  const loadYouTubeApi = useCallback(() => {
    if (window.YT?.Player) {
      setYtApiReady(true);
      return;
    }
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      setYtApiReady(true);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);
  }, []);

  useEffect(() => {
    loadYouTubeApi();
  }, [loadYouTubeApi]);

  useEffect(() => {
    if (!ytApiReady) return;
    if (!playback.videoId || playback.type !== "youtube") {
      destroyYt();
      return;
    }
    const vid = playback.videoId;
    const timer = window.setTimeout(() => {
      if (playbackRef.current.type !== "youtube" || playbackRef.current.videoId !== vid) return;
      if (!ytContainerRef.current) return;
      destroyYt();
      ytPlayerRef.current = new window.YT!.Player(ytContainerRef.current, {
        videoId: vid,
        width: "100%",
        height: "100%",
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            applyPlaybackToMedia(playbackRef.current, hostIsMeRef.current);
          },
          onStateChange: (e: { data: number }) => {
            if (!hostIsMeRef.current) return;
            const sk = socketRef.current;
            if (!sk) return;
            const pl = ytPlayerRef.current;
            if (!pl?.getCurrentTime) return;
            const playing = e.data === 1;
            const t = pl.getCurrentTime() || 0;
            sk.emit("playback:set", { type: "youtube", videoId: vid, src: null, t, playing, updatedAt: Date.now() }, () => {});
          },
        },
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      destroyYt();
    };
  }, [playback.type, playback.videoId, ytApiReady, destroyYt, applyPlaybackToMedia]);

  useEffect(() => {
    if (playback.type !== "youtube" || !playback.videoId) return;
    if (hostIsMe) return;
    applyPlaybackToMedia(playback, false);
  }, [playback.t, playback.playing, playback.updatedAt, playback.type, playback.videoId, applyPlaybackToMedia, hostIsMe]);

  useEffect(() => {
    if (playback.type !== "upload" || !playback.src) return;
    if (hostIsMe) return;
    applyPlaybackToMedia(playback, false);
  }, [playback.t, playback.playing, playback.updatedAt, playback.type, playback.src, applyPlaybackToMedia, hostIsMe]);

  useEffect(() => {
    if (playback.type !== "upload") return;
    const v = videoRef.current;
    if (!v || !playback.src) return;
    const onSeeked = () => {
      const s = socketRef.current;
      if (!s || !hostIsMe) return;
      s.emit(
        "playback:set",
        {
          ...playback,
          t: v.currentTime,
          playing: !v.paused,
        },
        () => {},
      );
    };
    const onPlayPause = () => {
      const s = socketRef.current;
      if (!s || !hostIsMe) return;
      s.emit(
        "playback:set",
        {
          ...playback,
          t: v.currentTime,
          playing: !v.paused,
        },
        () => {},
      );
    };
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("play", onPlayPause);
    v.addEventListener("pause", onPlayPause);
    return () => {
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("play", onPlayPause);
      v.removeEventListener("pause", onPlayPause);
    };
  }, [playback, hostIsMe, playback.type, playback.src]);

  const reconcileVoice = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !voiceOn || !localStreamRef.current) return;
    const myId = socket.id;
    if (!myId) return;
    for (const m of members) {
      if (m.socketId === myId) continue;
      if (myId >= m.socketId) continue;
      if (pcsRef.current.has(m.socketId)) continue;
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
      });
      pcsRef.current.set(m.socketId, pc);
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit("voice:signal", { to: m.socketId, data: { type: "ice", candidate: ev.candidate } });
        }
      };
      pc.ontrack = (ev) => {
        let el = remoteAudiosRef.current.get(m.socketId);
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          el.setAttribute("playsinline", "");
          document.body.appendChild(el);
          remoteAudiosRef.current.set(m.socketId, el);
        }
        el.srcObject = ev.streams[0];
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("voice:signal", {
        to: m.socketId,
        data: { type: "offer", sdp: pc.localDescription },
      });
    }
    for (const id of [...pcsRef.current.keys()]) {
      if (!members.some((m) => m.socketId === id)) {
        pcsRef.current.get(id)?.close();
        pcsRef.current.delete(id);
        const el = remoteAudiosRef.current.get(id);
        el?.remove();
        remoteAudiosRef.current.delete(id);
      }
    }
  }, [members, voiceOn]);

  useEffect(() => {
    void reconcileVoice();
  }, [reconcileVoice]);

  const toggleVoice = async () => {
    setVoiceError(null);
    if (!voiceOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setVoiceOn(true);
      } catch (e) {
        setVoiceError("Microphone permission denied or unavailable.");
      }
    } else {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
      remoteAudiosRef.current.forEach((a) => a.remove());
      remoteAudiosRef.current.clear();
      setVoiceOn(false);
    }
  };

  const createRoom = () => {
    const s = socketRef.current;
    if (!s) return;
    const code = normalizeRoomInput(createRoomCode);
    if (!/^[A-Z0-9_-]{3,16}$/.test(code)) {
      setCreateError("Pick a room code: 3–16 letters, numbers, _ or -");
      return;
    }
    setCreateError(null);
    s.emit("room:create", { name: name || "Host", room: code, libraryPin: createLibraryPin }, (r: any) => {
      if (r?.ok) {
        setLibraryPin(r.libraryPin);
        setLibraryPinInput(r.libraryPin);
        setCreateLibraryPin(r.libraryPin);
        localStorage.setItem("neonLibraryPin", r.libraryPin);
        setLibrary(r.library || []);
        setLibraryUnlocked(true);
        setRoomCode(r.room);
        setPhase("room");
        setChat([]);
        setTypers([]);
      } else {
        setCreateError(r?.error || "Could not create room");
      }
    });
  };

  const joinRoom = () => {
    const s = socketRef.current;
    if (!s) return;
    const code = normalizeRoomInput(roomInput);
    if (!code) return;
    s.emit("room:join", { room: code, name: name || "Guest" }, (r: any) => {
      if (r?.ok) {
        setPhase("room");
        setChat([]);
      } else {
        alert(r?.error || "Could not join");
      }
    });
  };

  const sendChat = () => {
    const t = chatDraft.trim();
    if (!t) return;
    emitTyping(false);
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    socketRef.current?.emit("chat:send", { text: t });
    playMessageSentSound();
    setChatDraft("");
  };

  const uploadVideoFile = async (file: File) => {
    if (!roomCode) throw new Error("No room");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
  `https://neon-watch-party.onrender.com/api/upload?room=${encodeURIComponent(roomCode)}`,
  {
    method: "POST",
    body: fd,
  }
);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Upload failed");
    return { url: j.url as string, name: (j.name as string) || file.name };
  };

  const pickThemePreset = (preset: NeonPreset) => {
    saveThemePreset(preset);
    setThemePreset(preset);
    setCustomNeonHex(preset.primary);
  };

  const applyCustomNeon = (hex: string) => {
    setCustomNeonHex(hex);
    const light = lightenHex(hex, 0.38);
    const dim = darkenHex(hex, 0.62);
    const custom = saveCustomTheme(hex, light, dim);
    setThemePreset(custom);
  };

  const typingLabel = useMemo(() => {
    const others = typers.filter((t) => t.socketId !== mySocketId);
    if (others.length === 0) return null;
    if (others.length === 1) return `${others[0].name} is typing`;
    if (others.length === 2) return `${others[0].name} and ${others[1].name} are typing`;
    return `${others[0].name} and ${others.length - 1} others are typing`;
  }, [typers, mySocketId]);

  const runYoutubeSearch = async () => {
    if (!hostIsMe) return;
    const q = searchQ.trim();
    if (!q) return;
    setSearching(true);
    setSearchHits([]);
    try {
      const res = await fetch(
  `https://neon-watch-party.onrender.com/api/youtube/search?q=${encodeURIComponent(q)}`
);
      const j = await res.json();
      setSearchHits(j.items || []);
    } catch {
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  };

  const playYoutube = (id: string) => {
    const s = socketRef.current;
    if (!s || !hostIsMe) return;
    destroyYt();
    s.emit(
      "playback:set",
      { type: "youtube", videoId: id, src: null, t: 0, playing: true, updatedAt: Date.now() },
      () => {},
    );
  };

  const unlockLibrary = () => {
    const s = socketRef.current;
    if (!s) return;
    setLibraryError(null);
    s.emit("library:list", { pin: libraryPinInput }, (r: any) => {
      if (r?.ok) {
        setLibrary(r.library || []);
        setLibraryUnlocked(true);
        localStorage.setItem("neonLibraryPin", libraryPinInput);
      } else {
        setLibraryError(r?.error || "Unlock failed");
      }
    });
  };

  const addToLibrary = (item: { type: "youtube" | "upload"; title: string; ref: string }) => {
    const s = socketRef.current;
    if (!s || !libraryUnlocked) return;
    s.emit("library:add", { pin: libraryPinInput, item }, (r: any) => {
      if (!r?.ok) setLibraryError(r?.error || "Could not add");
      else setLibrary(r.library || []);
    });
  };

  const removeFromLibrary = (id: string) => {
    const s = socketRef.current;
    if (!s) return;
    s.emit("library:remove", { pin: libraryPinInput, id }, (r: any) => {
      if (r?.ok) setLibrary(r.library || []);
    });
  };

  const transferHost = (toSocketId: string) => {
    socketRef.current?.emit("host:transfer", { toSocketId }, (r: any) => {
      if (!r?.ok) alert(r?.error || "Transfer failed");
    });
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomCode || !hostIsMe) return;
    setUploading(true);
    try {
      destroyYt();
      const { url } = await uploadVideoFile(file);
      socketRef.current?.emit(
        "playback:set",
        {
          type: "upload",
          videoId: null,
          src: url,
          t: 0,
          playing: true,
          updatedAt: Date.now(),
        },
        () => {},
      );
    } catch (err) {
      alert(String((err as Error).message || err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const onLibraryUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomCode || !libraryUnlocked) return;
    setLibraryUploading(true);
    setLibraryError(null);
    try {
      const { url, name: fileName } = await uploadVideoFile(file);
      addToLibrary({ type: "upload", title: fileName, ref: url });
    } catch (err) {
      setLibraryError(String((err as Error).message || err));
    } finally {
      setLibraryUploading(false);
      e.target.value = "";
    }
  };

  const playFromLibrary = (item: LibraryItem) => {
    if (!hostIsMe) return;
    if (item.type === "youtube") playYoutube(item.ref);
    else {
      destroyYt();
      socketRef.current?.emit(
        "playback:set",
        { type: "upload", videoId: null, src: item.ref, t: 0, playing: true, updatedAt: Date.now() },
        () => {},
      );
    }
  };

  const chatPanelProps = {
    chat,
    chatDraft,
    onChatDraftChange,
    onSend: sendChat,
    mySocketId,
    myDisplayName,
    typingLabel,
    chatEndRef,
    voiceOn,
    voiceError,
    onToggleVoice: () => void toggleVoice(),
    showVoiceButton: true,
    compact: true,
  };

  const banner = useMemo(() => {
    if (!connected) return "Connecting…";
    return null;
  }, [connected]);

  if (phase === "lobby") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 font-body">
        {banner && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm glass neon-border text-neon-pink">
            {banner}
          </div>
        )}
        <div className="w-full max-w-lg glass neon-border rounded-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="font-display text-3xl tracking-wide text-neon-red drop-shadow-neon">NEON WATCH PARTY</h1>
            <p className="text-zinc-400 text-sm">Pick a neon color and your own room code to host, or join with a code.</p>
          </div>
          <ThemePicker
            themePreset={themePreset}
            customHex={customNeonHex}
            onPickPreset={pickThemePreset}
            onCustomHex={applyCustomNeon}
            compact
          />
          <label className="block space-y-1 text-sm text-zinc-300">
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg bg-zinc-950/80 border border-neon-dim/50 px-3 py-2 outline-none focus:border-neon-red focus:shadow-neon-sm"
              placeholder="Your name"
            />
          </label>
          <div className="space-y-3 rounded-xl border border-neon-dim/40 p-4 bg-zinc-950/40">
            <p className="text-xs font-display tracking-widest text-neon-pink">CREATE AS HOST</p>
            <input
              value={createRoomCode}
              onChange={(e) => {
                setCreateRoomCode(e.target.value.toUpperCase().replace(/\s/g, ""));
                setCreateError(null);
              }}
              className="w-full rounded-lg bg-zinc-950/80 border border-neon-dim/50 px-3 py-2.5 font-mono outline-none focus-neon uppercase"
              placeholder="YOUR ROOM CODE"
              maxLength={16}
            />
            <input
              value={createLibraryPin}
              onChange={(e) => setCreateLibraryPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-full rounded-lg bg-zinc-950/80 border border-neon-dim/50 px-3 py-2.5 font-mono outline-none focus-neon"
              placeholder="LIBRARY CODE (OPTIONAL)"
              maxLength={4}
            />
            <button
              type="button"
              onClick={createRoom}
              disabled={!connected || !createRoomCode.trim()}
              className="w-full rounded-xl bg-neon-red px-4 py-3 font-display tracking-wide text-white shadow-neon disabled:opacity-40"
            >
              Create room
            </button>
            {createError && <p className="text-xs text-red-400">{createError}</p>}
          </div>
          <div className="space-y-3 rounded-xl border border-zinc-800 p-4 bg-zinc-950/40">
            <p className="text-xs font-display tracking-widest text-zinc-400">JOIN A ROOM</p>
            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.toUpperCase().replace(/\s/g, ""))}
              className="w-full rounded-lg bg-zinc-950/80 border border-zinc-700 px-3 py-2.5 font-mono outline-none focus-neon uppercase"
              placeholder="ROOM CODE"
              maxLength={16}
            />
            <button
              type="button"
              onClick={joinRoom}
              disabled={!connected || !roomInput.trim()}
              className="w-full rounded-xl border border-neon-red/60 px-4 py-3 font-display text-neon-pink hover:bg-neon-red/10 disabled:opacity-40"
            >
              Join room
            </button>
          </div>
        </div>
      </div>
    );
  }

  const mobileTabs: { id: MobileTab; label: string }[] = [
    { id: "watch", label: "Watch" },
    { id: "library", label: "Library" },
    { id: "voice", label: "Voice" },
  ];

  return (
    <div className="min-h-[100dvh] font-body text-zinc-100 flex flex-col">
      <header className="sticky top-0 z-30 shrink-0 border-b border-neon-dim/40 bg-zinc-950/90 backdrop-blur-md px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-display text-base sm:text-lg text-neon-red shadow-neon shrink-0">NEON</span>
          <span className="text-xs sm:text-sm truncate font-mono text-neon-pink">{roomCode}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] sm:text-sm shrink-0">
          {hostIsMe ? (
            <span className="rounded-full border border-neon-red/60 px-3 py-1 text-neon-pink shadow-neon-sm">You are host</span>
          ) : (
            <span className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400">Viewer</span>
          )}
          {voiceOn ? (
            <span className="rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 px-3 py-1">Voice on</span>
          ) : null}
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-[minmax(0,280px)_1fr_minmax(0,260px)] gap-4 p-3 sm:p-4 pb-20 lg:pb-4 min-h-0 overflow-hidden">
        <section
          className={`glass neon-border rounded-2xl p-4 flex flex-col gap-4 min-h-0 overflow-hidden ${
            mobileTab === "library" ? "flex" : "hidden"
          } lg:flex`}
        >
          <h2 className="font-display text-sm tracking-widest text-neon-pink">LIBRARY</h2>
          <p className="text-xs text-zinc-500">Enter the 4-digit library code to unlock. Only people with the code see titles.</p>
          <div className="flex gap-2">
            <input
              value={libraryPinInput}
              onChange={(e) => setLibraryPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="flex-1 rounded-lg bg-zinc-950/80 border border-neon-dim/50 px-3 py-2 font-mono"
              placeholder="PIN"
            />
            <button
              type="button"
              onClick={unlockLibrary}
              className="rounded-lg bg-neon-red/90 px-3 py-2 text-sm font-semibold text-white shadow-neon-sm"
            >
              Unlock
            </button>
          </div>
          {libraryError && <p className="text-xs text-red-400">{libraryError}</p>}
          {libraryUnlocked && (
            <>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-neon-red/50 px-3 py-2.5 text-sm text-neon-pink cursor-pointer hover:bg-neon-red/10 active:scale-[0.98] transition-transform">
                {libraryUploading ? "Uploading to library…" : "+ Upload video to library"}
                <input type="file" accept="video/*" className="hidden" onChange={onLibraryUpload} />
              </label>
            <ul className="space-y-2 overflow-y-auto flex-1 pr-1 max-h-[50dvh] lg:max-h-[360px]">
              {library.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 flex items-start justify-between gap-2"
                >
                  <div>
                    <p className="text-sm text-zinc-100 line-clamp-2">{item.title}</p>
                    <p className="text-[11px] text-zinc-500">{item.type}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {hostIsMe && (
                      <button
                        type="button"
                        onClick={() => playFromLibrary(item)}
                        className="text-xs rounded-md bg-neon-red/80 px-2 py-1 text-white"
                      >
                        Play
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFromLibrary(item.id)}
                      className="text-[11px] text-zinc-500 hover:text-neon-pink"
                      disabled={!hostIsMe}
                      title={hostIsMe ? "Remove" : "Only the host can remove"}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}
        </section>

        <section
          className={`flex flex-col gap-3 min-h-0 overflow-hidden flex-1 ${
            mobileTab === "watch" ? "flex" : "hidden"
          } lg:flex`}
        >
          <div className="relative rounded-2xl overflow-hidden neon-border bg-black aspect-video shadow-neon w-full shrink-0">
            <div
              ref={ytContainerRef}
              className={`absolute inset-0 w-full h-full ${
                playback.type === "youtube" && playback.videoId
                  ? "visible z-[2]"
                  : "invisible pointer-events-none z-0"
              }`}
            />
            {playback.type === "upload" && playback.src ? (
              <video
                key={playback.src}
                ref={videoRef}
                className="absolute inset-0 w-full h-full z-[2] object-contain bg-black"
                src={playback.src}
                controls={!!hostIsMe}
                playsInline
                onLoadedMetadata={() => {
                  if (!videoRef.current) return;
                  applyPlaybackToMedia(playback, !!hostIsMe);
                }}
              />
            ) : null}
            {playback.type !== "upload" && (playback.type !== "youtube" || !playback.videoId) && (
              <div className="absolute inset-0 z-[2] flex items-center justify-center text-zinc-500 text-sm px-4 text-center">
                Waiting for host to start something…
              </div>
            )}
            {reactions.map((r) => (
              <div
                key={r.id}
                className="reaction-float pointer-events-none absolute z-[4] text-3xl drop-shadow-[0_0_8px_rgba(255,42,109,0.9)]"
                style={{ left: `${r.x}%`, top: `${r.y}%` }}
              >
                {r.emoji}
              </div>
            ))}
          </div>

          <div className="glass neon-border rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <h3 className="font-display text-sm text-neon-pink tracking-widest">REACTIONS</h3>
              <div className="flex flex-wrap gap-1">
                {REACTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => socketRef.current?.emit("reaction:send", { emoji: em })}
                    className="text-xl rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 hover:border-neon-red hover:shadow-neon-sm"
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
            {hostIsMe ? (
              <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <label className="text-xs text-zinc-500">YouTube search</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runYoutubeSearch()}
                      className="flex-1 rounded-lg bg-zinc-950/80 border border-neon-dim/50 px-3 py-2 text-sm"
                      placeholder="Search YouTube…"
                    />
                    <button
                      type="button"
                      onClick={runYoutubeSearch}
                      disabled={searching}
                      className="rounded-lg bg-neon-red px-3 py-2 text-sm font-semibold text-white shadow-neon-sm disabled:opacity-40"
                    >
                      {searching ? "…" : "Search"}
                    </button>
                  </div>
                </div>
                <label className="text-xs rounded-xl border border-dashed border-neon-red/50 px-3 py-2 text-center cursor-pointer hover:bg-neon-red/10">
                  {uploading ? "Uploading…" : "Upload video"}
                  <input type="file" accept="video/*" className="hidden" onChange={onUpload} />
                </label>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Only the host can search YouTube or upload. Ask them to queue a video.</p>
            )}
            {hostIsMe && searchHits.length > 0 && (
              <ul className="max-h-48 overflow-y-auto space-y-1 border border-zinc-800 rounded-lg p-2 bg-zinc-950/60">
                {searchHits.map((h) => (
                  <li key={h.id} className="flex gap-2 items-center text-sm">
                    {h.thumbnail ? (
                      <img src={h.thumbnail} alt="" className="w-16 h-10 object-cover rounded border border-zinc-800" />
                    ) : (
                      <div className="w-16 h-10 rounded bg-zinc-900" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-zinc-200">{h.title}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{h.author}</p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0 items-end">
                      <button
                        type="button"
                        onClick={() => playYoutube(h.id)}
                        className="text-xs rounded-md bg-neon-red/80 px-2 py-1 text-white"
                      >
                        Play
                      </button>
                      {libraryUnlocked && (
                        <button
                          type="button"
                          onClick={() => addToLibrary({ type: "youtube", title: h.title, ref: h.id })}
                          className="text-[11px] text-zinc-400 hover:text-neon-pink"
                        >
                          Save to library
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ChatPanel {...chatPanelProps} />
        </section>

        <section
          className={`flex flex-col gap-4 min-h-0 ${
            mobileTab === "voice" ? "flex" : "hidden"
          } lg:flex`}
        >

          <div
            className={`glass neon-border rounded-2xl p-4 flex flex-col gap-4 overflow-y-auto ${
              mobileTab === "voice" ? "flex flex-1" : "hidden"
            } lg:hidden`}
          >
            <ThemePicker
              themePreset={themePreset}
              customHex={customNeonHex}
              onPickPreset={pickThemePreset}
              onCustomHex={applyCustomNeon}
              compact
            />
            {libraryPin && (
              <p className="text-xs text-zinc-500">
                Library PIN: <span className="font-mono text-neon-red">{libraryPin}</span>
              </p>
            )}
            <button
              type="button"
              onClick={() => void toggleVoice()}
              className={`w-full text-sm rounded-xl px-3 py-2.5 border ${
                voiceOn ? "border-emerald-500/60 text-emerald-300" : "border-neon-red/60 text-neon-pink"
              }`}
            >
              {voiceOn ? "Leave voice chat" : "Join voice chat"}
            </button>
            {voiceError && <p className="text-xs text-red-400">{voiceError}</p>}
            <h3 className="font-display text-sm text-neon-pink tracking-widest">PEOPLE</h3>
            <ul className="space-y-2 text-sm">
              {members.map((m) => (
                <li key={m.socketId} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {m.name}
                    {m.socketId === hostId ? (
                      <span className="ml-2 text-[10px] uppercase text-neon-red">host</span>
                    ) : null}
                    {m.socketId === mySocketId ? <span className="ml-2 text-zinc-500">(you)</span> : null}
                  </span>
                  {hostIsMe && m.socketId !== mySocketId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Make ${m.name} the host?`)) transferHost(m.socketId);
                      }}
                      className="text-[11px] rounded-md border border-neon-red/50 px-2 py-1 text-neon-pink"
                    >
                      Transfer host
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="glass neon-border rounded-2xl p-4 hidden lg:flex lg:flex-col lg:gap-4">
            <ThemePicker
              themePreset={themePreset}
              customHex={customNeonHex}
              onPickPreset={pickThemePreset}
              onCustomHex={applyCustomNeon}
              compact
            />
            {libraryPin && (
              <p className="text-xs text-zinc-500">
                Library PIN: <span className="font-mono text-neon-red">{libraryPin}</span>
              </p>
            )}
            <h3 className="font-display text-sm text-neon-pink tracking-widest mb-2">PEOPLE</h3>
            <ul className="space-y-2 text-sm">
              {members.map((m) => (
                <li key={m.socketId} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {m.name}
                    {m.socketId === hostId ? (
                      <span className="ml-2 text-[10px] uppercase text-neon-red">host</span>
                    ) : null}
                    {m.socketId === mySocketId ? <span className="ml-2 text-zinc-500">(you)</span> : null}
                  </span>
                  {hostIsMe && m.socketId !== mySocketId ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Make ${m.name} the host?`)) transferHost(m.socketId);
                      }}
                      className="text-[11px] rounded-md border border-neon-red/50 px-2 py-1 text-neon-pink hover:bg-neon-red/10"
                    >
                      Transfer host
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-neon-dim/40 bg-zinc-950/95 backdrop-blur-md safe-bottom">
        <div className="grid grid-cols-3 gap-1 px-2 py-2">
          {mobileTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMobileTab(t.id)}
              className={`rounded-xl py-2 text-[11px] font-medium transition-colors ${
                mobileTab === t.id
                  ? "bg-neon-red/20 text-neon-pink border border-neon-red/40 shadow-neon-sm"
                  : "text-zinc-500 border border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
