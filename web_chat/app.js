"use strict";

const STORAGE_STATE = "taataru_public_emotion_state_v1";
const STORAGE_MESSAGES = "taataru_public_messages_v1";
const TIME_STEP = 0.1;
const WAVE_SEARCH_RANGE = 1000;
const WAVE_SEARCH_STEP = 0.01;
const MAX_LENGTH = 5;
const TOPIC_WORDS_PER_TURN = 3;
const TOPIC_MEMORY_TURNS = 5;
const LOW_INFORMATION_WORDS = new Set([
  "\u306d", "\u3088", "\uff01", "\u3002", "\u3060",
  "\u3060\u306d", "\u306b", "\u304c", "\u3067", "\u306f", "\u3082",
]);
const NON_TOPIC_WORDS = new Set(["は", "が", "を", "に", "で", "と", "の", "も", "へ", "や", "ね", "よ", "だ", "です", "ます", "て"]);
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
  userZone: document.getElementById("userZone"),
  userCoordinates: document.getElementById("userCoordinates"),
  topicMemory: document.getElementById("topicMemory"),
  moodDot: document.getElementById("moodDot"),
  userMoodDot: document.getElementById("userMoodDot"),
  reset: document.getElementById("resetButton"),
};

let model = null;
let state = { tx: 0, ty: 0, userTx: 0, userTy: 0, topicMemory: [] };

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

function userEmotionX() {
  return emotionFunction(state.userTx);
}

function userEmotionY() {
  return emotionFunction(state.userTy);
}

function zoneFromCoordinates(x, y) {
  if (x >= 0 && y >= 0) return "喜";
  if (x < 0 && y >= 0) return "怒";
  if (x < 0 && y < 0) return "哀";
  return "楽";
}

function currentZone() {
  return zoneFromCoordinates(emotionX(), emotionY());
}

function userZone() {
  return zoneFromCoordinates(userEmotionX(), userEmotionY());
}

function tokenize(text) {
  const pattern = /[\u3040-\u309F]+|[\u30A0-\u30FF]+|[\u4E00-\u9FFF]+|[a-zA-Z0-9]+|[。、！？!?…．.]+|[\u{1F600}-\u{1F64F}]+/gu;
  return text.match(pattern) || [text];
}

function isTopicWord(word) {
  return word && !NON_TOPIC_WORDS.has(word) && !/^[。、！？!?…．.]+$/u.test(word);
}

function rememberedTopicWords() {
  return (state.topicMemory || [])
    .filter((item) => item.turnsLeft > 0)
    .map((item) => item.word)
    .filter((word, index, items) => items.indexOf(word) === index);
}

function ageTopicMemory() {
  state.topicMemory = (state.topicMemory || [])
    .map((item) => ({ word: item.word, turnsLeft: item.turnsLeft - 1 }))
    .filter((item) => item.turnsLeft > 0);
}

function rememberTopicWords(words) {
  const choices = [...new Set(words.filter(isTopicWord))];
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(Math.random() * (index + 1));
    [choices[index], choices[selected]] = [choices[selected], choices[index]];
  }
  choices.slice(0, TOPIC_WORDS_PER_TURN).forEach((word) => {
    const existing = state.topicMemory.find((item) => item.word === word);
    if (existing) {
      existing.turnsLeft = TOPIC_MEMORY_TURNS;
    } else {
      state.topicMemory.push({ word, turnsLeft: TOPIC_MEMORY_TURNS });
    }
  });
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

function updateUserEmotion(words) {
  state.userTx += TIME_STEP;
  state.userTy += TIME_STEP;
  const coordinates = words
    .map((word) => model.coords[word])
    .filter((coord) => Boolean(coord));
  if (!coordinates.length) return;
  const averageX = coordinates.reduce((sum, coord) => sum + coord.x, 0) / coordinates.length;
  const averageY = coordinates.reduce((sum, coord) => sum + coord.y, 0) / coordinates.length;
  state.userTx = findNearestT(userEmotionX() + averageX, state.userTx);
  state.userTy = findNearestT(userEmotionY() + averageY, state.userTy);
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

function textTokens(text) {
  const spaced = text.trim().split(/\s+/).filter(Boolean);
  return spaced.length > 1 ? spaced : tokenize(text);
}

function teacherSignature(words) {
  return [...new Set(words)].sort().join("\t");
}

function addCounts(scores, counts, multiplier = 1) {
  Object.entries(counts || {}).forEach(([word, count]) => {
    scores[word] = (scores[word] || 0) + Number(count) * multiplier;
  });
}

function predictTeacherWords(question, zone, topN = 12) {
  if (!model.teacher) return [];
  const questionWords = [...new Set(textTokens(question))].sort();
  const scores = {};
  const signature = teacherSignature(questionWords);
  const exact = ((model.teacher.signatures || {})[zone] || {})[signature];
  addCounts(scores, exact, 4);

  let matchCount = 0;
  questionWords.forEach((word) => {
    const counts = (((model.teacher.question_to_answer || {})[zone] || {})[word]);
    if (counts) {
      matchCount += 1;
      addCounts(scores, counts);
    }
  });
  if (!Object.keys(scores).length) {
    addCounts(scores, (model.teacher.answer_priors || {})[zone], 0.1);
  } else if (matchCount > 1) {
    const boost = 1 + Math.log1p(matchCount) / 4;
    Object.keys(scores).forEach((word) => {
      scores[word] *= boost;
    });
  }

  const pairCount = Number(model.teacher.pair_count || 0);
  const frequency = model.teacher.answer_document_frequency || {};
  Object.keys(scores).forEach((word) => {
    const rarity = Math.log((pairCount + 1) / (Number(frequency[word] || 0) + 1)) + 0.25;
    scores[word] *= rarity;
  });
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, topN);
  const total = ranked.reduce((sum, entry) => sum + entry[1], 0);
  return total ? ranked.map(([word, score]) => [word, score / total]) : [];
}

function predictTeacherZone(question) {
  if (!model.teacher) return [];
  const questionWords = [...new Set(textTokens(question))];
  const scores = {};
  const signatureCounts = (model.teacher.signature_zone_counts || {})[teacherSignature(questionWords)];
  if (signatureCounts) {
    const exact = Object.entries(signatureCounts).sort((a, b) => b[1] - a[1]);
    const exactTotal = exact.reduce((sum, entry) => sum + entry[1], 0);
    return exact.map(([zone, score]) => [zone, score / exactTotal]);
  }
  questionWords.forEach((word) => {
    const zoneCounts = (model.teacher.question_zone_counts || {})[word];
    Object.entries(zoneCounts || {}).forEach(([zone, count]) => {
      scores[zone] = (scores[zone] || 0) + Number(count);
    });
  });
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, entry) => sum + entry[1], 0);
  return total ? ranked.map(([zone, score]) => [zone, score / total]) : [];
}

function scoreTeacherAnswer(question, answer, zone) {
  const allPredicted = predictTeacherWords(question, zone, 20);
  const informative = allPredicted.filter(([word]) => !LOW_INFORMATION_WORDS.has(word));
  const predicted = informative.length ? informative : allPredicted;
  if (!predicted.length) return 0;
  const answerWords = new Set(textTokens(answer));
  const matched = predicted.filter(([word]) => answerWords.has(word) || answer.includes(word));
  const coverage = matched.reduce((sum, entry) => sum + entry[1], 0);
  const expectedWords = predicted.slice(0, 5).map(([word]) => word);
  const expectedHits = expectedWords.length
    ? expectedWords.filter((word) => answerWords.has(word) || answer.includes(word)).length / expectedWords.length
    : 0;
  return Math.min(1, coverage * 2.5 + expectedHits * 0.35);
}

function semanticCandidates(words, memoryWords, zone) {
  const candidates = new Set([...words, ...memoryWords]);
  [...words, ...memoryWords].forEach((word) => {
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
  return zoneCandidates;
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

function dualFeatures(text) {
  const compact = text.replace(/[\s。、！？!?…．.]/gu, "");
  const features = new Set(tokenize(text));
  for (let index = 0; index < compact.length - 1; index += 1) {
    features.add(compact.slice(index, index + 2));
  }
  return features;
}

function selectDualResponse(inputText, selfZone, observedUserZone) {
  if (!model.dual) return "";
  const examples = model.dual.combinations[`${selfZone}|${observedUserZone}`] || [];
  if (!examples.length) return "";
  const inputFeatures = dualFeatures(inputText);
  let bestScore = -1;
  let best = [];
  examples.forEach((example) => {
    const exampleFeatures = dualFeatures(example.input);
    let score = 0;
    inputFeatures.forEach((feature) => {
      if (exampleFeatures.has(feature)) score += feature.length > 1 ? 2 : 1;
    });
    if (score > bestScore) {
      bestScore = score;
      best = [example];
    } else if (score === bestScore) {
      best.push(example);
    }
  });
  const chosen = best[Math.floor(Math.random() * best.length)];
  return chosen ? chosen.response : "";
}

function respond(inputText) {
  state.tx += TIME_STEP;
  state.ty += TIME_STEP;
  const words = tokenize(inputText);
  updateUserEmotion(words);
  const impactWord = findImpactWord(words);
  if (impactWord) {
    const coord = model.coords[impactWord];
    state.tx = findNearestT(emotionX() + coord.x, state.tx);
    state.ty = findNearestT(emotionY() + coord.y, state.ty);
  }

  const zone = currentZone();
  const memoryWords = rememberedTopicWords();
  let response = "";
  if (model.dual && model.dual.record_count) {
    response = selectDualResponse(inputText, zone, userZone());
  } else if (model.teacher) {
    const zonePrediction = predictTeacherZone(inputText);
    const expectedZone = zonePrediction.length ? zonePrediction[0][0] : zone;
    const zoneCandidates = new Set(
      predictTeacherWords(inputText, expectedZone, 12)
        .map(([word]) => word)
        .filter((word) => wordZone(word) === zone)
    );
    memoryWords.forEach((word) => {
      if (wordZone(word) === zone) zoneCandidates.add(word);
      const related = model.meaning.cooccurrence[word] || {};
      Object.entries(related)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .forEach(([candidate]) => {
          if (wordZone(candidate) === zone) zoneCandidates.add(candidate);
        });
    });
    if (!zoneCandidates.size) {
      semanticCandidates(words, memoryWords, zone).forEach((word) => zoneCandidates.add(word));
    }
    let bestScore = -1;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const trial = generateResponse(zone, zoneCandidates);
      const score = scoreTeacherAnswer(inputText, trial, expectedZone);
      if (score >= bestScore) {
        bestScore = score;
        response = trial;
      }
    }
  } else {
    response = generateResponse(zone, semanticCandidates(words, memoryWords, zone));
  }
  ageTopicMemory();
  rememberTopicWords(words);
  saveState();
  updateMood();
  return response || "。。。";
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
  const observedUserZone = userZone();
  ui.zone.textContent = zone;
  ui.coordinates.textContent = `自分 x: ${emotionX().toFixed(1)} / y: ${emotionY().toFixed(1)}`;
  ui.userZone.textContent = observedUserZone;
  ui.userCoordinates.textContent = `相手 x: ${userEmotionX().toFixed(1)} / y: ${userEmotionY().toFixed(1)}`;
  const memoryWords = rememberedTopicWords();
  ui.topicMemory.textContent = `話題記憶: ${memoryWords.join(" / ") || "なし"}`;
  ui.moodDot.style.background = ZONE_COLORS[zone];
  ui.moodDot.style.boxShadow = `0 0 0 6px ${ZONE_COLORS[zone]}33`;
  ui.userMoodDot.style.background = ZONE_COLORS[observedUserZone];
  ui.userMoodDot.style.boxShadow = `0 0 0 6px ${ZONE_COLORS[observedUserZone]}33`;
}

function saveState() {
  localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
}

function loadStoredState(initialState) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_STATE));
    if (stored && Number.isFinite(stored.tx) && Number.isFinite(stored.ty)) {
      stored.topicMemory = Array.isArray(stored.topicMemory) ? stored.topicMemory : [];
      stored.userTx = Number.isFinite(stored.userTx) ? stored.userTx : 0;
      stored.userTy = Number.isFinite(stored.userTy) ? stored.userTy : 0;
      return stored;
    }
    return { ...initialState, userTx: 0, userTy: 0, topicMemory: [] };
  } catch {
    return { ...initialState, userTx: 0, userTy: 0, topicMemory: [] };
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
      teacher: window.TAATARU_MODEL.teacher || null,
      dual: window.TAATARU_MODEL.dual || null,
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
  model = { coords, markov, meaning, teacher: null, dual: null };
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
