// --- GLOBAL APPLICATION STATE ---
let state = {
    projectTitle: "3Dミニゲーム開発プロジェクト",
    projectStartDate: formatDateInputValue(new Date()),
    nodes: [],
    edges: [],
    doodles: [],
    stickyNotes: [],
    currentDragNodeId: null,
    currentDragStickyId: null,
    dragOffset: { x: 0, y: 0 },
    activeConnectingFromId: null,
    currentTool: 'select',
    currentDoodle: null,
    undoStack: [],
    currentView: 'canvas', // 'canvas', 'wbs', or 'gantt'
    lastTouchX: 0,
    lastTouchY: 0,
    currentMouseCoords: { x: 0, y: 0 }
};

// RequestAnimationFrame throttler flags
let ticking = false;
let autosaveTimer = null;
const AUTOSAVE_KEY = 'flowwbs-autosave-v1';

// Preset WBS Templates
const PRESETS = {
    game: {
        project_title: "🎮 3Dミニゲーム開発プロジェクト",
        wbs: [
            { id: "1", task_name: "1. 企画書＆ゲーム基本設計", duration: 3 },
            { id: "2", task_name: "2. 3Dモデルキャラクター制作", duration: 5, depends_on: ["1"] },
            { id: "3", task_name: "3. サウンド（BGM＆SE）素材制作", duration: 2, depends_on: ["1"] },
            { id: "4", task_name: "4. プログラミング（基本操作）", duration: 6, depends_on: ["2"] },
            { id: "5", task_name: "5. UI設計・ゲーム内演出組み込み", duration: 3, depends_on: ["4", "3"] },
            { id: "6", task_name: "6. デバッグ作業・エラー修正", duration: 4, depends_on: ["5"] },
            { id: "7", task_name: "7. アプリ公開・ストア申請", duration: 2, depends_on: ["6"] }
        ]
    },
    web: {
        project_title: "🌐 コーポレートサイト制作",
        wbs: [
            { id: "1", task_name: "1. 要件定義・サイト構成案決定", duration: 4 },
            { id: "2", task_name: "2. ワイヤーフレーム＆レイアウト作成", duration: 3, depends_on: ["1"] },
            { id: "3", task_name: "3. 原稿テキスト・イメージ素材準備", duration: 5, depends_on: ["1"] },
            { id: "4", task_name: "4. UI/UXビジュアルデザイン制作", duration: 6, depends_on: ["2"] },
            { id: "5", task_name: "5. フロント実装＆マークアップ", duration: 7, depends_on: ["4", "3"] },
            { id: "6", task_name: "6. 問い合わせフォーム＆システム開発", duration: 4, depends_on: ["1"] },
            { id: "7", task_name: "7. 総合動作確認・SEOタグ設置", duration: 3, depends_on: ["5", "6"] },
            { id: "8", task_name: "8. サーバーアップロード＆本番公開", duration: 1, depends_on: ["7"] }
        ]
    },
    app: {
        project_title: "📱 スマホ向けアプリ配信",
        wbs: [
            { id: "1", task_name: "1. 企画＆ターゲット市場調査", duration: 5 },
            { id: "2", task_name: "2. UIワイヤーフレームの構築", duration: 4, depends_on: ["1"] },
            { id: "3", task_name: "3. サーバーインフラ設計とDB設計", duration: 6, depends_on: ["1"] },
            { id: "4", task_name: "4. フロントエンドアプリ開発", duration: 12, depends_on: ["2"] },
            { id: "5", task_name: "5. APIサーバー構築・連携テスト", duration: 8, depends_on: ["3"] },
            { id: "6", task_name: "6. 社内テスターによる結合試験", duration: 5, depends_on: ["4", "5"] },
            { id: "7", task_name: "7. アプリリリース申請", duration: 4, depends_on: ["6"] }
        ]
    }
};

// Default Prompt to copy
const AI_PROMPT_TEMPLATE = `アローダイアグラムとWBSを描くので、以下のプロジェクトに必要となる詳細なタスク一覧を、前後関係がわかるように以下のJSON形式で出力してください。

【プロジェクト内容】：
「ここに作りたいものを入力（例：個人で2ヶ月で完成させるノベルゲーム開発）」

【出力ルール】：
・絶対に余計な説明文やマークダウンは書かず、純粋なJSON（配列のみ）だけで出力してください。
・JSONのキー名は正確に、id、task_name、duration、depends_onとしてください。
・日付を指定したい場合は project_start_date や start_date を YYYY-MM-DD 形式で入れてください。

【JSONのフォーマット】:
{
  "project_title": "プロジェクト名",
  "project_start_date": "2026-06-01",
  "wbs": [
    {
      "id": "1",
      "task_name": "企画検討",
      "duration": 3,
      "start_date": "2026-06-01",
      "depends_on": []
    },
    {
      "id": "2",
      "task_name": "シナリオ作成",
      "duration": 10,
      "depends_on": ["1"]
    }
  ]
}`;

// --- APP INITIALIZATION ---
window.onload = function() {
    syncProjectStartDateInput();

    if (!loadStateFromURLHash() && !restoreAutosaveIfAvailable()) {
        // Create an initial beautiful diagram
        loadPreset();
    }

    // Register canvas level mouse & touch handlers
    const canvas = document.getElementById('canvas-container');

    canvas.addEventListener('mousedown', onCanvasPointerStart);
    canvas.addEventListener('touchstart', onCanvasPointerStart, { passive: false });
    
    // Double click to add node
    canvas.addEventListener('dblclick', function(e) {
        if (state.currentTool === 'select' && isCanvasBlankTarget(e.target)) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left + canvas.scrollLeft;
            const y = e.clientY - rect.top + canvas.scrollTop;
            addNewNodeAt(x - 120, y - 60);
        }
    });

    // Support single long touch to add node on tablets/mobiles
    let touchStartTime = 0;
    canvas.addEventListener('touchstart', function(e) {
        if (state.currentTool === 'select' && isCanvasBlankTarget(e.target)) {
            touchStartTime = Date.now();
        }
    }, { passive: true });

    canvas.addEventListener('touchend', function(e) {
        if (state.currentTool === 'select' && isCanvasBlankTarget(e.target) && touchStartTime > 0) {
            const duration = Date.now() - touchStartTime;
            if (duration > 500) { // Long press detected (> 500ms)
                const rect = canvas.getBoundingClientRect();
                const touch = e.changedTouches[0];
                const x = touch.clientX - rect.left + canvas.scrollLeft;
                const y = touch.clientY - rect.top + canvas.scrollTop;
                addNewNodeAt(x - 120, y - 60);
            }
            touchStartTime = 0;
        }
    }, { passive: true });

    // Window global event listeners for mouse/touch tracking
    window.addEventListener('mousemove', onGlobalMove);
    window.addEventListener('touchmove', onGlobalMove, { passive: false });
    
    window.addEventListener('mouseup', onGlobalEnd);
    window.addEventListener('touchend', onGlobalEnd, { passive: true });
    window.addEventListener('keydown', onGlobalKeyDown);

    // Initial calculation run
    calculateCriticalPath();
};

// --- PLAKUMA ADVICE ADAPTER ---
function updatePlakumaSpeech(totalDuration) {
    const el = document.getElementById('plakuma-speech');
    if (!el) return;

    if (state.nodes.length === 0) {
        el.innerText = "キャンバスが空っぽだよ！ダブルクリックするか、左のテンプレートを選んでスケジュール作りをスタートしよう！";
    } else if (state.edges.length === 0) {
        el.innerText = "タスクを追加できたね！今度はタスクの右端の青丸『○』から、次のタスクの左端の『●』へ線を引っ張って繋いでみよう！";
    } else {
        el.innerText = `タスク同士が綺麗に繋がっているね！工期は【${totalDuration}日間】だよ。いつでも左のメニューからJSONファイルとして保存できるよ！`;
    }
}

// --- UI INTERACTION (MOBILE SIDEBAR) ---
function toggleSidebar(force) {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    const isOpen = sidebar.classList.contains('translate-x-0');
    const shouldOpen = force !== undefined ? force : !isOpen;

    if (shouldOpen) {
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        overlay.classList.remove('opacity-0', 'pointer-events-none');
        overlay.classList.add('opacity-100', 'pointer-events-auto');
    } else {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('translate-x-0');
        overlay.classList.add('opacity-0', 'pointer-events-none');
        overlay.classList.remove('opacity-100', 'pointer-events-auto');
    }
}

// Helper to resolve coordinates from mouse or touch event
function getCoordinates(e) {
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

// --- MODAL UTILITIES ---
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function getSerializableState() {
    return {
        projectTitle: state.projectTitle,
        projectStartDate: state.projectStartDate,
        doodles: state.doodles,
        stickyNotes: state.stickyNotes,
        nodes: state.nodes.map(n => ({
            id: n.id,
            name: n.name,
            duration: n.duration,
            x: n.x,
            y: n.y,
            hasFixedStart: n.hasFixedStart || false,
            fixedStart: n.fixedStart || 0,
            fixedStartDate: getDateForOffset(n.fixedStart || 0),
            hasFixedLatest: n.hasFixedLatest || false,
            fixedLatest: n.fixedLatest || 0,
            fixedLatestDate: getDateForOffset(n.fixedLatest || 0),
            image: n.image || null
        })),
        edges: state.edges
    };
}

function applySerializedState(parsed, options = {}) {
    if (!parsed || !Array.isArray(parsed.nodes)) return false;
    if (options.keepHistory && (state.nodes.length > 0 || state.edges.length > 0 || state.doodles.length > 0 || state.stickyNotes.length > 0)) {
        pushHistory();
    }

    state.nodes = [];
    state.edges = [];
    state.doodles = Array.isArray(parsed.doodles) ? parsed.doodles : [];
    state.stickyNotes = Array.isArray(parsed.stickyNotes) ? parsed.stickyNotes : [];
    state.projectTitle = parsed.projectTitle || "インポートしたプロジェクト";
    state.projectStartDate = isValidDateString(parsed.projectStartDate) ? parsed.projectStartDate : state.projectStartDate;
    syncProjectStartDateInput();

    parsed.nodes.forEach(item => {
        state.nodes.push({
            id: normalizeId(item.id),
            name: item.name || `タスク ${item.id}`,
            duration: parseInt(item.duration, 10) || 0,
            x: Number.isFinite(Number(item.x)) ? Number(item.x) : 100,
            y: Number.isFinite(Number(item.y)) ? Number(item.y) : 100,
            earliestStart: 0,
            earliestFinish: 0,
            latestStart: 0,
            latestFinish: 0,
            float: 0,
            hasFixedStart: item.hasFixedStart || false,
            fixedStart: parseScheduleOffset(item.fixedStartDate || item.fixedStart, 0),
            hasFixedLatest: item.hasFixedLatest || false,
            fixedLatest: parseScheduleOffset(item.fixedLatestDate || item.fixedLatest, 0),
            image: item.image || null
        });
    });

    let skippedEdges = 0;
    (parsed.edges || []).forEach(edge => {
        const from = normalizeId(edge.from);
        const to = normalizeId(edge.to);
        const exists = state.edges.some(e => e.from === from && e.to === to);
        const hasNodes = state.nodes.some(n => n.id === from) && state.nodes.some(n => n.id === to);
        if (from !== to && hasNodes && !exists && !wouldCreateCycle(from, to, state.edges)) {
            state.edges.push({ from, to });
        } else {
            skippedEdges++;
        }
    });

    calculateCriticalPath();
    renderDoodles();
    renderStickyNotes();
    if (options.alertSkipped && skippedEdges > 0) {
        alert(`循環や不正な接続線 ${skippedEdges}件はスキップしました。`);
    }
    return true;
}

function encodeShareData(data) {
    const json = JSON.stringify(data);
    return btoa(unescape(encodeURIComponent(json)));
}

function decodeShareData(encoded) {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

function getShareHash() {
    return `data=${encodeShareData(getSerializableState())}`;
}

function loadStateFromURLHash() {
    const match = location.hash.match(/(?:^#|&)data=([^&]+)/);
    if (!match) return false;

    try {
        return applySerializedState(decodeShareData(match[1]), { keepHistory: false, alertSkipped: true });
    } catch (err) {
        alert("共有URLの読み込みに失敗しました。通常のサンプルを開きます。");
        return false;
    }
}

function saveAutosaveNow() {
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
            savedAt: new Date().toISOString(),
            data: getSerializableState()
        }));
    } catch (err) {
        // Ignore quota/private-mode failures.
    }
}

function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveAutosaveNow, 400);
}

function restoreAutosaveIfAvailable() {
    if (location.hash.includes('data=')) return false;
    try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw);
        if (!saved?.data?.nodes?.length) return false;
        const shouldRestore = confirm("前回の自動保存データがあります。復元しますか？");
        if (!shouldRestore) return false;
        return applySerializedState(saved.data, { keepHistory: false, alertSkipped: true });
    } catch (err) {
        return false;
    }
}

function syncProjectStartDateInput() {
    const input = document.getElementById('project-start-date-input');
    if (input) input.value = state.projectStartDate;
}

function onProjectStartDateChange(value) {
    if (!isValidDateString(value)) return;
    pushHistory();
    state.projectStartDate = value;
    calculateCriticalPath();
}

function cloneStateForHistory() {
    return {
        projectTitle: state.projectTitle,
        projectStartDate: state.projectStartDate,
        nodes: deepClone(state.nodes),
        edges: deepClone(state.edges),
        doodles: deepClone(state.doodles),
        stickyNotes: deepClone(state.stickyNotes)
    };
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function pushHistory() {
    state.undoStack.push(cloneStateForHistory());
    if (state.undoStack.length > 50) {
        state.undoStack.shift();
    }
    scheduleAutosave();
}

function restoreHistorySnapshot(snapshot) {
    state.projectTitle = snapshot.projectTitle;
    state.projectStartDate = snapshot.projectStartDate;
    state.nodes = deepClone(snapshot.nodes);
    state.edges = deepClone(snapshot.edges);
    state.doodles = deepClone(snapshot.doodles);
    state.stickyNotes = deepClone(snapshot.stickyNotes);
    state.currentDragNodeId = null;
    state.currentDragStickyId = null;
    state.currentDoodle = null;
    state.activeConnectingFromId = null;

    syncProjectStartDateInput();
    calculateCriticalPath();
    renderDoodles();
    renderStickyNotes();
    scheduleAutosave();
}

function undoLastAction() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;
    restoreHistorySnapshot(snapshot);
}

function onGlobalKeyDown(e) {
    const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
    if (!isUndo) return;
    if (e.target.closest('input, textarea')) return;

    e.preventDefault();
    undoLastAction();
}

// Copy prompt template to clipboard
async function copyPromptToClipboard() {
    await copyTextToClipboard(AI_PROMPT_TEMPLATE);
    alert("💡 AIに投げる指示書（プロンプト）をクリップボードにコピーしました！ChatGPTやClaudeにそのままコピペして使ってください。");
}

// --- SHARE ON X (Twitter) ---
function shareOnX() {
    let projectTitle = state.projectTitle || "マイ工程表";
    let totalNodes = state.nodes.length;
    let totalDuration = 0;
    
    state.nodes.forEach(n => {
        totalDuration = Math.max(totalDuration, n.earliestFinish);
    });

    const tweetText = encodeURIComponent(
        `【FlowWBS】無料のAI WBS＆アローダイアグラム作成ツールでプロジェクト工程表を構築！\n\n` +
        `📊 プロジェクト名: ${projectTitle}\n` +
        `🛠️ 総タスク数: ${totalNodes}件\n` +
        `⏳ 総工期: ${totalDuration}日間\n\n` +
        `日程の個別手動ロック(最早/最遅開始)や自動整列、ガントチャート連動に対応！完全無料で使い放題です。\n` +
        `by @taataru_group\n` +
        `#FlowWBS #個人開発 #プロマネ`
    );
    const tweetUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=` + encodeURIComponent(getShareableURL());
    window.open(tweetUrl, '_blank');
}

function getShareableURL() {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#${getShareHash()}`;
}

async function copyShareableURL() {
    const url = getShareableURL();
    if (url.length > 50000) {
        alert("画像や落書きが多く、URLが長くなっています。共有URLではなくJSON保存の利用がおすすめです。");
    }
    await copyTextToClipboard(url);
    alert("共有URLをコピーしました。受け取った人も同じWBSを開いて編集できます。");
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (err) {
            // Fall back below.
        }
    }

    const tempTextarea = document.createElement('textarea');
    tempTextarea.value = text;
    document.body.appendChild(tempTextarea);
    tempTextarea.select();
    document.execCommand('copy');
    document.body.removeChild(tempTextarea);
}

function getCurrentExportElement() {
    if (state.currentView === 'wbs') return document.getElementById('wbs-container');
    if (state.currentView === 'gantt') return document.getElementById('gantt-container');
    return document.getElementById('canvas-container');
}

async function exportCurrentViewPNG() {
    if (typeof html2canvas === 'undefined') {
        alert("画像出力ライブラリの読み込み中です。少し待ってからもう一度試してください。");
        return;
    }

    const target = getCurrentExportElement();
    if (!target) return;
    const canvas = await html2canvas(target, {
        backgroundColor: '#f8fafc',
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true
    });
    const link = document.createElement('a');
    const cleanTitle = (state.projectTitle || 'flowwbs').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'flowwbs';
    link.href = canvas.toDataURL('image/png');
    link.download = `flowwbs_${state.currentView}_${cleanTitle}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// --- LOCAL STORAGE / JSON FILE FILE EXPORT & IMPORT ---
function exportJSONFile() {
    const layoutState = getSerializableState();

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(layoutState, null, 2));
    const downloadAnchor = document.createElement('a');
    
    const cleanTitle = (state.projectTitle || "project").replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `flowwbs_${cleanTitle}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function triggerFileInput() {
    document.getElementById('file-loader-input').click();
}

function loadJSONFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
                alert("❌ JSONファイルの形式が不正です。FlowWBSからエクスポートされたファイルを選択してください。");
                return;
            }

            applySerializedState(parsed, { keepHistory: true, alertSkipped: true });
            alert("📂 プロジェクトファイルを読み込みました。");
        } catch (err) {
            alert("❌ 読み込み失敗: ファイルの解析中にエラーが発生しました。\n" + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// --- IMAGE MANIPULATION UTILITIES ---
function triggerNodeImageUpload(nodeId) {
    const el = document.getElementById(`node-img-input-${nodeId}`);
    if (el) el.click();
}

function handleNodeImageUpload(event, nodeId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Resize canvas to make sure the Base64 representation is small
            const canvas = document.createElement('canvas');
            const maxDimension = 150; // Keep thumbnail small (150px)
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxDimension) {
                    height = Math.round(height * (maxDimension / width));
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width = Math.round(width * (maxDimension / height));
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Compress to JPEG with medium-low quality to stay super lightweight
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);

            // Save image data to the specific node in state
            const node = state.nodes.find(n => n.id === nodeId);
            if (node) {
                pushHistory();
                node.image = compressedDataUrl;
                calculateCriticalPath(); // trigger update and re-render
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removeNodeImage(nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        node.image = null;
        calculateCriticalPath();
    }
}

// --- CANVAS UTILITIES (ADD, DELETE, MODIFY NODES/EDGES) ---
function addNewNodeAtCenter() {
    const container = document.getElementById('canvas-container');
    const scrollX = container.scrollLeft;
    const scrollY = container.scrollTop;
    
    const viewWidth = Math.min(window.innerWidth, 800);
    const x = scrollX + (viewWidth / 2) - 120;
    const y = scrollY + 180;
    addNewNodeAt(x, y);
}

function addStickyNoteAtCenter() {
    setCurrentTool('select');
    const container = document.getElementById('canvas-container');
    const scrollX = container.scrollLeft;
    const scrollY = container.scrollTop;
    const viewWidth = Math.min(window.innerWidth, 800);
    const note = {
        id: `note-${Date.now()}`,
        text: '補足メモ',
        x: scrollX + (viewWidth / 2) - 80,
        y: scrollY + 180
    };

    pushHistory();
    state.stickyNotes.push(note);
    renderStickyNotes();
}

function toggleDoodleMode() {
    setCurrentTool(state.currentTool === 'doodle' ? 'select' : 'doodle');
}

function toggleEraserMode() {
    setCurrentTool(state.currentTool === 'eraser' ? 'select' : 'eraser');
}

function setCurrentTool(tool) {
    state.currentTool = tool;
    const doodleButton = document.getElementById('tool-doodle');
    const eraserButton = document.getElementById('tool-eraser');
    const svgLayer = document.getElementById('svg-layer');

    if (doodleButton) {
        doodleButton.className = tool === 'doodle'
            ? "bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs px-3 py-2 rounded-md border border-rose-200 transition flex items-center space-x-1.5 shadow-sm"
            : "bg-white hover:bg-slate-50 text-slate-700 text-xs px-3 py-2 rounded-md border border-slate-200 transition flex items-center space-x-1.5 shadow-sm";
    }
    if (eraserButton) {
        eraserButton.className = tool === 'eraser'
            ? "bg-slate-800 hover:bg-slate-700 text-white text-xs px-3 py-2 rounded-md border border-slate-800 transition flex items-center space-x-1.5 shadow-sm"
            : "bg-white hover:bg-slate-50 text-slate-700 text-xs px-3 py-2 rounded-md border border-slate-200 transition flex items-center space-x-1.5 shadow-sm";
    }
    if (svgLayer) {
        svgLayer.style.pointerEvents = tool === 'eraser' ? 'auto' : '';
    }
    renderDoodles();
    renderStickyNotes();
}

function getCanvasPoint(e) {
    const canvas = document.getElementById('canvas-container');
    const rect = canvas.getBoundingClientRect();
    const coords = getCoordinates(e);
    return {
        x: coords.x - rect.left + canvas.scrollLeft,
        y: coords.y - rect.top + canvas.scrollTop
    };
}

function isCanvasBlankTarget(target) {
    return target.id === 'canvas-container' ||
        target.id === 'svg-layer' ||
        target.id === 'nodes-container' ||
        target.id === 'sticky-notes-container';
}

function onCanvasPointerStart(e) {
    if (state.currentTool !== 'doodle' || !isCanvasBlankTarget(e.target)) return;
    if (e.cancelable) e.preventDefault();

    const point = getCanvasPoint(e);
    pushHistory();
    state.currentDoodle = {
        id: `doodle-${Date.now()}`,
        points: [point],
        color: '#e11d48',
        width: 3
    };

    state.doodles.push(state.currentDoodle);
    renderDoodles();
}

function createDoodlePath(points) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        path += ` L ${points[i].x} ${points[i].y}`;
    }
    return path;
}

function renderDoodles() {
    const group = document.getElementById('svg-doodles-group');
    if (!group) return;
    group.innerHTML = '';

    state.doodles.forEach(doodle => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute('d', createDoodlePath(doodle.points));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', doodle.color || '#e11d48');
        path.setAttribute('stroke-width', state.currentTool === 'eraser' ? Math.max((doodle.width || 3), 12) : (doodle.width || 3));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.style.cursor = state.currentTool === 'eraser' ? 'not-allowed' : 'default';
        path.style.pointerEvents = state.currentTool === 'eraser' ? 'stroke' : 'none';
        path.style.opacity = state.currentTool === 'eraser' ? '0.45' : '1';
        path.addEventListener('click', (e) => {
            if (state.currentTool !== 'eraser') return;
            e.stopPropagation();
            eraseDoodle(doodle.id);
        });
        group.appendChild(path);
    });
    updateCanvasEmptyState();
}

function renderStickyNotes() {
    const container = document.getElementById('sticky-notes-container');
    if (!container) return;
    container.innerHTML = '';

    state.stickyNotes.forEach(note => {
        const noteEl = document.createElement('div');
        noteEl.id = `sticky-${note.id}`;
        noteEl.className = `absolute pointer-events-auto w-40 min-h-24 bg-amber-100 border ${state.currentTool === 'eraser' ? 'border-rose-400 ring-2 ring-rose-200 cursor-not-allowed' : 'border-amber-200'} rounded-md shadow-md p-2 text-xs text-slate-700 flex flex-col`;
        noteEl.style.transform = `translate3d(${note.x}px, ${note.y}px, 0)`;
        noteEl.innerHTML = `
            <div class="flex items-center justify-between mb-1 cursor-grab text-amber-700" onmousedown="onStickyDragStart(event, '${escapeJsString(note.id)}')" ontouchstart="onStickyDragStart(event, '${escapeJsString(note.id)}')">
                <i class="fa-solid fa-note-sticky text-[11px]"></i>
                <button onclick="event.stopPropagation(); deleteStickyNote('${escapeJsString(note.id)}')" class="text-amber-700 hover:text-rose-500 px-1">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <textarea onfocus="pushHistory()" oninput="onStickyTextChange('${escapeJsString(note.id)}', this.value)" class="flex-1 min-h-16 bg-transparent resize-none focus:outline-none leading-relaxed placeholder:text-amber-600/60" placeholder="補足メモ">${escapeHtml(note.text || '')}</textarea>
        `;
        noteEl.addEventListener('click', (e) => {
            if (state.currentTool !== 'eraser') return;
            e.stopPropagation();
            deleteStickyNote(note.id);
        });
        container.appendChild(noteEl);
    });
    updateCanvasEmptyState();
}

function onStickyDragStart(e, noteId) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();

    const coords = getCoordinates(e);
    const note = state.stickyNotes.find(n => n.id === noteId);
    if (note) {
        pushHistory();
        state.currentDragStickyId = noteId;
        state.dragOffset.x = coords.x - note.x;
        state.dragOffset.y = coords.y - note.y;
    }
}

function onStickyTextChange(noteId, value) {
    const note = state.stickyNotes.find(n => n.id === noteId);
    if (note) {
        note.text = value;
        scheduleAutosave();
    }
}

function deleteStickyNote(noteId) {
    pushHistory();
    state.stickyNotes = state.stickyNotes.filter(note => note.id !== noteId);
    renderStickyNotes();
}

function eraseDoodle(doodleId) {
    pushHistory();
    state.doodles = state.doodles.filter(doodle => doodle.id !== doodleId);
    renderDoodles();
}

function addNewNodeAt(x, y) {
    pushHistory();
    let nextId = 1;
    while (state.nodes.some(n => n.id === String(nextId))) {
        nextId++;
    }

    const newNode = {
        id: String(nextId),
        name: `${nextId}. 新規タスク`,
        duration: 3,
        x: x,
        y: y,
        earliestStart: 0,
        earliestFinish: 3,
        latestStart: 0,
        latestFinish: 3,
        float: 0,
        hasFixedStart: false,
        fixedStart: 0,
        hasFixedLatest: false,
        fixedLatest: 0,
        image: null
    };

    state.nodes.push(newNode);
    renderNodes();
    calculateCriticalPath();
}

function normalizeId(value) {
    return String(value ?? '').trim() || String(Date.now());
}

function isValidDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00`);
    date.setDate(date.getDate() + days);
    return formatDateInputValue(date);
}

function daysBetween(startDateString, endDateString) {
    const start = new Date(`${startDateString}T00:00:00`);
    const end = new Date(`${endDateString}T00:00:00`);
    return Math.round((end - start) / 86400000);
}

function formatDisplayDate(dateString) {
    if (!isValidDateString(dateString)) return '';
    const date = new Date(`${dateString}T00:00:00`);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function getWeekdayLabel(dateString) {
    if (!isValidDateString(dateString)) return '';
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const date = new Date(`${dateString}T00:00:00`);
    return weekdays[date.getDay()];
}

function getDayType(dateString) {
    if (!isValidDateString(dateString)) return 'weekday';
    const day = new Date(`${dateString}T00:00:00`).getDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

function getDayHeaderClass(dateString) {
    const type = getDayType(dateString);
    if (type === 'sunday') return 'bg-rose-50 text-rose-500 border-rose-100';
    if (type === 'saturday') return 'bg-blue-50 text-blue-600 border-blue-100';
    return 'text-slate-400 border-slate-200/40';
}

function getDayGridClass(dateString) {
    const type = getDayType(dateString);
    if (type === 'sunday') return 'bg-rose-50/40 border-rose-100';
    if (type === 'saturday') return 'bg-blue-50/40 border-blue-100';
    return 'border-slate-100';
}

function getDateForOffset(offset) {
    return addDays(state.projectStartDate, offset || 0);
}

function getFinishDisplayDate(startOffset, finishOffset) {
    const endOffset = finishOffset > startOffset ? finishOffset - 1 : startOffset;
    return getDateForOffset(endOffset);
}

function getOffsetForDate(dateString) {
    return Math.max(0, daysBetween(state.projectStartDate, dateString));
}

function parseScheduleOffset(value, fallback = 0) {
    if (isValidDateString(value)) return getOffsetForDate(value);
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function wouldCreateCycle(fromId, toId, edges = state.edges) {
    const stack = [toId];
    const visited = new Set();

    while (stack.length > 0) {
        const current = stack.pop();
        if (current === fromId) return true;
        if (visited.has(current)) continue;
        visited.add(current);

        edges
            .filter(edge => edge.from === current)
            .forEach(edge => stack.push(edge.to));
    }

    return false;
}

function deleteNode(nodeId) {
    if (confirm("このタスクを削除しますか？紐づく依存関係（接続線）も自動的に削除されます。")) {
        pushHistory();
        state.nodes = state.nodes.filter(n => n.id !== nodeId);
        state.edges = state.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        renderNodes();
        calculateCriticalPath();
    }
}

function deleteEdge(fromId, toId) {
    pushHistory();
    state.edges = state.edges.filter(e => !(e.from === fromId && e.to === toId));
    calculateCriticalPath();
}

function onNodeNameChange(nodeId, newName) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        node.name = newName;
        if (state.currentView === 'gantt') {
            renderGanttChart();
        } else if (state.currentView === 'wbs') {
            renderWbsTable();
        }
    }
}

function onNodeDurationChange(nodeId, newDuration) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        let val = parseInt(newDuration, 10);
        if (isNaN(val) || val < 0) val = 0;
        node.duration = val;
        calculateCriticalPath();
        if (state.currentView === 'wbs') {
            renderWbsTable();
        }
    }
}

// Toggle individual constraints (Locks)
function toggleStartLock(nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        node.hasFixedStart = !node.hasFixedStart;
        if (node.hasFixedStart) {
            node.fixedStart = node.earliestStart; // Snap to current calculated value initially
        }
        calculateCriticalPath();
    }
}

function toggleLatestLock(nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        node.hasFixedLatest = !node.hasFixedLatest;
        if (node.hasFixedLatest) {
            node.fixedLatest = node.latestStart; // Snap to current calculated value initially
        }
        calculateCriticalPath();
    }
}

function onFixedStartDateChange(nodeId, val) {
    if (!isValidDateString(val)) return;
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        node.hasFixedStart = true;
        node.fixedStart = getOffsetForDate(val);
        calculateCriticalPath();
        if (state.currentView === 'wbs') {
            renderWbsTable();
        }
    }
}

function onFixedLatestDateChange(nodeId, val) {
    if (!isValidDateString(val)) return;
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        node.hasFixedLatest = true;
        node.fixedLatest = getOffsetForDate(val);
        calculateCriticalPath();
    }
}

function onFixedStartChange(nodeId, val) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        let parsed = parseInt(val, 10);
        if (isNaN(parsed) || parsed < 0) parsed = 0;
        node.fixedStart = parsed;
        calculateCriticalPath();
    }
}

function onFixedLatestChange(nodeId, val) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        let parsed = parseInt(val, 10);
        if (isNaN(parsed) || parsed < 0) parsed = 0;
        node.fixedLatest = parsed;
        calculateCriticalPath();
    }
}

// --- RENDER NODES AND CANVAS UPDATING ---
function updateCanvasEmptyState() {
    const emptyStateEl = document.getElementById('canvas-empty-state');
    if (!emptyStateEl) return;

    const hasCanvasContent = state.nodes.length > 0 || state.doodles.length > 0 || state.stickyNotes.length > 0;
    if (hasCanvasContent) {
        emptyStateEl.classList.remove('opacity-100');
        emptyStateEl.classList.add('opacity-0');
    } else {
        emptyStateEl.classList.remove('opacity-0');
        emptyStateEl.classList.add('opacity-100');
    }
}

function renderNodes() {
    const container = document.getElementById('nodes-container');
    container.innerHTML = '';

    updateCanvasEmptyState();

    state.nodes.forEach(node => {
        const cardStyle = 'border-slate-200 shadow-lg shadow-slate-100 bg-white hover:border-slate-300';
        const nodeEl = document.createElement('div');
        nodeEl.className = `gpu-node select-none pointer-events-auto w-64 border rounded-xl p-3 text-xs flex flex-col ${cardStyle}`;
        nodeEl.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
        nodeEl.id = `node-dom-${node.id}`;

        const nodeIdAttr = escapeHtml(node.id);
        const nodeIdJs = escapeJsString(node.id);
        const nodeNameAttr = escapeHtml(node.name || '');
        const startDateValue = getDateForOffset(node.hasFixedStart ? node.fixedStart : node.earliestStart);
        const latestDateText = formatDisplayDate(getDateForOffset(node.latestStart));
        const startLockIcon = node.hasFixedStart ? 'fa-lock text-amber-600' : 'fa-lock-open text-slate-400';
        const startLockBg = node.hasFixedStart ? 'bg-amber-50/70 border-amber-200' : 'bg-slate-50 border-slate-100';
        const latestLockIcon = node.hasFixedLatest ? 'fa-lock text-amber-600' : 'fa-lock-open text-slate-400';
        const latestLockBg = node.hasFixedLatest ? 'bg-amber-50/70 border-amber-200' : 'bg-slate-50 border-slate-100';

        const imageAreaHtml = node.image ? `
            <div class="relative w-full h-16 flex items-center justify-center bg-slate-100 border border-slate-200/50 rounded-lg overflow-hidden mb-2">
                <img src="${escapeHtml(node.image)}" class="max-w-full max-h-full object-contain" />
                <button onclick="removeNodeImage('${nodeIdJs}')" class="absolute top-1 right-1 bg-rose-500 hover:bg-rose-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow transition" title="写真を削除">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        ` : `
            <div class="mb-2">
                <button onclick="triggerNodeImageUpload('${nodeIdJs}')" class="w-full py-1.5 border border-dashed border-slate-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/20 text-slate-400 hover:text-indigo-600 transition flex items-center justify-center space-x-1" title="写真を追加">
                    <i class="fa-regular fa-image text-[10px]"></i>
                    <span class="text-[10px] font-medium">写真を追加</span>
                </button>
            </div>
        `;

        nodeEl.innerHTML = `
            <!-- Header drag handle & Delete -->
            <div class="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-2 cursor-grab drag-handle" 
                 onmousedown="onNodeDragStart(event, '${nodeIdJs}')"
                 ontouchstart="onNodeDragStart(event, '${nodeIdJs}')">
                <span class="font-mono text-[9px] text-slate-400">ID: ${nodeIdAttr}</span>
                <div class="flex items-center space-x-1">
                    <button onclick="deleteNode('${nodeIdJs}')" class="text-slate-400 hover:text-rose-500 transition ml-1 px-1">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- Task Name Input -->
            <div class="mb-2">
                <input type="text" value="${nodeNameAttr}" onchange="onNodeNameChange('${nodeIdJs}', this.value)" class="w-full bg-slate-50 border border-slate-200 rounded-md p-1.5 text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white font-semibold transition">
            </div>

            <!-- Image/Photo Area -->
            ${imageAreaHtml}
            <!-- Hidden file inputs uniquely generated per node -->
            <input type="file" id="node-img-input-${nodeIdAttr}" accept="image/*" class="hidden" onchange="handleNodeImageUpload(event, '${nodeIdJs}')">

            <!-- Duration Field -->
            <div class="flex items-center justify-between mb-2">
                <span class="text-slate-500 text-[11px]"><i class="fa-regular fa-clock mr-1 text-indigo-500"></i>工期:</span>
                <div class="flex items-center space-x-1">
                    <input type="number" min="0" value="${node.duration}" onchange="onNodeDurationChange('${nodeIdJs}', this.value)" class="w-16 bg-slate-50 border border-slate-200 rounded-md p-1 text-center font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:bg-white transition">
                    <span class="text-[10px] text-slate-400">日間</span>
                </div>
            </div>

            <!-- Interactive PERT Time Settings (With Manual Lock Features) -->
            <div class="space-y-1 mb-2">
                <!-- Earliest Start Setting -->
                <div class="flex items-center justify-between p-1 rounded ${startLockBg} border">
                    <div class="flex items-center space-x-1">
                        <button onclick="toggleStartLock('${nodeIdJs}')" class="p-1 hover:bg-slate-200/50 rounded transition" title="開始日固定を切り替える">
                            <i class="fa-solid ${startLockIcon}"></i>
                        </button>
                        <span class="text-[9px] text-slate-500">開始日:</span>
                    </div>
                    <div>
                        <input type="date" value="${startDateValue}" onchange="onFixedStartDateChange('${nodeIdJs}', this.value)" class="bg-white border ${node.hasFixedStart ? 'border-amber-300 text-amber-700' : 'border-slate-200 text-slate-600'} font-bold font-mono text-[10px] text-center rounded p-0.5 focus:outline-none focus:border-indigo-500" style="width: 7.7rem;">
                    </div>
                </div>

                <!-- Latest Start Setting -->
                <div class="flex items-center justify-between p-1 rounded ${latestLockBg} border">
                    <div class="flex items-center space-x-1">
                        <button onclick="toggleLatestLock('${nodeIdJs}')" class="p-1 hover:bg-slate-200/50 rounded transition" title="最遅開始日を個別に手動ロックする">
                            <i class="fa-solid ${latestLockIcon}"></i>
                        </button>
                        <span class="text-[9px] text-slate-500">最遅開始:</span>
                    </div>
                    <div>
                        ${node.hasFixedLatest ? 
                            `<input type="date" value="${getDateForOffset(node.fixedLatest)}" onchange="onFixedLatestDateChange('${nodeIdJs}', this.value)" class="bg-white border border-amber-300 text-amber-700 font-bold font-mono text-[10px] text-center rounded p-0.5 focus:outline-none" style="width: 7.7rem;">` :
                            `<span class="font-bold text-slate-600 font-mono text-[10px] pr-2">${latestDateText}</span>`
                        }
                    </div>
                </div>

                <!-- Float Indicator -->
                <div class="flex items-center justify-between p-1 rounded bg-slate-50 border border-slate-100">
                    <span class="text-[9px] text-slate-400 pl-6">スケジュールの余裕:</span>
                    <span class="font-bold font-mono text-[10px] pr-2 text-indigo-600">${node.float}日間</span>
                </div>
            </div>

            <!-- Connector Pins -->
            <!-- Incoming Connection Anchor (Left) -->
            <div class="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 border-blue-500 hover:bg-blue-50 cursor-crosshair z-20 flex items-center justify-center pointer-events-auto shadow-sm" 
                 id="pin-in-${nodeIdAttr}"
                 onmouseup="onPinInMouseUp(event, '${nodeIdJs}')"
                 title="つながれる側">
                 <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
            </div>

            <!-- Outgoing Connection Anchor (Right) -->
            <div class="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 border-rose-500 hover:bg-rose-50 cursor-crosshair z-20 flex items-center justify-center pointer-events-auto shadow-sm" 
                 id="pin-out-${nodeIdAttr}"
                 onmousedown="onPinOutMouseDown(event, '${nodeIdJs}')"
                 ontouchstart="onPinOutMouseDown(event, '${nodeIdJs}')"
                 title="つなげる側">
                 <div class="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
            </div>
        `;

        container.appendChild(nodeEl);
    });
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeJsString(str) {
    return String(str ?? '')
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/</g, "\\x3C");
}

// --- MOUSE & TOUCH EVENT HANDLERS ---
function onNodeDragStart(e, nodeId) {
    if (e.target.closest('button') || e.target.closest('input')) return;
    
    state.currentDragNodeId = nodeId;
    const coords = getCoordinates(e);
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
        pushHistory();
        state.dragOffset.x = coords.x - node.x;
        state.dragOffset.y = coords.y - node.y;
    }
}

function onPinOutMouseDown(e, nodeId) {
    e.preventDefault();
    e.stopPropagation();
    state.activeConnectingFromId = nodeId;

    const fromNode = state.nodes.find(n => n.id === nodeId);
    if (fromNode) {
        const tempLine = document.getElementById('temp-line');
        const start = getNodeAnchorPoint(fromNode, 'out');
        
        tempLine.setAttribute('d', `M ${start.x} ${start.y} L ${start.x} ${start.y}`);
        tempLine.classList.remove('hidden');
    }
}

function onPinInMouseUp(e, nodeId) {
    e.stopPropagation();
    if (state.activeConnectingFromId && state.activeConnectingFromId !== nodeId) {
        const fromId = state.activeConnectingFromId;
        const toId = nodeId;

        const exists = state.edges.some(edge => edge.from === fromId && edge.to === toId);
        if (wouldCreateCycle(fromId, toId)) {
            alert("循環する依存関係は作れません。別の向きで接続してください。");
        } else if (!exists) {
            pushHistory();
            state.edges.push({
                from: fromId,
                to: toId
            });
            calculateCriticalPath();
        }
    }
    resetConnectingState();
}

function resetConnectingState() {
    state.activeConnectingFromId = null;
    document.getElementById('temp-line').classList.add('hidden');
}

// Throttled mouse tracking inside requestAnimationFrame (rAF)
function onGlobalMove(e) {
    const coords = getCoordinates(e);
    
    if (e.touches && e.touches.length > 0) {
        state.lastTouchX = coords.x;
        state.lastTouchY = coords.y;
    }

    if (state.currentDoodle) {
        if (e.cancelable) e.preventDefault();
        state.currentDoodle.points.push(getCanvasPoint(e));
        renderDoodles();
        return;
    }

    if (state.currentDragStickyId) {
        if (e.cancelable) e.preventDefault();
        const note = state.stickyNotes.find(n => n.id === state.currentDragStickyId);
        if (note) {
            note.x = coords.x - state.dragOffset.x;
            note.y = coords.y - state.dragOffset.y;
            if (note.x < 10) note.x = 10;
            if (note.y < 10) note.y = 10;

            const el = document.getElementById(`sticky-${note.id}`);
            if (el) el.style.transform = `translate3d(${note.x}px, ${note.y}px, 0)`;
        }
        return;
    }

    if (state.currentDragNodeId || state.activeConnectingFromId) {
        if (e.cancelable) e.preventDefault(); 
        
        state.currentMouseCoords = coords;

        if (!ticking) {
            window.requestAnimationFrame(() => {
                updateDragAndLines();
                ticking = false;
            });
            ticking = true;
        }
    }
}

// Lightweight function called inside rAF for smooth GPU positioning and local SVG path updating
function updateDragAndLines() {
    // 1. Move dragging Node
    if (state.currentDragNodeId) {
        const node = state.nodes.find(n => n.id === state.currentDragNodeId);
        if (node) {
            node.x = state.currentMouseCoords.x - state.dragOffset.x;
            node.y = state.currentMouseCoords.y - state.dragOffset.y;

            if (node.x < 10) node.x = 10;
            if (node.y < 10) node.y = 10;

            const el = document.getElementById(`node-dom-${node.id}`);
            if (el) {
                // translate3d to offload rendering overhead to GPU
                el.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
            }
            // Super fast partial updates only on lines that belong to this node
            updateActiveEdges(node.id);
        }
    }

    // 2. Adjust Drafting Connective Line
    if (state.activeConnectingFromId) {
        const fromNode = state.nodes.find(n => n.id === state.activeConnectingFromId);
        if (fromNode) {
            const canvas = document.getElementById('canvas-container');
            const rect = canvas.getBoundingClientRect();
            
            const curMouseX = state.currentMouseCoords.x - rect.left + canvas.scrollLeft;
            const curMouseY = state.currentMouseCoords.y - rect.top + canvas.scrollTop;

            const start = getNodeAnchorPoint(fromNode, 'out');

            const tempLine = document.getElementById('temp-line');
            const dx = Math.abs(curMouseX - start.x) * 0.5;
            tempLine.setAttribute('d', `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${curMouseX - dx} ${curMouseY}, ${curMouseX} ${curMouseY}`);
        }
    }
}

function onGlobalEnd(e) {
    if (state.currentDoodle) {
        state.currentDoodle = null;
    }

    if (state.activeConnectingFromId && (e.type === 'touchend' || e.type === 'touchcancel')) {
        const targetElement = document.elementFromPoint(state.lastTouchX, state.lastTouchY);
        if (targetElement) {
            let pinInId = null;
            if (targetElement.id && targetElement.id.startsWith('pin-in-')) {
                pinInId = targetElement.id.replace('pin-in-', '');
            } else {
                const closestPin = targetElement.closest('[id^="pin-in-"]');
                if (closestPin) {
                    pinInId = closestPin.id.replace('pin-in-', '');
                }
            }
            
            if (pinInId && pinInId !== state.activeConnectingFromId) {
                const fromId = state.activeConnectingFromId;
                const toId = pinInId;
                const exists = state.edges.some(edge => edge.from === fromId && edge.to === toId);
                if (wouldCreateCycle(fromId, toId)) {
                    alert("循環する依存関係は作れません。別の向きで接続してください。");
                } else if (!exists) {
                    pushHistory();
                    state.edges.push({ from: fromId, to: toId });
                    calculateCriticalPath();
                }
            }
        }
    }

    if (state.currentDragNodeId) {
        state.currentDragNodeId = null;
        // recalculate final state once drag ends
        calculateCriticalPath();
    }
    if (state.currentDragStickyId) {
        state.currentDragStickyId = null;
    }
    if (state.activeConnectingFromId) {
        resetConnectingState();
    }
}

// --- SVG CONNECTION LINE DRAWING ---
function drawEdges() {
    const edgesGroup = document.getElementById('svg-edges-group');
    edgesGroup.innerHTML = '';

    state.edges.forEach((edge) => {
        const fromNode = state.nodes.find(n => n.id === edge.from);
        const toNode = state.nodes.find(n => n.id === edge.to);

        if (!fromNode || !toNode) return;

        const start = getNodeAnchorPoint(fromNode, 'out');
        const end = getNodeAnchorPoint(toNode, 'in');

        const strokeColor = '#4f46e5';
        const strokeWidth = '2';
        const marker = 'url(#arrow)';

        const pathD = createEdgePath(start, end);

        // Create main visible path with ID for real-time partial updates
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute('id', `edge-path-${edge.from}-${edge.to}`);
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', strokeWidth);
        path.setAttribute('marker-end', marker);

        // Create virtual wide hover path with ID for real-time partial updates
        const hoverPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hoverPath.setAttribute('id', `edge-hover-${edge.from}-${edge.to}`);
        hoverPath.setAttribute('d', pathD);
        hoverPath.setAttribute('fill', 'none');
        hoverPath.setAttribute('stroke', 'transparent');
        hoverPath.setAttribute('stroke-width', '10');
        hoverPath.style.cursor = 'pointer';
        hoverPath.style.pointerEvents = 'auto';

        hoverPath.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm("このタスク間の紐（接続線）を切り離しますか？")) {
                deleteEdge(edge.from, edge.to);
            }
        });

        edgesGroup.appendChild(path);
        edgesGroup.appendChild(hoverPath);
    });
}

// Fast partial update targeting only the lines affected by the currently dragged node
function updateActiveEdges(nodeId) {
    state.edges.forEach(edge => {
        if (edge.from === nodeId || edge.to === nodeId) {
            const fromNode = state.nodes.find(n => n.id === edge.from);
            const toNode = state.nodes.find(n => n.id === edge.to);

            if (!fromNode || !toNode) return;

            const start = getNodeAnchorPoint(fromNode, 'out');
            const end = getNodeAnchorPoint(toNode, 'in');
            const pathD = createEdgePath(start, end);

            const pathEl = document.getElementById(`edge-path-${edge.from}-${edge.to}`);
            const hoverEl = document.getElementById(`edge-hover-${edge.from}-${edge.to}`);
            
            if (pathEl) pathEl.setAttribute('d', pathD);
            if (hoverEl) hoverEl.setAttribute('d', pathD);
        }
    });
}

function getNodeAnchorPoint(node, side) {
    const el = document.getElementById(`node-dom-${node.id}`);
    const width = el ? el.offsetWidth : 256;
    const height = el ? el.offsetHeight : 180;
    const x = side === 'out' ? node.x + width : node.x;
    const y = node.y + (height / 2);

    return { x, y };
}

function createEdgePath(start, end) {
    const dx = Math.max(Math.abs(end.x - start.x) * 0.5, 40);
    return `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
}

// --- CRITICAL PATH METHOD (CPM) ALGORITHM WITH SCHEDULING CONSTRAINTS ---
function calculateCriticalPath() {
    if (state.nodes.length === 0) {
        updateStats(0, 0);
        updatePlakumaSpeech(0);
        return;
    }

    // Reset computational fields
    state.nodes.forEach(n => {
        n.earliestStart = 0;
        n.earliestFinish = 0;
        n.latestStart = 9999;
        n.latestFinish = 9999;
        n.float = 9999;
    });

    // Build DAG
    const adj = {};
    const inDegree = {};
    state.nodes.forEach(n => {
        adj[n.id] = [];
        inDegree[n.id] = 0;
    });

    state.edges.forEach(e => {
        if (adj[e.from] && adj[e.to] !== undefined) {
            adj[e.from].push(e.to);
            inDegree[e.to] = (inDegree[e.to] || 0) + 1;
        }
    });

    // Topological Sort (Kahn's algorithm)
    let queue = [];
    state.nodes.forEach(n => {
        if (inDegree[n.id] === 0) {
            queue.push(n.id);
        }
    });

    let order = [];
    let tempInDegree = { ...inDegree };

    while (queue.length > 0) {
        let u = queue.shift();
        order.push(u);

        (adj[u] || []).forEach(v => {
            tempInDegree[v]--;
            if (tempInDegree[v] === 0) {
                queue.push(v);
            }
        });
    }

    // Circular fallback
    if (order.length < state.nodes.length) {
        order = state.nodes.map(n => n.id);
    }

    // 1. FORWARD PASS (With start locked constraint)
    order.forEach(uId => {
        const uNode = state.nodes.find(n => n.id === uId);
        if (!uNode) return;

        // Collect parents earliest finishes
        let computedES = 0;
        state.edges.filter(e => e.to === uId).forEach(e => {
            const parentNode = state.nodes.find(p => p.id === e.from);
            if (parentNode) {
                computedES = Math.max(computedES, parentNode.earliestFinish);
            }
        });

        // Apply manual constraint if locked
        if (uNode.hasFixedStart) {
            uNode.earliestStart = Math.max(computedES, uNode.fixedStart);
        } else {
            uNode.earliestStart = computedES;
        }

        uNode.earliestFinish = uNode.earliestStart + uNode.duration;
    });

    // 2. PROJECT TOTAL DURATION
    let projectDuration = 0;
    state.nodes.forEach(n => {
        projectDuration = Math.max(projectDuration, n.earliestFinish);
    });

    // 3. BACKWARD PASS (With latest start constraint)
    // Setup initial dead-ends
    state.nodes.forEach(n => {
        const isEndNode = !adj[n.id] || adj[n.id].length === 0;
        if (isEndNode) {
            n.latestFinish = projectDuration;
        }
    });

    for (let i = order.length - 1; i >= 0; i--) {
        const uId = order[i];
        const uNode = state.nodes.find(n => n.id === uId);
        if (!uNode) continue;

        // If not end node, calculate from children
        const childrenEdges = state.edges.filter(e => e.from === uId);
        if (childrenEdges.length > 0) {
            let minLatestStart = 9999;
            childrenEdges.forEach(e => {
                const childNode = state.nodes.find(c => c.id === e.to);
                if (childNode) {
                    minLatestStart = Math.min(minLatestStart, childNode.latestStart);
                }
            });
            uNode.latestFinish = minLatestStart;
        }

        // Apply manual latest start constraint if locked
        if (uNode.hasFixedLatest) {
            uNode.latestFinish = Math.min(uNode.latestFinish, uNode.fixedLatest + uNode.duration);
        }

        uNode.latestStart = uNode.latestFinish - uNode.duration;
        if (uNode.latestStart < 0) uNode.latestStart = 0;
    }

    // 4. FLOAT CALCULATION
    state.nodes.forEach(n => {
        n.float = n.latestStart - n.earliestStart;
        if (n.float < 0) n.float = 0; 
    });

    // Re-draw visual layers
    renderNodes();
    drawEdges();

    // Stats & Mascot tips updates
    updateStats(state.nodes.length, projectDuration);
    updatePlakumaSpeech(projectDuration);

    // Sync Gantt
    if (state.currentView === 'gantt') {
        renderGanttChart();
    } else if (state.currentView === 'wbs') {
        renderWbsTable();
    }
}

function updateStats(totalNodes, totalDur) {
    document.getElementById('stat-total-nodes').innerText = totalNodes;
    const startDate = formatDisplayDate(state.projectStartDate);
    const endDate = formatDisplayDate(totalDur > 0 ? getDateForOffset(totalDur - 1) : state.projectStartDate);
    document.getElementById('stat-total-duration').innerText = totalDur > 0
        ? `${totalDur}日間 (${startDate}〜${endDate})`
        : '0日間';
}

// --- AUTO-LAYOUT ENGINE ---
function autoLayoutNodes() {
    if (state.nodes.length === 0) return;

    const layers = {};
    const nodeLayerMap = {};

    function getLongestPathDepth(nodeId, visited = new Set()) {
        if (visited.has(nodeId)) return 0;
        visited.add(nodeId);

        const node = state.nodes.find(n => n.id === nodeId);
        const parents = state.edges.filter(e => e.to === nodeId).map(e => e.from);
        if (parents.length === 0) return 0;

        let maxDepth = 0;
        parents.forEach(pId => {
            maxDepth = Math.max(maxDepth, getLongestPathDepth(pId, new Set(visited)));
        });
        return maxDepth + 1;
    }

    state.nodes.forEach(node => {
        const depth = getLongestPathDepth(node.id);
        if (!layers[depth]) layers[depth] = [];
        layers[depth].push(node);
        nodeLayerMap[node.id] = depth;
    });

    const startX = 60;
    const spacingX = 380; 
    const spacingY = 240; // slightly increased to account for photo slot 

    Object.keys(layers).forEach(layerKey => {
        const levelNodes = layers[layerKey];
        const depthNum = parseInt(layerKey, 10);

        levelNodes.forEach((node, index) => {
            node.x = startX + (depthNum * spacingX);
            const verticalOffset = (index - (levelNodes.length - 1) / 2) * spacingY;
            node.y = 250 + verticalOffset;
        });
    });

    renderNodes();
    drawEdges();
}

// --- JSON UTILS ---
function loadPreset() {
    const selector = document.getElementById('settings-preset-selector');
    const selectedPreset = PRESETS[selector.value];
    if (selectedPreset) {
        document.getElementById('ai-json-input').value = JSON.stringify(selectedPreset, null, 2);
        importJSON();
    }
}

function applyPresetFromSettings() {
    const hasCurrentData = state.nodes.length > 0 || state.edges.length > 0;
    if (hasCurrentData) {
        const ok = confirm(
            "テンプレートを変更すると、現在のタスク・接続線・写真・固定日程は上書きされます。\n\n" +
            "必要なら先に「先に保存」からセーブしてからにしてください。\n\n" +
            "このままテンプレートを変更しますか？"
        );
        if (!ok) return;
    }

    loadPreset();
    closeModal('settings-modal');
}

function importJSON() {
    const rawInput = document.getElementById('ai-json-input').value;
    try {
        const parsed = JSON.parse(rawInput);
        if (!parsed.wbs || !Array.isArray(parsed.wbs)) {
            alert("❌ JSONの構成エラー: `wbs` 配列が見つかりません。");
            return;
        }

        if (state.nodes.length > 0 || state.edges.length > 0 || state.doodles.length > 0 || state.stickyNotes.length > 0) {
            pushHistory();
        }

        // Wipe state
        state.nodes = [];
        state.edges = [];
        state.doodles = [];
        state.stickyNotes = [];
        state.projectTitle = parsed.project_title || "マイプロジェクト";
        if (isValidDateString(parsed.project_start_date)) {
            state.projectStartDate = parsed.project_start_date;
            syncProjectStartDateInput();
        }

        // Ingest nodes
        parsed.wbs.forEach(item => {
            const id = normalizeId(item.id);
            state.nodes.push({
                id: id,
                name: item.task_name || `タスク ${item.id}`,
                duration: parseInt(item.duration, 10) || 0,
                x: 0,
                y: 0,
                earliestStart: 0,
                earliestFinish: 0,
                latestStart: 0,
                latestFinish: 0,
                float: 0,
                hasFixedStart: item.hasFixedStart || isValidDateString(item.start_date) || false,
                fixedStart: parseScheduleOffset(item.fixedStart || item.start_date, 0),
                hasFixedLatest: item.hasFixedLatest || isValidDateString(item.latest_start_date) || false,
                fixedLatest: parseScheduleOffset(item.fixedLatest || item.latest_start_date, 0),
                image: item.image || null
            });
        });

        // Edges
        let skippedEdges = 0;
        parsed.wbs.forEach(item => {
            const to = normalizeId(item.id);
            if (item.depends_on && Array.isArray(item.depends_on)) {
                item.depends_on.forEach(parent => {
                    const from = normalizeId(parent);
                    const exists = state.edges.some(e => e.from === from && e.to === to);
                    const hasNodes = state.nodes.some(n => n.id === from) && state.nodes.some(n => n.id === to);
                    if (from !== to && hasNodes && !exists && !wouldCreateCycle(from, to, state.edges)) {
                        state.edges.push({
                            from: from,
                            to: to
                        });
                    } else {
                        skippedEdges++;
                    }
                });
            }
        });

        autoLayoutNodes();
        calculateCriticalPath();
        renderDoodles();
        renderStickyNotes();
        if (skippedEdges > 0) {
            alert(`循環や不正な依存関係 ${skippedEdges}件をスキップして読み込みました。`);
        }

    } catch (e) {
        alert("❌ JSON解析エラー: JSONの書き方が崩れているようです。\n" + e.message);
    }
}

function clearAllCanvas() {
    if (confirm("キャンバス上のタスクと紐をすべて消去して初期化しますか？")) {
        pushHistory();
        state.nodes = [];
        state.edges = [];
        state.doodles = [];
        state.stickyNotes = [];
        renderNodes();
        drawEdges();
        renderDoodles();
        renderStickyNotes();
        calculateCriticalPath();
    }
}

// --- VIEW SWITCH & GANTT CHART ENGINE ---
function switchView(viewName) {
    state.currentView = viewName;
    
    const tabCanvas = document.getElementById('tab-canvas');
    const tabWbs = document.getElementById('tab-wbs');
    const tabGantt = document.getElementById('tab-gantt');
    const canvasContainer = document.getElementById('canvas-container');
    const wbsContainer = document.getElementById('wbs-container');
    const ganttContainer = document.getElementById('gantt-container');
    const toolbar = document.getElementById('main-workspace').firstElementChild;
    const activeClass = "px-2.5 py-1 text-[11px] md:text-xs font-semibold rounded-md transition bg-white text-indigo-600 shadow-sm border border-slate-200/50";
    const inactiveClass = "px-2.5 py-1 text-[11px] md:text-xs font-semibold rounded-md transition text-slate-500 hover:text-slate-800";

    if (viewName === 'canvas') {
        tabCanvas.className = activeClass;
        tabWbs.className = inactiveClass;
        tabGantt.className = inactiveClass;
        canvasContainer.classList.remove('hidden');
        wbsContainer.classList.add('hidden');
        ganttContainer.classList.add('hidden');
        toolbar.classList.remove('hidden');
        
        renderNodes();
        drawEdges();
    } else if (viewName === 'wbs') {
        tabCanvas.className = inactiveClass;
        tabWbs.className = activeClass;
        tabGantt.className = inactiveClass;
        canvasContainer.classList.add('hidden');
        wbsContainer.classList.remove('hidden');
        ganttContainer.classList.add('hidden');
        toolbar.classList.add('hidden');

        renderWbsTable();
    } else {
        tabCanvas.className = inactiveClass;
        tabWbs.className = inactiveClass;
        tabGantt.className = activeClass;
        canvasContainer.classList.add('hidden');
        wbsContainer.classList.add('hidden');
        ganttContainer.classList.remove('hidden');
        toolbar.classList.add('hidden');

        renderGanttChart();
    }
}

function getNodeDependencyDepth(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);

    const parents = state.edges.filter(edge => edge.to === nodeId).map(edge => edge.from);
    if (parents.length === 0) return 0;

    return Math.max(...parents.map(parentId => getNodeDependencyDepth(parentId, new Set(visited)))) + 1;
}

function getWbsRows() {
    const layerCounters = {};

    return [...state.nodes]
        .map(node => ({
            node,
            depth: getNodeDependencyDepth(node.id)
        }))
        .sort((a, b) => a.depth - b.depth || a.node.earliestStart - b.node.earliestStart || String(a.node.id).localeCompare(String(b.node.id), 'ja'))
        .map(item => {
            const layer = item.depth + 1;
            layerCounters[layer] = (layerCounters[layer] || 0) + 1;
            return {
                ...item,
                wbsNo: `${layer}.${layerCounters[layer]}`
            };
        });
}

function getNextNodeId() {
    let nextId = 1;
    while (state.nodes.some(n => n.id === String(nextId))) {
        nextId++;
    }
    return String(nextId);
}

function addWbsTask() {
    pushHistory();
    const id = getNextNodeId();
    const siblings = state.nodes.length;
    state.nodes.push({
        id,
        name: `${id}. 新規タスク`,
        duration: 3,
        x: 60 + ((siblings % 4) * 360),
        y: 180 + (Math.floor(siblings / 4) * 220),
        earliestStart: 0,
        earliestFinish: 3,
        latestStart: 0,
        latestFinish: 3,
        float: 0,
        hasFixedStart: false,
        fixedStart: 0,
        hasFixedLatest: false,
        fixedLatest: 0,
        image: null
    });

    calculateCriticalPath();
    autoLayoutNodes();
    renderWbsTable();
}

function getDependencyIdsForNode(nodeId) {
    return state.edges
        .filter(edge => edge.to === nodeId)
        .map(edge => edge.from);
}

function onWbsDependenciesChange(nodeId, rawValue) {
    const requestedParents = rawValue
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    const uniqueParents = [...new Set(requestedParents)];
    const baseEdges = state.edges.filter(edge => edge.to !== nodeId);
    const nextEdges = [...baseEdges];
    let skipped = 0;

    uniqueParents.forEach(parentId => {
        const hasParent = state.nodes.some(node => node.id === parentId);
        const exists = nextEdges.some(edge => edge.from === parentId && edge.to === nodeId);
        if (parentId !== nodeId && hasParent && !exists && !wouldCreateCycle(parentId, nodeId, nextEdges)) {
            nextEdges.push({ from: parentId, to: nodeId });
        } else {
            skipped++;
        }
    });

    pushHistory();
    state.edges = nextEdges;
    calculateCriticalPath();
    autoLayoutNodes();
    renderWbsTable();

    if (skipped > 0) {
        alert(`存在しないID、同じタスク、循環する前提タスク ${skipped}件はスキップしました。`);
    }
}

function renderWbsTable() {
    const table = document.getElementById('wbs-table');
    if (!table) return;
    table.innerHTML = '';

    if (state.nodes.length === 0) {
        table.innerHTML = `<tr><td class="p-4 text-center text-slate-400 text-sm">タスクが存在しません。「WBSタスク追加」から作業を洗い出してください。</td></tr>`;
        return;
    }

    const rows = getWbsRows();
    let html = `
        <thead>
            <tr class="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                <th class="p-3 w-20 text-center border-r border-slate-200">WBS</th>
                <th class="p-3 min-w-[18rem] border-r border-slate-200">作業名</th>
                <th class="p-3 w-16 text-center border-r border-slate-200">階層</th>
                <th class="p-3 w-16 text-center border-r border-slate-200">工期</th>
                <th class="p-3 w-24 text-center border-r border-slate-200">開始日</th>
                <th class="p-3 w-24 text-center border-r border-slate-200">終了日</th>
                <th class="p-3 min-w-[16rem] border-r border-slate-200">前提タスクID</th>
                <th class="p-3 w-16 text-center">余裕</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white">
    `;

    rows.forEach(({ node, depth, wbsNo }) => {
        const parentIds = getDependencyIdsForNode(node.id);
        const parentNames = parentIds.map(parentId => state.nodes.find(parent => parent.id === parentId)?.name || parentId);
        const parentTitle = escapeHtml(parentNames.join(' / ') || '前提タスクなし');
        const parentSummary = parentNames.length ? parentNames.map(escapeHtml).join(' / ') : '前提なし';
        const startDate = getDateForOffset(node.earliestStart);
        const finishDate = getFinishDisplayDate(node.earliestStart, node.earliestFinish);
        const indent = depth * 16;
        const nodeIdJs = escapeJsString(node.id);

        html += `
            <tr class="hover:bg-slate-50/70 transition text-xs text-slate-600">
                <td class="p-3 text-center border-r border-slate-200 font-mono font-bold text-indigo-600">${wbsNo}</td>
                <td class="p-3 border-r border-slate-200 font-semibold text-slate-800">
                    <div class="flex items-center" style="padding-left: ${indent}px;">
                        <span class="inline-block w-2 h-2 rounded-full bg-indigo-500 mr-2 shrink-0"></span>
                        <input type="text" value="${escapeHtml(node.name)}" onchange="onNodeNameChange('${nodeIdJs}', this.value)" class="w-full bg-white border border-slate-200 rounded-md p-1.5 text-slate-800 focus:outline-none focus:border-indigo-500 font-semibold">
                    </div>
                </td>
                <td class="p-3 text-center border-r border-slate-200">${depth + 1}</td>
                <td class="p-3 text-center border-r border-slate-200 font-bold">
                    <input type="number" min="0" value="${node.duration}" onchange="onNodeDurationChange('${nodeIdJs}', this.value)" class="w-14 bg-white border border-slate-200 rounded-md p-1 text-center font-bold text-slate-700 focus:outline-none focus:border-indigo-500">日
                </td>
                <td class="p-3 text-center border-r border-slate-200 font-mono text-[11px]">
                    <input type="date" value="${startDate}" onchange="onFixedStartDateChange('${nodeIdJs}', this.value)" class="bg-white border ${node.hasFixedStart ? 'border-amber-300 text-amber-700' : 'border-slate-200 text-slate-700'} rounded-md p-1 text-[11px] focus:outline-none focus:border-indigo-500" style="width: 8.2rem;">
                </td>
                <td class="p-3 text-center border-r border-slate-200 font-mono text-[11px]">${formatDisplayDate(finishDate)}</td>
                <td class="p-3 border-r border-slate-200 text-slate-500">
                    <input type="text" value="${escapeHtml(parentIds.join(', '))}" onchange="onWbsDependenciesChange('${nodeIdJs}', this.value)" class="w-full bg-white border border-slate-200 rounded-md p-1.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:border-indigo-500" placeholder="例: 1, 2" title="${parentTitle}">
                    <div class="mt-1 text-[10px] text-slate-400 truncate">${parentSummary}</div>
                </td>
                <td class="p-3 text-center font-bold text-indigo-600">${node.float}日</td>
            </tr>
        `;
    });

    html += '</tbody>';
    table.innerHTML = html;
}

function renderGanttChart() {
    const table = document.getElementById('gantt-table');
    table.innerHTML = '';

    if (state.nodes.length === 0) {
        table.innerHTML = `<tr><td class="p-4 text-center text-slate-400 text-sm">タスクが存在しません。キャンバスで追加するか、JSONを読み込んでください。</td></tr>`;
        return;
    }

    let projectEnd = 0;
    state.nodes.forEach(n => {
        projectEnd = Math.max(projectEnd, n.earliestFinish);
    });
    const dayWidth = 72;
    const totalCols = Math.max(projectEnd + 2, 14);

    let headerHtml = `
        <thead>
            <tr class="border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                <th class="p-3 w-40 md:w-48 shrink-0 min-w-[10rem] md:min-w-[12rem] sticky left-0 bg-slate-50 z-10 border-r border-slate-200">タスク名</th>
                <th class="p-3 w-16 md:w-20 text-center border-r border-slate-200">工期</th>
                <th class="p-3 w-24 text-center border-r border-slate-200">開始日</th>
                <th class="p-3 w-24 text-center border-r border-slate-200">終了日</th>
                <th class="p-3 w-16 md:w-20 text-center border-r border-slate-200">固定状態</th>
                <th class="p-3 w-16 md:w-20 text-center border-r border-slate-200">余裕</th>
                <th class="p-3 flex-1">
                    <div class="flex select-none">
                        ${Array.from({ length: totalCols }).map((_, i) => {
                            const date = getDateForOffset(i);
                            return `<div class="text-center shrink-0 border-r text-[9px] ${getDayHeaderClass(date)}" style="width: ${dayWidth}px;">
                                <div class="font-mono leading-tight">${formatDisplayDate(date)}</div>
                                <div class="font-bold leading-tight">${getWeekdayLabel(date)}</div>
                            </div>`;
                        }).join('')}
                    </div>
                </th>
            </tr>
        </thead>
    `;

    let bodyHtml = '<tbody class="divide-y divide-slate-100 bg-white">';
    const sortedNodes = [...state.nodes].sort((a,b) => a.earliestStart - b.earliestStart);

    sortedNodes.forEach(node => {
        // Vibrant neon gradients for light mode
        const barColor = 'bg-gradient-to-r from-indigo-500 to-blue-500 shadow-md shadow-indigo-100';

        // Check if node is locked manually
        let statusBadge = '<span class="text-slate-400 text-[10px]">自動</span>';
        if (node.hasFixedStart || node.hasFixedLatest) {
            statusBadge = '<span class="text-amber-600 text-[10px] font-bold"><i class="fa-solid fa-lock mr-1"></i>固定</span>';
        }

        const nodeStartDate = getDateForOffset(node.earliestStart);
        const nodeFinishDate = getFinishDisplayDate(node.earliestStart, node.earliestFinish);
        const barStartOffset = node.earliestStart * dayWidth; 
        const barWidth = Math.max(node.duration * dayWidth, 12);

        bodyHtml += `
            <tr class="hover:bg-slate-50/50 transition text-xs text-slate-600">
                <td class="p-3 font-semibold text-slate-800 truncate border-r border-slate-200 sticky left-0 bg-white z-10">
                    <span class="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500 mr-2"></span>
                    ${escapeHtml(node.name)}
                </td>
                <td class="p-3 text-center border-r border-slate-200 font-bold text-slate-700">${node.duration}日</td>
                <td class="p-3 text-center border-r border-slate-200 font-mono text-[11px] text-slate-700">${formatDisplayDate(nodeStartDate)}</td>
                <td class="p-3 text-center border-r border-slate-200 font-mono text-[11px] text-slate-700">${formatDisplayDate(nodeFinishDate)}</td>
                <td class="p-3 text-center border-r border-slate-200">${statusBadge}</td>
                <td class="p-3 text-center border-r border-slate-200 font-bold text-indigo-600">${node.float}日</td>
                <td class="p-3 overflow-hidden">
                    <div class="flex relative h-6 w-full items-center">
                        <div class="absolute inset-0 flex pointer-events-none">
                            ${Array.from({ length: totalCols }).map((_, i) => {
                                const date = getDateForOffset(i);
                                return `<div class="h-full border-r shrink-0 ${getDayGridClass(date)}" style="width: ${dayWidth}px;"></div>`;
                            }).join('')}
                        </div>
                        <div class="absolute h-5 rounded-md ${barColor} flex items-center justify-between px-2 text-[9px] font-bold text-white shadow-sm"
                             style="left: ${barStartOffset}px; width: ${barWidth}px;"
                             title="${node.name} (${formatDisplayDate(nodeStartDate)}〜${formatDisplayDate(nodeFinishDate)})">
                             <span class="truncate">${node.duration > 1 ? node.name : ''}</span>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    bodyHtml += '</tbody>';
    table.innerHTML = headerHtml + bodyHtml;
}
