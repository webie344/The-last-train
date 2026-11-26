// Tweak the game here.
export const CFG = {
  // Serverless proxy for the Groq-powered Threat Director (see api/director.js).
  // If it is missing or slow the game silently uses the built-in fallback director.
  DIRECTOR_URL: '/api/director',
  DIRECTOR_INTERVAL: 9000,      // ms between strategic decisions
  DIRECTOR_TIMEOUT: 2800,       // ms before falling back

  ASSET_UAL: './assets/UAL1_Standard.glb',
  ASSET_SOLDIER: './assets/Soldier.glb',   // your Soldier.glb from Compound Clash (player + raiders); falls back to the mannequin if missing
  ASSET_RIFLE: './assets/Rifle.glb',       // your Rifle.glb; falls back to a built-in AK-style rifle   // Quaternius Universal Animation Library (Standard)

  PLAYER: { height: 1.78, radius: 0.34, walk: 1.9, jog: 3.7, sprint: 5.7, crouch: 1.5, hp: 100, stamina: 100 },
  CREATURE: { stalk: 1.5, investigate: 2.3, chase: 5.3, retreat: 4.2, damage: 30, hp: 1 },
  NOISE: { crouch: 1.5, walk: 4, jog: 7, sprint: 12, pickup: 3, door: 6, bottle: 16, generator: 30, roll: 8, hurt: 14 },

  VERSION: '0.3.0',
  SAVE_KEY: 'thelasttrain.save.v1',
  SET_KEY: 'thelasttrain.settings.v1',
};
