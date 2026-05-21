# Neon Watch Party

A self-hosted watch party with a red / dark neon UI: YouTube search and playback, uploaded videos, text chat, optional voice chat (WebRTC mesh), emoji reactions, a PIN-protected shared library, and host controls with host transfer.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
cd neon-watch-party
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`). The API and WebSocket server listen on port **3847**; Vite proxies `/api`, `/uploads`, and `/socket.io` to it.

## How it works

1. **Create room** — Choose your own **room code** (3–16 characters). You become host and see a **library PIN** in the More/People panel. Share the room code with friends and the library PIN only with people who should manage the saved list.
2. **Join room** — Enter the code and your display name.
3. **Host** — Search YouTube and play, or upload a video file (stored under `uploads/` on the server). Viewers stay in sync.
4. **Transfer host** — Use **Transfer host** next to someone in the People panel.
5. **Library** — Enter the PIN to unlock; use **Upload video to library** or save YouTube results. Anyone with the PIN can add items; only the host can remove.
6. **Chat** — WhatsApp-style bubbles (yours on the right), typing indicators, and a send sound.
7. **Neon color** — Pick a preset or custom color in the lobby or **More** tab (saved in your browser).
8. **Mobile** — Bottom tabs: Watch, Library, Chat, More.
9. **Voice** — **Join voice** in Chat (desktop) or More (phone) requests the microphone (basic peer mesh; small groups work best).

## Notes

- Uploaded files can be large; ensure disk space and trust everyone in the room.
- YouTube search uses `youtubei.js` (no Google API key). If search fails, check server logs and network.
- Voice uses public STUN servers; some networks block WebRTC or symmetric NAT may limit connectivity.

## Production

Run `npm run build` for the static client, then serve `dist/` behind a reverse proxy that also forwards WebSockets to the Node server, or deploy client and server separately and point the Socket.IO client at your API origin.
