"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"menu" | "create" | "join">("menu");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const genCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const handleCreate = () => {
    if (!name.trim()) { setError("أدخل اسمك أولاً"); return; }
    const roomCode = genCode();
    localStorage.setItem("playerName", name.trim());
    localStorage.setItem("roomCode", roomCode);
    localStorage.setItem("isHost", "true");
    router.push(`/game?room=${roomCode}&name=${encodeURIComponent(name.trim())}&host=1`);
  };

  const handleJoin = () => {
    if (!name.trim()) { setError("أدخل اسمك أولاً"); return; }
    if (!code.trim() || code.trim().length < 4) { setError("أدخل رمز الغرفة (6 أحرف)"); return; }
    localStorage.setItem("playerName", name.trim());
    localStorage.setItem("roomCode", code.trim().toUpperCase());
    localStorage.setItem("isHost", "false");
    router.push(`/game?room=${code.trim().toUpperCase()}&name=${encodeURIComponent(name.trim())}&host=0`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md fade-in">
        {/* Logo */}
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
          {mode === "menu" && (
            <div className="space-y-3">
              <input
                className="input"
                placeholder="اسمك / Your name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                maxLength={20}
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button className="btn btn-primary w-full" onClick={() => { if (!name.trim()) { setError("أدخل اسمك أولاً"); return; } setMode("create"); setError(""); }}>
                🎮 إنشاء غرفة / Create Room
              </button>
              <button className="btn btn-secondary w-full" onClick={() => { if (!name.trim()) { setError("أدخل اسمك أولاً"); return; } setMode("join"); setError(""); }}>
                🔗 انضمام لغرفة / Join Room
              </button>
            </div>
          )}

          {mode === "create" && (
            <div className="space-y-3">
              <div className="text-center py-4">
                <p className="text-slate-400 mb-2">اسمك: <span className="text-white font-semibold">{name}</span></p>
                <p className="text-slate-500 text-sm">سيتم إنشاء رمز غرفة. شاركه مع صديقك.</p>
              </div>
              <button className="btn btn-primary w-full" onClick={handleCreate}>
                ✅ إنشاء والبدء / Create & Start
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setMode("menu")}>
                ← رجوع / Back
              </button>
            </div>
          )}

          {mode === "join" && (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">اسمك: <span className="text-white font-semibold">{name}</span></p>
              <input
                className="input text-center code-display"
                placeholder="ABC123"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
                maxLength={6}
              />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button className="btn btn-primary w-full" onClick={handleJoin}>
                🔗 انضمام / Join
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setMode("menu")}>
                ← رجوع / Back
              </button>
            </div>
          )}
        </div>

        {/* Download section */}
        <div className="glass p-6 mt-6">
          <h3 className="text-center text-slate-300 font-semibold mb-4">📥 تنزيل التطبيق / Download App</h3>
          <div className="grid grid-cols-1 gap-2">
            <a href="https://github.com/aihams21/xo-online-game/releases/download/v1.0.0/app-debug.apk" className="btn btn-secondary w-full" download>
              🤖 Android (APK)
            </a>
            <a href="https://github.com/aihams21/xo-online-game/releases/download/v1.0.0/XO.Online-1.0.0.AppImage" className="btn btn-secondary w-full" download>
              🐧 Linux (AppImage)
            </a>
            <a href="https://github.com/aihams21/xo-online-game/releases/download/v1.0.0/XO.Online.Setup.1.0.0.exe" className="btn btn-secondary w-full" download>
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
