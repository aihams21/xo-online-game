"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [selectedGame, setSelectedGame] = useState<string | null>(null);

  const createRoom = (game: string) => {
    if (!name.trim()) {
      alert("الرجاء إدخال اسمك / Please enter your name");
      return;
    }
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    router.push(`/game/${game}?room=${code}&name=${encodeURIComponent(name)}&host=1`);
  };

  const joinRoom = (game: string) => {
    if (!name.trim()) {
      alert("الرجاء إدخال اسمك / Please enter your name");
      return;
    }
    if (!roomCode.trim()) {
      alert("الرجاء إدخال رمز الغرفة / Please enter room code");
      return;
    }
    router.push(`/game/${game}?room=${roomCode.toUpperCase()}&name=${encodeURIComponent(name)}`);
  };

  const games = [
    {
      id: "xo",
      name: "إكس أو",
      nameEn: "Tic-Tac-Toe",
      icon: "❌⭕",
      desc: "اللعبة الكلاسيكية — 3×3",
      descEn: "Classic game — 3×3 grid",
      color: "from-violet-600 to-fuchsia-600",
      border: "border-violet-500/30",
      hover: "hover:border-violet-400/60",
    },
    {
      id: "connect4",
      name: "أربعة في صف",
      nameEn: "Connect 4",
      icon: "🔴🟡",
      desc: "أسقط الأقراص — 7×6",
      descEn: "Drop discs — 7×6 grid",
      color: "from-red-600 to-yellow-500",
      border: "border-red-500/30",
      hover: "hover:border-red-400/60",
    },
  ];

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl fade-in">
        <div className="text-center mb-8">
          <h1 className="text-6xl font-black mb-2">
            <span className="neon-x">X</span>
            <span className="text-slate-500 mx-2">/</span>
            <span className="neon-o">O</span>
          </h1>
          <p className="text-slate-400 text-lg">Online Games — ألعاب أونلاين</p>
          <p className="text-slate-500 text-sm mt-1">العب مع أي شخص في العالم</p>
        </div>

        <div className="glass p-6 space-y-4 mb-6">
          <div className="space-y-3">
            <input
              className="input"
              placeholder="اسمك / Your name"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {!selectedGame ? (
              <>
                <p className="text-slate-300 text-sm text-center font-semibold">
                  اختر لعبة / Choose a game:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {games.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGame(g.id)}
                      className={`glass p-4 text-center transition-all duration-200 hover:scale-105 border ${g.border} ${g.hover}`}
                    >
                      <div className="text-4xl mb-2">{g.icon}</div>
                      <div className="text-lg font-bold text-white">{g.name}</div>
                      <div className="text-xs text-slate-400">{g.nameEn}</div>
                      <div className="text-xs text-slate-500 mt-1">{g.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <button
                    className="text-slate-400 hover:text-white text-sm"
                    onClick={() => { setSelectedGame(null); setShowJoin(false); }}
                  >
                    ← رجوع / Back
                  </button>
                  <span className="text-slate-300 text-sm font-semibold">
                    {games.find(g => g.id === selectedGame)?.name}
                  </span>
                </div>

                <div className="space-y-2">
                  <button
                    className="btn btn-primary w-full"
                    onClick={() => createRoom(selectedGame)}
                  >
                    🎮 إنشاء غرفة / Create Room
                  </button>
                  <button
                    className="btn btn-secondary w-full"
                    onClick={() => setShowJoin(!showJoin)}
                  >
                    🔗 انضمام لغرفة / Join Room
                  </button>
                </div>

                {showJoin && (
                  <div className="space-y-2 mt-2">
                    <input
                      className="input"
                      placeholder="رمز الغرفة / Room code"
                      maxLength={6}
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    />
                    <button
                      className="btn btn-primary w-full"
                      onClick={() => joinRoom(selectedGame)}
                    >
                      دخول / Join
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="glass p-6">
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

        <p className="text-center text-slate-600 text-xs mt-6">
          Powered by PeerJS • Works globally • Free
        </p>
      </div>
    </main>
  );
}