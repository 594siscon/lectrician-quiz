/**
 * sync.js - 雲端帳號同步模組 (方案 C: Firebase Auth + Cloud Firestore)
 * 支援跨裝置自動背景雙向同步、離線暫存與智慧資料合併
 */
(function() {
  const PENDING_REDIRECT_KEY = 'elec_pending_google_redirect_ts';

  const ERROR_MESSAGES = {
    'permission-denied': '⚠️ 雲端資料庫存取被拒絕 (permission-denied)：請確認 Firebase Firestore 安全規則是否已過期或未允許此帳號讀寫。',
    'unavailable': '⚠️ 無法連線至雲端資料庫，請確認手機網路連線正常後再試。',
    'failed-precondition': '⚠️ 雲端同步衝突 (failed-precondition)，請關閉重複分頁並重新整理頁面後再試。',
    'auth/network-request-failed': '⚠️ 網路連線異常，請確認手機網路後再試。',
    'auth/popup-closed-by-user': '登入視窗已關閉。若手機無法正常完成彈窗登入，可點上方「改用網頁跳轉登入」，或使用下方 Email 帳號登入。',
    'auth/popup-blocked': '瀏覽器阻擋了彈出式登入視窗，請允許彈出視窗、點擊上方「改用網頁跳轉登入」，或直接使用下方 Email 登入。',
    'auth/cancelled-popup-request': '前一次登入請求尚未完成，請再點擊一次。',
    'auth/unauthorized-domain': '⚠️ 網域未授權：請至 Firebase 控制台 ➔ Authentication ➔ 設定 (Settings) ➔ 已授權網域，新增 594siscon.github.io',
    'auth/operation-not-allowed': '⚠️ 尚未在 Firebase 啟用此登入方式：請至 Firebase 控制台 ➔ Authentication ➔ 登入方法，確認已啟用 Google 與 Email 登入。',
    'auth/web-storage-unsupported': '⚠️ 瀏覽器封鎖了網站儲存空間或 Cookie（常見於無痕模式），請改用一般視窗或開啟 Cookie 後再試。',
    'auth/missing-initial-state': '⚠️ 手機瀏覽器的跨站隱私設定攔截了跳轉登入狀態！請改用「使用 Google 帳號一鍵登入同步」（彈窗模式），或在下方用 Email／密碼登入。',
    'auth/no-auth-event': '⚠️ 跳轉登入狀態遺失，請改用彈窗登入或下方 Email／密碼登入。',
    'auth/disallowed-useragent': '⚠️ 您正使用 App 內建瀏覽器，Google 禁止在內建視窗登入。請改用 Safari／Chrome 開啟本頁，或用 Email 登入。',
    'auth/user-not-found': '帳號或密碼錯誤，若尚未註冊請切換至「註冊」分頁。',
    'auth/wrong-password': '帳號或密碼錯誤，若尚未註冊請切換至「註冊」分頁。',
    'auth/invalid-credential': '帳號或密碼錯誤，若尚未註冊請切換至「註冊」分頁。',
    'auth/email-already-in-use': '該信箱已被註冊，請直接切換至「登入」。',
    'auth/weak-password': '密碼長度需至少 6 個字元。',
    'auth/too-many-requests': '嘗試次數過多，請稍候片刻再試。'
  };

  function isInAppBrowser() {
    const ua = navigator.userAgent || '';
    return /\b(Line|MicroMessenger|FBAN|FBAV|Instagram|WhatsApp|Twitter)\b|;\s*wv\)/i.test(ua);
  }

  function formatSyncError(err) {
    if (!err) return '發生未知錯誤';
    const code = err.code || '';
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    const msg = String(err.message || err);
    const lower = msg.toLowerCase();
    if (lower.includes('missing initial state')) return ERROR_MESSAGES['auth/missing-initial-state'];
    if (lower.includes('disallowed_useragent')) return ERROR_MESSAGES['auth/disallowed-useragent'];
    if (lower.includes('permission') && lower.includes('denied')) return ERROR_MESSAGES['permission-denied'];
    for (const key of Object.keys(ERROR_MESSAGES)) {
      if (msg.includes(key)) return ERROR_MESSAGES[key];
    }
    return code ? `${msg} (${code})` : msg;
  }

  function setElementError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function clearPendingRedirectFlag() {
    try { sessionStorage.removeItem(PENDING_REDIRECT_KEY); } catch (e) {}
  }

  function hasLocalAdditions(remoteSubj, localHist, localMis, localBmk) {
    const remoteHist = remoteSubj.history || {};
    const remoteMis = remoteSubj.mistakes || {};
    const remoteBmkSet = new Set(remoteSubj.bookmarks || []);

    for (const qid of Object.keys(localHist)) {
      if (remoteHist[qid] !== localHist[qid]) return true;
    }
    for (const qid of Object.keys(localMis)) {
      if ((localMis[qid] || 0) > (remoteMis[qid] || 0)) return true;
    }
    for (const qid of localBmk) {
      if (!remoteBmkSet.has(qid)) return true;
    }
    return false;
  }

  const CloudSync = {
    isConfigured: false,
    auth: null,
    db: null,
    currentUser: null,
    debounceTimer: null,
    isSyncing: false,
    lastSyncTime: null,
    lastError: null,
    lastAuthError: null,

    // 初始化 Firebase
    init() {
      let cfg = window.FIREBASE_CONFIG;
      // 若檔案未配置，才嘗試從本機 LocalStorage 讀取自訂設定
      if (!cfg || !cfg.apiKey || cfg.apiKey.includes("YOUR_API_KEY")) {
        const customCfg = localStorage.getItem('elec_custom_firebase_config');
        if (customCfg) {
          try {
            cfg = JSON.parse(customCfg);
          } catch(e){}
        }
      }

      if (!cfg || !cfg.apiKey || cfg.apiKey.includes("YOUR_API_KEY")) {
        this.isConfigured = false;
        this.updateBadgeUI();
        return;
      }

      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(cfg);
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.isConfigured = true;

        // 處理手機 Redirect 登入返回結果，若跨站被攔截則明確提示使用者
        this.auth.getRedirectResult()
          .then(result => {
            if (result && result.user) {
              clearPendingRedirectFlag();
              this.lastAuthError = null;
              console.log("🟢 Redirect 登入成功:", result.user.email);
              return;
            }
            let pendingTs = null;
            try { pendingTs = sessionStorage.getItem(PENDING_REDIRECT_KEY); } catch (e) {}
            if (pendingTs) {
              clearPendingRedirectFlag();
              const isRecent = (Date.now() - Number(pendingTs)) < 5 * 60 * 1000;
              if (isRecent && !this.auth.currentUser) {
                this.lastAuthError = "⚠️ 跳轉登入返回後未能取得授權狀態（常見於手機 Safari／Chrome 跨站隱私阻擋）。請改用上方「使用 Google 帳號一鍵登入同步」（彈窗），或在下方使用 Email／密碼登入。";
                if (window.openCloudSyncModal) window.openCloudSyncModal();
              }
            }
          })
          .catch(err => {
            clearPendingRedirectFlag();
            console.error("Redirect 登入處理失敗:", err);
            this.lastAuthError = formatSyncError(err);
            if (window.openCloudSyncModal) window.openCloudSyncModal();
          });

        // 監聽登入狀態改變
        this.auth.onAuthStateChanged(user => {
          this.currentUser = user;
          if (user) {
            clearPendingRedirectFlag();
            this.lastAuthError = null;
            this.lastError = null;
            this.updateBadgeUI();
            console.log("🟢 雲端帳號已登入:", user.email);
            // 登入後立即進行初次雙向拉取與合併
            this.pullAndMerge();
          } else {
            this.lastError = null;
            this.updateBadgeUI();
            console.log("⚪ 尚未登入雲端帳號");
          }
        });

        // 切換回應用時拉取最新進度；切至背景或關閉分頁時立即送出待上傳記錄
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            this.flushPendingPush();
          } else if (document.visibilityState === 'visible' && this.currentUser && !this.isSyncing) {
            const now = Date.now();
            const last = this.lastSyncTime ? this.lastSyncTime.getTime() : 0;
            if (now - last > 5000) {
              console.log("🔄 偵測到切換回應用，自動執行雲端雙向同步...");
              this.pullAndMerge();
            }
          }
        });
        window.addEventListener('pagehide', () => this.flushPendingPush());
      } catch (err) {
        console.error("Firebase 初始化失敗:", err);
        this.isConfigured = false;
        this.updateBadgeUI();
      }
      this.updateBadgeUI();
    },

    // 更新導覽列狀態徽章
    updateBadgeUI() {
      const btn = document.getElementById('cloud-sync-btn');
      const text = document.getElementById('cloud-sync-btn-text');
      if (btn && text) {
        if (!this.isConfigured) {
          text.textContent = "☁️ 雲端同步 (待配置)";
          btn.className = "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 transition whitespace-nowrap shrink-0";
        } else if (this.isSyncing) {
          text.textContent = "🔄 同步中...";
          btn.className = "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-medium animate-pulse whitespace-nowrap shrink-0";
        } else if (this.currentUser && this.lastError) {
          text.textContent = "⚠️ 同步異常";
          btn.title = this.lastError;
          btn.className = "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-medium hover:bg-red-100 transition whitespace-nowrap shrink-0";
        } else if (this.currentUser) {
          const displayName = this.currentUser.displayName || (this.currentUser.email ? this.currentUser.email.split('@')[0] : '已登入');
          text.textContent = `🟢 ${displayName}`;
          btn.title = "";
          btn.className = "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 text-xs font-medium hover:bg-green-100 transition whitespace-nowrap shrink-0 max-w-[140px] sm:max-w-[200px] truncate";
        } else {
          text.textContent = "☁️ 同步 / 登入";
          btn.title = "";
          btn.className = "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition whitespace-nowrap shrink-0";
        }
      }
      setElementError('sync-user-error-msg', this.lastError);
    },

    // 收集本機三大科目的所有記錄
    collectLocalData() {
      const subjects = ['mid_maintenance_electrician', 'junior_maintenance_electrician', 'junior_equipment_installer'];
      const data = {
        updatedAt: new Date().toISOString(),
        subjects: {}
      };

      subjects.forEach(subj => {
        const pfx = `elec_${subj}_`;
        let history = {};
        let mistakes = {};
        let bookmarks = [];
        let lastQid = '';

        try {
          const rawHist = localStorage.getItem(pfx + 'history') || (subj === 'mid_maintenance_electrician' ? localStorage.getItem('elec_history') : null);
          if (rawHist) history = JSON.parse(rawHist);

          const rawMis = localStorage.getItem(pfx + 'mistakes') || (subj === 'mid_maintenance_electrician' ? localStorage.getItem('elec_mistakes') : null);
          if (rawMis) mistakes = JSON.parse(rawMis);

          const rawBmk = localStorage.getItem(pfx + 'bookmarks') || (subj === 'mid_maintenance_electrician' ? localStorage.getItem('elec_bookmarks') : null);
          if (rawBmk) bookmarks = JSON.parse(rawBmk);

          lastQid = localStorage.getItem(`${pfx}last_qid`) || '';
        } catch (e) {
          console.error("Error collecting local data for:", subj, e);
        }

        data.subjects[subj] = { history, mistakes, bookmarks, lastQid };
      });

      return data;
    },

    async _uploadLocalSnapshot() {
      const localData = this.collectLocalData();
      const userDocRef = this.db.collection('users').doc(this.currentUser.uid);
      await userDocRef.set(localData, { merge: true });
    },

    // 將本機記錄上傳到 Firestore
    async pushToCloud() {
      if (!this.isConfigured || !this.currentUser || !this.db) return false;
      this.isSyncing = true;
      this.updateBadgeUI();

      try {
        await this._uploadLocalSnapshot();
        this.lastSyncTime = new Date();
        this.lastError = null;
        console.log("☁️ 雲端同步完成 (Push success):", this.lastSyncTime.toLocaleTimeString());
        return true;
      } catch (err) {
        console.error("雲端上傳失敗:", err);
        this.lastError = formatSyncError(err);
        return false;
      } finally {
        this.isSyncing = false;
        this.updateBadgeUI();
      }
    },

    // 立即送出尚未執行的防抖上傳（用於手機切至背景或關閉分頁前）
    flushPendingPush() {
      if (this.debounceTimer && this.isConfigured && this.currentUser) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        this.pushToCloud();
      }
    },

    // 防抖上傳：答題時每 2 秒最多同步一次，避免頻繁寫入
    scheduleDebouncedPush() {
      if (!this.isConfigured || !this.currentUser) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.pushToCloud();
      }, 2000);
    },

    // 從 Firestore 拉取並與本機進行智慧合併 (Smart Merge)
    async pullAndMerge() {
      if (!this.isConfigured || !this.currentUser || !this.db) return false;
      this.isSyncing = true;
      this.updateBadgeUI();

      try {
        const userDocRef = this.db.collection('users').doc(this.currentUser.uid);
        const docSnap = await userDocRef.get();

        if (docSnap.exists) {
          const remoteData = docSnap.data();
          const remoteSubjects = remoteData.subjects || {};
          const subjects = ['mid_maintenance_electrician', 'junior_maintenance_electrician', 'junior_equipment_installer'];
          let shouldPushMerged = false;

          subjects.forEach(subj => {
            const pfx = `elec_${subj}_`;
            const remoteSubj = remoteSubjects[subj] || {};

            // 1. 讀取本機舊資料
            let localHist = {};
            let localMis = {};
            let localBmk = [];
            try {
              localHist = JSON.parse(localStorage.getItem(pfx + 'history') || '{}');
              localMis = JSON.parse(localStorage.getItem(pfx + 'mistakes') || '{}');
              localBmk = JSON.parse(localStorage.getItem(pfx + 'bookmarks') || '[]');
            } catch (e) {}

            if (hasLocalAdditions(remoteSubj, localHist, localMis, localBmk)) {
              shouldPushMerged = true;
            }

            // 2. 智慧合併 History (聯集，答對優先)
            const mergedHist = Object.assign({}, remoteSubj.history || {}, localHist);
            // 3. 智慧合併 Mistakes (合併錯題計數，取較大者)
            const mergedMis = Object.assign({}, remoteSubj.mistakes || {});
            Object.keys(localMis).forEach(qid => {
              mergedMis[qid] = Math.max(mergedMis[qid] || 0, localMis[qid]);
            });
            // 4. 智慧合併 Bookmarks (集合聯集)
            const mergedBmkSet = new Set([...(remoteSubj.bookmarks || []), ...localBmk]);

            // 5. 寫回 LocalStorage
            localStorage.setItem(pfx + 'history', JSON.stringify(mergedHist));
            localStorage.setItem(pfx + 'mistakes', JSON.stringify(mergedMis));
            localStorage.setItem(pfx + 'bookmarks', JSON.stringify(Array.from(mergedBmkSet)));
          });

          // 重新整理頁面數據顯示
          if (window.refreshCurrentSubjectData) {
            window.refreshCurrentSubjectData();
          }

          if (shouldPushMerged) {
            await this._uploadLocalSnapshot();
          }
          this.lastSyncTime = new Date();
          this.lastError = null;
          console.log("☁️ 雲端資料拉取與智慧合併完成！");
        } else {
          // 雲端尚無資料，首次上傳本機現有進度
          console.log("☁️ 雲端尚無資料，正將本機進度首次備份至雲端...");
          await this._uploadLocalSnapshot();
          this.lastSyncTime = new Date();
          this.lastError = null;
        }
        return true;
      } catch (err) {
        console.error("雲端拉取失敗:", err);
        this.lastError = formatSyncError(err);
        return false;
      } finally {
        this.isSyncing = false;
        this.updateBadgeUI();
      }
    },

    // 帳號註冊
    async register(email, password) {
      if (!this.isConfigured) throw new Error("Firebase 尚未配置");
      return await this.auth.createUserWithEmailAndPassword(email, password);
    },

    // 帳號登入
    async login(email, password) {
      if (!this.isConfigured) throw new Error("Firebase 尚未配置");
      return await this.auth.signInWithEmailAndPassword(email, password);
    },

    // Google 一鍵登入 (優先使用彈窗保留手勢與狀態，僅在明確要求時改用跳轉)
    async signInWithGoogle(useRedirect = false) {
      if (!this.isConfigured || !this.auth) throw new Error("Firebase 尚未配置");
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      if (useRedirect) {
        console.log("📲 使用網頁跳轉模式 (signInWithRedirect)...");
        try { sessionStorage.setItem(PENDING_REDIRECT_KEY, String(Date.now())); } catch (e) {}
        return await this.auth.signInWithRedirect(provider);
      }
      return await this.auth.signInWithPopup(provider);
    },

    // 帳號登出
    async logout() {
      if (!this.isConfigured || !this.auth) return;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        await this.pushToCloud();
      }
      await this.auth.signOut();
      this.currentUser = null;
      this.lastError = null;
      this.updateBadgeUI();
    }
  };

  // 全域暴露
  window.CloudSync = CloudSync;

  // 供 app.js 在每題儲存時呼叫
  window.triggerCloudSync = function() {
    CloudSync.scheduleDebouncedPush();
  };

  // 彈窗與介面互動
  let currentAuthTab = 'login'; // 'login' | 'register'

  window.openCloudSyncModal = function() {
    const modal = document.getElementById('cloud-sync-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const unconfiguredView = document.getElementById('sync-unconfigured-view');
    const authView = document.getElementById('sync-auth-view');
    const userView = document.getElementById('sync-user-view');

    if (!CloudSync.isConfigured) {
      if (unconfiguredView) unconfiguredView.classList.remove('hidden');
      if (authView) authView.classList.add('hidden');
      if (userView) userView.classList.add('hidden');
    } else if (CloudSync.currentUser) {
      if (unconfiguredView) unconfiguredView.classList.add('hidden');
      if (authView) authView.classList.add('hidden');
      if (userView) {
        userView.classList.remove('hidden');
        document.getElementById('sync-user-email').textContent = CloudSync.currentUser.email || '已登入';
        document.getElementById('sync-last-time').textContent = CloudSync.lastSyncTime
          ? CloudSync.lastSyncTime.toLocaleTimeString()
          : (CloudSync.lastError ? '同步失敗' : '尚未同步');

        const nameEl = document.getElementById('sync-user-name');
        if (nameEl) nameEl.textContent = CloudSync.currentUser.displayName || '';

        const avatarImg = document.getElementById('sync-user-avatar');
        const avatarPlaceholder = document.getElementById('sync-user-avatar-placeholder');
        if (CloudSync.currentUser.photoURL && avatarImg) {
          avatarImg.src = CloudSync.currentUser.photoURL;
          avatarImg.classList.remove('hidden');
          if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
        } else {
          if (avatarImg) avatarImg.classList.add('hidden');
          if (avatarPlaceholder) avatarPlaceholder.classList.remove('hidden');
        }
        setElementError('sync-user-error-msg', CloudSync.lastError);
      }
    } else {
      if (unconfiguredView) unconfiguredView.classList.add('hidden');
      if (authView) authView.classList.remove('hidden');
      if (userView) userView.classList.add('hidden');

      const webviewWarn = document.getElementById('webview-warning-msg');
      if (webviewWarn) {
        webviewWarn.classList.toggle('hidden', !isInAppBrowser());
      }
      setElementError('google-error-msg', CloudSync.lastAuthError);
      window.switchAuthTab('login');
    }
  };

  window.closeCloudSyncModal = function() {
    const modal = document.getElementById('cloud-sync-modal');
    if (modal) modal.classList.add('hidden');
    CloudSync.lastAuthError = null;
    setElementError('auth-error-msg', '');
    setElementError('google-error-msg', '');
  };

  window.switchAuthTab = function(tab) {
    currentAuthTab = tab;
    const loginBtn = document.getElementById('auth-tab-login-btn');
    const regBtn = document.getElementById('auth-tab-register-btn');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (tab === 'login') {
      loginBtn.className = "px-3 py-1 rounded-md bg-white dark:bg-slate-800 shadow-xs text-blue-600 dark:text-blue-400 font-bold";
      regBtn.className = "px-3 py-1 rounded-md text-slate-500 dark:text-slate-400";
      submitBtn.innerHTML = "<span>登入並同步進度</span>";
    } else {
      regBtn.className = "px-3 py-1 rounded-md bg-white dark:bg-slate-800 shadow-xs text-blue-600 dark:text-blue-400 font-bold";
      loginBtn.className = "px-3 py-1 rounded-md text-slate-500 dark:text-slate-400";
      submitBtn.innerHTML = "<span>註冊新帳號並開始同步</span>";
    }
  };

  window.handleAuthSubmit = async function(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email-input').value.trim();
    const password = document.getElementById('auth-password-input').value;
    const submitBtn = document.getElementById('auth-submit-btn');

    setElementError('auth-error-msg', '');
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<span>連線處理中...</span>";

    try {
      if (currentAuthTab === 'login') {
        await CloudSync.login(email, password);
      } else {
        await CloudSync.register(email, password);
      }
      window.openCloudSyncModal(); // 刷新為已登入狀態
    } catch (err) {
      setElementError('auth-error-msg', formatSyncError(err));
    } finally {
      submitBtn.disabled = false;
      window.switchAuthTab(currentAuthTab);
    }
  };

  // Google 一鍵登入處理
  window.handleGoogleSignIn = async function(forceRedirect = false) {
    const googleBtn = document.getElementById('google-signin-btn');
    CloudSync.lastAuthError = null;
    setElementError('google-error-msg', '');

    if (isInAppBrowser()) {
      const warnMsg = "⚠️ 您正使用 App 內建瀏覽器，Google 安全政策會阻擋登入。請改用 Safari／Chrome 開啟本頁，或使用下方 Email 登入。";
      setElementError('google-error-msg', warnMsg);
      return;
    }

    const origBtnHtml = googleBtn ? googleBtn.innerHTML : '';
    if (googleBtn) {
      googleBtn.disabled = true;
      googleBtn.innerHTML = `
        <svg class="w-4 h-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="4" class="opacity-25"></circle>
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
        </svg>
        <span>正在連線 Google 授權...</span>
      `;
    }

    try {
      await CloudSync.signInWithGoogle(forceRedirect);
      window.openCloudSyncModal();
    } catch (err) {
      console.error("Google 登入失敗:", err);
      const msg = formatSyncError(err);
      setElementError('google-error-msg', msg);
      if (err && (err.code === 'auth/unauthorized-domain' || err.code === 'auth/operation-not-allowed')) {
        alert(msg);
      }
    } finally {
      if (googleBtn) {
        googleBtn.disabled = false;
        googleBtn.innerHTML = origBtnHtml;
      }
    }
  };

  window.handleCloudLogout = async function() {
    if (confirm("確定要登出雲端帳號嗎？(本機做題記錄將會妥善保留)")) {
      await CloudSync.logout();
      window.openCloudSyncModal();
    }
  };

  window.manualCloudSync = async function() {
    const pulled = await CloudSync.pullAndMerge();
    const pushed = pulled ? await CloudSync.pushToCloud() : false;
    const lastEl = document.getElementById('sync-last-time');
    if (pulled && pushed) {
      if (lastEl) lastEl.textContent = new Date().toLocaleTimeString();
      setElementError('sync-user-error-msg', '');
      alert("雲端雙向同步完成！所有紀錄已為最新狀態。");
    } else {
      const errMsg = CloudSync.lastError || "雲端同步失敗，請檢查網路連線或 Firebase 權限設定。";
      if (lastEl) lastEl.textContent = '同步失敗';
      setElementError('sync-user-error-msg', errMsg);
      alert("雲端同步失敗：\n" + errMsg);
    }
  };

  window.saveQuickFirebaseConfig = function() {
    const raw = document.getElementById('quick-firebase-config-input').value.trim();
    if (!raw) return alert("請先貼上 Firebase 設定！");

    try {
      // 嘗試解析物件字串 (自動剝離 const/let/var 宣告，支援標準 JSON 或 JS 物件寫法)
      let clean = raw.replace(/^(const|let|var)\s+[a-zA-Z0-9_$]+\s*=\s*/, '').trim();
      if (clean.endsWith(';')) clean = clean.slice(0, -1).trim();

      let parsed = null;
      try {
        parsed = JSON.parse(clean);
      } catch (e) {
        const objStr = clean.startsWith('{') ? clean : '{' + clean + '}';
        parsed = new Function('return ' + objStr)();
      }

      if (!parsed.apiKey || !parsed.projectId) {
        throw new Error("設定缺少 apiKey 或 projectId");
      }

      localStorage.setItem('elec_custom_firebase_config', JSON.stringify(parsed));
      CloudSync.init();
      alert("Firebase 設定已儲存成功！");
      window.openCloudSyncModal();
    } catch (err) {
      alert("解析失敗，請確認貼上的是標準 JSON 或 JS 物件！錯誤: " + err.message);
    }
  };

  // 頁面載入完成後初始化
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => CloudSync.init());
  } else {
    CloudSync.init();
  }
})();
