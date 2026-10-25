"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import Peer from "peerjs";

// ─── Maze constants ───
const MAZE_SIZE = 21;
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
  mapIndex: number;
};

// ─── Seeded PRNG (mulberry32) ───
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Maze generation (seeded recursive backtracking) ───
function generateMazeWithSeed(seed: number): { maze: CellType[][]; start: Pos; exit: Pos } {
  const rng = mulberry32(seed);
  const size = MAZE_SIZE;
  const maze: CellType[][] = Array.from({ length: size }, () =>
    Array(size).fill("wall")
  );

  function carve(x: number, y: number) {
    maze[y][x] = "path";
    const dirs = [
      [0, -2],
      [0, 2],
      [-2, 0],
      [2, 0],
    ].sort(() => rng() - 0.5);
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

  const start: Pos = { x: 1, y: 1 };

  // Exit: far corner, find nearest path
  let exit: Pos = { x: size - 2, y: size - 2 };
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

  // Place traps (5-8) on path cells far from start and exit
  const trapCount = 5 + Math.floor(rng() * 4);
  let placed = 0;
  const candidates: Pos[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (maze[y][x] === "path") {
        const distStart = Math.abs(x - start.x) + Math.abs(y - start.y);
        const distExit = Math.abs(x - exit.x) + Math.abs(y - exit.y);
        if (distStart > 4 && distExit > 3) candidates.push({ x, y });
      }
    }
  }
  candidates.sort(() => rng() - 0.5);
  for (const c of candidates) {
    if (placed >= trapCount) break;
    maze[c.y][c.x] = "trap";
    placed++;
  }

  // Validate solvability with BFS; if no path, this maze is still solvable
  // because recursive backtracking always produces a perfect maze.
  // We only place traps on cells that don't disconnect the maze.
  // (No extra walls added — they caused trapped/unreachable cells.)

  return { maze, start, exit };
}

// 7 map seeds
const MAP_SEEDS = [1001, 2002, 3003, 4004, 5005, 6006, 7007];
const MAP_NAMES = [
  "المتاهة ١ — البداية",
  "المتاهة ٢ — المتاهة المظلمة",
  "المتاهة ٣ — متاهة الفخاخ",
  "المتاهة ٤ — التحدي",
  "المتاهة ٥ — المتاهة العميقة",
  "المتاهة ٦ — labyrinth of Shadows",
  "المتاهة ٧ — الفخ final",
];

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
  const [revealLeft, setRevealLeft] = useState(0);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  // Voice chat
  const [micOn, setMicOn] = useState(false);
  const [micLoading, setMicLoading] = useState(false);
  const [micError, setMicError] = useState("");
  const micOnRef = useRef(false);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  const [remoteMicOn, setRemoteMicOn] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaCallRef = useRef<any>(null);
  const guestPeerIdRef = useRef<string>("");

  // Input
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const connRef = useRef<any>(null);
  const gameRef = useRef<MazeGameState | null>(null);
  gameRef.current = game;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerRef = useRef<any>(null);

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

  // Movement request (walker → host)
  const moveWalker = useCallback((dx: number, dy: number) => {
    if (myRole !== "walker") return;
    const g = gameRef.current;
    if (!g || g.status !== "playing") return;
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
    setTimeout(() => {
      const cur = gameRef.current;
      if (cur && cur.guidePing && cur.guidePing.x === x && cur.guidePing.y === y) {
        const cleared = { ...cur, guidePing: null };
        setGame(cleared);
        gameRef.current = cleared;
      }
    }, 2000);
  }, [myRole]);

  // Voice chat: toggle mic
  const toggleMic = () => {
    if (micLoading) return;
    if (micOnRef.current) {
      // Turn off — update icon immediately
      setMicOn(false);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (mediaCallRef.current) {
        try { mediaCallRef.current.close(); } catch {}
        mediaCallRef.current = null;
      }
      setMicError("");
      // Notify other party
      if (connRef.current && connRef.current.open) {
        connRef.current.send({ type: "mic", on: false });
      }
      return;
    }

    // Turn on — show ON state immediately (optimistic), then loading
    setMicOn(true);
    setMicLoading(true);
    setMicError("");
    (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      const peer = peerRef.current;
      if (!peer) throw new Error("Peer not ready");

      const otherPeerId = isHost
        ? guestPeerIdRef.current
        : `bm-host-${room}`;

      if (!otherPeerId) throw new Error("الطرف الآخر غير متصل");

      // Close existing call if any
      if (mediaCallRef.current) {
        try { mediaCallRef.current.close(); } catch {}
        mediaCallRef.current = null;
      }

      const call = peer.call(otherPeerId, stream);
      mediaCallRef.current = call;
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => {});
        }
      });
      call.on("close", () => {
        mediaCallRef.current = null;
      });
      call.on("error", (e: any) => {
        console.error("Call error:", e);
        setMicError("خطأ في المكالمة");
      });

      setMicOn(true);
      // Notify other party
      if (connRef.current && connRef.current.open) {
        connRef.current.send({ type: "mic", on: true });
      }
    } catch (e: any) {
      console.error("Mic error:", e);
      setMicError(e?.name === "NotAllowedError" ? "تم رفض الوصول للمايك" : (e?.message || "خطأ في المايك"));
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setMicOn(false);
    } finally {
      setMicLoading(false);
    }
    })();
  };

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
  }, [status, game?.status, myRole]);

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

  // PeerJS connection
  useEffect(() => {
    if (!room) { router.push("/"); return; }

    const peerId = isHost
      ? `bm-host-${room}`
      : `bm-guest-${room}-${Math.random().toString(36).slice(2, 8)}`;

    const p = new Peer(peerId, { debug: 0 });
    peerRef.current = p;

    // Handle incoming media calls (for voice chat)
    p.on("call", (call: any) => {
      const stream = localStreamRef.current;
      if (stream) {
        call.answer(stream);
      } else {
        // No local stream yet; answer with empty stream
        try {
          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          call.answer(dest.stream);
        } catch {
          call.answer();
        }
      }
      // If we already have a call, close it
      if (mediaCallRef.current && mediaCallRef.current !== call) {
        try { mediaCallRef.current.close(); } catch {}
      }
      mediaCallRef.current = call;
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => {});
        }
      });
      call.on("close", () => {
        mediaCallRef.current = null;
      });
    });

    const onOpen = () => {
      if (isHost) {
        setMyRole("guide");
        const mapIndex = Math.floor(Math.random() * MAP_SEEDS.length);
        const { maze, start } = generateMazeWithSeed(MAP_SEEDS[mapIndex]);
        // Find exit
        let exit = { x: MAZE_SIZE - 2, y: MAZE_SIZE - 2 };
        if (maze[exit.y][exit.x] !== "path" && maze[exit.y][exit.x] !== "exit") {
          outer: for (let r = MAZE_SIZE - 2; r >= 1; r--) {
            for (let c = MAZE_SIZE - 2; c >= 1; c--) {
              if (maze[r][c] === "path") {
                exit = { x: c, y: r };
                break outer;
              }
            }
          }
        }
        maze[start.y][start.x] = "start";
        maze[exit.y][exit.x] = "exit";

        const initial: MazeGameState = {
          maze,
          walker: start,
          guidePing: null,
          lives: 3,
          timeLeft: 180,
          status: "waiting",
          players: { guide: name, walker: "" },
          trapsTriggered: 0,
          mapIndex,
        };
        setGame(initial);
        setStatus("waiting");

        p.on("connection", (c: any) => {
          connRef.current = c;
          setConn(c);
          guestPeerIdRef.current = c.peer;
          c.on("data", (data: any) => {
            if (data.type === "join") {
              setOpponentName(data.name);
              const updated: MazeGameState = {
                ...initial,
                players: { guide: name, walker: data.name },
                status: "playing",
              };
              setGame(updated);
              gameRef.current = updated;
              setStatus("playing");
              if (c.open) c.send({ type: "state", state: updated });
            } else if (data.type === "move") {
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
              // host doesn't need to handle ping (it's the guide)
            } else if (data.type === "mic") {
              setRemoteMicOn(data.on);
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
            if (data.state.players) {
              setOpponentName(
                data.state.players.guide === name ? data.state.players.walker : data.state.players.guide
              );
            }
          } else if (data.type === "chat") {
            addChatMessage(data.sender || "الخصم", data.text, false);
          } else if (data.type === "mic") {
            setRemoteMicOn(data.on);
          } else if (data.type === "ping") {
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
      peerRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (mediaCallRef.current) {
        try { mediaCallRef.current.close(); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name, isHost, router]);

  useEffect(() => {
    setMyRole(isHost ? "guide" : "walker");
  }, [isHost]);

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

  // Reveal timer: show full map for first 5 seconds
  useEffect(() => {
    if (status !== "playing") return;
    if (myRole !== "walker") return;
    setRevealLeft(5);
    const interval = setInterval(() => {
      setRevealLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, myRole, game?.mapIndex]);

  // Visibility: guide sees all; walker sees full map during reveal, then 7x7
  const isVisible = (x: number, y: number): boolean => {
    if (myRole === "guide") return true;
    if (!game) return false;
    if (revealLeft > 0) return true; // full map reveal
    const w = game.walker;
    return Math.abs(x - w.x) <= 3 && Math.abs(y - w.y) <= 3;
  };

  const renderCell = (cell: CellType, x: number, y: number) => {
    const visible = isVisible(x, y);
    const isWalkerPos = game?.walker.x === x && game?.walker.y === y;
    const isPing = game?.guidePing?.x === x && game?.guidePing?.y === y;

    if (!visible) {
      return (
        <div
          key={`${x}-${y}`}
          className="aspect-square bg-slate-950 rounded-sm"
          style={{ boxShadow: "inset 0 0 4px rgba(0,0,0,0.8)" }}
        />
      );
    }

    let bg = "bg-slate-800/40";
    let content: React.ReactNode = null;

    if (cell === "wall") {
      bg = "bg-slate-600/70";
    } else if (cell === "path" || cell === "start") {
      bg = "bg-slate-800/30";
    } else if (cell === "exit") {
      bg = "bg-emerald-900/50";
      content = <span className="text-emerald-400 text-sm animate-pulse">🚪</span>;
    } else if (cell === "trap") {
      if (myRole === "guide") {
        bg = "bg-red-900/40";
        content = <span className="text-red-400 text-[10px]">⚠</span>;
      } else {
        bg = "bg-slate-800/30";
      }
    }

    if (isWalkerPos) {
      content = (
        <div className="w-2/3 h-2/3 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-md shadow-cyan-500/60 animate-pulse" />
      );
    }

    const pingRing = isPing ? "ring-2 ring-yellow-400 ring-offset-1 ring-offset-slate-900" : "";
    const cursor = myRole === "guide" && cell !== "wall" ? "cursor-pointer hover:bg-cyan-900/40" : "";

    return (
      <div
        key={`${x}-${y}`}
        className={`aspect-square rounded-sm flex items-center justify-center transition-all duration-150 ${bg} ${pingRing} ${cursor}`}
        onClick={() => myRole === "guide" && handlePing(x, y)}
      >
        {content}
      </div>
    );
  };

  if (!room) return null;

  return (
    <main
      className="min-h-screen flex flex-col items-center p-1 sm:p-3 select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Hidden audio element for remote voice */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      {/* Header */}
      <div className="w-full max-w-3xl flex items-center justify-between mb-1 sm:mb-2">
        <button className="btn btn-secondary text-xs" onClick={() => router.push("/")}>
          ← خروج
        </button>
        <div className="text-center">
          <h2 className="text-base sm:text-lg font-bold text-cyan-300">🧭 المتاهة العمياء</h2>
          <p className="text-slate-500 text-[10px] sm:text-xs">غرفة: {room}</p>
        </div>
        <div className="text-right">
          <div className={`text-xs sm:text-sm font-bold ${status === "playing" ? "text-amber-400" : "text-slate-400"}`}>
            ⏱ {game ? formatTime(game.timeLeft) : "--:--"}
          </div>
          <div className="text-xs text-red-400">❤ {game?.lives ?? 3}</div>
        </div>
      </div>

      {/* Role + Status */}
      <div className="w-full max-w-3xl glass p-2 mb-1 sm:mb-2 text-center">
        <p className="text-xs sm:text-sm font-semibold">
          {status === "connecting" && "جاري الاتصال..."}
          {status === "waiting" && "في انتظار الخصم..."}
          {status === "playing" && (
            myRole === "guide"
              ? "👁️ أنت المرشد — وجه المشي (إشارات + صوت + دردشة)"
              : "🚶 أنت المشي — اتبع توجيهات المرشد (أنت ترى القليل!)"
          )}
          {status === "won" && "🎉 فزتم! وصلتم إلى المخرج!"}
          {status === "lost" && "💀 خسرتم! حاولوا مرة أخرى"}
        </p>
        {status === "waiting" && room && (
          <div className="mt-1">
            <div className="code-display text-base sm:text-lg mb-1">{room}</div>
            <p className="text-slate-400 text-xs">شارك هذا الرمز مع صديقك</p>
          </div>
        )}
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        {micError && <p className="text-red-400 text-xs mt-1">{micError}</p>}
      </div>

      {/* Players */}
      <div className="w-full max-w-3xl flex justify-between gap-2 mb-1 sm:mb-2">
        <div className={`glass p-1.5 sm:p-2 flex-1 text-center text-xs ${myRole === "guide" ? "ring-2 ring-cyan-500" : ""}`}>
          <span className="text-cyan-400 font-bold">👁️ مرشد {remoteMicOn && myRole === "walker" ? "🎤" : ""}</span>
          <div className="text-slate-300 truncate">{game?.players.guide || name}</div>
          {myRole === "guide" && <div className="text-[10px] text-cyan-400">أنت {micOn ? "🎤" : ""}</div>}
        </div>
        <div className={`glass p-1.5 sm:p-2 flex-1 text-center text-xs ${myRole === "walker" ? "ring-2 ring-amber-500" : ""}`}>
          <span className="text-amber-400 font-bold">🚶 مشي {remoteMicOn && myRole === "guide" ? "🎤" : ""}</span>
          <div className="text-slate-300 truncate">{game?.players.walker || opponentName || "..."}</div>
          {myRole === "walker" && <div className="text-[10px] text-amber-400">أنت {micOn ? "🎤" : ""}</div>}
        </div>
      </div>

      {/* Map name */}
      {game && (
        <div className="w-full max-w-3xl text-center mb-1">
          <span className="text-[10px] sm:text-xs text-slate-500">
            🗺️ {MAP_NAMES[game.mapIndex]} ({game.mapIndex + 1}/7)
          </span>
        </div>
      )}

      {/* Maze Grid */}
      {game && (
        <div className="w-full max-w-4xl mb-1 sm:mb-2 flex justify-center relative">
          {revealLeft > 0 && myRole === "walker" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-xl pointer-events-none">
              <div className="text-4xl sm:text-6xl font-black text-white animate-pulse">
                {revealLeft}
              </div>
            </div>
          )}
          <div
            className="glass p-2 sm:p-3 rounded-xl"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${MAZE_SIZE}, 1fr)`,
              gap: "1px",
              width: "min(90vw, 600px)",
              aspectRatio: "1 / 1",
            }}
          >
            {game.maze.map((row, y) =>
              row.map((cell, x) => renderCell(cell, x, y))
            )}
          </div>
          {myRole === "guide" && (
            <p className="text-slate-500 text-[10px] sm:text-xs text-center mt-1">
              انقر على خلية لتوجيه المشي • Click a cell to ping
            </p>
          )}
          {myRole === "walker" && (
            <p className="text-slate-500 text-[10px] sm:text-xs text-center mt-1">
              أنت ترى القليل — اتبع المرشد • You see little — follow the guide
            </p>
          )}
        </div>
      )}

      {/* D-pad for walker (mobile) */}
      {myRole === "walker" && status === "playing" && (
        <div className="grid grid-cols-3 gap-1 mb-2 w-28 sm:w-32">
          <div />
          <button className="btn btn-secondary text-lg py-1" onClick={() => moveWalker(0, -1)}>↑</button>
          <div />
          <button className="btn btn-secondary text-lg py-1" onClick={() => moveWalker(-1, 0)}>←</button>
          <div className="flex items-center justify-center text-slate-600 text-xs">•</div>
          <button className="btn btn-secondary text-lg py-1" onClick={() => moveWalker(1, 0)}>→</button>
          <div />
          <button className="btn btn-secondary text-lg py-1" onClick={() => moveWalker(0, 1)}>↓</button>
          <div />
        </div>
      )}

      {/* Win/Lose overlay */}
      {(status === "won" || status === "lost") && (
        <div className="w-full max-w-3xl text-center mb-2">
          <div className={`glass p-3 sm:p-4 ${status === "won" ? "border border-emerald-500/40" : "border border-red-500/40"}`}>
            <p className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">
              {status === "won" ? "🎉 فوز! / Victory!" : "💀 خسارة / Defeat"}
            </p>
            <p className="text-slate-400 text-xs sm:text-sm mb-2 sm:mb-3">
              {status === "won"
                ? "وصلتم إلى المخرج معاً! تعاون رائع."
                : "حاولوا مرة أخرى — تواصلوا بشكل أفضل!"}
            </p>
            {isHost && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const newMapIndex = (game?.mapIndex ?? 0 + 1) % MAP_SEEDS.length;
                  const { maze, start } = generateMazeWithSeed(MAP_SEEDS[newMapIndex]);
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
                  const tc = 5 + Math.floor(Math.random() * 4);
                  let pl = 0;
                  const cands: Pos[] = [];
                  for (let y = 1; y < MAZE_SIZE - 1; y++)
                    for (let x = 1; x < MAZE_SIZE - 1; x++)
                      if (maze[y][x] === "path") {
                        const ds = Math.abs(x - start.x) + Math.abs(y - start.y);
                        const de = Math.abs(x - exit.x) + Math.abs(y - exit.y);
                        if (ds > 4 && de > 3) cands.push({ x, y });
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
                    timeLeft: 180,
                    status: "playing",
                    players: game?.players || { guide: name, walker: opponentName },
                    trapsTriggered: 0,
                    mapIndex: newMapIndex,
                  };
                  setGame(newState);
                  gameRef.current = newState;
                  setRevealLeft(5);
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

      {/* Stacked floating buttons: Chat + Mic */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
        {/* Chat toggle */}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-xl sm:text-2xl transition-all duration-200 hover:scale-110 relative"
          aria-label="فتح الدردشة"
        >
          💬
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Mic toggle */}
        <button
          onClick={() => { toggleMic(); }}
          disabled={false}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-lg flex items-center justify-center text-xl sm:text-2xl transition-all duration-200 hover:scale-110 relative ${
            micOn
              ? "bg-emerald-600 hover:bg-emerald-500 text-white"
              : "bg-slate-700 hover:bg-slate-600 text-slate-300"
          } ${micLoading ? "opacity-50 cursor-wait" : ""}`}
          aria-label={micOn ? "إيقاف المايك" : "تشغيل المايك"}
        >
          {micLoading ? (
            <span className="relative">
              🎤
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full animate-ping" />
            </span>
          ) : micOn ? (
            <span className="relative">
              🎤
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
            </span>
          ) : (
            "🔇"
          )}
        </button>
      </div>

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