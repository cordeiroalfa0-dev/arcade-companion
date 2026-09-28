# Auditoria do fluxo completo no Master Games Arcade

**Data:** 20 de setembro de 2026  
**Escopo:** seleção do jogo, carregamento do player, controles, saves, retorno à partida, saída e comportamento esperado em celular na horizontal.

## Conclusão executiva

O fluxo principal está implementado e a biblioteca web funciona: a aplicação carregou o bridge WebAssembly, encontrou **175 jogos**, exibiu a lista e habilitou os botões de seleção. O player também possui uma integração coerente por `iframe`, com comunicação por `postMessage` para informar início, erro e saída.

As lacunas de código identificadas foram corrigidas nesta entrega. A interface móvel foi cuidadosamente estilizada para a orientação horizontal, mas ainda não foi possível simular toque e `pointer: coarse` na sessão de navegador disponível. Portanto, a validação mobile abaixo combina inspeção do código com o teste visual realizado no navegador, e não substitui um teste em celular físico.

## Status após a implementação

Foi implementado um protocolo de saída segura: o launcher pergunta se deve salvar, envia uma solicitação ao `iframe`, aguarda `mga-emulator-save-complete` e só então desmonta o player. Em caso de falha, são oferecidas as ações **Tentar salvar novamente** e **Sair sem salvar**. O bridge também passou a retornar `ready` e `missing` junto com a lista detalhada de BIOS.

O player agora exibe recuperação para falhas de inicialização, com **Tentar novamente** e **Voltar à biblioteca**, libera fullscreen e orientação ao sair, mostra um aviso explícito quando o celular está em retrato e mantém checkpoint periódico também em dispositivos touch. A URL do player foi versionada para impedir que o navegador reutilize a implementação antiga.

## Fluxo auditado

| Etapa | Implementação encontrada | Resultado | Lacuna principal |
|---|---|---|---|
| Entrada na aplicação | A página inicial injeta o bridge WebAssembly e o bundle remoto do launcher. | Funciona no teste local. | O launcher depende de assets remotos com hash fixo e de um repositório separado. |
| Seleção do jogo | O catálogo é carregado pelo bridge; a lista visualiza nome, busca, favoritos e recentes. | 175 jogos apareceram e os botões estavam habilitados. | Há um arquivo sem título correspondente: `cap-33s-2`; o fallback funciona, mas a catalogação está incompleta. |
| Abertura do jogo | O bridge resolve ROM e BIOS, cria um `iframe` e carrega `/web/player.html`. | Arquitetura correta. | Corrigido: falhas agora oferecem nova tentativa ou retorno à biblioteca. |
| Inicialização | O player exibe configuração de dificuldade, vídeo e controles antes de iniciar o EmulatorJS. | Implementado. | Corrigido: a tela de erro não deixa mais o usuário preso sem ação. |
| Jogo e controles | O player configura teclado, gamepad e controles touch, forçando a orientação horizontal. | Implementado por CSS e configuração do EmulatorJS. | Falta uma matriz de testes por dispositivo, especialmente para crédito, START, segundo jogador e rotação física. |
| Salvamento manual | Há 15 slots, IndexedDB, pausa temporária durante a captura e confirmação visual. | O código está melhor protegido contra estado incompleto. | Saída segura e checkpoint mobile implementados; o teste físico de toque ainda falta. |
| Carregamento | O player aguarda o core, pausa o loop, aplica o estado e só depois confirma. | Implementado e validado em build. | Ainda não há verificação independente de que o estado restaurado mudou o jogo; o sucesso depende da ausência de exceção em `loadState`. |
| Retorno à partida | O modal possui “Voltar à partida”, botão de fechar e fechamento ao tocar fora. | Implementado. | O teste físico mobile ainda falta. |
| Saída do jogo | O player solicita save; o launcher aguarda confirmação antes de remover o `iframe` e libera fullscreen/orientação. | Corrigido e validado por contrato no navegador. | O teste de toque em aparelho físico ainda falta. |

## Achados prioritários

### P0 — Saída pode perder o save em andamento

Em `public/mame-web.js`, `closePlayer()` define o `iframe` como `about:blank` e remove o overlay imediatamente. No player, o save de saída é disparado por `pagehide` e `visibilitychange`, mas essas operações usam IndexedDB de forma assíncrona. Não existe um protocolo `save-and-exit` que aguarde a conclusão da transação antes de desmontar o `iframe`.

Esse é o problema mais importante do fluxo atual. O usuário pode salvar, fechar logo depois e voltar para a lista, enquanto a gravação ainda está pendente. Em celular, a chance aumenta quando o navegador suspende a página ou troca a orientação.

**Correção recomendada:** o botão de saída deve enviar uma mensagem ao player pedindo `saveProgress()`; o player deve responder `mga-emulator-save-complete` ou `mga-emulator-save-failed`; somente depois disso o launcher deve remover o `iframe`. Se o usuário não quiser salvar, deve existir uma escolha explícita entre **Salvar e sair**, **Sair sem salvar** e **Cancelar**.

### P0 — Status de BIOS possui contrato incompatível

O bridge retorna em `/api/bios/status` um objeto com `bios`, onde cada entrada possui `name`, `available` e `id`. O launcher remoto, porém, atualiza a interface lendo `b.ready` e `b.missing`. Portanto, mesmo quando as BIOS são encontradas, o indicador pode mostrar estado incorreto ou incompleto.

**Correção recomendada:** padronizar o retorno do bridge para incluir `ready` e `missing`, ou alterar a UI para consumir `bios[].available`. Esse ajuste deve ser acompanhado de um teste para BIOS completa, BIOS ausente e catálogo indisponível.

### P1 — Falha de inicialização não oferece recuperação suficiente

O player envia uma mensagem de erro para o launcher, mas o overlay continua aberto e não apresenta um botão confiável de **Tentar novamente**, **Escolher outro jogo** ou **Voltar à biblioteca**. Uma falha de ROM, BIOS, rede ou core pode deixar o usuário preso no player.

**Correção recomendada:** transformar a mensagem de erro em um painel com diagnóstico curto, botão de nova tentativa e botão de saída. A nova tentativa deve recriar o `iframe` para limpar o estado parcial do EmulatorJS.

### P1 — Saída não limpa completamente a experiência de tela cheia

O launcher solicita fullscreen e bloqueio de orientação ao abrir o jogo. Ao sair, o código remove o overlay, mas não centraliza a saída de fullscreen nem libera explicitamente a orientação no mesmo fluxo. Dependendo do navegador, o usuário pode voltar à biblioteca ainda em fullscreen ou com a interface presa em horizontal.

**Correção recomendada:** em `closePlayer()`, chamar `document.exitFullscreen()` quando o fullscreen foi criado pelo launcher e `screen.orientation.unlock()` quando disponível. A operação deve ser protegida contra rejeição do navegador.

### P1 — Salvamento automático de saída é frágil no celular

O auto-save periódico é desativado em dispositivos touch. Neles, o sistema depende de troca de aba, `visibilitychange`, `pagehide` e saves manuais. Eventos de encerramento de página não garantem tempo suficiente para concluir uma gravação IndexedDB.

**Correção recomendada:** manter um checkpoint curto e controlado no celular quando o jogo estiver ativo, ou fazer o launcher pausar o jogo e solicitar save antes de fechar. Também é importante mostrar a data do último save e um indicador de “progresso não salvo”.

### P1 — O carregamento confirma aplicação sem prova do efeito no jogo

O fluxo atual considera sucesso quando `gameManager.loadState()` não lança exceção. Isso elimina o falso positivo mais comum, mas não comprova que o frame, pontuação ou posição do jogo mudou. Alguns cores podem aceitar o estado e consumi-lo depois.

**Correção recomendada:** registrar uma assinatura simples do estado antes e depois, quando o core permitir, ou aguardar um marco observável do EmulatorJS. O botão deve permanecer em “Restaurando...” até essa confirmação ou até um timeout claramente informado.

### P2 — Dependência de assets remotos torna a entrada frágil

`src/routes/index.tsx` carrega o CSS e o bundle do launcher por uma URL CDN com hashes fixos. O código local depende de um segundo repositório para que esses arquivos existam exatamente nessas versões. Uma publicação parcial no repositório do sistema ou uma falha do CDN pode deixar a tela sem launcher, sem que o projeto web tenha um fallback local.

**Correção recomendada:** empacotar os assets do launcher no próprio deploy web, ou implementar fallback local e checagem de versão. O pipeline deve validar que cada hash referenciado existe antes de publicar.

## Auditoria específica do celular

O CSS do player tem regras dedicadas para `orientation: landscape`, inclui áreas separadas para vídeo, direcional, botões de ação, crédito e START, e remove o menu padrão do EmulatorJS que poderia cobrir os toques. Essa estrutura é adequada para a intenção do produto.

Ainda faltam testes reais de toque para confirmar quatro cenários: tocar em crédito e START sem acionar o menu; usar o direcional enquanto a lista de saves está fechada; abrir saves em horizontal estreito sem cortar o botão de retorno; e sair do player após uma rotação ou após o teclado virtual aparecer. O modo retrato informa que o jogo deve funcionar apenas na horizontal, mas deveria apresentar uma tela de orientação explícita, em vez de depender apenas do bloqueio de orientação do navegador.

Também é necessário validar aparelhos com `safe-area-inset`, telas com notch e navegadores que recusam `screen.orientation.lock()`. A implementação captura a rejeição em vários pontos, mas não informa ao usuário que ele precisa girar o telefone manualmente.

## Itens que já funcionaram na auditoria

A aplicação local carregou o bundle e o bridge sem erros JavaScript visíveis no console. A lista foi preenchida com 175 jogos. A seleção inicial apresentou botões habilitados, busca, favoritos, recentes e configuração. Os hashes CSS e JavaScript referenciados pelo launcher estavam presentes no repositório do sistema. O build do projeto web passou, o bridge passou no `node --check` e os testes automatizados do repositório do sistema passaram.

A correção anterior do save também está presente: o salvamento manual pausa brevemente o emulador, captura o estado e retoma a execução. O modal oferece o botão **Voltar à partida**. Essa parte está funcional no código, mas ainda precisa do teste físico no celular para validar tamanho, posição e resposta ao toque.

## Plano de correção recomendado

A primeira entrega deve implementar o protocolo de saída segura. O launcher precisa esperar o save terminar antes de remover o player, liberar fullscreen e desbloquear a orientação. Na mesma entrega, o contrato de BIOS deve ser corrigido e deve ser adicionado um painel de erro com nova tentativa e retorno à biblioteca.

Na segunda entrega, deve ser criada uma suíte de testes de fluxo com pelo menos os cenários de seleção, abertura, ROM inválida, BIOS ausente, save manual, load manual, retorno, saída com e sem save e reload da página. Para o celular, os testes devem ser executados em viewport horizontal e em pelo menos um aparelho físico Android e um iPhone, com foco em toque, orientação, safe area e bloqueio de áudio.

Na terceira entrega, a dependência do CDN deve ser reduzida. O deploy deve falhar se o hash remoto não existir, e o site deve exibir uma tela de indisponibilidade clara se o catálogo ou o bundle do launcher não puder ser carregado.

## Limites desta auditoria

O teste interativo foi realizado no navegador sandbox com a aplicação local. A lista, o bridge e a montagem do fluxo foram exercitados, mas a sessão disponível não permitiu emular de forma confiável `pointer: coarse`, toque físico, notch ou rotação real de telefone. Portanto, não foi declarado que todos os botões móveis foram aprovados em hardware. Os itens de touch devem ser confirmados em dispositivo real antes de considerar o fluxo fechado.

## Referências

[1]: https://github.com/cordeiroalfa0-dev/master-games-arcade-web/blob/main/public/mame-web.js "Bridge WebAssembly e fluxo de abertura e saída do player"

[2]: https://github.com/cordeiroalfa0-dev/master-games-arcade-web/blob/main/public/web/player.html "Player EmulatorJS, controles móveis e gerenciamento de saves"

[3]: https://github.com/cordeiroalfa0-dev/master-games-arcade-web/blob/main/src/routes/index.tsx "Entrada web e carregamento dos assets do launcher"

[4]: https://github.com/cordeiroalfa0-dev/master-games-arcade-system/blob/main/dist/launcher.html "Launcher remoto, biblioteca e contrato de status"

[5]: https://github.com/cordeiroalfa0-dev/master-games-arcade-system/tree/main/tests "Testes automatizados disponíveis no repositório do sistema"


## Atualização da Auditoria (21 de setembro de 2026)

### 1. Resolução do Save State no 1942 / MAME
- A captura e restauração foram alteradas para executar com o core em andamento contínuo.
- Pausar o core congelava a rotina de VBLANK e os buffers de DMA de vídeo; com a execução contínua durante `loadState`, o driver Capcom Z80 aplica imediatamente a VRAM restaurada ao canvas.
- Estados vazios são rejeitados com feedback informativo na UI.

### 2. Acessibilidade do Botão Saves no Touch
- O botão `#btn-save` agora permanece visível no HUD touch em todas as situações móveis: dentro do launcher, fora do launcher e em modo tela cheia.
- Alvos de toque adequados com margens protegidas por `safe-area-inset-top` e `safe-area-inset-right`.
