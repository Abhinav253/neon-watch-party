import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import { Server } from "socket.io";
import { Innertube } from "youtubei.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3847);
const UPLOAD_DIR = path.join(__dirname, "../uploads");
const DATA_DIR = path.join(__dirname, "../data");
const LIBRARY_STORE_FILE = path.join(DATA_DIR, "libraries.json");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    cb(null, safe);
  },
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } });

/** @type {Promise<import('youtubei.js').Innertube> | null} */
let tubePromise = null;
function getTube() {
  if (!tubePromise) tubePromise = Innertube.create({ retrieve_player: false });
  return tubePromise;
}

app.get("/api/youtube/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ items: [] });
    const yt = await getTube();
    const search = await yt.search(q, { type: "video" });
    const videos = search.videos || [];
    const items = videos.slice(0, 18).map((v) => ({
      id: v.id,
      title: v.title?.text || "Untitled",
      author: v.author?.name || "",
      thumbnail: v.thumbnails?.[0]?.url || "",
      duration: v.duration?.text || "",
    }));
    res.json({ items });
  } catch (e) {
    console.error("youtube search", e);
    res.status(500).json({ error: "Search failed" });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

function normalizeRoomCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isValidRoomCode(code) {
  return /^[A-Z0-9_-]{3,16}$/.test(code);
}

function genLibraryPin() {
  let pin = "";
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (libraryStores.has(pin));
  return pin;
}

function normalizeLibraryPin(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 4);
}

function isValidLibraryPin(pin) {
  return /^\d{4}$/.test(pin);
}

function loadLibraryStores() {
  try {
    if (!fs.existsSync(LIBRARY_STORE_FILE)) return new Map();
    const raw = JSON.parse(fs.readFileSync(LIBRARY_STORE_FILE, "utf8"));
    const entries = raw && typeof raw === "object" && raw.libraries ? Object.entries(raw.libraries) : [];
    return new Map(
      entries
        .filter(([pin, items]) => isValidLibraryPin(pin) && Array.isArray(items))
        .map(([pin, items]) => [
          pin,
          items
            .filter((item) => item && (item.type === "youtube" || item.type === "upload") && item.ref)
            .map((item) => ({
              id: String(item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
              type: item.type === "upload" ? "upload" : "youtube",
              title: String(item.title || "Untitled").slice(0, 200),
              ref: String(item.ref || "").slice(0, 512),
            })),
        ]),
    );
  } catch (e) {
    console.error("library store load", e);
    return new Map();
  }
}

const libraryStores = loadLibraryStores();

function saveLibraryStores() {
  const libraries = Object.fromEntries(libraryStores.entries());
  fs.writeFileSync(LIBRARY_STORE_FILE, JSON.stringify({ libraries }, null, 2));
}

function ensureLibrary(pin) {
  if (!libraryStores.has(pin)) {
    libraryStores.set(pin, []);
    saveLibraryStores();
  }
  return libraryStores.get(pin);
}

function emitLibraryUpdate(pin) {
  for (const [roomCode, room] of rooms.entries()) {
    if (room.libraryPin === pin) io.to(roomCode).emit("library:updated", ensureLibrary(pin));
  }
}

/** @type {Map<string, {
 *   code: string,
 *   hostId: string | null,
 *   libraryPin: string,
 *   members: Map<string, { name: string }>,
 *   playback: { type: 'none'|'youtube'|'upload', videoId: string | null, src: string | null, t: number, playing: boolean, updatedAt: number }
 * }>} */
const rooms = new Map();

function roomPublicState(code) {
  const r = rooms.get(code);
  if (!r) return null;
  return {
    room: r.code,
    hostId: r.hostId,
    members: [...r.members.entries()].map(([socketId, m]) => ({ socketId, name: m.name })),
    playback: r.playback,
  };
}

app.post("/api/upload", (req, res) => {
  const room = String(req.query.room || "").toUpperCase();
  if (!room || !rooms.has(room)) {
    res.status(400).json({ error: "Invalid or unknown room" });
    return;
  }
  upload.single("file")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: String(err.message || err) });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ url, name: req.file.originalname, filename: req.file.filename });
  });
});

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, room: requestedRoom, libraryPin: requestedLibraryPin }, cb) => {
    const code = normalizeRoomCode(requestedRoom);
    if (!isValidRoomCode(code)) {
      cb?.({
        ok: false,
        error: "Room code must be 3–16 characters (letters, numbers, _ or -)",
      });
      return;
    }
    if (rooms.has(code)) {
      cb?.({ ok: false, error: "That room code is already taken" });
      return;
    }
    const requestedPin = normalizeLibraryPin(requestedLibraryPin);
    if (requestedPin && !isValidLibraryPin(requestedPin)) {
      cb?.({ ok: false, error: "Library code must be exactly 4 digits" });
      return;
    }
    const libraryPin = requestedPin || genLibraryPin();
    ensureLibrary(libraryPin);
    rooms.set(code, {
      code,
      hostId: socket.id,
      libraryPin,
      members: new Map([[socket.id, { name: String(name || "Host").slice(0, 32) || "Host" }]]),
      playback: {
        type: "none",
        videoId: null,
        src: null,
        t: 0,
        playing: false,
        updatedAt: Date.now(),
      },
    });
    socket.join(code);
    cb?.({
      ok: true,
      room: code,
      libraryPin,
      library: ensureLibrary(libraryPin),
      youAreHost: true,
    });
    io.to(code).emit("room:state", roomPublicState(code));
  });

  socket.on("room:join", ({ room, name }, cb) => {
    const code = String(room || "").toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) {
      cb?.({ ok: false, error: "Room not found" });
      return;
    }
    socket.join(r.code);
    r.members.set(socket.id, { name: String(name || "Guest").slice(0, 32) || "Guest" });
    if (!r.hostId) r.hostId = socket.id;
    cb?.({
      ok: true,
      room: r.code,
      youAreHost: r.hostId === socket.id,
    });
    io.to(r.code).emit("room:state", roomPublicState(r.code));
  });

  socket.on("host:transfer", ({ toSocketId }, cb) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: "No room" });
      return;
    }
    const r = rooms.get(roomCode);
    if (!r || r.hostId !== socket.id) {
      cb?.({ ok: false, error: "Only the host can transfer host" });
      return;
    }
    if (!toSocketId || !r.members.has(toSocketId)) {
      cb?.({ ok: false, error: "Pick someone in the room" });
      return;
    }
    r.hostId = toSocketId;
    io.to(roomCode).emit("room:state", roomPublicState(roomCode));
    cb?.({ ok: true });
  });

  socket.on("playback:set", (payload, cb) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) {
      cb?.({ ok: false });
      return;
    }
    const r = rooms.get(roomCode);
    if (!r || r.hostId !== socket.id) {
      cb?.({ ok: false, error: "Only the host can change playback" });
      return;
    }
    const t = typeof payload.t === "number" ? payload.t : 0;
    r.playback = {
      type: payload.type === "youtube" || payload.type === "upload" || payload.type === "none" ? payload.type : "none",
      videoId: payload.videoId ?? null,
      src: payload.src ?? null,
      t: Math.max(0, t),
      playing: Boolean(payload.playing),
      updatedAt: Date.now(),
    };
    socket.to(roomCode).emit("playback:sync", r.playback);
    io.to(roomCode).emit("room:state", roomPublicState(roomCode));
    cb?.({ ok: true });
  });

  socket.on("chat:send", ({ text }) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) return;
    const r = rooms.get(roomCode);
    const member = r?.members.get(socket.id);
    io.to(roomCode).emit("chat:message", {
      id: `${Date.now()}-${socket.id}`,
      senderId: socket.id,
      name: member?.name || "Anon",
      text: String(text || "").slice(0, 4000),
      at: Date.now(),
    });
  });

  socket.on("chat:typing", ({ typing }) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) return;
    const r = rooms.get(roomCode);
    const member = r?.members.get(socket.id);
    socket.to(roomCode).emit("chat:typing", {
      socketId: socket.id,
      name: member?.name || "Someone",
      typing: Boolean(typing),
    });
  });

  socket.on("reaction:send", ({ emoji }) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) return;
    const em = String(emoji || "").slice(0, 8);
    if (!em) return;
    io.to(roomCode).emit("reaction:burst", { emoji: em, by: socket.id, at: Date.now() });
  });

  socket.on("voice:signal", ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit("voice:signal", { from: socket.id, data });
  });

  socket.on("library:list", ({ pin }, cb) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: "No room" });
      return;
    }
    const r = rooms.get(roomCode);
    if (!r || String(pin) !== r.libraryPin) {
      cb?.({ ok: false, error: "Invalid library code" });
      return;
    }
    cb?.({ ok: true, library: ensureLibrary(r.libraryPin) });
  });

  socket.on("library:add", ({ pin, item }, cb) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: "No room" });
      return;
    }
    const r = rooms.get(roomCode);
    if (!r || String(pin) !== r.libraryPin) {
      cb?.({ ok: false, error: "Invalid library code" });
      return;
    }
    const type = item?.type === "upload" ? "upload" : "youtube";
    const ref = String(item?.ref || "").slice(0, 512);
    const title = String(item?.title || "Untitled").slice(0, 200);
    if (!ref) {
      cb?.({ ok: false, error: "Missing ref" });
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const library = ensureLibrary(r.libraryPin);
    library.push({ id, type, title, ref });
    saveLibraryStores();
    emitLibraryUpdate(r.libraryPin);
    cb?.({ ok: true, library });
  });

  socket.on("library:remove", ({ pin, id }, cb) => {
    const roomCode = [...socket.rooms].find((x) => x !== socket.id);
    if (!roomCode) {
      cb?.({ ok: false, error: "No room" });
      return;
    }
    const r = rooms.get(roomCode);
    if (!r || String(pin) !== r.libraryPin) {
      cb?.({ ok: false, error: "Invalid library code" });
      return;
    }
    if (r.hostId !== socket.id) {
      cb?.({ ok: false, error: "Only the host can remove from the library" });
      return;
    }
    const library = ensureLibrary(r.libraryPin).filter((x) => x.id !== id);
    libraryStores.set(r.libraryPin, library);
    saveLibraryStores();
    emitLibraryUpdate(r.libraryPin);
    cb?.({ ok: true, library });
  });

  socket.on("disconnecting", () => {
    for (const roomCode of socket.rooms) {
      if (roomCode === socket.id) continue;
      const r = rooms.get(roomCode);
      if (!r) continue;
      r.members.delete(socket.id);
      if (r.hostId === socket.id) {
        const next = r.members.keys().next();
        r.hostId = next.done ? null : next.value;
      }
      if (r.members.size === 0) {
        rooms.delete(roomCode);
      } else {
        io.to(roomCode).emit("room:state", roomPublicState(roomCode));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Neon watch party server http://localhost:${PORT}`);
});
