'use strict';

/* =========================================================================
   CONFIG
   ========================================================================= */

// Approximate expected-putts-to-hole-out and 1-putt make% benchmarks by
// distance (feet). Modeled loosely on published tour-average putting data.
// Piecewise-linear interpolated between anchors. Practice approximation,
// not an official stat.
const EXPECTED_PUTTS_ANCHORS = [
  [1, 1.001], [2, 1.02], [3, 1.05], [4, 1.10], [5, 1.17], [6, 1.25],
  [7, 1.31], [8, 1.38], [9, 1.42], [10, 1.46], [15, 1.61], [20, 1.74],
  [25, 1.83], [30, 1.90], [40, 2.00], [50, 2.08], [60, 2.14], [70, 2.19],
  [80, 2.23], [90, 2.27], [100, 2.30]
];

const EXPECTED_MAKE_PCT_ANCHORS = [
  [1, 0.999], [2, 0.99], [3, 0.96], [4, 0.88], [5, 0.77], [6, 0.67],
  [7, 0.60], [8, 0.53], [9, 0.48], [10, 0.45], [15, 0.23], [20, 0.15],
  [25, 0.10], [30, 0.08], [40, 0.05], [50, 0.04], [60, 0.03]
];

const CATEGORY_RANGES = {
  short:    { min: 2,  max: 8  },
  breaking: { min: 6,  max: 20 },
  lag:      { min: 20, max: 50 }
};

const MIX_WEIGHTS = {
  balanced: { short: 0.40, breaking: 0.35, lag: 0.25 },
  short:    { short: 0.65, breaking: 0.25, lag: 0.10 },
  lag:      { short: 0.15, breaking: 0.25, lag: 0.60 }
};

const CATEGORY_MULT = { short: 1.0, breaking: 1.15, lag: 1.3 };
const CATEGORY_LABEL = { short: 'Short', breaking: 'Breaking', lag: 'Lag' };

const MISS_DIRECTIONS = [
  { key: 'long',       label: 'Long',        short: 'Long' },
  { key: 'longRight',  label: 'Long-Right',  short: 'L-R'  },
  { key: 'right',      label: 'Right',       short: 'Right'},
  { key: 'shortRight', label: 'Short-Right', short: 'S-R'  },
  { key: 'short',      label: 'Short',       short: 'Short'},
  { key: 'shortLeft',  label: 'Short-Left',  short: 'S-L'  },
  { key: 'left',       label: 'Left',        short: 'Left' },
  { key: 'longLeft',   label: 'Long-Left',   short: 'L-L'  }
];

const LEVEL_TITLES = [
  'Green Rookie', 'Fringe Walker', 'Lag Artist', 'Circle Chaser',
  'Clutch Putter', 'Green Reader', 'Iron Nerve', 'Stroke Saver',
  'Zero Three-Putt', 'Putting Savant'
];

const ADAPTIVE_UNLOCK_SESSIONS = 2;
const STORAGE_KEY = 'greenkeeper_v1';

/* =========================================================================
   STORAGE
   ========================================================================= */

function emptyCat() { return { count: 0, makes: 0, makePct: 0, sg: 0 }; }
function emptyLifetimeCat() { return { attempts: 0, makes: 0 }; }
function emptyMissDir() {
  const o = {};
  MISS_DIRECTIONS.forEach(d => { o[d.key] = 0; });
  o.unspecified = 0;
  return o;
}

function defaultProfile() {
  return {
    totalXP: 0,
    badges: [],
    settings: {
      units: 'ft', voice: true, sound: true, mix: 'balanced',
      puttCount: 18, adaptive: false, adaptiveEverEnabled: false
    },
    lifetime: {
      byCategory: { short: emptyLifetimeCat(), breaking: emptyLifetimeCat(), lag: emptyLifetimeCat() },
      missDir: emptyMissDir()
    }
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profile: defaultProfile(), sessions: [] };
    const parsed = JSON.parse(raw);
    const dp = defaultProfile();
    parsed.profile = Object.assign(dp, parsed.profile || {});
    parsed.profile.settings = Object.assign(dp.settings, parsed.profile.settings || {});
    parsed.profile.lifetime = parsed.profile.lifetime || dp.lifetime;
    parsed.profile.lifetime.byCategory = Object.assign(dp.lifetime.byCategory, parsed.profile.lifetime.byCategory || {});
    parsed.profile.lifetime.missDir = Object.assign(dp.lifetime.missDir, parsed.profile.lifetime.missDir || {});
    parsed.sessions = parsed.sessions || [];
    return parsed;
  } catch (e) {
    return { profile: defaultProfile(), sessions: [] };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
}

let DB = loadData();

/* =========================================================================
   UTIL / SCORING MATH
   ========================================================================= */

function interpolate(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [d0, v0] = anchors[i], [d1, v1] = anchors[i + 1];
    if (x >= d0 && x <= d1) {
      const t = (x - d0) / (d1 - d0);
      return v0 + t * (v1 - v0);
    }
  }
  return last[1];
}

function expectedPutts(distanceFt) { return interpolate(EXPECTED_PUTTS_ANCHORS, distanceFt); }
function expectedMakePct(distanceFt) { return interpolate(EXPECTED_MAKE_PCT_ANCHORS, distanceFt); }
function categoryMidpoint(cat) { const r = CATEGORY_RANGES[cat]; return (r.min + r.max) / 2; }

function fmtSG(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }
function fmtSG1(v) { return (v >= 0 ? '+' : '') + v.toFixed(1); }
function fmtPct(v) { return (v >= 0 ? '+' : '') + Math.round(v) + '%'; }

function randRange(min, max) { return min + Math.random() * (max - min); }

function weightedPick(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) { if (r < w) return k; r -= w; }
  return entries[entries.length - 1][0];
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function toMeters(ft) { return ft * 0.3048; }
function formatDistance(ft, units) { return units === 'm' ? Math.max(1, Math.round(toMeters(ft))) : Math.round(ft); }

/* =========================================================================
   STATION GENERATION
   ========================================================================= */

function generateStation(weights) {
  const category = weightedPick(weights);
  const range = CATEGORY_RANGES[category];
  const distanceFt = Math.round(randRange(range.min, range.max));

  let severity, direction = null, elevation;
  if (category === 'short') {
    severity = Math.random() < 0.7 ? 'none' : 'slight';
  } else if (category === 'breaking') {
    const r = Math.random();
    severity = r < 0.1 ? 'none' : (r < 0.6 ? 'slight' : 'big');
  } else {
    const r = Math.random();
    severity = r < 0.3 ? 'none' : (r < 0.65 ? 'slight' : 'big');
  }
  if (severity !== 'none') direction = pick(['left to right', 'right to left']);

  const er = Math.random();
  elevation = er < 0.5 ? 'level' : (er < 0.75 ? 'uphill' : 'downhill');

  let breakDesc;
  if (severity === 'none') {
    breakDesc = elevation === 'level' ? 'Straight & level' : `Straight, ${elevation}`;
  } else {
    const sevLabel = severity === 'slight' ? 'Slight break' : 'Big break';
    breakDesc = elevation === 'level' ? `${sevLabel}, ${direction}` : `${sevLabel}, ${direction}, ${elevation}`;
  }

  return { category, distanceFt, severity, direction, elevation, breakDesc };
}

/* =========================================================================
   ADAPTIVE WEIGHTING
   ========================================================================= */

function computeAdaptiveWeights() {
  const base = MIX_WEIGHTS[DB.profile.settings.mix] || MIX_WEIGHTS.balanced;
  const lifetime = DB.profile.lifetime.byCategory;
  const deficits = {};
  let anyData = false;
  ['short', 'breaking', 'lag'].forEach(cat => {
    const stats = lifetime[cat];
    if (stats && stats.attempts >= 3) {
      anyData = true;
      const actual = stats.makes / stats.attempts;
      const bench = expectedMakePct(categoryMidpoint(cat));
      deficits[cat] = Math.max(0, bench - actual);
    } else {
      deficits[cat] = 0;
    }
  });
  if (!anyData) return base;

  const boosted = {};
  ['short', 'breaking', 'lag'].forEach(cat => { boosted[cat] = base[cat] * (1 + 2.5 * deficits[cat]); });
  let sum = Object.values(boosted).reduce((a, b) => a + b, 0);
  ['short', 'breaking', 'lag'].forEach(cat => { boosted[cat] /= sum; });

  const floor = 0.1;
  ['short', 'breaking', 'lag'].forEach(cat => { if (boosted[cat] < floor) boosted[cat] = floor; });
  sum = Object.values(boosted).reduce((a, b) => a + b, 0);
  ['short', 'breaking', 'lag'].forEach(cat => { boosted[cat] /= sum; });

  return boosted;
}

function getEffectiveWeights() {
  const s = DB.profile.settings;
  if (s.adaptive && DB.sessions.length >= ADAPTIVE_UNLOCK_SESSIONS) {
    return { weights: computeAdaptiveWeights(), isAdaptive: true };
  }
  return { weights: MIX_WEIGHTS[s.mix] || MIX_WEIGHTS.balanced, isAdaptive: false };
}

/* =========================================================================
   VOICE: text-to-speech + speech recognition
   ========================================================================= */

const Voice = {
  recognition: null,
  listening: false,
  fatalError: false,
  restartTimer: null,
  supported: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window,

  speak(text) {
    if (!DB.profile.settings.voice) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* no-op */ }
  },

  start(onText) {
    if (!this.supported || !DB.profile.settings.voice) { this.setIndicator(false); return; }
    this.fatalError = false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!this.recognition) {
      this.recognition = new SR();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
        onText(transcript);
      };

      this.recognition.onerror = (event) => {
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
          this.fatalError = true;
          this.listening = false;
          this.setIndicator(false);
          disableVoiceDueToError();
        }
      };

      this.recognition.onend = () => {
        this.setIndicator(false);
        if (this.listening && !this.fatalError) {
          clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            if (this.listening && !this.fatalError) {
              try { this.recognition.start(); this.setIndicator(true); } catch (e) { /* already running */ }
            }
          }, 350);
        }
      };
    }
    try {
      this.listening = true;
      this.recognition.start();
      this.setIndicator(true);
    } catch (e) { /* already running */ }
  },

  stop() {
    this.listening = false;
    clearTimeout(this.restartTimer);
    this.setIndicator(false);
    if (this.recognition) { try { this.recognition.stop(); } catch (e) {} }
  },

  setIndicator(on) {
    const el = document.getElementById('mic-indicator');
    if (el) el.classList.toggle('listening', !!on);
  }
};

function disableVoiceDueToError() {
  DB.profile.settings.voice = false;
  saveData();
  const t = document.getElementById('toggle-voice');
  if (t) t.checked = false;
  const hint = document.getElementById('voice-hint');
  if (hint) hint.textContent = 'Microphone unavailable — using taps only';
}

const HOLED_WORDS = ['holed', 'hold', "it's in", 'its in', 'made it', 'make', 'good', 'sunk', 'bottom', 'in the hole', 'in'];
const MISS_WORDS = ['miss', 'missed', 'again', 'no make', 'lip out'];

function matchDirection(text) {
  const compounds = [
    [/long\s*-?\s*right/, 'longRight'], [/right\s*-?\s*long/, 'longRight'],
    [/long\s*-?\s*left/, 'longLeft'], [/left\s*-?\s*long/, 'longLeft'],
    [/short\s*-?\s*right/, 'shortRight'], [/right\s*-?\s*short/, 'shortRight'],
    [/short\s*-?\s*left/, 'shortLeft'], [/left\s*-?\s*short/, 'shortLeft']
  ];
  for (const [re, key] of compounds) { if (re.test(text)) return key; }
  if (/\blong\b/.test(text)) return 'long';
  if (/\bshort\b/.test(text)) return 'short';
  if (/\bright\b/.test(text)) return 'right';
  if (/\bleft\b/.test(text)) return 'left';
  return null;
}

function handleVoiceText(text) {
  if (!Round.active) return;
  if (HOLED_WORDS.some(w => text.includes(w))) { finalizeStation(true, null); return; }
  const dirKey = matchDirection(text);
  if (dirKey) { finalizeStation(false, dirKey); return; }
  if (MISS_WORDS.some(w => text.includes(w))) { finalizeStation(false, 'unspecified'); return; }
}

/* =========================================================================
   SOUND (WebAudio beeps, independent of voice)
   ========================================================================= */

const Sound = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, start, dur, gain = 0.15) {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    g.gain.setValueAtTime(gain, ctx.currentTime + start + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
    osc.stop(ctx.currentTime + start + dur);
  },
  make() { if (DB.profile.settings.sound) { this.tone(660, 0, 0.12); this.tone(880, 0.1, 0.18); } },
  miss() { if (DB.profile.settings.sound) this.tone(220, 0, 0.22, 0.12); },
  finish() {
    if (!DB.profile.settings.sound) return;
    this.tone(523, 0, 0.14); this.tone(659, 0.12, 0.14); this.tone(784, 0.24, 0.28);
  }
};

/* =========================================================================
   GAMIFICATION: XP / levels / badges
   ========================================================================= */

function xpNeededForLevel(level) { return 100 + (level - 1) * 40; }

function getLevelInfo(totalXP) {
  let level = 1, remaining = totalXP;
  while (remaining >= xpNeededForLevel(level)) { remaining -= xpNeededForLevel(level); level++; }
  const need = xpNeededForLevel(level);
  const title = level <= LEVEL_TITLES.length ? LEVEL_TITLES[level - 1] : `Green Wizard Lv${level}`;
  return { level, into: remaining, need, title };
}

const BADGE_DEFS = {
  ice_veins:  { emoji: '🧊', label: 'Ice in Veins',  desc: '5-putt make streak' },
  clutch:     { emoji: '🎯', label: 'Clutch',         desc: 'Made a 15ft+ putt' },
  lag_master: { emoji: '🪶', label: 'Lag Master',     desc: 'Made a 25ft+ lag putt' },
  sniper:     { emoji: '🔫', label: 'Sniper',         desc: '100% on short putts' },
  sharpshooter: { emoji: '🏹', label: 'Sharpshooter', desc: '70%+ makes this round' }
};

function evaluateBadges(session) {
  const earned = [];
  let maxStreak = 0, cur = 0;
  let shortMakes = 0, shortTotal = 0;
  let clutch = false, lagMaster = false;

  session.stations.forEach(st => {
    if (st.made) { cur++; maxStreak = Math.max(maxStreak, cur); } else { cur = 0; }
    if (st.category === 'short') { shortTotal++; if (st.made) shortMakes++; }
    if (st.made && st.distanceFt >= 15) clutch = true;
    if (st.made && st.category === 'lag' && st.distanceFt >= 25) lagMaster = true;
  });

  if (maxStreak >= 5) earned.push('ice_veins');
  if (clutch) earned.push('clutch');
  if (lagMaster) earned.push('lag_master');
  if (shortTotal >= 3 && shortMakes === shortTotal) earned.push('sniper');
  if (session.stations.length >= 6 && session.makePct >= 70) earned.push('sharpshooter');

  return earned;
}

/* =========================================================================
   ROUND STATE
   ========================================================================= */

const Round = {
  active: false,
  stations: [],
  current: null,
  runningSG: 0,
  points: 0,
  streak: 0,
  bestStreak: 0,
  weights: null,
  usingAdaptive: false,

  start(count) {
    const eff = getEffectiveWeights();
    this.active = true;
    this.stations = [];
    this.runningSG = 0;
    this.points = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.total = count;
    this.weights = eff.weights;
    this.usingAdaptive = eff.isAdaptive;
    this.nextStation();
  },

  nextStation() { this.current = generateStation(this.weights); },

  recordResult(made, missDirectionKey) {
    const st = this.current;
    const exp = expectedPutts(st.distanceFt);
    const assumedPutts = made ? 1 : 2;
    const sg = exp - assumedPutts;

    st.made = made;
    st.missDirection = made ? null : (missDirectionKey || 'unspecified');
    st.expected = exp;
    st.sg = sg;

    this.runningSG += sg;

    if (made) { this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); }
    else { this.streak = 0; }

    const streakMult = 1 + Math.min(this.streak > 0 ? this.streak - 1 : 0, 10) * 0.05;
    const catMult = CATEGORY_MULT[st.category];
    let basePts = Math.max(sg, 0) * 50;
    if (made) basePts += 15 + st.distanceFt * 0.8;
    st.points = Math.round(basePts * catMult * streakMult);
    this.points += st.points;

    this.stations.push(st);
    return st;
  },

  isLastStation() { return this.stations.length >= this.total; },

  finish() {
    this.active = false;
    const breakdown = { short: emptyCat(), breaking: emptyCat(), lag: emptyCat() };
    const distSum = { short: 0, breaking: 0, lag: 0 };
    const missDir = emptyMissDir();

    this.stations.forEach(st => {
      const b = breakdown[st.category];
      b.count++; b.sg += st.sg; if (st.made) b.makes++;
      distSum[st.category] += st.distanceFt;
      if (!st.made) missDir[st.missDirection] = (missDir[st.missDirection] || 0) + 1;
    });

    let weakestCategory = null, weakestDiff = 0;
    Object.entries(breakdown).forEach(([cat, b]) => {
      b.makePct = b.count ? Math.round(100 * b.makes / b.count) : 0;
      const avgDistance = b.count ? distSum[cat] / b.count : categoryMidpoint(cat);
      b.avgDistance = avgDistance;
      b.benchMakePct = Math.round(100 * expectedMakePct(avgDistance));
      b.diff = b.makePct - b.benchMakePct;
      if (b.count >= 2 && b.diff < weakestDiff) { weakestDiff = b.diff; weakestCategory = cat; }
    });

    const session = {
      id: Date.now(),
      date: new Date().toISOString(),
      puttCount: this.total,
      totalSG: this.runningSG,
      points: this.points,
      bestStreak: this.bestStreak,
      makePct: Math.round(100 * this.stations.filter(s => s.made).length / this.stations.length),
      stations: this.stations.map(s => ({
        category: s.category, distanceFt: s.distanceFt, made: s.made,
        missDirection: s.missDirection, sg: s.sg, breakDesc: s.breakDesc
      })),
      breakdown, missDir, weakestCategory, usingAdaptive: this.usingAdaptive
    };

    // lifetime accumulation
    ['short', 'breaking', 'lag'].forEach(cat => {
      const lc = DB.profile.lifetime.byCategory[cat];
      lc.attempts += breakdown[cat].count;
      lc.makes += breakdown[cat].makes;
    });
    Object.keys(missDir).forEach(k => { DB.profile.lifetime.missDir[k] += missDir[k]; });

    const newBadges = evaluateBadges(session).filter(b => !DB.profile.badges.includes(b));
    session.badgesEarned = evaluateBadges(session);
    session.newBadges = newBadges;
    DB.profile.badges = Array.from(new Set([...DB.profile.badges, ...newBadges]));

    const xpGained = Math.max(10, Math.round(this.points * 0.6) + newBadges.length * 25);
    session.xpGained = xpGained;
    DB.profile.totalXP += xpGained;

    DB.sessions.unshift(session);
    if (DB.sessions.length > 200) DB.sessions.pop();

    if (DB.sessions.length === ADAPTIVE_UNLOCK_SESSIONS && !DB.profile.settings.adaptiveEverEnabled) {
      DB.profile.settings.adaptive = true;
      DB.profile.settings.adaptiveEverEnabled = true;
      session.adaptiveJustUnlocked = true;
    }

    saveData();
    return session;
  }
};

/* =========================================================================
   COMPASS WHEEL (miss direction picker + heatmaps)
   ========================================================================= */

function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function wedgePath(cx, cy, rInner, rOuter, startAngle, endAngle) {
  const [ox1, oy1] = polarToXY(cx, cy, rOuter, startAngle);
  const [ox2, oy2] = polarToXY(cx, cy, rOuter, endAngle);
  const [ix1, iy1] = polarToXY(cx, cy, rInner, startAngle);
  const [ix2, iy2] = polarToXY(cx, cy, rInner, endAngle);
  return `M ${ox1} ${oy1} A ${rOuter} ${rOuter} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rInner} ${rInner} 0 0 0 ${ix1} ${iy1} Z`;
}

function heatColor(t) {
  const from = [22, 41, 31], to = [255, 92, 108];
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${rgb.join(',')})`;
}

function buildCompassSVG(svgEl, opts) {
  const NS = 'http://www.w3.org/2000/svg';
  svgEl.innerHTML = '';
  const cx = 130, cy = 130, rOuter = 118, rInner = 40;
  const anglePer = 360 / MISS_DIRECTIONS.length;
  const maxCount = opts.counts ? Math.max(1, ...Object.values(opts.counts)) : 1;

  MISS_DIRECTIONS.forEach((dir, i) => {
    const centerAngle = i * anglePer;
    const startAngle = centerAngle - anglePer / 2;
    const endAngle = centerAngle + anglePer / 2;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', wedgePath(cx, cy, rInner, rOuter, startAngle, endAngle));
    path.setAttribute('class', 'compass-wedge');
    path.dataset.key = dir.key;
    if (opts.counts) {
      const c = opts.counts[dir.key] || 0;
      if (c > 0) path.setAttribute('fill', heatColor(c / maxCount));
    }
    if (opts.interactive) {
      path.addEventListener('click', () => opts.onSelect(dir.key));
    }
    svgEl.appendChild(path);

    const [lx, ly] = polarToXY(cx, cy, (rInner + rOuter) / 2, centerAngle);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', lx); text.setAttribute('y', ly);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('class', 'compass-label');
    text.textContent = dir.short;
    svgEl.appendChild(text);
  });
}

/* =========================================================================
   RENDERING
   ========================================================================= */

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function renderHome() {
  const p = DB.profile;
  const lvl = getLevelInfo(p.totalXP);
  $('level-num').textContent = lvl.level;
  $('level-title').textContent = lvl.title;
  $('xp-current').textContent = lvl.into;
  $('xp-next').textContent = lvl.need;
  const circumference = 176;
  $('ring-fg').style.strokeDashoffset = String(circumference * (1 - Math.min(1, lvl.into / lvl.need)));

  $('putt-count').value = p.settings.puttCount;
  $('putt-count-label').textContent = p.settings.puttCount;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.putts) === p.settings.puttCount));
  document.querySelectorAll('.mix-btn[data-mix]').forEach(b => b.classList.toggle('active', b.dataset.mix === p.settings.mix));
  $('toggle-voice').checked = p.settings.voice;
  $('toggle-sound').checked = p.settings.sound;

  const sessionsLogged = DB.sessions.length;
  if (sessionsLogged >= ADAPTIVE_UNLOCK_SESSIONS) {
    $('adaptive-locked').style.display = 'none';
    $('adaptive-unlocked').style.display = 'block';
    $('toggle-adaptive').checked = p.settings.adaptive;
  } else {
    $('adaptive-locked').style.display = 'block';
    $('adaptive-unlocked').style.display = 'none';
    $('adaptive-progress').textContent = sessionsLogged;
    $('adaptive-unlock-total').textContent = ADAPTIVE_UNLOCK_SESSIONS;
    $('adaptive-unlock-total-2').textContent = ADAPTIVE_UNLOCK_SESSIONS;
  }

  if (DB.sessions.length) {
    const last = DB.sessions[0];
    $('last-session').style.display = 'block';
    $('last-sg').textContent = fmtSG1(last.totalSG);
    $('last-sg').className = last.totalSG >= 0 ? 'pos' : 'neg';
    $('last-putts').textContent = last.puttCount;
    $('last-make').textContent = last.makePct + '%';
  } else {
    $('last-session').style.display = 'none';
  }
}

function renderStation() {
  const st = Round.current;
  const units = DB.profile.settings.units;
  $('category-badge').textContent = CATEGORY_LABEL[st.category];
  $('category-badge').className = 'category-badge ' + st.category;
  $('distance-num').textContent = formatDistance(st.distanceFt, units);
  $('distance-unit').textContent = units === 'm' ? 'm' : 'ft';
  $('break-desc').textContent = st.breakDesc;

  $('station-num').textContent = Round.stations.length + 1;
  $('station-total').textContent = Round.total;
  $('progress-fill').style.width = (100 * Round.stations.length / Round.total) + '%';

  $('running-sg').textContent = fmtSG(Round.runningSG);
  $('running-sg').className = 'score-value ' + (Round.runningSG >= 0 ? 'pos' : 'neg');
  $('streak-val').innerHTML = Round.streak + '<span class="streak-fire">' + (Round.streak >= 2 ? '🔥' : '') + '</span>';
  $('points-val').textContent = Round.points;

  $('round-adaptive-banner').style.display = Round.usingAdaptive ? 'block' : 'none';

  const voiceHint = $('voice-hint');
  if (!Voice.supported) { voiceHint.textContent = 'Voice not supported in this browser — use the buttons'; }
  else if (!DB.profile.settings.voice) { voiceHint.textContent = ''; }
  else { voiceHint.textContent = 'Say "made" or a miss direction'; }
}

function announceStation() {
  const st = Round.current;
  const units = DB.profile.settings.units;
  const d = formatDistance(st.distanceFt, units);
  const unitWord = units === 'm' ? 'meters' : 'feet';
  Voice.speak(`Station ${Round.stations.length + 1}. ${d} ${unitWord}. ${st.breakDesc}.`);
}

function showResultToast(station) {
  const toast = $('result-toast');
  toast.className = 'result-toast';
  void toast.offsetWidth;
  if (station.made) {
    toast.classList.add('holed');
    $('result-icon').textContent = '✔';
    $('result-sg').textContent = fmtSG(station.sg);
    $('result-sg').className = 'result-sg pos';
    $('result-sub').textContent = 'strokes gained';
  } else {
    toast.classList.add('miss');
    $('result-icon').textContent = '✕';
    $('result-sg').textContent = fmtSG(station.sg);
    $('result-sg').className = 'result-sg neg';
    const dirDef = MISS_DIRECTIONS.find(d => d.key === station.missDirection);
    $('result-sub').textContent = dirDef ? 'missed ' + dirDef.label.toLowerCase() : 'strokes gained';
  }
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 900);
}

function renderBreakdownGrid(container, breakdown) {
  container.innerHTML = '';
  ['short', 'breaking', 'lag'].forEach(cat => {
    const b = breakdown[cat];
    const color = cat === 'short' ? 'blue' : cat === 'breaking' ? 'purple' : 'orange';
    const card = document.createElement('div');
    card.className = 'breakdown-card';
    card.innerHTML = `
      <div class="bd-label" style="color:var(--${color})">${CATEGORY_LABEL[cat]}</div>
      <div class="bd-make">${b.count ? b.makePct + '%' : '—'}</div>
      <div class="bd-sub">${b.count ? `${b.count} · vs ${b.benchMakePct}% avg` : 'no attempts'}</div>
      ${b.count ? `<div class="bd-sub ${b.diff >= 0 ? 'pos' : 'neg'}">${fmtPct(b.diff)}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

function renderSummary(session) {
  $('summary-sg').textContent = fmtSG1(session.totalSG);
  $('summary-sg').className = 'summary-sg ' + (session.totalSG >= 0 ? 'pos' : 'neg');
  $('xp-gained').textContent = '+' + session.xpGained;

  renderBreakdownGrid($('breakdown-grid'), session.breakdown);

  const weakEl = $('weak-callout');
  if (session.weakestCategory) {
    const b = session.breakdown[session.weakestCategory];
    weakEl.style.display = 'block';
    weakEl.innerHTML = `Weak spot this round: <strong>${CATEGORY_LABEL[session.weakestCategory]} putts</strong> — ${b.makePct}% made vs a ${b.benchMakePct}% benchmark (${fmtPct(b.diff)}).`;
  } else {
    const allOk = Object.values(session.breakdown).every(b => b.count === 0 || b.diff >= 0);
    if (allOk) {
      weakEl.style.display = 'block';
      weakEl.innerHTML = `Solid round — you matched or beat the benchmark make rate in every category you putted.`;
    } else {
      weakEl.style.display = 'none';
    }
  }

  const totalMisses = Object.values(session.missDir).reduce((a, b) => a + b, 0);
  if (totalMisses > 0) {
    $('miss-heatmap-card').style.display = 'block';
    buildCompassSVG($('summary-heatmap-svg'), { counts: session.missDir, interactive: false });
  } else {
    $('miss-heatmap-card').style.display = 'none';
  }

  const badgesRow = $('badges-row');
  badgesRow.innerHTML = '';
  if (session.adaptiveJustUnlocked) {
    const pill = document.createElement('div');
    pill.className = 'badge-pill';
    pill.innerHTML = `<span class="emoji">🧠</span><span>Adaptive Practice Unlocked!</span>`;
    badgesRow.appendChild(pill);
  }
  session.badgesEarned.forEach(key => {
    const def = BADGE_DEFS[key];
    const pill = document.createElement('div');
    pill.className = 'badge-pill';
    pill.innerHTML = `<span class="emoji">${def.emoji}</span><span>${def.label}${session.newBadges.includes(key) ? ' (new!)' : ''}</span>`;
    badgesRow.appendChild(pill);
  });
}

function renderHistory() {
  const sessions = DB.sessions;
  const stats = $('lifetime-stats');
  const totalSessions = sessions.length;
  const avgSG = totalSessions ? sessions.reduce((s, x) => s + x.totalSG, 0) / totalSessions : 0;
  const lvl = getLevelInfo(DB.profile.totalXP);
  stats.innerHTML = `
    <div class="lifetime-stat"><div class="val">${totalSessions}</div><div class="lab">Rounds</div></div>
    <div class="lifetime-stat"><div class="val ${avgSG >= 0 ? 'pos' : 'neg'}">${fmtSG1(avgSG)}</div><div class="lab">Avg SG</div></div>
    <div class="lifetime-stat"><div class="val">${lvl.level}</div><div class="lab">Level</div></div>
  `;

  drawTrend(sessions.slice(0, 12).reverse());

  const lc = DB.profile.lifetime.byCategory;
  const anyAttempts = Object.values(lc).some(c => c.attempts > 0);
  if (anyAttempts) {
    $('history-weak-card').style.display = 'block';
    const bars = $('history-weak-bars');
    bars.innerHTML = '';
    ['short', 'breaking', 'lag'].forEach(cat => {
      const c = lc[cat];
      if (!c.attempts) return;
      const actual = Math.round(100 * c.makes / c.attempts);
      const bench = Math.round(100 * expectedMakePct(categoryMidpoint(cat)));
      const diff = actual - bench;
      const row = document.createElement('div');
      row.className = 'weak-bar-row';
      row.innerHTML = `
        <div class="wb-top"><span>${CATEGORY_LABEL[cat]} (${c.attempts})</span><span class="${diff >= 0 ? 'pos' : 'neg'}">${actual}% vs ${bench}% avg</span></div>
        <div class="weak-bar-track"><div class="weak-bar-fill ${diff < 0 ? 'under' : ''}" style="width:${Math.min(100, actual)}%"></div></div>
      `;
      bars.appendChild(row);
    });
  } else {
    $('history-weak-card').style.display = 'none';
  }

  const missDir = DB.profile.lifetime.missDir;
  const totalMisses = Object.values(missDir).reduce((a, b) => a + b, 0);
  if (totalMisses > 0) {
    $('history-heatmap-card').style.display = 'block';
    buildCompassSVG($('history-heatmap-svg'), { counts: missDir, interactive: false });
  } else {
    $('history-heatmap-card').style.display = 'none';
  }

  const list = $('session-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty-state">No rounds yet. Go putt something.</div>';
    return;
  }
  list.innerHTML = '';
  sessions.slice(0, 30).forEach(s => {
    const row = document.createElement('div');
    row.className = 'session-row';
    const dt = new Date(s.date);
    const dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    row.innerHTML = `
      <div>
        <div class="sr-date">${dateStr}</div>
        <div class="sr-meta">${s.puttCount} putts · ${s.makePct}% made</div>
      </div>
      <div class="sr-sg ${s.totalSG >= 0 ? 'pos' : 'neg'}">${fmtSG1(s.totalSG)}</div>
    `;
    list.appendChild(row);
  });
}

function drawTrend(sessions) {
  const canvas = $('trend-canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = 120;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!sessions.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '13px sans-serif';
    ctx.fillText('Play a round to see your trend', 8, h / 2);
    return;
  }

  const values = sessions.map(s => s.totalSG);
  const max = Math.max(...values, 0.5);
  const min = Math.min(...values, -0.5);
  const range = max - min || 1;
  const padX = 8, padY = 10;
  const stepX = (w - padX * 2) / Math.max(1, values.length - 1);
  const zeroY = padY + (max - 0) / range * (h - padY * 2);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(padX, zeroY); ctx.lineTo(w - padX, zeroY); ctx.stroke();

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = padX + i * stepX;
    const y = padY + (max - v) / range * (h - padY * 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#c8ff5c';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  values.forEach((v, i) => {
    const x = padX + i * stepX;
    const y = padY + (max - v) / range * (h - padY * 2);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = v >= 0 ? '#c8ff5c' : '#ff5c6c';
    ctx.fill();
  });
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */

function initHome() {
  $('putt-count').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    DB.profile.settings.puttCount = v;
    $('putt-count-label').textContent = v;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.putts) === v));
    saveData();
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      DB.profile.settings.puttCount = Number(btn.dataset.putts);
      saveData();
      renderHome();
    });
  });

  document.querySelectorAll('.mix-btn[data-mix]').forEach(btn => {
    btn.addEventListener('click', () => {
      DB.profile.settings.mix = btn.dataset.mix;
      saveData();
      document.querySelectorAll('.mix-btn[data-mix]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  $('toggle-voice').addEventListener('change', (e) => { DB.profile.settings.voice = e.target.checked; saveData(); });
  $('toggle-sound').addEventListener('change', (e) => { DB.profile.settings.sound = e.target.checked; saveData(); });
  $('toggle-adaptive').addEventListener('change', (e) => { DB.profile.settings.adaptive = e.target.checked; saveData(); });

  $('btn-start').addEventListener('click', startRound);
  $('btn-history').addEventListener('click', () => { renderHistory(); showScreen('screen-history'); });
  $('btn-settings').addEventListener('click', () => { showScreen('screen-settings'); });
  $('btn-history-back').addEventListener('click', () => showScreen('screen-home'));
  $('btn-settings-back').addEventListener('click', () => { renderHome(); showScreen('screen-home'); });
}

function startRound() {
  Sound.ensure();
  Round.start(DB.profile.settings.puttCount);
  showScreen('screen-round');
  renderStation();
  setTimeout(announceStation, 350);
  if (DB.profile.settings.voice) Voice.start(handleVoiceText);
}

function finalizeStation(made, missDirectionKey) {
  if (!Round.active || !Round.current) return;
  const station = Round.recordResult(made, missDirectionKey);
  if (made) Sound.make(); else Sound.miss();
  showResultToast(station);
  renderStation();

  if (Round.isLastStation()) {
    setTimeout(endRound, 950);
  } else {
    setTimeout(() => {
      Round.nextStation();
      renderStation();
      announceStation();
    }, 950);
  }
}

function endRound() {
  Voice.stop();
  const session = Round.finish();
  Sound.finish();
  Voice.speak(`Round complete. ${session.totalSG >= 0 ? 'Plus' : 'Minus'} ${Math.abs(session.totalSG).toFixed(1)} strokes gained.`);
  renderSummary(session);
  showScreen('screen-summary');
}

function initRound() {
  $('btn-made').addEventListener('click', () => finalizeStation(true, null));
  $('btn-quit').addEventListener('click', () => {
    if (confirm('Quit this round? Progress will not be saved.')) {
      Voice.stop();
      Round.active = false;
      showScreen('screen-home');
      renderHome();
    }
  });

  buildCompassSVG($('compass-svg'), { interactive: true, onSelect: (key) => finalizeStation(false, key) });
}

function initSummary() {
  $('btn-play-again').addEventListener('click', startRound);
  $('btn-back-home').addEventListener('click', () => { renderHome(); showScreen('screen-home'); });
}

function initSettings() {
  $('units-row').querySelectorAll('.mix-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      DB.profile.settings.units = btn.dataset.units;
      saveData();
      $('units-row').querySelectorAll('.mix-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  $('btn-reset-data').addEventListener('click', () => {
    if (confirm('Erase all local data? This cannot be undone.')) {
      localStorage.removeItem(STORAGE_KEY);
      DB = loadData();
      renderHome();
      showScreen('screen-home');
    }
  });
}

function renderSettings() {
  $('units-row').querySelectorAll('.mix-btn').forEach(b => b.classList.toggle('active', b.dataset.units === DB.profile.settings.units));
}

/* =========================================================================
   INIT
   ========================================================================= */

function init() {
  initHome();
  initRound();
  initSummary();
  initSettings();
  renderHome();
  renderSettings();
  showScreen('screen-home');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
