// 電工技能測試刷題工具 - 核心業務邏輯
(function() {
  const SUBJECTS = {
    'mid_maintenance_electrician': {
      id: 'mid_maintenance_electrician',
      name: '中級維修電工',
      badge: '920 題 · 2026 最新版',
      getData: () => window.RAW_QUESTION_DATA,
      file: 'data/mid_maintenance_electrician.json'
    },
    'junior_maintenance_electrician': {
      id: 'junior_maintenance_electrician',
      name: '初級維修電工',
      badge: '610 題 · 完整官方題庫',
      getData: () => window.RAW_JUNIOR_ELECTRICIAN_DATA,
      file: 'data/junior_maintenance_electrician.json'
    },
    'junior_equipment_installer': {
      id: 'junior_equipment_installer',
      name: '初級電氣設備安裝工',
      badge: '328 題 · 完整官方題庫',
      getData: () => window.RAW_EQUIPMENT_INSTALLER_DATA,
      file: 'data/junior_equipment_installer.json'
    }
  };

  // 核心狀態
  const state = {
    currentSubject: localStorage.getItem('elec_current_subject') || 'mid_maintenance_electrician',
    allQuestions: [],
    categories: [],
    
    // 篩選與模式
    currentMode: 'practice', // 'practice' | 'shuffle' | 'exam' | 'mistakes' | 'bookmarks' | 'search'
    selectedCategory: 'all',
    selectedType: 'all', // 'all' | 'tf' | 'mc'
    searchKeyword: '',
    
    // 當前模式題目列表與索引
    activeQuestions: [],
    currentIndex: 0,
    
    // 模擬考試狀態
    exam: {
      active: false,
      totalQuestions: 100, // 50 是非 + 50 選擇
      durationSeconds: 3600, // 60分鐘
      remainingSeconds: 3600,
      timerId: null,
      submitted: false,
      answers: {}, // { [index]: optionKey }
      result: null
    },
    
    // 持久化資料 (LocalStorage)
    history: {}, // { [id]: { answer, isCorrect, count } }
    mistakes: {}, // { [id]: count }
    bookmarks: new Set(), // Set of id
    notes: {}, // { [id]: string }
    
    // 設定
    settings: {
      autoNext: true,
      autoNextDelay: 800,
      darkMode: false
    },
    
    // UI 控制
    showAnswerSheet: false,
    sheetFilter: 'all', // 'all' | 'done' | 'undone' | 'wrong'
    showImageModal: false,
    modalImageUrl: '',
    showSettingsModal: false,
    showExamModal: false
  };

  // 載入當前科目題庫資料
  function loadSubjectData(subjId) {
    state.currentSubject = subjId;
    localStorage.setItem('elec_current_subject', subjId);
    
    const subj = SUBJECTS[subjId];
    if (!subj) return;
    
    // 更新科目下拉框與徽章
    const sel = document.getElementById('subject-selector');
    if (sel) sel.value = subjId;
    const badge = document.getElementById('subject-badge');
    if (badge) badge.innerText = subj.badge;
    
    let raw = subj.getData();
    if (raw) {
      setupApp(raw);
    } else {
      fetch(subj.file)
        .then(res => res.json())
        .then(data => setupApp(data))
        .catch(err => alert("無法載入題庫檔案：" + subj.file));
    }
  }

  function initData() {
    loadSubjectData(state.currentSubject);
  }

  function setupApp(data) {
    state.allQuestions = data.questions;
    state.categories = data.categories;
    
    // 動態更新章節篩選下拉框
    const catSelect = document.getElementById('category-filter');
    if (catSelect) {
      let optHtml = `<option value="all">全本題庫 (全部 ${data.categories.length} 大篇章 · ${data.total_count} 題)</option>`;
      data.categories.forEach((c, idx) => {
        const cnt = state.allQuestions.filter(q => q.category === c).length;
        optHtml += `<option value="${c}">${idx + 1}. ${c} (${cnt} 題)</option>`;
      });
      catSelect.innerHTML = optHtml;
      catSelect.value = state.selectedCategory;
      if (catSelect.value !== state.selectedCategory) {
        state.selectedCategory = 'all';
      }
    }

    // 讀取該科目的 LocalStorage 記錄
    loadUserData();
    
    if (state.settings.darkMode) {
      document.documentElement.classList.add('dark');
    }
    
    state.currentIndex = 0;
    updateActiveQuestions();
    
    // 記憶上次該科目的題號
    const savedLastId = localStorage.getItem(`elec_${state.currentSubject}_last_qid`);
    if (savedLastId && state.currentMode === 'practice') {
      const idx = state.activeQuestions.findIndex(q => q.id === savedLastId);
      if (idx !== -1) state.currentIndex = idx;
    }
    
    render();
    bindEvents();
    bindKeyboardShortcuts();
  }

  // 讀取使用者本機歷史 (按科目隔離)
  function loadUserData() {
    try {
      const pfx = `elec_${state.currentSubject}_`;
      // 相容舊 key
      const savedHist = localStorage.getItem(pfx + 'history') || (state.currentSubject === 'mid_maintenance_electrician' ? localStorage.getItem('elec_history') : null);
      state.history = savedHist ? JSON.parse(savedHist) : {};
      
      const savedMis = localStorage.getItem(pfx + 'mistakes') || (state.currentSubject === 'mid_maintenance_electrician' ? localStorage.getItem('elec_mistakes') : null);
      state.mistakes = savedMis ? JSON.parse(savedMis) : {};
      
      const savedBmk = localStorage.getItem(pfx + 'bookmarks') || (state.currentSubject === 'mid_maintenance_electrician' ? localStorage.getItem('elec_bookmarks') : null);
      state.bookmarks = savedBmk ? new Set(JSON.parse(savedBmk)) : new Set();
      
      const savedNotes = localStorage.getItem(pfx + 'notes') || (state.currentSubject === 'mid_maintenance_electrician' ? localStorage.getItem('elec_notes') : null);
      state.notes = savedNotes ? JSON.parse(savedNotes) : {};
      
      const savedSet = localStorage.getItem('elec_settings');
      if (savedSet) state.settings = Object.assign(state.settings, JSON.parse(savedSet));
    } catch (e) {
      console.error("Error loading localStorage:", e);
    }
  }

  // 保存使用者本機資料 (按科目隔離)
  function saveUserData() {
    try {
      const pfx = `elec_${state.currentSubject}_`;
      localStorage.setItem(pfx + 'history', JSON.stringify(state.history));
      localStorage.setItem(pfx + 'mistakes', JSON.stringify(state.mistakes));
      localStorage.setItem(pfx + 'bookmarks', JSON.stringify(Array.from(state.bookmarks)));
      localStorage.setItem(pfx + 'notes', JSON.stringify(state.notes));
      localStorage.setItem('elec_settings', JSON.stringify(state.settings));
      
      if (state.currentMode === 'practice' && getCurrentQuestion()) {
        localStorage.setItem(`${pfx}last_qid`, getCurrentQuestion().id);
      }
    } catch (e) {
      console.error("Error saving localStorage:", e);
    }
  }

  // 篩選啟用模式的題目
  function updateActiveQuestions() {
    let list = [...state.allQuestions];
    
    // 模式篩選
    if (state.currentMode === 'mistakes') {
      const mistakeIds = Object.keys(state.mistakes).filter(id => state.mistakes[id] > 0);
      list = list.filter(q => mistakeIds.includes(q.id));
    } else if (state.currentMode === 'bookmarks') {
      list = list.filter(q => state.bookmarks.has(q.id));
    } else if (state.currentMode === 'search') {
      const kw = state.searchKeyword.trim().toLowerCase();
      if (kw) {
        list = list.filter(q => 
          q.question.toLowerCase().includes(kw) || 
          q.options.some(o => o.text.toLowerCase().includes(kw))
        );
      }
    }
    
    // 章節與題型篩選 (在非模擬考試模式下生效)
    if (state.currentMode !== 'exam') {
      if (state.selectedCategory !== 'all') {
        list = list.filter(q => q.category === state.selectedCategory);
      }
      if (state.selectedType !== 'all') {
        list = list.filter(q => q.type === state.selectedType);
      }
    }
    
    // 隨機模式打亂順序
    if (state.currentMode === 'shuffle') {
      list = shuffleArray(list);
    }
    
    state.activeQuestions = list;
    if (state.currentIndex >= list.length) {
      state.currentIndex = Math.max(0, list.length - 1);
    }
  }

  function shuffleArray(arr) {
    const clone = [...arr];
    for (let i = clone.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
  }

  function getCurrentQuestion() {
    if (!state.activeQuestions || state.activeQuestions.length === 0) return null;
    return state.activeQuestions[state.currentIndex];
  }

  // 啟動模擬考試
  function startExam(customTfCount = 50, customMcCount = 50) {
    const tfList = shuffleArray(state.allQuestions.filter(q => q.type === 'tf')).slice(0, customTfCount);
    const mcList = shuffleArray(state.allQuestions.filter(q => q.type === 'mc')).slice(0, customMcCount);
    
    state.activeQuestions = [...tfList, ...mcList];
    state.currentIndex = 0;
    state.currentMode = 'exam';
    
    state.exam.active = true;
    state.exam.submitted = false;
    state.exam.answers = {};
    state.exam.result = null;
    state.exam.remainingSeconds = state.exam.durationSeconds;
    
    if (state.exam.timerId) clearInterval(state.exam.timerId);
    state.exam.timerId = setInterval(() => {
      if (state.exam.remainingSeconds > 0) {
        state.exam.remainingSeconds--;
        renderTimer();
      } else {
        clearInterval(state.exam.timerId);
        submitExam(true);
      }
    }, 1000);
    
    render();
  }

  // 交卷結算
  function submitExam(force = false) {
    if (!force && !confirm("確定要交卷嗎？交卷後將揭曉成績與完整答案解析！")) {
      return;
    }
    
    clearInterval(state.exam.timerId);
    state.exam.active = false;
    state.exam.submitted = true;
    
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    
    state.activeQuestions.forEach((q, idx) => {
      const userAns = state.exam.answers[idx];
      if (!userAns) {
        unansweredCount++;
      } else if (userAns === q.answer) {
        correctCount++;
        // 記錄到歷史
        recordAnswer(q.id, userAns, true);
      } else {
        wrongCount++;
        recordAnswer(q.id, userAns, false);
      }
    });
    
    const score = Math.round((correctCount / state.activeQuestions.length) * 100);
    state.exam.result = {
      score,
      isPassed: score >= 60,
      correctCount,
      wrongCount,
      unansweredCount,
      total: state.activeQuestions.length,
      usedTimeSeconds: state.exam.durationSeconds - state.exam.remainingSeconds
    };
    
    saveUserData();
    render();
  }

  // 記錄單題作答結果
  function recordAnswer(qid, selectedKey, isCorrect) {
    state.history[qid] = {
      answer: selectedKey,
      isCorrect: isCorrect,
      timestamp: Date.now()
    };
    
    if (!isCorrect) {
      state.mistakes[qid] = (state.mistakes[qid] || 0) + 1;
    } else {
      // 若答對，在錯題模式下減少錯誤次數
      if (state.mistakes[qid]) {
        state.mistakes[qid]--;
        if (state.mistakes[qid] <= 0) {
          delete state.mistakes[qid];
        }
      }
    }
  }

  // 作答動作
  function answerQuestion(selectedKey) {
    const q = getCurrentQuestion();
    if (!q) return;
    
    // 模擬考試模式
    if (state.currentMode === 'exam') {
      if (state.exam.submitted) return; // 已交卷不可改
      state.exam.answers[state.currentIndex] = selectedKey;
      render();
      
      if (state.settings.autoNext && state.currentIndex < state.activeQuestions.length - 1) {
        setTimeout(() => {
          goToNext();
        }, 300);
      }
      return;
    }
    
    // 練習模式即時作答
    const isCorrect = (selectedKey === q.answer);
    recordAnswer(q.id, selectedKey, isCorrect);
    saveUserData();
    render();
    
    // 自動下一題
    if (state.settings.autoNext && isCorrect) {
      setTimeout(() => {
        if (state.currentIndex < state.activeQuestions.length - 1) {
          goToNext();
        }
      }, state.settings.autoNextDelay);
    }
  }

  function goToPrev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      render();
    }
  }

  function goToNext() {
    if (state.currentIndex < state.activeQuestions.length - 1) {
      state.currentIndex++;
      render();
    }
  }

  function toggleBookmark(qid) {
    if (state.bookmarks.has(qid)) {
      state.bookmarks.delete(qid);
    } else {
      state.bookmarks.add(qid);
    }
    saveUserData();
    render();
  }

  // 渲染主介面
  function render() {
    renderHeader();
    renderMainCard();
    renderFooter();
    renderModals();
  }

  function renderHeader() {
    // 模式切換按鈕狀態
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const mode = btn.dataset.mode;
      if (mode === state.currentMode) {
        btn.className = "mode-btn flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 text-white shadow-sm";
      } else {
        btn.className = "mode-btn flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition";
      }
    });
    
    // 錯題數徽章
    const mistakeCount = Object.keys(state.mistakes).length;
    const misBadge = document.getElementById('mistake-count-badge');
    if (misBadge) {
      misBadge.innerText = mistakeCount;
      misBadge.style.display = mistakeCount > 0 ? 'inline-block' : 'none';
    }
    
    // 收藏數徽章
    const bmkCount = state.bookmarks.size;
    const bmkBadge = document.getElementById('bookmark-count-badge');
    if (bmkBadge) {
      bmkBadge.innerText = bmkCount;
      bmkBadge.style.display = bmkCount > 0 ? 'inline-block' : 'none';
    }
    
    // 考試計時器顯示
    const timerBox = document.getElementById('exam-timer-box');
    if (timerBox) {
      if (state.currentMode === 'exam' && state.exam.active) {
        timerBox.classList.remove('hidden');
        renderTimer();
      } else {
        timerBox.classList.add('hidden');
      }
    }
    
    // 篩選列控制：考試模式時隱藏章節篩選
    const filterSection = document.getElementById('filter-section');
    if (filterSection) {
      filterSection.style.display = state.currentMode === 'exam' ? 'none' : 'flex';
    }
  }

  function renderTimer() {
    const timerText = document.getElementById('exam-timer-text');
    if (!timerText) return;
    const mins = Math.floor(state.exam.remainingSeconds / 60);
    const secs = state.exam.remainingSeconds % 60;
    timerText.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    if (state.exam.remainingSeconds <= 300) {
      timerText.classList.add('text-red-500', 'animate-pulse');
    } else {
      timerText.classList.remove('text-red-500', 'animate-pulse');
    }
  }

  function renderMainCard() {
    const container = document.getElementById('question-area');
    if (!container) return;
    
    // 檢查是否有題目
    if (!state.activeQuestions || state.activeQuestions.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div class="w-16 h-16 bg-blue-50 dark:bg-slate-700 rounded-full flex items-center justify-center text-blue-500 mb-4 text-2xl font-bold">
            ℹ️
          </div>
          <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">此條件下沒有題目</h3>
          <p class="text-slate-500 dark:text-slate-400 max-w-md mb-6">請調整篩選分類，或返回「順序刷題」模式開始學習！</p>
          <button id="reset-filter-btn" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition shadow-sm">
            重置篩選
          </button>
        </div>
      `;
      document.getElementById('reset-filter-btn')?.addEventListener('click', () => {
        state.currentMode = 'practice';
        state.selectedCategory = 'all';
        state.selectedType = 'all';
        state.searchKeyword = '';
        updateActiveQuestions();
        render();
      });
      return;
    }

    // 模擬考試交卷後的成績報告單
    if (state.currentMode === 'exam' && state.exam.submitted && state.exam.result) {
      renderExamScoreCard(container);
      return;
    }

    const q = getCurrentQuestion();
    const isBookmarked = state.bookmarks.has(q.id);
    const userAns = state.currentMode === 'exam' 
      ? state.exam.answers[state.currentIndex] 
      : (state.history[q.id]?.answer);
    const hasAnswered = !!userAns;
    const isCorrect = userAns === q.answer;
    
    // 題型徽章
    const typeBadge = q.type === 'tf' 
      ? `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">是非題</span>`
      : `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">單選題</span>`;

    // 題目圖片區域
    const imgHtml = q.image ? `
      <div class="diagram-container my-4 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
        <img src="${q.image}" alt="題目圖形" class="rounded cursor-zoom-in" onclick="window.viewImage('${q.image}')" />
        <span class="text-xs text-slate-400 mt-1.5 flex items-center gap-1">🔍 點擊查看放大圖</span>
      </div>
    ` : '';

    // 選項列表
    let optionsHtml = '';
    q.options.forEach((opt, idx) => {
      let cardStyle = "border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200";
      let keyStyle = "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300";
      let statusIcon = '';
      
      // 判定狀態
      if (hasAnswered) {
        if (state.currentMode === 'exam') {
          // 考試作答中：只高亮選取的選項
          if (userAns === opt.key) {
            cardStyle = "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-2 ring-blue-500/20";
            keyStyle = "bg-blue-600 text-white font-bold";
          }
        } else {
          // 練習模式或已交卷：即時揭曉答案
          if (opt.key === q.answer) {
            // 正確答案標綠
            cardStyle = "border-green-500 bg-green-50 dark:bg-green-950/40 text-green-900 dark:text-green-200 ring-2 ring-green-500/30";
            keyStyle = "bg-green-600 text-white font-bold";
            statusIcon = `<span class="ml-auto text-green-600 dark:text-green-400 font-bold text-lg">✓ 正確</span>`;
          } else if (opt.key === userAns) {
            // 答錯的選項標紅
            cardStyle = "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 ring-2 ring-red-500/30";
            keyStyle = "bg-red-600 text-white font-bold";
            statusIcon = `<span class="ml-auto text-red-600 dark:text-red-400 font-bold text-lg">✗ 你的選擇</span>`;
          }
        }
      }

      // 快速鍵提示標籤
      const kbdKey = opt.key;
      optionsHtml += `
        <div class="option-card flex items-center p-4 rounded-xl border-2 cursor-pointer transition select-none ${cardStyle}"
             onclick="window.handleSelectOption('${opt.key}')">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 mr-3.5 ${keyStyle}">
            ${opt.key}
          </div>
          <div class="text-base leading-relaxed flex-1">${opt.text}</div>
          ${statusIcon}
          <span class="kbd-badge ml-3 hidden sm:inline-flex text-xs opacity-60">${kbdKey}</span>
        </div>
      `;
    });

    // 答案揭曉與解析區塊 (練習模式已作答，或交卷後)
    let feedbackHtml = '';
    const userNote = state.notes[q.id] || '';
    const builtInExp = q.explanation || '';
    const hasAnyExp = !!(builtInExp || userNote);

    if (hasAnswered && state.currentMode !== 'exam') {
      let expContentHtml = '';
      if (builtInExp) {
        expContentHtml += `
          <div class="mb-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-slate-800/70 p-3 rounded-lg border border-slate-200/80 dark:border-slate-700">
            <span class="font-bold text-blue-600 dark:text-blue-400 mr-1.5">【考點詳解】</span>${builtInExp}
          </div>
        `;
      }
      if (userNote) {
        expContentHtml += `
          <div class="mb-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 bg-amber-50/80 dark:bg-amber-950/40 p-3 rounded-lg border border-amber-200/80 dark:border-amber-800/60">
            <span class="font-bold text-amber-600 dark:text-amber-400 mr-1.5">【我的筆記/解析】</span>${userNote}
          </div>
        `;
      }

      feedbackHtml = `
        <div class="mt-6 p-4 rounded-xl border ${isCorrect ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'}">
          <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div class="flex items-center gap-2 font-bold ${isCorrect ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}">
              <span>${isCorrect ? '🎉 回答正確！' : '❌ 回答錯誤！'}</span>
              <span class="text-sm font-normal text-slate-600 dark:text-slate-400 ml-2">標準答案：<strong class="text-base text-blue-600 dark:text-blue-400">${q.answer}</strong></span>
            </div>
            <button onclick="window.toggleNoteEditor('${q.id}')" class="text-xs px-2.5 py-1 rounded-lg bg-white/80 dark:bg-slate-800 hover:bg-white text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium transition flex items-center gap-1 shadow-xs">
              <span>✏️</span> ${userNote ? '修改解析筆記' : '新增解析/筆記'}
            </button>
          </div>

          <!-- 詳解內容區塊 -->
          ${expContentHtml}

          <!-- 解析/筆記編輯器 (預設隱藏，點擊按鈕展開) -->
          <div id="note-editor-${q.id}" class="hidden mt-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-blue-200 dark:border-blue-900 shadow-sm animate-fade-in">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-slate-700 dark:text-slate-300">為此題添加解答說明 / 記憶心得：</span>
              <div class="flex gap-1">
                <button type="button" onclick="window.insertNoteTag('${q.id}', '【法規要點】')" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">#法規</button>
                <button type="button" onclick="window.insertNoteTag('${q.id}', '【口訣記憶】')" class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">#口訣</button>
                <button type="button" onclick="window.insertNoteTag('${q.id}', '【易錯陷阱】')" class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-800">#陷阱</button>
              </div>
            </div>
            <textarea id="note-textarea-${q.id}" rows="3" placeholder="例如：依澳門電工規範，PE線截面積不得小於相線的一半；安全電壓36V以下..." class="w-full text-xs sm:text-sm p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">${userNote}</textarea>
            <div class="flex items-center justify-end gap-2 mt-2">
              <button onclick="window.toggleNoteEditor('${q.id}')" class="px-3 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">取消</button>
              <button onclick="window.saveNote('${q.id}')" class="px-4 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shadow-xs">儲存解析</button>
            </div>
          </div>

          <div class="text-xs text-slate-500 dark:text-slate-400 mt-2.5 flex items-center justify-between border-t border-slate-200/50 dark:border-slate-700/50 pt-2">
            <span>章節：${q.category}</span>
            <span>官方手冊頁碼：P.${q.page}</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 sm:p-8 animate-fade-in">
        <!-- 頂部資訊列 -->
        <div class="flex items-center justify-between mb-5 flex-wrap gap-2 pb-4 border-b border-slate-100 dark:border-slate-700/60">
          <div class="flex items-center gap-2.5">
            ${typeBadge}
            <span class="text-xs px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 font-medium">
              ${q.category}
            </span>
          </div>
          <div class="flex items-center gap-2.5">
            <!-- 快速跳轉指定題號小元件 -->
            <div class="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700/60 px-2.5 py-1 rounded-xl border border-slate-200/80 dark:border-slate-600/60 shadow-inner">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400">第</span>
              <input type="number" min="1" max="${state.activeQuestions.length}" value="${state.currentIndex + 1}"
                     title="點擊可直接輸入題號跳轉，按 Enter 前往"
                     onchange="window.handleQuickJump(this.value)"
                     onkeydown="if(event.key==='Enter') window.handleQuickJump(this.value)"
                     class="w-12 text-center font-mono font-bold text-xs bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-slate-600 rounded-lg px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span class="text-xs font-mono text-slate-500 dark:text-slate-400 font-medium">/ ${state.activeQuestions.length} 題</span>
            </div>
            <button onclick="window.handleToggleBookmark('${q.id}')" title="收藏本題 (快捷鍵 S)" class="p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition">
              <span class="text-xl ${isBookmarked ? 'text-amber-500' : ''}">${isBookmarked ? '★' : '☆'}</span>
            </button>
          </div>
        </div>

        <!-- 題目內文 -->
        <div class="text-lg sm:text-xl font-medium text-slate-900 dark:text-slate-100 leading-relaxed mb-6">
          <span class="text-blue-600 dark:text-blue-400 font-bold font-mono mr-1.5">#${q.num}.</span>
          ${q.question}
        </div>

        <!-- 題目圖形 (如有) -->
        ${imgHtml}

        <!-- 選項列表 -->
        <div class="space-y-3 mb-6">
          ${optionsHtml}
        </div>

        <!-- 回饋結果 -->
        ${feedbackHtml}
      </div>
    `;
  }

  // 渲染模擬考試成績報告單
  function renderExamScoreCard(container) {
    const res = state.exam.result;
    const mins = Math.floor(res.usedTimeSeconds / 60);
    const secs = res.usedTimeSeconds % 60;
    
    container.innerHTML = `
      <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center animate-fade-in">
        <div class="inline-flex items-center justify-center w-24 h-24 rounded-full mb-4 ${res.isPassed ? 'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'}">
          <span class="text-4xl font-extrabold font-mono">${res.score}</span>
        </div>
        <h2 class="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1">
          ${res.isPassed ? '🎉 恭喜及格！通過技能測試！' : '💪 還需加油！未達及格標準 (60分)'}
        </h2>
        <p class="text-slate-500 dark:text-slate-400 text-sm mb-6">
          考試總題數：${res.total} 題 ｜ 作答用時：${mins} 分 ${secs} 秒
        </p>

        <!-- 統計數據卡 -->
        <div class="grid grid-cols-3 gap-4 max-w-lg mx-auto mb-8">
          <div class="p-3.5 bg-green-50 dark:bg-green-950/40 rounded-xl border border-green-200 dark:border-green-900">
            <div class="text-2xl font-bold text-green-600 dark:text-green-400 font-mono">${res.correctCount}</div>
            <div class="text-xs text-green-800 dark:text-green-300 font-medium">答對題數</div>
          </div>
          <div class="p-3.5 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-200 dark:border-red-900">
            <div class="text-2xl font-bold text-red-600 dark:text-red-400 font-mono">${res.wrongCount}</div>
            <div class="text-xs text-red-800 dark:text-red-300 font-medium">答錯題數</div>
          </div>
          <div class="p-3.5 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-700">
            <div class="text-2xl font-bold text-slate-600 dark:text-slate-300 font-mono">${res.unansweredCount}</div>
            <div class="text-xs text-slate-600 dark:text-slate-400 font-medium">未作答</div>
          </div>
        </div>

        <div class="flex items-center justify-center gap-4 flex-wrap">
          <button onclick="window.startNewExam()" class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition shadow-sm">
            重新模擬考
          </button>
          <button onclick="window.reviewExamMistakes()" class="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-xl transition shadow-sm">
            查看本次錯題本
          </button>
          <button onclick="window.switchToMode('practice')" class="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium rounded-xl transition">
            返回順序練習
          </button>
        </div>
      </div>
    `;
  }

  function renderFooter() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-exam-btn');
    
    if (prevBtn) {
      prevBtn.disabled = state.currentIndex <= 0;
      prevBtn.className = `flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl border transition ${
        state.currentIndex <= 0 
          ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700 text-slate-400' 
          : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
      }`;
    }
    
    if (nextBtn) {
      const isLast = state.currentIndex >= state.activeQuestions.length - 1;
      nextBtn.disabled = isLast;
      nextBtn.className = `flex items-center gap-1.5 px-5 py-2 text-sm font-semibold rounded-xl border transition ${
        isLast 
          ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700 text-slate-400' 
          : 'bg-blue-600 hover:bg-blue-700 border-transparent text-white shadow-sm'
      }`;
    }

    // 模擬考試模式下的交卷按鈕
    if (submitBtn) {
      if (state.currentMode === 'exam' && state.exam.active) {
        submitBtn.classList.remove('hidden');
      } else {
        submitBtn.classList.add('hidden');
      }
    }
    
    // 自動下一題開關狀態
    const autoNextCheckbox = document.getElementById('auto-next-toggle');
    if (autoNextCheckbox) {
      autoNextCheckbox.checked = state.settings.autoNext;
    }
  }

  // 渲染所有彈出視窗
  function renderModals() {
    renderAnswerSheetModal();
  }

  // 學習進度與答題卡跳轉網格彈窗
  function renderAnswerSheetModal() {
    const modal = document.getElementById('answer-sheet-modal');
    if (!modal) return;
    
    if (!state.showAnswerSheet) {
      modal.classList.add('hidden');
      return;
    }
    modal.classList.remove('hidden');
    
    const summaryBox = document.getElementById('progress-summary-box');
    const gridContainer = document.getElementById('answer-sheet-grid');
    if (!gridContainer) return;
    
    // 計算每題作答狀態
    const items = state.activeQuestions.map((q, idx) => {
      let isDone = false;
      let isCorrect = false;
      let isWrong = false;
      let userAns = null;
      
      if (state.currentMode === 'exam') {
        userAns = state.exam.answers[idx];
        if (userAns) {
          isDone = true;
          if (state.exam.submitted) {
            isCorrect = (userAns === q.answer);
            isWrong = !isCorrect;
          }
        }
      } else {
        const hist = state.history[q.id];
        if (hist) {
          isDone = true;
          isCorrect = hist.isCorrect;
          isWrong = !hist.isCorrect;
        }
      }
      
      return { q, idx, isDone, isCorrect, isWrong, userAns };
    });

    const total = items.length;
    const doneCount = items.filter(i => i.isDone).length;
    const correctCount = items.filter(i => i.isCorrect).length;
    const wrongCount = items.filter(i => i.isWrong).length;
    const undoneCount = total - doneCount;
    const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    const accuracyRate = doneCount > 0 ? Math.round((correctCount / doneCount) * 100) : 0;
    
    // 1. 渲染進度統計面版
    if (summaryBox) {
      summaryBox.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3 text-center">
          <div class="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div class="text-xs text-slate-500 dark:text-slate-400">總題數</div>
            <div class="text-lg font-bold font-mono text-slate-800 dark:text-slate-100">${total} 題</div>
          </div>
          <div class="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div class="text-xs text-slate-500 dark:text-slate-400">已完成</div>
            <div class="text-lg font-bold font-mono text-blue-600 dark:text-blue-400">${doneCount} 題 <span class="text-xs font-normal">(${completionRate}%)</span></div>
          </div>
          <div class="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div class="text-xs text-slate-500 dark:text-slate-400">答對題數</div>
            <div class="text-lg font-bold font-mono text-green-600 dark:text-green-400">${correctCount} 題 <span class="text-xs font-normal">(${accuracyRate}%)</span></div>
          </div>
          <div class="p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div class="text-xs text-slate-500 dark:text-slate-400">答錯題數</div>
            <div class="text-lg font-bold font-mono text-red-600 dark:text-red-400">${wrongCount} 題</div>
          </div>
        </div>

        <!-- 雙色進度長條圖 -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>完成進度條</span>
            <span>已做 ${doneCount} / 剩餘 ${undoneCount} 題</span>
          </div>
          <div class="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
            <div style="width: ${(correctCount / total) * 100}%" class="bg-green-500 h-full transition-all duration-300" title="答對：${correctCount} 題"></div>
            <div style="width: ${(wrongCount / total) * 100}%" class="bg-red-500 h-full transition-all duration-300" title="答錯：${wrongCount} 題"></div>
          </div>
        </div>
      `;
    }

    // 2. 更新篩選標籤 Tab 樣式與計數
    const tabs = [
      { id: 'sheet-tab-all', key: 'all', label: `全部 (${total})` },
      { id: 'sheet-tab-done', key: 'done', label: `✅ 已完成 (${doneCount})` },
      { id: 'sheet-tab-undone', key: 'undone', label: `⬜ 未完成 (${undoneCount})` },
      { id: 'sheet-tab-wrong', key: 'wrong', label: `❌ 做錯 (${wrongCount})` },
    ];
    tabs.forEach(tab => {
      const el = document.getElementById(tab.id);
      if (el) {
        el.innerText = tab.label;
        if (state.sheetFilter === tab.key) {
          el.className = "sheet-tab-btn px-3 py-1.5 font-semibold rounded-lg bg-blue-600 text-white shadow-sm";
        } else {
          el.className = "sheet-tab-btn px-3 py-1.5 font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition";
        }
      }
    });

    // 3. 依據篩選條件過濾要展示在網格中的題目
    let displayItems = items;
    if (state.sheetFilter === 'done') {
      displayItems = items.filter(i => i.isDone);
    } else if (state.sheetFilter === 'undone') {
      displayItems = items.filter(i => !i.isDone);
    } else if (state.sheetFilter === 'wrong') {
      displayItems = items.filter(i => i.isWrong);
    }

    if (displayItems.length === 0) {
      gridContainer.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-400">
          <div class="text-3xl mb-2">🔍</div>
          <p class="text-sm">此分類下暫無題目</p>
        </div>
      `;
      return;
    }

    let buttonsHtml = '';
    displayItems.forEach(item => {
      const idx = item.idx;
      const isCurrent = (idx === state.currentIndex);
      let bg = "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600";
      
      if (state.currentMode === 'exam') {
        if (state.exam.submitted) {
          if (item.isCorrect) bg = "bg-green-500 text-white font-bold";
          else if (item.isWrong) bg = "bg-red-500 text-white font-bold";
        } else {
          if (item.isDone) bg = "bg-blue-600 text-white font-bold";
        }
      } else {
        if (item.isCorrect) bg = "bg-green-500 text-white font-bold";
        else if (item.isWrong) bg = "bg-red-500 text-white font-bold";
      }
      
      const currentRing = isCurrent ? "ring-2 ring-offset-2 ring-blue-600 dark:ring-offset-slate-800 scale-105 font-extrabold shadow-md" : "";
      buttonsHtml += `
        <button onclick="window.jumpToQuestion(${idx})" title="題號 #${idx + 1} (${item.isDone ? (item.isCorrect ? '已答對' : '已答錯') : '未作答'})" class="answer-grid-btn h-9 rounded-lg flex items-center justify-center text-xs font-mono font-medium ${bg} ${currentRing}">
          ${idx + 1}
        </button>
      `;
    });
    
    gridContainer.innerHTML = buttonsHtml;
  }

  // 鍵盤快速鍵監聽
  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // 避免在輸入框打字時觸發快捷鍵
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      
      const key = e.key.toUpperCase();
      const q = getCurrentQuestion();
      if (!q) return;
      
      // 導航
      if (e.key === 'ArrowLeft') {
        goToPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        goToNext();
      }
      
      // 收藏
      if (key === 'S') {
        toggleBookmark(q.id);
      }
      
      // 是非題按鍵
      if (q.type === 'tf') {
        if (['1', 'T', 'O'].includes(key)) {
          answerQuestion('O');
        } else if (['2', 'F', 'X'].includes(key)) {
          answerQuestion('X');
        }
      } 
      // 選擇題按鍵
      else if (q.type === 'mc') {
        if (['A', '1'].includes(key)) answerQuestion('A');
        else if (['B', '2'].includes(key)) answerQuestion('B');
        else if (['C', '3'].includes(key)) answerQuestion('C');
        else if (['D', '4'].includes(key)) answerQuestion('D');
      }
    });
  }

  // 綁定 UI 元素事件
  function bindEvents() {
    // 模式切換
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'exam') {
          openExamSetupModal();
        } else {
          switchMode(mode);
        }
      });
    });

    // 章節下拉選單
    const catSelect = document.getElementById('category-filter');
    if (catSelect) {
      catSelect.addEventListener('change', (e) => {
        state.selectedCategory = e.target.value;
        state.currentIndex = 0;
        updateActiveQuestions();
        render();
      });
    }

    // 題型按鈕
    document.querySelectorAll('.type-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedType = btn.dataset.type;
        document.querySelectorAll('.type-filter-btn').forEach(b => {
          b.className = b.dataset.type === state.selectedType 
            ? "type-filter-btn px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white" 
            : "type-filter-btn px-3 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700";
        });
        state.currentIndex = 0;
        updateActiveQuestions();
        render();
      });
    });

    // 導航按鈕
    document.getElementById('prev-btn')?.addEventListener('click', goToPrev);
    document.getElementById('next-btn')?.addEventListener('click', goToNext);
    
    // 自動下一題勾選
    document.getElementById('auto-next-toggle')?.addEventListener('change', (e) => {
      state.settings.autoNext = e.target.checked;
      saveUserData();
    });

    // 深色模式開關
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      state.settings.darkMode = !state.settings.darkMode;
      if (state.settings.darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      saveUserData();
    });

    // 答題卡按鈕
    document.getElementById('open-answer-sheet-btn')?.addEventListener('click', () => {
      state.showAnswerSheet = true;
      renderAnswerSheetModal();
    });
    document.getElementById('close-answer-sheet-btn')?.addEventListener('click', () => {
      state.showAnswerSheet = false;
      renderAnswerSheetModal();
    });

    // 交卷按鈕
    document.getElementById('submit-exam-btn')?.addEventListener('click', () => {
      submitExam(false);
    });

    // 搜尋輸入框
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchKeyword = e.target.value;
        if (state.searchKeyword.trim()) {
          state.currentMode = 'search';
        }
        updateActiveQuestions();
        render();
      });
    }
  }

  function switchMode(newMode) {
    if (state.exam.active && !confirm("切換模式將退出當前模擬考試，確定要切換嗎？")) {
      return;
    }
    if (state.exam.timerId) clearInterval(state.exam.timerId);
    state.exam.active = false;
    
    state.currentMode = newMode;
    state.currentIndex = 0;
    updateActiveQuestions();
    render();
  }

  function openExamSetupModal() {
    const modal = document.getElementById('exam-modal');
    if (modal) modal.classList.remove('hidden');
  }

  // 全域暴露給 HTML 點擊調用的函數
  window.handleSelectOption = answerQuestion;
  window.handleToggleBookmark = toggleBookmark;
  window.jumpToQuestion = function(idx) {
    state.currentIndex = idx;
    state.showAnswerSheet = false;
    render();
  };
  window.handleQuickJump = function(val) {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= state.activeQuestions.length) {
      state.currentIndex = num - 1;
      render();
    }
  };
  window.setAnswerSheetFilter = function(filter) {
    state.sheetFilter = filter;
    renderAnswerSheetModal();
  };
  window.jumpBySheetInput = function() {
    const input = document.getElementById('sheet-jump-input');
    if (!input) return;
    const num = parseInt(input.value, 10);
    if (!isNaN(num) && num >= 1 && num <= state.activeQuestions.length) {
      window.jumpToQuestion(num - 1);
      input.value = '';
    } else {
      alert(`請輸入 1 到 ${state.activeQuestions.length} 之間的有效題號！`);
    }
  };
  window.switchToMode = switchMode;
  window.startNewExam = function() {
    startExam(50, 50);
  };
  window.reviewExamMistakes = function() {
    switchMode('mistakes');
  };
  window.viewImage = function(src) {
    const modal = document.getElementById('image-modal');
    const imgEl = document.getElementById('modal-expanded-img');
    if (modal && imgEl) {
      imgEl.src = src;
      modal.classList.remove('hidden');
    }
  };
  window.closeImageModal = function() {
    const modal = document.getElementById('image-modal');
    if (modal) modal.classList.add('hidden');
  };
  window.confirmStartExam = function() {
    const tfCount = parseInt(document.getElementById('exam-tf-count')?.value || 50, 10);
    const mcCount = parseInt(document.getElementById('exam-mc-count')?.value || 50, 10);
    document.getElementById('exam-modal')?.classList.add('hidden');
    startExam(tfCount, mcCount);
  };
  window.closeExamModal = function() {
    document.getElementById('exam-modal')?.classList.add('hidden');
  };

  // 題目解析/筆記編輯操作
  window.toggleNoteEditor = function(qid) {
    const el = document.getElementById(`note-editor-${qid}`);
    if (el) {
      el.classList.toggle('hidden');
      if (!el.classList.contains('hidden')) {
        const textarea = document.getElementById(`note-textarea-${qid}`);
        if (textarea) textarea.focus();
      }
    }
  };
  window.saveNote = function(qid) {
    const textarea = document.getElementById(`note-textarea-${qid}`);
    if (!textarea) return;
    const text = textarea.value.trim();
    if (text) {
      state.notes[qid] = text;
    } else {
      delete state.notes[qid];
    }
    saveUserData();
    render();
  };
  window.insertNoteTag = function(qid, tag) {
    const textarea = document.getElementById(`note-textarea-${qid}`);
    if (!textarea) return;
    textarea.value = tag + ' ' + textarea.value;
    textarea.focus();
  };

  // 科目切換
  window.switchSubject = function(subjId) {
    if (state.exam.active && !confirm("切換科目將中斷當前考試，確定要切換嗎？")) {
      const sel = document.getElementById('subject-selector');
      if (sel) sel.value = state.currentSubject;
      return;
    }
    if (state.exam.timerId) clearInterval(state.exam.timerId);
    state.exam.active = false;
    loadSubjectData(subjId);
  };

  // 匯出/匯入作答進度備份
  window.exportProgress = function() {
    const backup = {
      history: state.history,
      mistakes: state.mistakes,
      bookmarks: Array.from(state.bookmarks),
      notes: state.notes,
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `電工刷題備份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  window.importProgress = function(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.history) state.history = data.history;
        if (data.mistakes) state.mistakes = data.mistakes;
        if (data.bookmarks) state.bookmarks = new Set(data.bookmarks);
        if (data.notes) state.notes = data.notes;
        saveUserData();
        updateActiveQuestions();
        render();
        alert("進度匯入成功！");
      } catch (err) {
        alert("匯入失敗：檔案格式不正確！");
      }
    };
    reader.readAsText(file);
  };

  // 啟動應用
  window.addEventListener('DOMContentLoaded', initData);
})();

