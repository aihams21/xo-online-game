"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const GAMES = [
  {
    id: "xo",
    name: "إكس أو",
    nameEn: "Tic-Tac-Toe",
    icon: "❌⭕",
    desc: "اللعبة الكلاسيكية — 3 في صف",
    descEn: "Classic game — 3 in a row",
    color: "from-violet-600 to-indigo-600",
    border: "border-violet-500/40",
    hover: "hover:border-violet-400",
  },
  {
    id: "connect4",
    name: "أربعة في صف",
    nameEn: "Connect 4",
    icon: "🔴🟡",
    desc: "أسقط الأقراص — 4 في صف",
    descEn: "Drop discs — 4 in a row",
    color: "from-red-600 to-yellow-500",
    border: "border-red-500/40",
    hover: "hover:border-red-400",
  },
  {
    id: "blindmaze",
    name: "المتاهة العمياء",
    nameEn: "Blind Maze",
    icon: "🧭",
    desc: "تعاونوا — один يرى، другой يمشي",
    descEn: "Co-op — one sees, one walks",
    color: "from-cyan-600 to-emerald-500",
    border: "border-cyan-500/40",
    hover: "hover:border-cyan-400",
    coOp: true,
  },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [isApp, setIsApp] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Detect if running inside an app (Capacitor or Electron)
    const appEnv =
      typeof window !== "undefined" &&
      ((window as any).Capacitor !== undefined ||
        navigator.userAgent.includes("Electron"));
    setIsApp(appEnv);
  }, []);

  const handleSelectGame = useCallback((gameId: string) => {
    if (gameId === "blindmaze") {
      setShowTutorial(true);
      setSelectedGame(gameId);
    } else {
      setSelectedGame(gameId);
    }
  }, []);

  const handleContinueTutorial = useCallback(() => {
    setShowTutorial(false);
  }, []);

  const handleCreateRoom = useCallback(() => {
    if (!name.trim() || !selectedGame) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    router.push(`/game/${selectedGame}?room=${code}&name=${encodeURIComponent(name.trim())}&host=1`);
  }, [name, selectedGame, router]);

  const handleJoinRoom = useCallback(() => {
    if (!name.trim() || !roomCode.trim() || !selectedGame) return;
    router.push(`/game/${selectedGame}?room=${roomCode.trim().toUpperCase()}&name=${encodeURIComponent(name.trim())}`);
  }, [name, roomCode, selectedGame, router]);

  const copyDownloadLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectedGameData = GAMES.find((g) => g.id === selectedGame);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg fade-in">
        <div className="text-center mb-8">
          <h1 className="text-6xl font-black mb-2">
            <span className="neon-x">X</span>
            <span className="text-slate-500 mx-2">/</span>
            <span className="neon-o">O</span>
          </h1>
          <p className="text-slate-400 text-lg">Online — أونلاين</p>
          <p className="text-slate-500 text-sm mt-1">العب مع أي شخص في العالم</p>
        </div>

        <div className="glass p-6 space-y-4">
          <input
            className="input"
            placeholder="اسمك / Your name"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {!selectedGame && (
            <>
              <p className="text-center text-slate-300 font-semibold text-sm">
                اختر لعبة / Choose a game
              </p>
              <div className="grid grid-cols-1 gap-3">
                {GAMES.map((game) => (
                  <button
                    key={game.id}
                    onClick={() => handleSelectGame(game.id)}
                    disabled={!name.trim()}
                    className={`glass p-4 text-right border ${game.border} ${game.hover} transition-all duration-200 hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{game.icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-100">{game.name}</span>
                          <span className="text-xs text-slate-500">({game.nameEn})</span>
                          {(game as any).coOp && (
                            <span className="text-[10px] bg-emerald-600/30 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                              تعاوني
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{game.desc}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {selectedGame && !showTutorial && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-secondary text-sm"
                  onClick={() => { setSelectedGame(null); setShowJoin(false); }}
                >
                  ← رجوع
                </button>
                <span className="text-slate-300 text-sm font-semibold">
                  {selectedGameData?.icon} {selectedGameData?.name}
                </span>
              </div>

              {!showJoin ? (
                <button
                  className="btn btn-primary w-full"
                  onClick={handleCreateRoom}
                  disabled={!name.trim()}
                >
                  🎮 إنشاء غرفة / Create Room
                </button>
              ) : null}

              <button
                className="btn btn-secondary w-full"
                onClick={() => setShowJoin(true)}
              >
                🔗 انضمام لغرفة / Join Room
              </button>

              {showJoin && (
                <div className="space-y-2">
                  <input
                    className="input text-center tracking-widest uppercase"
                    placeholder="رمز الغرفة / Room Code"
                    maxLength={6}
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  />
                  <button
                    className="btn btn-primary w-full"
                    onClick={handleJoinRoom}
                    disabled={!name.trim() || !roomCode.trim()}
                  >
                    انضمام / Join
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Download section — hidden in app, shown on web */}
        {!isApp && (
          <div className="glass p-6 mt-6">
            <h3 className="text-center text-slate-300 font-semibold mb-4">
              📥 تنزيل التطبيق / Download App
            </h3>
            <div className="grid grid-cols-1 gap-2">
              <a
                href="https://github.com/aihams21/xo-online-game/releases/download/v1.0.0/app-debug.apk"
                className="btn btn-secondary w-full"
                download
              >
                🤖 Android (APK)
              </a>
              <a
                href="https://github.com/aihams21/xo-online-game/releases/download/v1.0.0/XO.Online-1.0.0.AppImage"
                className="btn btn-secondary w-full"
                download
              >
                🐧 Linux (AppImage)
              </a>
              <a
                href="https://github.com/aihams21/xo-online-game/releases/download/v1.0.0/XO.Online.Setup.1.0.0.exe"
                className="btn btn-secondary w-full"
                download
              >
                🪟 Windows (.exe)
              </a>
            </div>
            <p className="text-slate-500 text-xs text-center mt-3">
              أو العب مباشرة في المتصفح — No install needed
            </p>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-6">
          Powered by PeerJS • Works globally • Free
        </p>
      </div>

      {/* Tutorial Modal for Blind Maze */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="glass max-w-md w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="text-center">
              <span className="text-5xl">🧭</span>
              <h2 className="text-2xl font-bold mt-2 text-cyan-300">المتاهة العمياء</h2>
              <p className="text-slate-400 text-sm">Blind Maze — Cooperative</p>
            </div>

            <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
              <div className="glass p-3 border border-cyan-500/20">
                <p className="font-semibold text-cyan-300 mb-1">🎯 الهدف</p>
                <p>الوصول إلى المخرج (🟢) قبل انتهاء الوقت. لاعبان، هدف واحد.</p>
              </div>

              <div className="glass p-3 border border-violet-500/20">
                <p className="font-semibold text-violet-300 mb-1">👁️ المرشد (Guide)</p>
                <p>يرى الخريطة كاملة — الجدران، الممرات، المخرج، الفخاخ، وموقع المشي. يوجه المشي عبر الدردشة ويضع إشارات (ping) على الخلايا.</p>
              </div>

              <div className="glass p-3 border border-amber-500/20">
                <p className="font-semibold text-amber-300 mb-1">🚶 المشي (Walker)</p>
                <p>يمشي في الظلام — يرى فقط 3×3 خلايا حوله. يتحرك بالأسهم/الأزرار. يتبع توجيهات المرشد.</p>
              </div>

              <div className="glass p-3 border border-red-500/20">
                <p className="font-semibold text-red-300 mb-1">⚠️ الفخاخ والوقت</p>
                <p>3 حيوات. 3 فخاخ مخفية. 2 دقيقة. كل فخ = -1 حياة. 0 حيوات = خسارة.</p>
              </div>

              <div className="glass p-3 border border-emerald-500/20">
                <p className="font-semibold text-emerald-300 mb-1">💬 التواصل</p>
                <p>استخدم الدردشة (💬) للتواصل. المرشد يصف الطريق، المشي يسأل ويتحرك.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                className="btn btn-secondary flex-1"
                onClick={() => { setShowTutorial(false); setSelectedGame(null); }}
              >
                إلغاء
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={handleContinueTutorial}
              >
                متابعة / Continue →
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}