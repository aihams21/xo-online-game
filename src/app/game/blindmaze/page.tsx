"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import Peer from "peerjs";

// ─── Maze constants ───
const MAZE_SIZE = 13; // odd for recursive backtracking
type CellType = "wall" | "path" | "exit" | "trap" | "start";
type Pos = { x: number; y: number };

type MazeGameState = {
  maze: CellType[][];
  walker: Pos;
  guidePing: Pos | null;
  lives: number;
  timeLeft: number;
  status: "waiting" | "playing" | "won" | "lost";
  players: { guide: string; walker: string };
  trapsTriggered: number;
  startedAt: number | null;
};

// ─── Maze generation (recursive backtracking) ───
function generateMaze(): { maze: CellType[][]; start: Pos; exit: Pos } {
  const size = MAZE_SIZE;
  const maze: CellType[][] = Array.from({ length: size }, () =>
    Array(size).fill("wall")
  );

  // Carve paths
  function carve(x: number, y: number) {
    maze[y][x] = "path";
    const dirs = [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx > 0 && nx < size - 1 && ny > 0 && ny < size - 1 && maze[ny][nx] === "wall") {
        maze[y + dy / 2][x + dx / 2] = "path";
        carve(nx, ny);
      }
    }
  }
  carve(1, 1);

  // Start and exit
  const start: Pos = { x: 1, y: 1 };
  // Find a far cell for exit
  let exit: Pos = { x: size - 2, y: size - 2 };
  // Ensure exit is a path; if not, find nearest path
  if (maze[exit.y][exit.x] !== "path") {
    outer: for (let r = size - 2; r >= 1; r--) {
      for (let c = size - 2; c >= 1; c--) {
        if (maze[r][c] === "path") {
          exit = { x: c, y: r };
          break outer;
        }
      }
    }
  }
  maze[start.y][start.x] = "start";
  maze[exit.y][exit.x] = "exit";

  // Place traps (3-5) on path cells (not start, not exit, not adjacent to start/exit)
  const trapCount = 3 + Math.floor(Math.random() * 3);
  let placed = 0;
  const candidates: Pos[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (maze[y][x] === "path") {
        const distStart = Math.abs(x - start.x) + Math.abs(y - start.y);
        const distExit = Math.abs(x - exit.x) + Math.abs(y - exit.y);
        if (distStart > 3 && distExit > 2) candidates.push({ x, y });
      }
    }
  }
  candidates.sort(() => Math.random() - 0.5);
  for (const c of candidates) {
    if (placed >= trapCount) break;
    maze[c.y][c.x] = "trap";
    placed++;
  }

  return { maze, start, exit };
}

type ChatMessage = {
  id: number;
  sender: string;
  text: string;
  time: string;
  isMe: boolean;
};

function GameInner() {
  const params = useSearchParams();
  const router = useRouter();
  const room = params.get("room") || "";
  const name = params.get("name") || "Player";
  const isHost = params.get("host") === "1";

  const [myRole, setMyRole] = useState<"guide" | "walker" | null>(null);
  const [game, setGame] = useState<MazeGameState | null>(null);
  const [conn, setConn] = useState<any>(null);
  const [error, setError] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [status, setStatus] = useState<"connecting" | "waiting" | "playing" | "won" | "lost">("connecting");

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  // Input
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const connRef = useRef<any>(null);
  const gameRef = useRef<MazeGameState | null>(null);
  gameRef.current = game;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addChatMessage = useCallback((sender: string, text: string, isMe: boolean) => {
    const msg: ChatMessage = {
      id: ++msgIdRef.current,
      sender,
      text,
      time: new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }),
      isMe,
    };
    setChatMessages((prev) => [...prev, msg]);
    if (!chatOpen) setUnreadCount((prev) => prev + 1);
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

  // Movement
  const moveWalker = useCallback((dx: number, dy: number) => {
    if (myRole !== "walker") return;
    const g = gameRef.current;
    if (!g || g.status !== "playing") return;
    // Send move request to host (host validates and broadcasts state)
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: "move", dx, dy });
    }
  }, [myRole]);

  // Guide ping
  const handlePing = useCallback((x: number, y: number) => {
    if (myRole !== "guide") return;
    const g = gameRef.current;
    if (!g || g.status !== "playing") return;
    const newState: MazeGameState = { ...g, guidePing: { x, y } };
    setGame(newState);
    gameRef.current = newState;
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: "ping", pos: { x, y } });
    }
    // Clear ping after 2s
    setTimeout(() => {
      const cur = gameRef.current;
      if (cur && cur.guidePing && cur.guidePing.x === x && cur.guidePing.y === y) {
        const cleared = { ...cur, guidePing: null };
        setGame(cleared);
        gameRef.current = cleared;
      }
    }, 2000);
  }, [myRole]);

  // Timer (host only)
  useEffect(() => {
    if (status !== "playing" || !game) return;
    if (myRole !== "guide") return;
    timerRef.current = setInterval(() => {
      setGame((prev) => {
        if (!prev || prev.status !== "playing") return prev;
        const newTime = prev.timeLeft - 1;
        if (newTime <= 0) {
          const lost = { ...prev, timeLeft: 0, status: "lost" as const };
          gameRef.current = lost;
          setStatus("lost");
          if (connRef.current && connRef.current.open) {
            connRef.current.send({ type: "state", state: lost });
          }
          return lost;
        }
        const updated = { ...prev, timeLeft: newTime };
        gameRef.current = updated;
        if (connRef.current && connRef.current.open) {
          connRef.current.send({ type: "state", state: updated });
        }
        return updated;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, game?.status]);

  // Keyboard input
  useEffect(() => {
    if (myRole !== "walker" || status !== "playing") return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); moveWalker(0, -1); break;
        case "ArrowDown": e.preventDefault(); moveWalker(0, 1); break;
        case "ArrowLeft": e.preventDefault(); moveWalker(-1, 0); break;
        case "ArrowRight": e.preventDefault(); moveWalker(1, 0); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [myRole, status, moveWalker]);

  // Swipe input
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < 30) return;
    if (absDx > absDy) {
      moveWalker(dx > 0 ? 1 : -1, 0);
    } else {
      moveWalker(0, dy > 0 ? 1 : -1);
    }
    setTouchStart(null);
  };

  useEffect(() => {
    if (!room) { router.push("/"); return; }

    const peerId = isHost
      ? `bm-host-${room}`
      : `bm-guest-${room}-${Math.random().toString(36).slice(2, 8)}`;

    const p = new Peer(peerId, { debug: 0 });

    const onOpen = () => {
      if (isHost) {
        setMyRole("guide");
        const { maze, start, exit } = generateMaze();
        const initial: MazeGameState = {
          maze,
          walker: start,
          guidePing: null,
          lives: 3,
          timeLeft: 120,
          status: "waiting",
          players: { guide: name, walker: "" },
          trapsTriggered: 0,
          startedAt: null,
        };
        setGame(initial);
        setStatus("waiting");

        p.on("connection", (c: any) => {
          connRef.current = c;
          setConn(c);
          c.on("data", (data: any) => {
            if (data.type === "join") {
              setOpponentName(data.name);
              const updated: MazeGameState = {
                ...initial,
                players: { guide: name, walker: data.name },
                status: "playing",
                startedAt: Date.now(),
              };
              setGame(updated);
              gameRef.current = updated;
              setStatus("playing");
              if (c.open) c.send({ type: "state", state: updated });
            } else if (data.type === "move") {
              // walker moved, host validates
              const g = gameRef.current;
              if (!g || g.status !== "playing") return;
              const { dx, dy } = data;
              const nx = g.walker.x + dx;
              const ny = g.walker.y + dy;
              if (nx < 0 || ny < 0 || nx >= MAZE_SIZE || ny >= MAZE_SIZE) return;
              if (g.maze[ny][nx] === "wall") return;
              let newMaze = g.maze.map((r) => [...r]);
              let newLives = g.lives;
              let newTraps = g.trapsTriggered;
              const cell = g.maze[ny][nx];
              if (cell === "trap") {
                newLives = Math.max(0, newLives - 1);
                newTraps++;
                newMaze[ny][nx] = "path";
              }
              const newState: MazeGameState = {
                ...g,
                maze: newMaze,
                walker: { x: nx, y: ny },
                lives: newLives,
                trapsTriggered: newTraps,
              };
              if (cell === "exit") {
                newState.status = "won";
              } else if (newLives <= 0) {
                newState.status = "lost";
              }
              setGame(newState);
              gameRef.current = newState;
              if (c.open) c.send({ type: "state", state: newState });
              if (newState.status === "won") setStatus("won");
              if (newState.status === "lost") setStatus("lost");
            } else if (data.type === "state") {
              applyState(data.state);
            } else if (data.type === "chat") {
              addChatMessage(data.sender || "الخصم", data.text, false);
            } else if (data.type === "ping") {
              // guide pinged, already handled by host
            }
          });
          c.on("close", () => {
            setError("الخصم غادر الغرفة");
            setStatus("lost");
          });
        });
      } else {
        setMyRole("walker");
        const c = p.connect(`bm-host-${room}`, { reliable: true });
        connRef.current = c;
        setConn(c);
        c.on("open", () => {
          c.send({ type: "join", name });
        });
        c.on("data", (data: any) => {
          if (data.type === "state") {
            applyState(data.state);
            if (data.state.players.walker === name) {
              setOpponentName(data.state.players.guide);
            } else {
              setOpponentName(data.state.players.walker === name ? data.state.players.guide : data.state.players.walker);
            }
          } else if (data.type === "chat") {
            addChatMessage(data.sender || "الخصم", data.text, false);
          } else if (data.type === "ping") {
            // Show ping on walker's view
            const g = gameRef.current;
            if (g) {
              const newState = { ...g, guidePing: data.pos };
              setGame(newState);
              gameRef.current = newState;
              setTimeout(() => {
                const cur = gameRef.current;
                if (cur && cur.guidePing && cur.guidePing.x === data.pos.x && cur.guidePing.y === data.pos.y) {
                  const cleared = { ...cur, guidePing: null };
                  setGame(cleared);
                  gameRef.current = cleared;
                }
              }, 2000);
            }
          }
        });
        c.on("close", () => {
          setError("الاتصال بالمضيف فقد");
          setStatus("lost");
        });
        c.on("error", (e: any) => {
          setError("خطأ: " + (e?.message || e));
        });
      }
    };

    const applyState = (state: MazeGameState) => {
      setGame(state);
      gameRef.current = state;
      if (state.status === "won") setStatus("won");
      else if (state.status === "lost") setStatus("lost");
      else if (state.status === "playing") setStatus("playing");
      else if (state.status === "waiting") setStatus("waiting");
      // Set role based on players
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
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name, isHost, router]);

  // Set role on mount
  useEffect(() => {
    setMyRole(isHost ? "guide" : "walker");
  }, [isHost]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (chatOpen) setUnreadCount(0);
  }, [chatOpen]);

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Render a single cell
  const renderCell = (cell: CellType, x: number, y: number, visible: boolean, isWalker: boolean, isGuide: boolean) => {
    const isWalkerPos = game?.walker.x === x && game?.walker.y === y;
    const isPing = game?.guidePing?.x === x && game?.guidePing?.y === y;

    if (!visible) {
      return (
        <div
          key={`${x}-${y}`}
          className="aspect-square bg-slate-900/80 rounded-sm"
          style={{ boxShadow: "inset 0 0 8px rgba(0,0,0,0.5)" }}
        />
      );
    }

    let bg = "bg-slate-800/60";
    let content = null;
    let extra = "";

    if (cell === "wall") {
      bg = "bg-slate-700/80";
    } else if (cell === "path" || cell === "start") {
      bg = "bg-slate-800/40";
    } else if (cell === "exit") {
      bg = "bg-emerald-900/40";
      content = <span className="text-emerald-400 text-lg animate-pulse">🚪</span>;
    } else if (cell === "trap") {
      if (isGuide) {
        bg = "bg-red-900/30";
        content = <span className="text-red-400 text-xs">⚠</span>;
      } else {
        bg = "bg-slate-800/40"; // hidden from walker
      }
    }

    if (isWalkerPos) {
      content = (
        <div className="w-3/4 h-3/4 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-cyan-500/50 animate-pulse" />
      );
    }

    if (isPing) {
      extra = "ring-2 ring-yellow-400 ring-offset-1 ring-offset-slate-900";
    }

    return (
      <div
        key={`${x}-${y}`}
        className={`aspect-square rounded-sm flex items-center justify-center transition-all duration-200 ${bg} ${extra} ${isGuide && cell !== "wall" ? "cursor-pointer hover:bg-cyan-900/30" : ""}`}
        onClick={() => isGuide && handlePing(x, y)}
        title={isGuide ? `${x},${y}` : ""}
      >
        {content}
      </div>
    );
  };

  // Determine visibility for walker (3x3 around walker)
  const isVisible = (x: number, y: number): boolean => {
    if (myRole === "guide") return true;
    if (!game) return false;
    const w = game.walker;
    return Math.abs(x - w.x) <= 1 && Math.abs(y - w.y) <= 1;
  };

  if (!room) return null;

  return (
    <main
      className="min-h-screen flex flex-col items-center p-2 sm:p-4 select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between mb-2">
        <button className="btn btn-secondary text-xs sm:text-sm" onClick={() => router.push("/")}>
          ← خروج
        </button>
        <div className="text-center">
          <h2 className="text-lg sm:text-xl font-bold text-cyan-300">🧭 المتاهة العمياء</h2>
          <p className="text-slate-500 text-xs">غرفة: {room}</p>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold ${status === "playing" ? "text-amber-400" : "text-slate-400"}`}>
            ⏱ {game ? formatTime(game.timeLeft) : "--:--"}
          </div>
          <div className="text-xs text-red-400">❤ {game?.lives ?? 3}</div>
        </div>
      </div>

      {/* Role + Status */}
      <div className="w-full max-w-2xl glass p-2 mb-2 text-center">
        <p className="text-sm font-semibold">
          {status === "connecting" && "جاري الاتصال..."}
          {status === "waiting" && "في انتظار الخصم..."}
          {status === "playing" && (
            myRole === "guide"
              ? "👁️ أنت المرشد — وجه المشي عبر الدردشة والإشارات"
              : "🚶 أنت المشي — اتبع توجيهات المرشد"
          )}
          {status === "won" && "🎉 فزتم! وصلتم إلى المخرج!"}
          {status === "lost" && "💀 خسرتم! حاولوا مرة أخرى"}
        </p>
        {status === "waiting" && room && (
          <div className="mt-2">
            <div className="code-display text-lg mb-1">{room}</div>
            <p className="text-slate-400 text-xs">شارك هذا الرمز مع صديقك</p>
          </div>
        )}
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>

      {/* Players */}
      <div className="w-full max-w-2xl flex justify-between gap-2 mb-2">
        <div className={`glass p-2 flex-1 text-center text-xs ${myRole === "guide" ? "ring-2 ring-cyan-500" : ""}`}>
          <span className="text-cyan-400 font-bold">👁️ مرشد</span>
          <div className="text-slate-300 truncate">{game?.players.guide || name}</div>
          {myRole === "guide" && <div className="text-[10px] text-cyan-400">أنت</div>}
        </div>
        <div className={`glass p-2 flex-1 text-center text-xs ${myRole === "walker" ? "ring-2 ring-amber-500" : ""}`}>
          <span className="text-amber-400 font-bold">🚶 مشي</span>
          <div className="text-slate-300 truncate">{game?.players.walker || opponentName || "..."}</div>
          {myRole === "walker" && <div className="text-[10px] text-amber-400">أنت</div>}
        </div>
      </div>

      {/* Maze Grid */}
      {game && (
        <div className="w-full max-w-2xl mb-2">
          <div
            className="glass p-2 sm:p-3 rounded-xl"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${MAZE_SIZE}, 1fr)`,
              gap: "2px",
              maxWidth: "100%",
            }}
          >
            {game.maze.map((row, y) =>
              row.map((cell, x) => renderCell(cell, x, y, isVisible(x, y), myRole === "walker", myRole === "guide"))
            )}
          </div>
          {myRole === "guide" && (
            <p className="text-slate-500 text-xs text-center mt-1">
              انقر على خلية لتوجيه المشي (ping) • Click a cell to ping the walker
            </p>
          )}
          {myRole === "walker" && (
            <p className="text-slate-500 text-xs text-center mt-1">
              استخدم الأسهم أو الأزرار أو السحب • Use arrows, buttons, or swipe
            </p>
          )}
        </div>
      )}

      {/* D-pad for walker (mobile) */}
      {myRole === "walker" && status === "playing" && (
        <div className="grid grid-cols-3 gap-1 mb-2 w-32">
          <div />
          <button
            className="btn btn-secondary text-lg py-1"
            onClick={() => moveWalker(0, -1)}
          >
            ↑
          </button>
          <div />
          <button
            className="btn btn-secondary text-lg py-1"
            onClick={() => moveWalker(-1, 0)}
          >
            ←
          </button>
          <div className="flex items-center justify-center text-slate-600 text-xs">•</div>
          <button
            className="btn btn-secondary text-lg py-1"
            onClick={() => moveWalker(1, 0)}
          >
            →
          </button>
          <div />
          <button
            className="btn btn-secondary text-lg py-1"
            onClick={() => moveWalker(0, 1)}
          >
            ↓
          </button>
          <div />
        </div>
      )}

      {/* Win/Lose overlay */}
      {(status === "won" || status === "lost") && (
        <div className="w-full max-w-2xl text-center mb-2">
          <div className={`glass p-4 ${status === "won" ? "border border-emerald-500/40" : "border border-red-500/40"}`}>
            <p className="text-2xl font-bold mb-2">
              {status === "won" ? "🎉 فوز! / Victory!" : "💀 خسارة / Defeat"}
            </p>
            <p className="text-slate-400 text-sm mb-3">
              {status === "won"
                ? "وصلتم إلى المخرج معاً! تعاون رائع."
                : "حاولوا مرة أخرى — تواصلوا بشكل أفضل!"}
            </p>
            {isHost && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const { maze, start } = generateMaze();
                  // regenerate exit
                  let exit = { x: MAZE_SIZE - 2, y: MAZE_SIZE - 2 };
                  if (maze[exit.y][exit.x] !== "path") {
                    outer: for (let r = MAZE_SIZE - 2; r >= 1; r--) {
                      for (let c = MAZE_SIZE - 2; c >= 1; c--) {
                        if (maze[r][c] === "path") { exit = { x: c, y: r }; break outer; }
                      }
                    }
                  }
                  maze[start.y][start.x] = "start";
                  maze[exit.y][exit.x] = "exit";
                  // traps
                  const tc = 3 + Math.floor(Math.random() * 3);
                  let pl = 0;
                  const cands: Pos[] = [];
                  for (let y = 1; y < MAZE_SIZE - 1; y++)
                    for (let x = 1; x < MAZE_SIZE - 1; x++)
                      if (maze[y][x] === "path") {
                        const ds = Math.abs(x - start.x) + Math.abs(y - start.y);
                        const de = Math.abs(x - exit.x) + Math.abs(y - exit.y);
                        if (ds > 3 && de > 2) cands.push({ x, y });
                      }
                  cands.sort(() => Math.random() - 0.5);
                  for (const cc of cands) {
                    if (pl >= tc) break;
                    maze[cc.y][cc.x] = "trap";
                    pl++;
                  }
                  const newState: MazeGameState = {
                    maze,
                    walker: start,
                    guidePing: null,
                    lives: 3,
                    timeLeft: 120,
                    status: "playing",
                    players: game?.players || { guide: name, walker: opponentName },
                    trapsTriggered: 0,
                    startedAt: Date.now(),
                  };
                  setGame(newState);
                  gameRef.current = newState;
                  setStatus("playing");
                  if (connRef.current && connRef.current.open) {
                    connRef.current.send({ type: "state", state: newState });
                  }
                }}
              >
                🔄 جولة جديدة / New Round
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating chat toggle */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className="fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-2xl transition-all duration-200 hover:scale-110"
        aria-label="فتح الدردشة"
      >
        💬
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div
          className="fixed bottom-20 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] glass rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ height: "360px" }}
        >
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
              <div key={msg.id} className={`flex ${msg.isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-xl px-3 py-1.5 text-sm ${
                    msg.isMe
                      ? "bg-cyan-600 text-white rounded-br-sm"
                      : "bg-slate-700 text-slate-100 rounded-bl-sm"
                  }`}
                >
                  {!msg.isMe && (
                    <div className="text-xs text-slate-400 mb-0.5 font-semibold">{msg.sender}</div>
                  )}
                  <div className="break-words">{msg.text}</div>
                  <div className={`text-[10px] mt-0.5 ${msg.isMe ? "text-cyan-200" : "text-slate-500"}`}>
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
              className="flex-1 bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
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
    </main>
  );
}

export default function BlindMaze() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-slate-400">جاري التحميل...</div>
        </div>
      }
    >
      <GameInner />
    </Suspense>
  );
}