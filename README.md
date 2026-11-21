# Sunset Riders (Arcade) — HTML5 remake

Fan remake of Konami's 1991 *Sunset Riders* arcade game, running in the browser and as a Windows desktop app.

This repository contains **only original source code** for the remake (emulator, renderer, input, netplay, tools and tests). It does **not** include the game ROM, Konami graphics, audio, or any other copyrighted assets. You must provide your own legally obtained MAME `ssriders.zip` (4-player World ver. EAC). The in-game loader checks the ROM and can cache it locally in the browser (IndexedDB).

*Sunset Riders* and all related characters, names and artwork are trademarks or copyrights of their respective owners (including Konami). This is an unofficial fan project and is not affiliated with, endorsed by, or connected to those owners.

**Web build:** `20261116-0825`.

## Run locally (web)

1. Clone this repository.
2. Serve the `web/` folder over HTTP (a static server is enough for single-player and for the ROM picker):

   ```bash
   python3 -m http.server --directory web 8080
   ```

3. Open `http://localhost:8080/` and select (or drag and drop) your `ssriders.zip` when asked. The file is read only in your browser; nothing is uploaded. After the first successful load it is kept in IndexedDB, so you are not asked again on that browser.

Do not put a ROM in the repo. `roms/`, `web/roms/`, `web/assets/` and `*.zip` are gitignored.

If you prefer to skip the picker on your own machine, extract the set once with `python3 tools/extract_prog.py roms/ssriders.zip`. That writes the decoded files into `web/assets/` (gitignored). When `web/assets/prog.bin` is present, the loader uses it and does not ask for the zip.

Online play (rooms, spectators, voice, online highscores) is **web-only**. It uses the `games4me-netplay` Cloudflare Worker (`sunsetriders_web`). The desktop app has no online multiplayer.

Self-hosting the legacy PHP signaler (`web/net/signal.php`) is optional and needs a `turn_config.php` next to it (not included; never commit secrets).

## Desktop (Windows x64)

The Electron app is local-only: no online play, no ROM bundled. On first launch the loader asks for your `ssriders.zip`.

```bash
cd desktop
npm install
./build.sh
```

The zip is written to `dist/desktop/` (that folder is gitignored). `desktop/icon.png` and `desktop/icon.ico` are required by the packager; add them next to `desktop/main.js` if they are not in your checkout yet.

## Controls

This 4-player set has no Start buttons: insert a coin in a player's slot, then press fire to join. The "start" keys therefore press fire.

- **P1:** arrows or WASD, Z or J fire, X or K jump, 5 coin, 1 or Enter start
- **P2:** numpad 8/4/5/6 move, numpad 0 or N fire, numpad . or M jump, 6 coin, 2 start
- **P3:** 7 coin, 3 start
- **P4:** 8 coin, 4 start
- **Service / test:** F2 (service), F9 (test / settings; this board has no DIP switches)
- **Gamepad (standard mapping):** d-pad or left stick move, A fire, B jump, Select coin, Start fire
- **Web online:** F7 multiplayer panel, Tab chat
- **Desktop:** F11 or Alt+Enter fullscreen, Esc to leave fullscreen

## Layout

- `web/` — browser game (engine, renderer, ROM loader, netplay)
- `desktop/` — Electron shell and public Windows build script
- `tools/` — packaging and verification helpers (including a ROM-free itch.io packager)
- `test/` — regression and netplay tests (they expect a local ROM; they do not ship one)
- `run/` — optional MAME helper scripts for comparison tests

## URLs

In the web game, links are relative, except the Open Graph / canonical tags, which point at the live page: `https://games4me.alwaysdata.net/sunsetriders_web/`.

The documented exception for an absolute service URL is the netplay Worker: `https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php`.

---

# Sunset Riders (Arcade) — remake em HTML5

Remake feito por fãs do arcade *Sunset Riders* (Konami, 1991), para o navegador e para um aplicativo de Windows.

Este repositório contém **somente código-fonte original** do remake (emulador, renderizador, controles, jogo online, ferramentas e testes). Ele **não** inclui a ROM do jogo, gráficos da Konami, áudio nem outros materiais protegidos por direitos autorais. Você precisa usar o seu próprio `ssriders.zip` da MAME (World 4 jogadores, versão EAC), obtido de forma legal. O carregador do jogo confere a ROM e pode guardá-la no navegador (IndexedDB).

*Sunset Riders* e os personagens, nomes e artes relacionados são marcas ou obras de seus respectivos donos (incluindo a Konami). Este é um projeto não oficial de fãs e não tem vínculo, endosso ou relação com esses donos.

**Build web:** `20261116-0825`.

## Rodar localmente (web)

1. Clone este repositório.
2. Sirva a pasta `web/` por HTTP (um servidor estático basta para um jogador e para escolher a ROM):

   ```bash
   python3 -m http.server --directory web 8080
   ```

3. Abra `http://localhost:8080/` e selecione (ou arraste) o seu `ssriders.zip` quando o jogo pedir. O arquivo é lido só no seu navegador; nada é enviado. Depois da primeira carga com sucesso ele fica no IndexedDB, e o jogo não pede de novo naquele navegador.

Não coloque a ROM no repositório. `roms/`, `web/roms/`, `web/assets/` e `*.zip` estão no `.gitignore`.

Se quiser pular a escolha do arquivo na sua máquina, extraia o set uma vez com `python3 tools/extract_prog.py roms/ssriders.zip`. Isso grava os arquivos decodificados em `web/assets/` (fora do git). Quando `web/assets/prog.bin` existe, o carregador usa esses arquivos e não pede o zip.

O jogo online (salas, espectadores, voz e placar online) é **somente na versão web**, pelo Worker `games4me-netplay` (`sunsetriders_web`). O aplicativo para desktop não tem multiplayer online.

Hospedar o sinalizador PHP antigo (`web/net/signal.php`) é opcional e exige um `turn_config.php` ao lado (não vem no repositório; nunca envie segredos no git).

## Desktop (Windows x64)

O app em Electron é só local: sem jogo online e sem ROM embutida. Na primeira abertura o carregador pede o seu `ssriders.zip`.

```bash
cd desktop
npm install
./build.sh
```

O zip vai para `dist/desktop/` (essa pasta fica de fora do git). `desktop/icon.png` e `desktop/icon.ico` são necessários para o empacote; coloque-os ao lado de `desktop/main.js` se ainda não estiverem no seu clone.

## Controles

Este set de 4 jogadores não tem botões de Start: coloque uma ficha no slot do jogador e depois aperte tiro para entrar. As teclas de "start" portanto disparam o tiro.

- **J1:** setas ou WASD, Z ou J tiro, X ou K pulo, 5 ficha, 1 ou Enter start
- **J2:** numpad 8/4/5/6 movimento, numpad 0 ou N tiro, numpad . ou M pulo, 6 ficha, 2 start
- **J3:** 7 ficha, 3 start
- **J4:** 8 ficha, 4 start
- **Serviço / teste:** F2 (serviço), F9 (teste / ajustes; esta placa não tem DIP switches)
- **Controle (mapeamento padrão):** direcional ou analógico esquerdo anda, A tiro, B pulo, Select ficha, Start tiro
- **Online na web:** F7 painel multijogador, Tab chat
- **Desktop:** F11 ou Alt+Enter tela cheia, Esc para sair da tela cheia

## Pastas

- `web/` — jogo no navegador (motor, renderizador, carregador de ROM, netplay)
- `desktop/` — casca Electron e script da build pública para Windows
- `tools/` — ferramentas de empacote e verificação (incluindo o empacotador ROM-free para o itch.io)
- `test/` — testes de regressão e netplay (eles usam uma ROM local; ela não vem no repositório)
- `run/` — scripts opcionais da MAME para testes de comparação

## URLs

No jogo web, os links são relativos, exceto as tags Open Graph / canonical, que apontam para a página no ar: `https://games4me.alwaysdata.net/sunsetriders_web/`.

A exceção documentada de URL absoluta de serviço é o Worker de netplay: `https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php`.
