THE LAST TRAIN - Chapter 1: The Abandoned Station  (v0.2.0)
Mobile-first 3D survival horror. Solo + AI companion Mara. Vanilla ES modules + three.js r160 (loaded from the jsDelivr CDN).

RUN IT
1. It must be served over HTTP (ES modules + GLB loading do not work from file://).
   - Quick local test:   npx serve .        (or: python3 -m http.server 8080)  then open the URL on your phone/PC.
   - Deploy:            push the folder to Vercel (static site + the /api function). HTTPS is required for fullscreen/audio on phones.
2. Keep assets/UAL1_Standard.glb where it is (path set in src/config.js -> ASSET_UAL). If it is missing the game falls back to blocky placeholder characters.

INSTALL AS AN APP (PWA)
- Open the deployed https:// URL on your phone. Android Chrome: tap "Install app" on the title screen (or menu > Install app). iPhone Safari: Share > Add to Home Screen.
- It then opens fullscreen in landscape with its own icon and works offline after the first online load (the service worker caches the game, the model, and three.js). The AI Director still needs internet, otherwise the local director runs.
- Needs HTTPS (Vercel gives you this) or localhost. After updating the game, bump VER in sw.js so phones fetch the new files.

GROQ AI DIRECTOR
- The browser never sees your key. The client calls /api/director (api/director.js, a Vercel serverless function).
- In Vercel: Project Settings -> Environment Variables -> GROQ_API_KEY = <your key>  (optional GROQ_MODEL, default llama-3.1-8b-instant). Redeploy.
- Every ~9 s the game sends a compact state snapshot; Groq answers with ONE strategic action (hunt, investigate, stalk, ambush, retreat, hide, pressure, none).
  The client validates it against a whitelist, the threat budget, and mercy rules (no attacks right after you were hit / at low HP / while you are in the train).
- If Groq is down, slow, not configured, or you switch "AI Director" off in Settings, a local scoring director takes over automatically. Pause menu shows which is active.
- Movement, perception, pathfinding and attacks are always local game AI.

CONTROLS
Touch: left stick moves (push to the edge to sprint, or use the sprint button); drag the right side to look; big button = context action (hold for repairs/searching);
       crouch, flashlight, dodge roll, item (flare etc.), top-right: Mara commands, inventory, fullscreen, pause.
Keyboard: WASD, Shift sprint, mouse look (click to capture), E act, C crouch, F flashlight, Space dodge, G use item, 1-4 select item, I inventory, Q commands, Esc pause.

HOW A RUN GOES
Start the train from the control compartment -> arrive at Kessler Street -> find 3 fuel cells (kiosk, locker room via maintenance corridor, ticket booth) ->
repair the generator (LOUD, the Stalker will come) -> security office: rescue Elias, play the recording (PROJECT EXODUS) -> return to TR-09 and depart.
The Stalker never enters the train. Light and flares push it back; bottles and noise pull it around. Mara can follow / stay / interact (fetch supplies) / defend (throws flares).

TUNING (all in plain code)
- src/config.js: speeds, damage, noise radii, director timing.
- src/director.js: costs/budget/mercy.  src/creature.js: senses and states.  src/world.js: lamp intensities (base), fog, light pool size.
- Brightness slider in Settings multiplies exposure + ambient.
- If characters face backwards, change `facing` in src/rig.js (Math.PI flips the model). If a prop looks mis-oriented, adjust offsets in the Rig.attach calls.

KNOWN LIMITS OF THIS DROP
- Written and logic-tested headlessly (a full simulated Chapter 1 playthrough passes), but NOT yet seen on a real GPU/phone. Expect to tune lighting values, model facing, and animation feel on device.
- Single-player + AI companion only. Online 4-player co-op is the next drop (planned host-authoritative design).
- Only the Stalker creature; Crawler/Brute/Unknown come later.
- Audio is fully procedural (no audio files); voices use the browser speech engine and vary by device.
- Quality changes fully apply after reloading the page.

Files: index.html, style.css, src/*.js (main, world, player, creature, director, companion, chapter1, interact, ui, input, audio, rig, nav, fx, textures, util, config), api/director.js, assets/UAL1_Standard.glb
