import type { Ref } from "react";

export type ChatMessage = {
  id: string;
  senderId: string;
  name: string;
  text: string;
  at: number;
};

type Props = {
  chat: ChatMessage[];
  chatDraft: string;
  onChatDraftChange: (value: string) => void;
  onSend: () => void;
  mySocketId: string | null;
  myDisplayName: string;
  typingLabel: string | null;
  chatEndRef: Ref<HTMLDivElement>;
  voiceOn: boolean;
  voiceError: string | null;
  onToggleVoice: () => void;
  showVoiceButton?: boolean;
  compact?: boolean;
};

function formatChatTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  chat,
  chatDraft,
  onChatDraftChange,
  onSend,
  mySocketId,
  myDisplayName,
  typingLabel,
  chatEndRef,
  voiceOn,
  voiceError,
  onToggleVoice,
  showVoiceButton = true,
  compact,
}: Props) {
  return (
    <div className={`glass neon-border rounded-2xl p-3 sm:p-4 flex flex-col min-h-0 ${compact ? "" : "flex-1"}`}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="font-display text-sm text-neon-pink tracking-widest">CHAT</h3>
        {showVoiceButton && (
          <button
            type="button"
            onClick={onToggleVoice}
            className={`text-xs rounded-full px-3 py-1 border ${
              voiceOn ? "border-emerald-500/60 text-emerald-300" : "border-neon-red/60 text-neon-pink"
            }`}
          >
            {voiceOn ? "Leave voice" : "Join voice"}
          </button>
        )}
      </div>
      {voiceError && <p className="text-xs text-red-400 mb-2 shrink-0">{voiceError}</p>}
      <div
        className={`overflow-y-auto space-y-2 pr-1 bg-zinc-950/40 rounded-xl p-2 ${
          compact
            ? "h-[180px] sm:h-[220px] lg:h-[260px] lg:flex-1 lg:max-h-[300px]"
            : "flex-1 min-h-[140px] max-h-[280px] lg:max-h-[320px]"
        }`}
      >
        {chat.length === 0 && (
          <p className="text-center text-xs text-zinc-600 py-6">Chat while you watch — say hi!</p>
        )}
        {chat.map((m) => {
          const isMe = m.senderId ? m.senderId === mySocketId : m.name === myDisplayName;
          return (
            <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                  isMe ? "chat-bubble-own rounded-br-sm" : "chat-bubble-other rounded-bl-sm"
                }`}
              >
                {!isMe && <p className="text-[11px] text-neon-pink font-semibold mb-0.5">{m.name}</p>}
                <p className="text-zinc-100 whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
                <p className={`text-[10px] mt-1 tabular-nums ${isMe ? "text-right text-zinc-400" : "text-zinc-500"}`}>
                  {formatChatTime(m.at)}
                </p>
              </div>
            </div>
          );
        })}
        {typingLabel && (
          <div className="flex justify-start items-end gap-2 px-1">
            <div className="chat-bubble-other rounded-2xl rounded-bl-sm px-3 py-2.5 flex gap-1">
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
            </div>
            <span className="text-[11px] text-zinc-500 pb-1">{typingLabel}…</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="flex gap-2 mt-3 items-end shrink-0">
        <textarea
          value={chatDraft}
          onChange={(e) => onChatDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          className="flex-1 rounded-2xl bg-zinc-950/80 border border-neon-dim/50 px-4 py-2.5 text-sm resize-none max-h-24 focus-neon"
          placeholder="Message…"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!chatDraft.trim()}
          className="shrink-0 rounded-full bg-neon-red w-11 h-11 flex items-center justify-center text-white shadow-neon-sm disabled:opacity-40 active:scale-95 transition-transform"
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
