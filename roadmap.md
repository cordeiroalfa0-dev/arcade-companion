# Roadmap & Diagnóstico — Master Games Arcade Web

## Status Atual dos Itens Prioritários

### 1. Salvamento e Restauração de Partidas (1942 / MAME Arcade) — Concluído
- **Diagnóstico da Restauração Inconclusiva:**
  - O driver do arcade Capcom 1942 (Z80 + custom video) gera um buffer de estado de aproximadamente **9.792 bytes** (RAM de trabalho Z80 + VRAM de tiles + sprite RAM + registradores de som AY-3-8910).
  - Quando o jogo era pausado com `emulator.pause(true)` ou `toggleMainLoop(0)` durante o `loadState()`, a interrupção de VBLANK ficava inativa no core do Emscripten/libretro. Isso impedia que a VRAM recém-injetada fosse rasterizada no canvas de vídeo. Consequentemente, o frame visual mantinha a imagem anterior e parecia não ter sido restaurado.
  - **Correção aplicada:**
    - A captura (`saveProgress` e `saveToSlot`) e a restauração (`applyStateWithRetry`) foram padronizadas para operar **sem pausar o core** (`resumeIfPaused()`), garantindo que o ciclo de VBLANK continue ativo.
    - Estados vazios (`byteLength === 0`) são rejeitados com notificação visual clara.
    - Após o `loadState`, é aguardado o avanço do frame loop do emulador (~450ms) para que os buffers de tela sejam redesenhados de imediato.

### 2. Modo Celular: Botão Saves Sempre Acessível no Touch — Concluído
- **Dentro e fora do Launcher:**
  - Anteriormente, o botão interno `#btn-save` era suprimido incondicionalmente no launcher (`body.mga-embedded #btn-save { display: none !important }`), o que causava a perda total de acesso aos saves quando o player mobile entrava em tela cheia (pois a barra superior externa do launcher fica oculta).
  - **Correções aplicadas:**
    - Adicionada detecção robusta de toque (`navigator.maxTouchPoints > 0`, `pointer:coarse` e `ontouchstart`) aplicando a classe `.mga-touch`.
    - O botão `#btn-save` agora permanece **sempre visível** em qualquer dispositivo touch (`body.mga-touch #btn-save`) e sempre que o modo tela cheia estiver ativo (`body.mga-fullscreen #btn-save`), além do modo standalone (`body:not(.mga-embedded)`).
    - As dimensões do alvo de toque foram ajustadas para o padrão mobile (mínimo 38px de altura, `touch-action: manipulation` e margens com `env(safe-area-inset-top)` e `env(safe-area-inset-right)`).
    - O cabeçalho do launcher em `mame-web.js` foi atualizado com suporte a `safe-area-inset` para evitar sobreposição por notch ou câmera frontal.

---

## Próximos Passos (Backlog)
- [ ] Validação interativa direta em hardware físico (dispositivos iOS Safari e Android Chrome com notch).
- [ ] Otimização do tempo de injeção de ROMs pesadas (acima de 20MB) com feedback de progresso percentual.
- [ ] Suporte a mapeamento customizado de botões touch adicionais por perfil de jogo (ex: 6 botões para CPS2/NeoGeo).
