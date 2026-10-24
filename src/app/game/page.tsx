"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import Peer from "peerjs";

type Cell = "X" | "O" | null;
type GameState = {
  board: Cell[];
  turn: "X" | "O";
  winner: "X" | "O" | "draw" | null;
  players: { X: string; O: string };
};

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function checkWinner(board: Cell[]): "X" | "O" | "draw" | null {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(c => c !== null)) return "draw";
  return null;
}

function GameInner() {
  const params = useSearchParams();
  const router = useRouter();
  const room = params.get("room") || "";
  const name = params.get("name") || "Player";
  const isHost = params.get("host") === "1";

  const [status, setStatus] = useState<"connecting" | "waiting" | "playing" | "ended">("connecting");
  const [mySymbol, setMySymbol] = useState<"X" | "O" | null>(null);
  const [game, setGame] = useState<GameState>({
    board: Array(9).fill(null),
    turn: "X",
    winner: null,
    players: { X: "", O: "" },
  });
  const [conn, setConn] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [opponentName, setOpponentName] = useState("");
  const [error, setError] = useState("");

  const connRef = useRef<any>(null);
  const gameRef = useRef<GameState>(game);
  gameRef.current = game;

  const applyState = useCallback((state: GameState) => {
    setGame(state);
    setStatus(state.winner ? "ended" : "playing");
  }, []);

  const handleMove = useCallback((idx: number) => {
    const g = gameRef.current;
    if (status !== "playing" && status !== "ended") {
      // allow during playing only
    }
    if (status !== "playing") return;
    if (g.winner) return;
    if (g.board[idx] !== null) return;
    if (g.turn !== mySymbol) return;

    const newBoard = [...g.board];
    newBoard[idx] = mySymbol;
    const winner = checkWinner(newBoard);
    const newState: GameState = {
      board: newBoard,
      turn: mySymbol === "X" ? "O" : "X",
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
      board: Array(9).fill(null),
      turn: "X",
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
    if (!room) { router.push("/"); return; }

    const peerId = isHost
      ? `xo-host-${room}`
      : `xo-guest-${room}-${Math.random().toString(36).slice(2, 8)}`;

    const p = new Peer(peerId, { debug: 0 });

    const onOpen = () => {
      if (isHost) {
        setMySymbol("X");
        const initial: GameState = {
          board: Array(9).fill(null),
          turn: "X",
          winner: null,
          players: { X: name, O: "" },
        };
        setGame(initial);
        setStatus("waiting");

        p.on("connection", (c: any) => {
          connRef.current = c;
          setConn(c);
          c.on("open", () => {
            // wait for join message
          });
          c.on("data", (data: any) => {
            if (data.type === "join") {
              const updatedPlayers = { X: name, O: data.name };
              setOpponentName(data.name);
              const newState: GameState = {
                board: Array(9).fill(null),
                turn: "X",
                winner: null,
                players: updatedPlayers,
              };
              setGame(newState);
              setStatus("playing");
              if (c.open) c.send({ type: "state", state: newState });
            } else if (data.type === "state") {
              applyState(data.state);
            }
          });
          c.on("close", () => {
            setError("الخصم غادر الغرفة");
            setStatus("ended");
          });
        });
      } else {
        setMySymbol("O");
        const c = p.connect(`xo-host-${room}`, { reliable: true });
        connRef.current = c;
        setConn(c);
        c.on("open", () => {
          c.send({ type: "join", name });
        });
        c.on("data", (data: any) => {
          if (data.type === "state") {
            applyState(data.state);
            if (data.state.players.O) setOpponentName(data.state.players.O === name ? data.state.players.X : data.state.players.O);
          } else if (data.type === "welcome") {
            setOpponentName(data.hostName);
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

    return () => {
      p.destroy();
    };
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

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md fade-in">
        <div className="flex items-center justify-between mb-4">
          <button className="btn btn-secondary text-sm" onClick={() => router.push("/")}>
            ← خروج
          </button>
          <div className="text-center">
            <h2 className="text-xl font-bold">إكس أو / XO</h2>
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
          <div className={`glass p-3 flex-1 text-center ${game.turn === "X" ? "ring-2 ring-violet-500" : ""}`}>
            <div className="neon-x text-2xl font-black">X</div>
            <div className="text-sm text-slate-300 truncate">{game.players.X || name}</div>
            {mySymbol === "X" && <div className="text-xs text-violet-400 mt-1">أنت</div>}
          </div>
          <div className="flex items-center text-slate-500 font-bold">VS</div>
          <div className={`glass p-3 flex-1 text-center ${game.turn === "O" ? "ring-2 ring-cyan-500" : ""}`}>
            <div className="neon-o text-2xl font-black">O</div>
            <div className="text-sm text-slate-300 truncate">{game.players.O || opponentName || "..."}</div>
            {mySymbol === "O" && <div className="text-xs text-cyan-400 mt-1">أنت</div>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {game.board.map((cell, idx) => {
            const isWin = game.winner && game.winner !== "draw" &&
              WIN_LINES.some(line => line.includes(idx) && line.every(i => game.board[i] === game.winner));
            return (
              <button
                key={idx}
                className={`cell ${cell ? "filled" : ""} ${isWin ? "win" : ""}`}
                onClick={() => handleMove(idx)}
                disabled={!!cell || !!game.winner || game.turn !== mySymbol || status !== "playing"}
              >
                {cell === "X" && <span className="neon-x">X</span>}
                {cell === "O" && <span className="neon-o">O</span>}
              </button>
            );
          })}
        </div>

        {status === "ended" && game.winner !== null && (
          <div className="text-center">
            <button className="btn btn-primary" onClick={resetGame}>
              🔄 إعادة اللعب / Play Again
            </button>
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
