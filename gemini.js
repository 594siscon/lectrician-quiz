/**
 * gemini.js - Gemini AI 解析助教模組
 * 支援自動帶入當前題目、選項與附圖（Base64 inlineData）傳送至 Google Gemini API，
 * 並於網頁內顯示解析與進行多輪追問對話。
 */
(function() {
  const STORAGE_KEY_API = 'elec_gemini_api_key';
  const STORAGE_KEY_MODEL = 'elec_gemini_model';
  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const VALID_MODELS = [
    'gemini-3.8-flash',
    'gemini-4-hydrogen',
    'gemini-2.5-flash',
    'gemini-4-argon',
    'gemini-4-carbon',
    'gemini-4-neon',
    'gemini-3.1-pro-preview'
  ];

  const SYSTEM_INSTRUCTION = [
    '你是一位專精於澳門勞工事務局「中級維修電工」、「初級維修電工」及「初級電氣設備安裝工」技能測試的資深電工講師。',
    '請一律使用繁體中文回答，語氣親切專業、條理分明。',
    '解析選擇題或是非題時，請清楚說明正確答案的電工原理或安全規範依據、必要時列出計算步驟與公式，並逐一簡述其他干擾選項為何不正確。',
    '若有附帶電路圖或選項圖片，請仔細辨識圖中符號、接線、元件標示與選項編號後再作答解析。'
  ].join('\n');

  // 依題目 ID 快取當前分頁內的對話記錄，切換題目再點回時無需重複消耗額度
  const questionSessions = new Map();

  let activeQuestionId = null;
  let activeContext = null;
  let isLoading = false;
  let showSettingsPanel = false;
  let pendingAskAfterConfig = false;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getApiKey() {
    try {
      return (localStorage.getItem(STORAGE_KEY_API) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function setApiKey(key) {
    try {
      const cleaned = (key || '').trim();
      if (cleaned) {
        localStorage.setItem(STORAGE_KEY_API, cleaned);
      } else {
        localStorage.removeItem(STORAGE_KEY_API);
      }
    } catch (e) {
      console.error('Error saving Gemini API key:', e);
    }
  }

  function getModel() {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY_MODEL) || '').trim();
      return saved || DEFAULT_MODEL;
    } catch (e) {
      return DEFAULT_MODEL;
    }
  }

  function setModel(model) {
    try {
      const cleaned = (model || '').trim();
      localStorage.setItem(STORAGE_KEY_MODEL, VALID_MODELS.includes(cleaned) ? cleaned : (cleaned || DEFAULT_MODEL));
    } catch (e) {
      console.error('Error saving Gemini model:', e);
    }
  }

  function guessMimeType(path, blobType) {
    if (blobType && blobType.startsWith('image/')) return blobType;
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/png';
  }

  // 將題目附圖轉換為 Gemini generateContent 所需的 inlineData { mimeType, data }
  async function loadImageAsInlineData(imagePath) {
    if (!imagePath) return null;

    // 方案 1：透過 fetch 讀取 Blob 轉 Base64（支援 http/https）
    try {
      const resp = await fetch(imagePath);
      if (resp.ok) {
        const blob = await resp.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(blob);
        });
        const commaIdx = String(dataUrl).indexOf(',');
        if (commaIdx !== -1) {
          const base64Data = String(dataUrl).slice(commaIdx + 1);
          const mimeType = guessMimeType(imagePath, blob.type);
          return { ok: true, mimeType, data: base64Data, previewUrl: imagePath };
        }
      }
    } catch (fetchErr) {
      // 繼續嘗試方案 2（例如 file:// 協定）
    }

    // 方案 2：透過 Canvas 讀取已載入圖片像素
    try {
      const imgEl = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load error'));
        img.src = imagePath;
      });
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || imgEl.width;
      canvas.height = imgEl.naturalHeight || imgEl.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0);
      const mimeType = guessMimeType(imagePath, '');
      const dataUrl = canvas.toDataURL(mimeType);
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx !== -1) {
        return { ok: true, mimeType, data: dataUrl.slice(commaIdx + 1), previewUrl: imagePath };
      }
    } catch (canvasErr) {
      const isFileProtocol = window.location && window.location.protocol === 'file:';
      return {
        ok: false,
        reason: isFileProtocol ? 'FILE_PROTOCOL_BLOCKED' : 'LOAD_FAILED',
        previewUrl: imagePath
      };
    }

    return { ok: false, reason: 'LOAD_FAILED', previewUrl: imagePath };
  }

  function formatInlineMarkdown(escapedLine) {
    return escapedLine
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 font-mono text-[12px] text-indigo-700 dark:text-indigo-300">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em class="italic">$2</em>');
  }

  // 安全地將純文字／輕量 Markdown 轉為整潔 HTML（先進行 HTML 實體跳脫）
  function renderMarkdownSafe(rawText) {
    const escaped = escapeHtml(rawText || '').replace(/\r\n/g, '\n');

    // 先分離程式碼區塊 ```...```
    const segments = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = codeBlockRegex.exec(escaped)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: escaped.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'code', lang: match[1], content: match[2] });
      lastIndex = codeBlockRegex.lastIndex;
    }
    if (lastIndex < escaped.length) {
      segments.push({ type: 'text', content: escaped.slice(lastIndex) });
    }

    const htmlParts = [];
    segments.forEach(seg => {
      if (seg.type === 'code') {
        htmlParts.push(
          `<pre class="my-2.5 p-3 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed"><code>${seg.content}</code></pre>`
        );
        return;
      }

      const lines = seg.content.split('\n');
      let listType = null; // 'ul' | 'ol'

      const closeList = () => {
        if (listType) {
          htmlParts.push(listType === 'ul' ? '</ul>' : '</ol>');
          listType = null;
        }
      };

      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
          closeList();
          return;
        }

        if (/^---+$/.test(trimmed)) {
          closeList();
          htmlParts.push('<hr class="my-3 border-slate-200 dark:border-slate-700" />');
          return;
        }

        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          closeList();
          const level = headingMatch[1].length;
          const sizeClass = level <= 2 ? 'text-base font-bold mt-3 mb-1.5' : 'text-sm font-bold mt-2.5 mb-1';
          htmlParts.push(`<div class="${sizeClass} text-slate-900 dark:text-white">${formatInlineMarkdown(headingMatch[2])}</div>`);
          return;
        }

        const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/);
        if (ulMatch) {
          if (listType !== 'ul') {
            closeList();
            listType = 'ul';
            htmlParts.push('<ul class="list-disc pl-5 my-1.5 space-y-1">');
          }
          htmlParts.push(`<li>${formatInlineMarkdown(ulMatch[1])}</li>`);
          return;
        }

        const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) {
          if (listType !== 'ol') {
            closeList();
            listType = 'ol';
            htmlParts.push('<ol class="list-decimal pl-5 my-1.5 space-y-1">');
          }
          htmlParts.push(`<li>${formatInlineMarkdown(olMatch[2])}</li>`);
          return;
        }

        const quoteMatch = trimmed.match(/^&gt;\s?(.*)$/);
        if (quoteMatch) {
          closeList();
          htmlParts.push(`<blockquote class="my-2 pl-3 border-l-2 border-indigo-400 text-slate-600 dark:text-slate-300 text-xs sm:text-sm">${formatInlineMarkdown(quoteMatch[1])}</blockquote>`);
          return;
        }

        closeList();
        htmlParts.push(`<p class="my-1.5 leading-relaxed">${formatInlineMarkdown(trimmed)}</p>`);
      });

      closeList();
    });

    return htmlParts.join('');
  }

  // 組裝給 Gemini 的初始提問內容（包含題目、選項、圖片說明與標準答案情境）
  function buildInitialPromptText(ctx, imageResult) {
    const q = ctx.question;
    const typeLabel = q.type === 'tf' ? '是非題' : '單選題';
    const lines = [
      `【科目】${ctx.subjectName}`,
      `【章節】${q.category}（官方手冊 P.${q.page}，原題 #${q.num}）`,
      `【題型】${typeLabel}`,
      `【題目】${q.question}`,
      '【選項】'
    ];

    (q.options || []).forEach(opt => {
      const optText = (opt.text && opt.text.trim()) ? opt.text : '（參考附圖選項）';
      lines.push(`${opt.key}. ${optText}`);
    });

    const hasImageOption = (q.options || []).some(o => String(o.text || '').includes('見選項圖'));

    if (imageResult && imageResult.ok) {
      lines.push('');
      if (hasImageOption) {
        lines.push('【附圖說明】本題附有圖片，且各選項圖形（A、B、C、D）位於所附圖片內，請務必仔細辨識圖中的四個選項圖形後進行比較與解析。');
      } else {
        lines.push('【附圖說明】本題附有題目電路圖／設備示意圖（已隨本次請求附帶圖片），請結合圖片內容進行解析。');
      }
    } else if (q.image) {
      lines.push('');
      lines.push('【附圖說明】原題附有圖片，但目前瀏覽器環境未能讀取圖片檔案像素；若需要識圖，請提示我可參考原圖細節。');
    }

    lines.push('');
    if (ctx.revealAnswerToAI) {
      if (ctx.userAnswer) {
        lines.push(`【我的作答】${ctx.userAnswer}`);
      }
      lines.push(`【官方標準答案】${q.answer}`);
      lines.push('請根據以上題目、選項與標準答案（以及附圖若有），詳細解析正確答案的原因與原理，並說明其餘選項為何不正確。');
    } else {
      lines.push('【備註】我目前正在模擬考試中尚未交卷，請協助分析題意、解題思路與相關電工原理，並在最後給出你的判斷說明。');
    }

    return lines.join('\n');
  }

  function formatApiError(status, errJson, errMsg) {
    const msg = (errJson && errJson.error && errJson.error.message) ? errJson.error.message : (errMsg || '');
    const lower = msg.toLowerCase();

    if (status === 400 && (lower.includes('api key') || lower.includes('api_key'))) {
      return 'API Key 格式不正確或無效，請點擊右上角「⚙️ 設定」檢查您輸入的 Gemini API Key。';
    }
    if (status === 401 || status === 403 || lower.includes('permission') || lower.includes('unauthenticated')) {
      return 'Gemini API Key 驗證失敗或權限不足；若使用付費限定旗艦模型（如 argon/carbon/neon），請確認專案已綁定付款帳單或改選免費可用的 gemini-3.8-flash / gemini-4-hydrogen。';
    }
    if (status === 404) {
      return `找不到所選模型（${getModel()}），建議點擊右上角「⚙️ 設定」改用 gemini-3.8-flash 或 gemini-4-hydrogen。`;
    }
    if (status === 429 || lower.includes('quota') || lower.includes('rate limit')) {
      return '已達 Gemini API 請求頻率或免費額度上限（部分高階模型於免費層無可用配額），請稍候重試或於「⚙️ 設定」切換為 gemini-3.8-flash。';
    }
    if (msg) {
      return `請求失敗 (${status || 'Network'})：${msg}`;
    }
    return '無法連線至 Gemini 伺服器，請確認網路連線正常後再試一次。';
  }

  async function callGeminiApi(contents, apiKey, model) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents,
      generationConfig: {
        temperature: 0.35
      }
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    let data = null;
    try {
      data = await resp.json();
    } catch (e) {}

    if (!resp.ok) {
      throw new Error(formatApiError(resp.status, data, resp.statusText));
    }

    const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (!candidate) {
      const blockReason = data && data.promptFeedback && data.promptFeedback.blockReason;
      if (blockReason) {
        throw new Error(`請求內容被安全過濾器攔截（${blockReason}），請調整提問後重試。`);
      }
      throw new Error('Gemini 未回傳任何解答內容，請稍後重試。');
    }

    const parts = (candidate.content && Array.isArray(candidate.content.parts)) ? candidate.content.parts : [];
    const replyText = parts.map(p => p.text || '').join('\n').trim();
    if (!replyText) {
      throw new Error(`Gemini 回傳空白內容（結束原因：${candidate.finishReason || '未知'}）。`);
    }

    return replyText;
  }

  function renderModalUI() {
    const modal = document.getElementById('gemini-modal');
    if (!modal || modal.classList.contains('hidden')) return;

    const apiKey = getApiKey();
    const model = getModel();

    const modelBadge = document.getElementById('gemini-current-model-badge');
    if (modelBadge) modelBadge.textContent = model;

    const settingsBtn = document.getElementById('gemini-toggle-settings-btn');
    if (settingsBtn) {
      settingsBtn.className = showSettingsPanel
        ? 'px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200 transition'
        : 'px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition';
    }

    const settingsPanel = document.getElementById('gemini-settings-panel');
    if (settingsPanel) {
      settingsPanel.classList.toggle('hidden', !showSettingsPanel);
      const keyInput = document.getElementById('gemini-api-key-input');
      if (keyInput && document.activeElement !== keyInput) {
        keyInput.value = apiKey;
      }
      const modelSelect = document.getElementById('gemini-model-select');
      const customModelInput = document.getElementById('gemini-custom-model-input');
      if (modelSelect) {
        const isBuiltIn = Array.from(modelSelect.options).some(o => o.value === model && o.value !== '__custom__');
        if (isBuiltIn) {
          modelSelect.value = model;
          if (customModelInput) customModelInput.classList.add('hidden');
        } else {
          modelSelect.value = '__custom__';
          if (customModelInput) {
            customModelInput.classList.remove('hidden');
            if (document.activeElement !== customModelInput) {
              customModelInput.value = model;
            }
          }
        }
      }
      const clearKeyBtn = document.getElementById('gemini-clear-key-btn');
      if (clearKeyBtn) {
        clearKeyBtn.classList.toggle('hidden', !apiKey);
      }
    }

    // 題目預覽區
    const previewEl = document.getElementById('gemini-question-preview');
    const session = activeQuestionId ? questionSessions.get(activeQuestionId) : null;
    if (previewEl && activeContext) {
      const q = activeContext.question;
      let imgTagHtml = '';
      if (q.image) {
        const imgRes = session ? session.imageResult : null;
        let statusBadge = '<span class="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">🖼️ 附題目圖片</span>';
        if (imgRes && imgRes.ok) {
          statusBadge = '<span class="text-[11px] px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">🖼️ 已附帶圖片傳送</span>';
        } else if (imgRes && !imgRes.ok) {
          statusBadge = '<span class="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">⚠️ 僅傳送文字（無法讀取本地圖檔）</span>';
        }
        imgTagHtml = `
          <div class="mt-2 flex items-center gap-2.5">
            <img src="${escapeHtml(q.image)}" alt="題目附圖縮圖" class="h-12 w-auto rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 object-contain cursor-zoom-in" onclick="window.viewImage('${escapeHtml(q.image)}')" />
            <div class="flex flex-col gap-1">
              ${statusBadge}
              ${(imgRes && imgRes.reason === 'FILE_PROTOCOL_BLOCKED')
                ? '<span class="text-[11px] text-amber-700 dark:text-amber-300">本機 file:// 開啟受瀏覽器安全限制無法讀取圖片像素；透過 run_app.bat 或線上版開啟即可附圖傳送。</span>'
                : ''}
            </div>
          </div>
        `;
      }

      previewEl.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <span class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
            ${escapeHtml(activeContext.subjectName)} · ${escapeHtml(q.category)} · 原題 #${q.num}
          </span>
          ${activeContext.revealAnswerToAI
            ? `<span class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200">標準答案：${escapeHtml(q.answer)}</span>`
            : '<span class="text-[11px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">模擬考進行中（僅分析思路）</span>'}
        </div>
        <div class="text-xs sm:text-sm text-slate-800 dark:text-slate-100 font-medium line-clamp-3">${escapeHtml(q.question)}</div>
        ${imgTagHtml}
      `;
    }

    // 對話內容區
    const messagesEl = document.getElementById('gemini-messages');
    if (messagesEl) {
      if (!apiKey && (!session || session.displayMessages.length === 0)) {
        messagesEl.innerHTML = `
          <div class="p-5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/70 text-center space-y-2">
            <div class="text-2xl">🔑</div>
            <div class="text-sm font-bold text-slate-800 dark:text-slate-100">請先設定您的 Google Gemini API Key</div>
            <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-md mx-auto">
              在上方輸入您的免費 Gemini API Key 並按下儲存，系統就會自動把本題的題目、選項與附圖傳送給 Gemini 並送回解析！
            </p>
          </div>
        `;
      } else if (session) {
        let html = '';
        session.displayMessages.forEach((msg, idx) => {
          if (msg.role === 'user') {
            html += `
              <div class="flex justify-end">
                <div class="max-w-[88%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-blue-600 text-white text-xs sm:text-sm shadow-xs leading-relaxed whitespace-pre-wrap">${escapeHtml(msg.label)}</div>
              </div>
            `;
          } else {
            html += `
              <div class="bg-slate-50 dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-700/80 rounded-2xl p-4 shadow-xs">
                <div class="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200/70 dark:border-slate-700/60">
                  <span class="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                    <span>✨</span> Gemini 解析回覆
                  </span>
                  <button type="button" onclick="window.copyGeminiMessage(${idx}, this)" class="text-[11px] px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition">
                    📋 複製
                  </button>
                </div>
                <div class="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">${renderMarkdownSafe(msg.text)}</div>
              </div>
            `;
          }
        });

        if (session.error) {
          html += `
            <div class="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs sm:text-sm text-red-700 dark:text-red-300 space-y-2">
              <div class="font-semibold">⚠️ ${escapeHtml(session.error)}</div>
              <div class="flex items-center gap-2">
                <button type="button" onclick="window.retryAskGemini()" class="px-3 py-1 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white transition">🔄 重試</button>
                <button type="button" onclick="window.toggleGeminiSettings(true)" class="px-3 py-1 text-xs font-medium rounded-lg border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/40 transition">⚙️ 檢查 API 設定</button>
              </div>
            </div>
          `;
        }

        if (isLoading) {
          html += `
            <div class="flex items-center gap-2.5 p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-800/60 text-xs sm:text-sm text-indigo-700 dark:text-indigo-300">
              <svg class="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              <span>Gemini 正在分析題目${activeContext && activeContext.question.image ? '與圖片' : ''}，請稍候...</span>
            </div>
          `;
        }

        messagesEl.innerHTML = html;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }

    // 控制追問輸入與送出按鈕狀態
    const followUpInput = document.getElementById('gemini-followup-input');
    const followUpBtn = document.getElementById('gemini-followup-btn');
    const canFollowUp = Boolean(apiKey && session && session.apiContents.length >= 2 && !isLoading);
    if (followUpInput) {
      followUpInput.disabled = !canFollowUp;
      followUpInput.placeholder = canFollowUp
        ? '有不清楚的地方嗎？輸入問題繼續追問 Gemini... (Enter 送出)'
        : (isLoading ? '正在等待 Gemini 回覆...' : '請先完成初始解析後即可繼續追問');
    }
    if (followUpBtn) {
      followUpBtn.disabled = !canFollowUp;
      followUpBtn.className = canFollowUp
        ? 'px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition shrink-0'
        : 'px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed shrink-0';
    }
  }

  async function runInitialQuestionRequest(forceReset = false) {
    if (!activeContext) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      showSettingsPanel = true;
      pendingAskAfterConfig = true;
      renderModalUI();
      return;
    }

    const q = activeContext.question;
    let session = questionSessions.get(q.id);
    if (!session || forceReset) {
      session = {
        apiContents: [],
        displayMessages: [],
        imageResult: null,
        error: null
      };
      questionSessions.set(q.id, session);
    }

    // 若已有成功對話且非強制重問，直接呈現快取結果
    if (!forceReset && session.apiContents.length >= 2 && !session.error) {
      renderModalUI();
      return;
    }

    isLoading = true;
    session.error = null;
    if (session.displayMessages.length === 0) {
      session.displayMessages.push({
        role: 'user',
        label: `請解析本題（原題 #${q.num}${q.image ? ' · 已嘗試附帶題目圖片' : ''}）`
      });
    }
    renderModalUI();

    try {
      if (q.image && !session.imageResult) {
        session.imageResult = await loadImageAsInlineData(q.image);
      }

      const promptText = buildInitialPromptText(activeContext, session.imageResult);
      const userParts = [];
      if (session.imageResult && session.imageResult.ok) {
        userParts.push({
          inlineData: {
            mimeType: session.imageResult.mimeType,
            data: session.imageResult.data
          }
        });
      }
      userParts.push({ text: promptText });

      const requestContents = [{ role: 'user', parts: userParts }];
      const replyText = await callGeminiApi(requestContents, apiKey, getModel());

      session.apiContents = [
        { role: 'user', parts: userParts },
        { role: 'model', parts: [{ text: replyText }] }
      ];
      session.displayMessages.push({ role: 'model', text: replyText });
      session.error = null;
    } catch (err) {
      session.error = err && err.message ? err.message : '詢問 Gemini 時發生錯誤';
    } finally {
      isLoading = false;
      renderModalUI();
    }
  }

  window.askGeminiCurrentQuestion = function() {
    if (typeof window.getGeminiQuestionContext !== 'function') return;
    const ctx = window.getGeminiQuestionContext();
    if (!ctx || !ctx.question) return;

    activeContext = ctx;
    activeQuestionId = ctx.question.id;
    const apiKey = getApiKey();
    showSettingsPanel = !apiKey;
    pendingAskAfterConfig = !apiKey;

    const modal = document.getElementById('gemini-modal');
    if (modal) modal.classList.remove('hidden');

    if (!apiKey) {
      if (!questionSessions.has(activeQuestionId)) {
        questionSessions.set(activeQuestionId, {
          apiContents: [],
          displayMessages: [],
          imageResult: null,
          error: null
        });
      }
      renderModalUI();
      document.getElementById('gemini-api-key-input')?.focus();
      return;
    }

    runInitialQuestionRequest(false);
  };

  window.closeGeminiModal = function() {
    document.getElementById('gemini-modal')?.classList.add('hidden');
  };

  window.toggleGeminiSettings = function(forceOpen) {
    showSettingsPanel = (typeof forceOpen === 'boolean') ? forceOpen : !showSettingsPanel;
    renderModalUI();
  };

  window.toggleGeminiKeyVisibility = function() {
    const input = document.getElementById('gemini-api-key-input');
    const btn = document.getElementById('gemini-key-eye-btn');
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (btn) btn.textContent = isPassword ? '🙈' : '👁️';
  };

  window.handleGeminiModelChange = function() {
    const modelSelect = document.getElementById('gemini-model-select');
    const customModelInput = document.getElementById('gemini-custom-model-input');
    if (!modelSelect || !customModelInput) return;
    const isCustom = modelSelect.value === '__custom__';
    customModelInput.classList.toggle('hidden', !isCustom);
    if (isCustom) {
      customModelInput.focus();
    }
  };

  window.saveGeminiSettings = function() {
    const keyInput = document.getElementById('gemini-api-key-input');
    const modelSelect = document.getElementById('gemini-model-select');
    const customModelInput = document.getElementById('gemini-custom-model-input');
    const newKey = keyInput ? keyInput.value.trim() : '';
    let newModel = modelSelect ? modelSelect.value.trim() : DEFAULT_MODEL;
    if (newModel === '__custom__') {
      newModel = customModelInput ? customModelInput.value.trim() : '';
      if (!newModel) {
        alert('請輸入自訂的模型 ID（例如 gemini-4-argon 或 gemini-3.8-flash）。');
        customModelInput?.focus();
        return;
      }
    }

    if (!newKey) {
      alert('請輸入有效的 Google Gemini API Key。');
      keyInput?.focus();
      return;
    }

    setApiKey(newKey);
    setModel(newModel);
    showSettingsPanel = false;

    if (pendingAskAfterConfig || (activeQuestionId && (!questionSessions.get(activeQuestionId) || questionSessions.get(activeQuestionId).apiContents.length === 0))) {
      pendingAskAfterConfig = false;
      runInitialQuestionRequest(false);
    } else {
      renderModalUI();
    }
  };

  window.clearGeminiApiKey = function() {
    if (!confirm('確定要從本機瀏覽器移除已儲存的 Gemini API Key 嗎？')) return;
    setApiKey('');
    const keyInput = document.getElementById('gemini-api-key-input');
    if (keyInput) keyInput.value = '';
    showSettingsPanel = true;
    renderModalUI();
  };

  window.retryAskGemini = function() {
    if (isLoading) return;
    runInitialQuestionRequest(true);
  };

  window.sendGeminiFollowUp = async function(presetPrompt) {
    if (isLoading || !activeQuestionId) return;
    const session = questionSessions.get(activeQuestionId);
    if (!session || session.apiContents.length < 2) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      showSettingsPanel = true;
      renderModalUI();
      return;
    }

    const inputEl = document.getElementById('gemini-followup-input');
    const text = (typeof presetPrompt === 'string' && presetPrompt.trim())
      ? presetPrompt.trim()
      : (inputEl ? inputEl.value.trim() : '');
    if (!text) return;

    if (!presetPrompt && inputEl) {
      inputEl.value = '';
    }

    session.displayMessages.push({ role: 'user', label: text });
    session.error = null;
    isLoading = true;
    renderModalUI();

    const nextContents = [
      ...session.apiContents,
      { role: 'user', parts: [{ text }] }
    ];

    try {
      const replyText = await callGeminiApi(nextContents, apiKey, getModel());
      session.apiContents = [
        ...nextContents,
        { role: 'model', parts: [{ text: replyText }] }
      ];
      session.displayMessages.push({ role: 'model', text: replyText });
    } catch (err) {
      session.error = err && err.message ? err.message : '追問 Gemini 失敗，請重試。';
    } finally {
      isLoading = false;
      renderModalUI();
    }
  };

  window.copyGeminiMessage = function(idx, btnEl) {
    const session = activeQuestionId ? questionSessions.get(activeQuestionId) : null;
    if (!session || !session.displayMessages[idx]) return;
    const text = session.displayMessages[idx].text || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (btnEl) {
          const orig = btnEl.textContent;
          btnEl.textContent = '✓ 已複製';
          setTimeout(() => {
            btnEl.textContent = orig;
          }, 1500);
        }
      }).catch(() => {});
    }
  };
})();
