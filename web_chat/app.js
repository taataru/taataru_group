"use strict";

const STORAGE_STATE = "taataru_public_emotion_state_v1";
const STORAGE_MESSAGES = "taataru_public_messages_v1";
const TIME_STEP = 0.1;
const WAVE_SEARCH_RANGE = 1000;
const WAVE_SEARCH_STEP = 0.01;
const MAX_LENGTH = 5;
const ZONE_COLORS = {
  "喜": "#df8662",
  "怒": "#c74b4b",
  "哀": "#567fa9",
  "楽": "#66a07a",
};

const ui = {
  form: document.getElementById("chatForm"),
  input: document.getElementById("input"),
  send: document.getElementById("sendButton"),
  messages: document.getElementById("messages"),
  zone: document.getElementById("zone"),
  coordinates: document.getElementById("coordinates"),
  moodDot: document.getElementById("moodDot"),
  reset: document.getElementById("resetButton"),
};

let model = null;
let state = { tx: 0, ty: 0 };

function emotionFunction(t) {
  return ((15 * Math.sin(t) + 7 * Math.sin(t / 7) + 15 * Math.sin(t / 30)) / 37) * 100;
}

function findNearestT(targetValue, currentT) {
  const target = Math.max(-100, Math.min(100, targetValue));
  let bestT = currentT;
  let bestDiff = Math.abs(emotionFunction(currentT) - target);

  const coarseStep = WAVE_SEARCH_RANGE / 200;
  for (let t = currentT - WAVE_SEARCH_RANGE; t <= currentT + WAVE_SEARCH_RANGE; t += coarseStep) {
    const diff = Math.abs(emotionFunction(t) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestT = t;
    }
  }

  const fineStep = coarseStep / 100;
  for (let t = bestT - coarseStep * 2; t <= bestT + coarseStep * 2; t += fineStep) {
    const diff = Math.abs(emotionFunction(t) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestT = t;
    }
  }

  const superFineStep = WAVE_SEARCH_STEP / 10;
  for (let t = bestT - fineStep * 2; t <= bestT + fineStep * 2; t += superFineStep) {
    const diff = Math.abs(emotionFunction(t) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestT = t;
    }
  }
  return bestT;
}

function emotionX() {
  return emotionFunction(state.tx);
}

function emotionY() {
  return emotionFunction(state.ty);
}

function currentZone() {
  const x = emotionX();
  const y = emotionY();
  if (x >= 0 && y >= 0) return "喜";
  if (x < 0 && y >= 0) return "怒";
  if (x < 0 && y < 0) return "哀";
  return "楽";
}

function tokenize(text) {
  const pattern = /[\u3040-\u309F]+|[\u30A0-\u30FF]+|[\u4E00-\u9FFF]+|[a-zA-Z0-9]+|[。、！？!?…．.]+|[\u{1F600}-\u{1F64F}]+/gu;
  return text.match(pattern) || [text];
}

function wordZone(word) {
  const coord = model.coords[word];
  if (!coord) return null;
  if (coord.x >= 0 && coord.y >= 0) return "喜";
  if (coord.x < 0 && coord.y >= 0) return "怒";
  if (coord.x < 0 && coord.y < 0) return "哀";
  return "楽";
}

function findImpactWord(words) {
  let chosen = null;
  let greatest = -1;
  words.forEach((word) => {
    const coord = model.coords[word];
    const distance = coord ? Math.sqrt(coord.x ** 2 + coord.y ** 2) : 0;
    if (distance > greatest) {
      greatest = distance;
      chosen = word;
    }
  });
  return greatest > 0 ? chosen : null;
}

function weightedChoice(options) {
  const total = options.reduce((sum, option) => sum + option[1], 0);
  if (total <= 0) return null;
  let point = Math.random() * total;
  for (const [word, weight] of options) {
    point -= weight;
    if (point <= 0) return word;
  }
  return options[options.length - 1][0];
}

function generateResponse(zone, candidates) {
  const table = model.markov.tables[zone] || {};
  const starts = model.markov.start_words[zone] || [];
  if (!Object.keys(table).length) return "";

  const validStarts = starts.filter((word) => candidates.has(word));
  let current = validStarts.length
    ? validStarts[Math.floor(Math.random() * validStarts.length)]
    : starts[Math.floor(Math.random() * starts.length)];
  if (!current) {
    current = Object.keys(table)[0];
  }

  const result = [current];
  for (let index = 1; index < MAX_LENGTH; index += 1) {
    const nextOptions = table[current];
    if (!nextOptions) break;
    const next = weightedChoice(Object.entries(nextOptions));
    if (!next) break;
    result.push(next);
    current = next;
  }
  return result.join("");
}

function respond(inputText) {
  state.tx += TIME_STEP;
  state.ty += TIME_STEP;
  const words = tokenize(inputText);
  const impactWord = findImpactWord(words);
  if (impactWord) {
    const coord = model.coords[impactWord];
    state.tx = findNearestT(emotionX() + coord.x, state.tx);
    state.ty = findNearestT(emotionY() + coord.y, state.ty);
  }

  const zone = currentZone();
  const candidates = new Set(words);
  words.forEach((word) => {
    const related = model.meaning.cooccurrence[word] || {};
    Object.entries(related)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([candidate]) => candidates.add(candidate));
  });
  const zoneCandidates = new Set([...candidates].filter((word) => wordZone(word) === zone));
  if (!zoneCandidates.size) {
    Object.keys(model.coords).forEach((word) => {
      if (wordZone(word) === zone) zoneCandidates.add(word);
    });
  }
  saveState();
  updateMood();
  return generateResponse(zone, zoneCandidates) || "。。。";
}

function appendMessage(text, role) {
  const bubble = document.createElement("article");
  bubble.className = `bubble ${role}`;
  const content = document.createElement("p");
  content.textContent = text;
  bubble.appendChild(content);
  ui.messages.appendChild(bubble);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function updateMood() {
  const zone = currentZone();
  ui.zone.textContent = zone;
  ui.coordinates.textContent = `x: ${emotionX().toFixed(1)} / y: ${emotionY().toFixed(1)}`;
  ui.moodDot.style.background = ZONE_COLORS[zone];
  ui.moodDot.style.boxShadow = `0 0 0 6px ${ZONE_COLORS[zone]}33`;
}

function saveState() {
  localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
}

function loadStoredState(initialState) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_STATE));
    return stored && Number.isFinite(stored.tx) && Number.isFinite(stored.ty) ? stored : initialState;
  } catch {
    return initialState;
  }
}

function rememberMessage(text, role) {
  const history = JSON.parse(localStorage.getItem(STORAGE_MESSAGES) || "[]");
  history.push({ text, role });
  localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(history.slice(-60)));
}

function restoreMessages() {
  const history = JSON.parse(localStorage.getItem(STORAGE_MESSAGES) || "[]");
  if (!history.length) return;
  ui.messages.innerHTML = "";
  history.forEach(({ text, role }) => appendMessage(text, role));
}

async function loadModel() {
  if (window.TAATARU_MODEL) {
    model = {
      coords: window.TAATARU_MODEL.coords,
      markov: window.TAATARU_MODEL.markov,
      meaning: window.TAATARU_MODEL.meaning,
    };
    state = loadStoredState(window.TAATARU_MODEL.initialState);
    restoreMessages();
    updateMood();
    ui.input.disabled = false;
    ui.send.disabled = false;
    ui.input.focus();
    return;
  }

  const [coords, markov, meaning, initialState] = await Promise.all([
    fetch("./data/emotion_coords.json").then((response) => response.json()),
    fetch("./data/markov_table.json").then((response) => response.json()),
    fetch("./data/word2vec.model.json").then((response) => response.json()),
    fetch("./data/emotion_state.json").then((response) => response.json()),
  ]);
  model = { coords, markov, meaning };
  state = loadStoredState(initialState);
  restoreMessages();
  updateMood();
  ui.input.disabled = false;
  ui.send.disabled = false;
  ui.input.focus();
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = ui.input.value.trim();
  if (!text || !model) return;
  appendMessage(text, "user");
  rememberMessage(text, "user");
  ui.input.value = "";
  const answer = respond(text);
  window.setTimeout(() => {
    appendMessage(answer, "ai");
    rememberMessage(answer, "ai");
  }, 90);
});

ui.reset.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_STATE);
  localStorage.removeItem(STORAGE_MESSAGES);
  window.location.reload();
});

loadModel().catch((error) => {
  console.error(error);
  ui.zone.textContent = "読込失敗";
  appendMessage("データ を 読み込め なかった よ", "ai");
});
