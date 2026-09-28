import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { GameLibrary } from "@/components/GameLibrary";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Master Games Arcade" },
      {
        name: "description",
        content:
          "Fliperama online com clássicos de arcade: escolha o jogo, jogue no navegador e continue de onde parou.",
      },
      { property: "og:title", content: "Master Games Arcade" },
      {
        property: "og:description",
        content: "Jogue clássicos de arcade direto no navegador e salve seu progresso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type AuthState = "checking" | "guest" | "authed";
type MgaUser = { email: string; name?: string; picture?: string };

function Index() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [user, setUser] = useState<MgaUser | null>(null);

  useEffect(() => {
    // A intro é a porta de entrada; o launcher só abre depois de pressionar Start.
    if (new URLSearchParams(window.location.search).get("launcher") !== "1") {
      window.location.replace("/intro.html");
      return;
    }

    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setUser(data.user as MgaUser);
          setAuthState("authed");
        } else {
          setAuthState("guest");
        }
      })
      .catch(() => {
        if (!cancelled) setAuthState("guest");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-sm text-cyan-400">
        Carregando...
      </div>
    );
  }

  return (
    <Launcher
      user={user}
      onLogout={() => {
        setUser(null);
        setAuthState("guest");
      }}
    />
  );
}

function Launcher({ user, onLogout }: { user: MgaUser | null; onLogout: () => void }) {
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // segue o logout local mesmo se a chamada falhar
    }
    onLogout();
  };

  const accountBadge = user ? (
    <div className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-black/50 py-1 pl-1 pr-2 font-mono text-[11px] text-cyan-300">
      {user?.picture && (
        <img
          src={user.picture}
          alt=""
          referrerPolicy="no-referrer"
          className="h-5 w-5 rounded-full"
        />
      )}
      <span className="max-w-[110px] truncate">{user?.name || user?.email}</span>
      <button
        type="button"
        onClick={logout}
        className="rounded border border-cyan-500/50 px-1.5 py-0.5 text-cyan-300 hover:bg-cyan-400/10"
      >
        Sair
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-black/50 px-2 py-1 font-mono text-[11px] text-cyan-300">
      <span>Modo convidado · saves locais</span>
      <button
        type="button"
        onClick={() => {
          window.location.href = "/api/auth/google";
        }}
        className="rounded border border-cyan-500/50 px-1.5 py-0.5 text-cyan-300 hover:bg-cyan-400/10"
      >
        Login Google
      </button>
    </div>
  );

  // A biblioteca de jogos (cards, busca, favoritos, recentes) roda
  // inteiramente neste projeto agora — veja src/components/GameLibrary.tsx.
  // Ela só usa o bridge local (public/mame-web.js) para abrir o jogo e
  // ler/gravar favoritos e recentes; não depende mais do bundle remoto
  // hospedado no repositório master-games-arcade-system.
  return <GameLibrary accountSlot={accountBadge} />;
}
