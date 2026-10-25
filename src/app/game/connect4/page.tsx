"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import Peer from "peerjs";

// Connect 4: 7 columns x 6 rows
const COLS = 7;
const ROWS = 6;

type Cell = "R" | "Y" | null; // Red / Yellow
type GameState = {
  board: Cell[][]; // [row][col]
  turn: "R" | "Y";
  winner: "R" | "Y" | "draw" | null;
  players: { R: string; Y: string };
};

type ChatMessage = {
  id: number;
  sender: string;
  text: string;
  time: string;
  isMe: boolean;
};

function checkWinner(board: Cell[][]): "R" | "Y" | "draw" | null {
  // Check horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const v = board[r][c];
      if (v && v === board[r][c+1] && v === board[r][c+2] && v === board[r][c+3]) return v;
    }
  }
  // Check vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      const v = board[r][c];
      if (v && v === board[r+1][c] && v === board[r+2][c] && v === board[r+3][c]) return v;
    }
  }
  // Check diagonal (down-right)
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const v = board[r][c];
      if (v && v === board[r+1][c+1] && v === board[r+2][c+2] && v === board[r+3][c+3]) return v;
    }
  }
  // Check diagonal (down-left)
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      const v = board[r][c];
      if (v && v === board[r+1][c-1] && v === board[r+2][c-2] && v === board[r+3][c-3]) return v;
    }
  }
  // Check draw
  if (board[0].every(c => c !== null)) return "draw";
  return null;
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function getDropRow(board: Cell[][], col: number): number {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === null) return r;
  }
  return -1;
}

function GameInner() {
  const params = useSearchParams();
  const router = useRouter();
  const room = params.get("room") || "";
  const name = params.get("name") || "Player";
  const isHost = params.get("host") === "1";

  const [status, setStatus] = useState<"connecting" | "waiting" | "playing" | "ended">("connecting");
  const [mySymbol, setMySymbol] = useState<"R" | "Y" | null>(null);
  const [game, setGame] = useState<GameState>({
    board: emptyBoard(),
    turn: "R",
    winner: null,
    players: { R: "", Y: "" },
  });
  const [conn, setConn] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [opponentName, setOpponentName] = useState("");
  const [error, setError] = useState("");
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  const connRef = useRef<any>(null);
  const gameRef = useRef<GameState>(game);
  gameRef.current = game;

  const applyState = useCallback((state: GameState) => {
    setGame(state);
    setStatus(state.winner ? "ended" : "playing");
  }, []);

  const addChatMessage = useCallback((sender: string, text: string, isMe: boolean) => {
    const msg: ChatMessage = {
      id: ++msgIdRef.current,
      sender,
      text,
      time: new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }),
      isMe,
    };
    setChatMessages(prev => [...prev, msg]);
    if (!chatOpen) setUnreadCount(prev => prev + 1);
  }, [chatOpen]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    addChatMessage(name, text, true);
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: "chat", text, sender: name });
    }
    setChatInput("");
  }, [chatInput, name, addChatMessage]);

  const handleMove = useCallback((col: number) => {
    const g = gameRef.current;
    if (status !== "playing") return;
    if (g.winner) return;
    if (g.turn !== mySymbol) return;
    const row = getDropRow(g.board, col);
    if (row === -1) return;

    const newBoard = g.board.map(r => [...r]);
    newBoard[row][col] = mySymbol;
    const winner = checkWinner(newBoard);
    const newState: GameState = {
      board: newBoard,
      turn: mySymbol === "R" ? "Y" : "R",
      winner,
      players: g.players,
    };
    setGame(newState);
    setStatus(winner ? "ended" : "playing");
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: "state", state: newState });
    }
  }, [status, mySymbol]);

  const resetGame = useCallback(() => {
    const g = gameRef.current;
    const newState: GameState = {
      board: emptyBoard(),
      turn: "R",
      winner: null,
      players: g.players,
    };
    setGame(newState);
    setStatus("playing");
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: "state", state: newState });
    }
  }, []);

  useEffect(() => {
    if (chatOpen && chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (chatOpen) setUnreadCount(0);
  }, [chatOpen]);

  useEffect(() => {
    if (!room) { router.push("/"); return; }

    const peerId = isHost
      ? `c4-host-${room}`
      : `c4-guest-${room}-${Math.random().toString(36).slice(2, 8)}`;

    const p = new Peer(peerId, { debug: 0 });

    const onOpen = () => {
      if (isHost) {
        setMySymbol("R");
        const initial: GameState = {
          board: emptyBoard(),
          turn: "R",
          winner: null,
          players: { R: name, Y: "" },
        };
        setGame(initial);
        setStatus("waiting");

        p.on("connection", (c: any) => {
          connRef.current = c;
          setConn(c);
          c.on("data", (data: any) => {
            if (data.type === "join") {
              const updatedPlayers = { R: name, Y: data.name };
              setOpponentName(data.name);
              const newState: GameState = {
                board: emptyBoard(),
                turn: "R",
                winner: null,
                players: updatedPlayers,
              };
              setGame(newState);
              setStatus("playing");
              if (c.open) c.send({ type: "state", state: newState });
            } else if (data.type === "state") {
              applyState(data.state);
            } else if (data.type === "chat") {
              addChatMessage(data.sender || "الخصم", data.text, false);
            }
          });
          c.on("close", () => {
            setError("الخصم غادر الغرفة");
            setStatus("ended");
          });
        });
      } else {
        setMySymbol("Y");
        const c = p.connect(`c4-host-${room}`, { reliable: true });
        connRef.current = c;
        setConn(c);
        c.on("open", () => {
          c.send({ type: "join", name });
        });
        c.on("data", (data: any) => {
          if (data.type === "state") {
            applyState(data.state);
            if (data.state.players.Y) setOpponentName(data.state.players.Y === name ? data.state.players.R : data.state.players.Y);
          } else if (data.type === "chat") {
            addChatMessage(data.sender || "الخصم", data.text, false);
          }
        });
        c.on("close", () => {
          setError("الاتصال بالمضيف فقد");
          setStatus("ended");
        });
        c.on("error", (e: any) => {
          setError("خطأ: " + (e?.message || e));
        });
      }
    };

    p.on("open", onOpen);
    p.on("error", (err: any) => {
      console.error("Peer error:", err);
      if (err.type === "peer-unavailable") {
        setError("الغرفة غير موجودة. تحقق من الرمز.");
      } else if (err.type === "unavailable-id") {
        setError("رمز الغرفة مستخدم. جرب رمزاً آخر.");
      } else {
        setError("خطأ في الاتصال: " + err.message);
      }
    });

    return () => { p.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name, isHost, router]);

  const copyCode = () => {
    navigator.clipboard.writeText(room);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusText = () => {
    if (status === "connecting") return "جاري الاتصال...";
    if (status === "waiting") return "في انتظار الخصم...";
    if (status === "ended") {
      if (game.winner === "draw") return "تعادل! 🤝";
      if (game.winner === mySymbol) return "فزت! 🎉";
      return "خسرت! 😢";
    }
    if (game.turn === mySymbol) return "دورك! 🎯";
    return "دور الخصم...";
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  const renderCell = (r: number, c: number) => {
    const cell = game.board[r][c];
    const isWin = game.winner && game.winner !== "draw" && false; // placeholder, could compute
    return (
      <div
        key={`${r}-${c}`}
        className="w-full aspect-square flex items-center justify-center"
      >
        {cell === "R" && (
          <div className="w-[85%] h-[85%] rounded-full bg-gradient-to-br from-red-400 to-red-600 shadow-lg shadow-red-500/40 border-2 border-red-300/30" />
        )}
        {cell === "Y" && (
          <div className="w-[85%] h-[85%] rounded-full bg-gradient-to-br from-yellow-300 to-yellow-500 shadow-lg shadow-yellow-500/40 border-2 border-yellow-200/30" />
        )}
      </div>
    );
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg fade-in relative">
        <div className="flex items-center justify-between mb-4">
          <button className="btn btn-secondary text-sm" onClick={() => router.push("/")}>
            ← خروج
          </button>
          <div className="text-center">
            <h2 className="text-xl font-bold">أربعة في صف / Connect 4</h2>
            <p className="text-slate-500 text-xs">غرفة: {room}</p>
          </div>
          <div className="w-16" />
        </div>

        <div className="glass p-4 mb-4 text-center">
          <p className="text-lg font-semibold">{statusText()}</p>
          {status === "waiting" && (
            <div className="mt-3">
              <p className="text-slate-400 text-sm mb-2">شارك هذا الرمز:</p>
              <div className="code-display mb-2">{room}</div>
              <button className="btn btn-secondary text-sm" onClick={copyCode}>
                {copied ? "✅ تم النسخ" : "📋 نسخ الرمز"}
              </button>
            </div>
          )}
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        <div className="flex justify-between mb-4 gap-2">
          <div className={`glass p-3 flex-1 text-center ${game.turn === "R" ? "ring-2 ring-red-500" : ""}`}>
            <div className="text-red-400 text-2xl font-black">●</div>
            <div className="text-sm text-slate-300 truncate">{game.players.R || name}</div>
            {mySymbol === "R" && <div className="text-xs text-red-400 mt-1">أنت</div>}
          </div>
          <div className="flex items-center text-slate-500 font-bold">VS</div>
          <div className={`glass p-3 flex-1 text-center ${game.turn === "Y" ? "ring-2 ring-yellow-500" : ""}`}>
            <div className="text-yellow-400 text-2xl font-black">●</div>
            <div className="text-sm text-slate-300 truncate">{game.players.Y || opponentName || "..."}</div>
            {mySymbol === "Y" && <div className="text-xs text-yellow-400 mt-1">أنت</div>}
          </div>
        </div>

        {/* Board */}
        <div className="glass p-3 mb-4">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
            {Array.from({ length: COLS }, (_, c) => (
              <button
                key={`col-${c}`}
                onClick={() => handleMove(c)}
                onMouseEnter={() => setHoverCol(c)}
                onMouseLeave={() => setHoverCol(null)}
                disabled={!!game.winner || game.turn !== mySymbol || status !== "playing" || getDropRow(game.board, c) === -1}
                className="relative flex flex-col items-center justify-end pb-1 h-8 hover:bg-white/5 rounded-t-lg transition-colors disabled:cursor-not-allowed"
                aria-label={`عمود ${c + 1}`}
              >
                {hoverCol === c && !game.winner && game.turn === mySymbol && getDropRow(game.board, c) !== -1 && (
                  <div className={`w-6 h-6 rounded-full opacity-60 ${mySymbol === "R" ? "bg-red-500" : "bg-yellow-400"}`} />
                )}
              </button>
            ))}
          </div>
          <div className="grid gap-1 mt-1" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
            {game.board.map((row, r) =>
              row.map((cell, c) => (
                <div
                  key={`${r}-${c}`}
                  className="aspect-square bg-slate-800/60 rounded-lg border border-slate-700/50 flex items-center justify-center"
                >
                  {renderCell(r, c)}
                </div>
              ))
            )}
          </div>
        </div>

        {status === "ended" && game.winner !== null && (
          <div className="text-center mb-4">
            <button className="btn btn-primary" onClick={resetGame}>
              🔄 إعادة اللعب / Play Again
            </button>
          </div>
        )}

        {/* Floating chat */}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center text-2xl transition-all duration-200 hover:scale-110"
          aria-label="فتح الدردشة"
        >
          💬
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {chatOpen && (
          <div className="fixed bottom-20 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] glass rounded-2xl shadow-2xl flex flex-col overflow-hidden"
               style={{ height: "360px" }}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5">
              <h3 className="text-sm font-semibold text-slate-200">💬 دردشة / Chat</h3>
              <button
                onClick={() => setChatOpen(false)}
                className="text-slate-400 hover:text-white text-lg leading-none"
                aria-label="إغلاق"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {chatMessages.length === 0 && (
                <p className="text-slate-500 text-xs text-center mt-4">
                  لا توجد رسائل بعد. ابدأ المحادثة! 💬
                </p>
              )}
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.isMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-xl px-3 py-1.5 text-sm ${
                      msg.isMe
                        ? "bg-violet-600 text-white rounded-br-sm"
                        : "bg-slate-700 text-slate-100 rounded-bl-sm"
                    }`}
                  >
                    {!msg.isMe && (
                      <div className="text-xs text-slate-400 mb-0.5 font-semibold">{msg.sender}</div>
                    )}
                    <div className="break-words">{msg.text}</div>
                    <div className={`text-[10px] mt-0.5 ${msg.isMe ? "text-violet-200" : "text-slate-500"}`}>
                      {msg.time}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="px-3 py-2 border-t border-white/10 bg-white/5 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="اكتب رسالة..."
                className="flex-1 bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                maxLength={500}
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim()}
                className="btn btn-primary text-sm px-3 py-1.5 disabled:opacity-40"
              >
                ➤
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function Game() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-slate-400">جاري التحميل...</div></div>}>
      <GameInner />
    </Suspense>
  );
}