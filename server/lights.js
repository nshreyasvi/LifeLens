// Real stage lights from the page's fixtures: [{ r, g, b, level }] (0-255 colors, level 0-1), one per light.
// LIGHTS_OUTPUT picks where they go (dev server env):
//   sim      (default) nothing is sent; the last frame is kept so the Show view can display what would go out
//   artnet   DMX over Art-Net UDP: ARTNET_HOST (default 255.255.255.255), ARTNET_UNIVERSE (0), ARTNET_START (channel 1);
//            4 channels per fixture: dimmer, red, green, blue
//   hue      Philips Hue bridge: HUE_BRIDGE (its IP), HUE_KEY (app key), HUE_LIGHTS (light ids in fixture order, "1,2,3")
// shortcut: Art-Net and Hue are written against their specs but untested on hardware; test with a node or bridge first.
import dgram from 'node:dgram';

const env = process.env;
export const mode = ['artnet', 'hue'].includes(env.LIGHTS_OUTPUT) ? env.LIGHTS_OUTPUT : 'sim';
const state = { mode, fixtures: [], sentAt: 0, error: '' };
let socket = null;
let seq = 0;
const hueLast = new Map();
let hueAt = 0;

// One ArtDmx packet: "Art-Net\0", OpOutput 0x5000 (little-endian), protocol 14, sequence, physical, universe, length.
export function artnetPacket(channels, universe = 0, sequence = 0) {
  const len = Math.max(2, channels.length + (channels.length % 2));        // DMX length must be even, 2-512
  const head = Buffer.from([...Buffer.from('Art-Net\0'), 0x00, 0x50, 0x00, 14, sequence & 0xff, 0,
    universe & 0xff, (universe >> 8) & 0x7f, (len >> 8) & 0xff, len & 0xff]);
  const data = Buffer.alloc(len);
  channels.forEach((v, i) => { data[i] = Math.max(0, Math.min(255, Math.round(v))); });
  return Buffer.concat([head, data]);
}

// Hue wants hue 0-65535, saturation and brightness 1-254.
export function hueState({ r, g, b, level }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { on: level > 0.02, bri: Math.max(1, Math.round(254 * level)), hue: Math.round(((h * 60 + 360) % 360) / 360 * 65535),
    sat: max ? Math.round((254 * d) / max) : 0, transitiontime: 1 };
}

function sendArtnet(fixtures) {
  socket ??= dgram.createSocket('udp4');
  socket.setBroadcast?.(true);
  const start = Math.max(1, Number(env.ARTNET_START) || 1) - 1;
  const channels = new Array(start).fill(0);
  for (const f of fixtures) channels.push(255 * f.level, f.r, f.g, f.b);
  socket.send(artnetPacket(channels, Number(env.ARTNET_UNIVERSE) || 0, ++seq), 6454, env.ARTNET_HOST || '255.255.255.255',
    (err) => { state.error = err ? err.message : ''; });
}

function sendHue(fixtures) {
  if (Date.now() - hueAt < 500) return;            // ~10 commands/s is the bridge's limit: send changed lights, 2x a second
  hueAt = Date.now();
  const ids = (env.HUE_LIGHTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  fixtures.slice(0, ids.length).forEach((f, i) => {
    const body = hueState(f);
    const key = JSON.stringify([body.on, Math.round(body.bri / 13), Math.round(body.hue / 3000), Math.round(body.sat / 25)]);
    if (hueLast.get(ids[i]) === key) return;
    hueLast.set(ids[i], key);
    fetch(`http://${env.HUE_BRIDGE}/api/${env.HUE_KEY}/lights/${ids[i]}/state`, { method: 'PUT', body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500) }).then(() => { state.error = ''; }).catch((err) => { state.error = err.message; });
  });
}

export function output(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length > 32) return state;
  const clean = fixtures.map((f) => ({ r: +f.r || 0, g: +f.g || 0, b: +f.b || 0, level: Math.max(0, Math.min(1, +f.level || 0)) }));
  if (mode === 'artnet') sendArtnet(clean);
  if (mode === 'hue' && env.HUE_BRIDGE && env.HUE_KEY) sendHue(clean);
  Object.assign(state, { fixtures: clean, sentAt: Date.now() });
  return state;
}

export const status = () => state;
