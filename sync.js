/**
 * sync.js - 雲端帳號同步模組 (方案 C: Firebase Auth + Cloud Firestore)
 * 支援跨裝置自動背景雙向同步、離線暫存與智慧資料合併
 */
(function() {
  const CloudSync = {
    isConfigured: false,
    auth: null,
    db: null,
    currentUser: null,
    debounceTimer: null,
    isSyncing: false,
    lastSyncTime: null,

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

        // 處理手機 Redirect 登入返回結果
        this.auth.getRedirectResult().catch(err => {
          console.error("Redirect 登入處理失敗:", err);
        });

        // 監聽登入狀態改變
        this.auth.onAuthStateChanged(user => {
          this.currentUser = user;
          this.updateBadgeUI();
          if (user) {
            console.log("🟢 雲端帳號已登入:", user.email);
            // 登入後立即進行初次雙向拉取與合併
            this.pullAndMerge();
          } else {
            console.log("⚪ 尚未登入雲端帳號");
          }
        });

        // 當使用者從背景切換回分頁或手機桌面重啟 PWA 時，自動從雲端拉取最新進度
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && this.currentUser && !this.isSyncing) {
            const now = Date.now();
            const last = this.lastSyncTime ? this.lastSyncTime.getTime() : 0;
            if (now - last > 5000) {
              console.log("🔄 偵測到切換回應用，自動執行雲端雙向同步...");
              this.pullAndMerge();
            }
          }
        });
      } catch (err) {
        console.error("Firebase 初始化失敗:", err);
        this.isConfigured = false;
        this.updateBadgeUI();
      }
    },

    // 更新導覽列狀態徽章
    updateBadgeUI() {
      const btn = document.getElementById('cloud-sync-btn');
      const text = document.getElementById('cloud-sync-btn-text');
      if (!btn || !text) return;

      if (!this.isConfigured) {
        text.textContent = "☁️ 雲端同步 (待配置)";
        btn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 transition";
        return;
      }

      if (this.isSyncing) {
        text.textContent = "🔄 同步中...";
        btn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-medium animate-pulse";
      } else if (this.currentUser) {
        const displayName = this.currentUser.displayName || (this.currentUser.email ? this.currentUser.email.split('@')[0] : '已登入');
        text.textContent = `🟢 已同步 (${displayName})`;
        btn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 text-xs font-medium hover:bg-green-100 transition";
      } else {
        text.textContent = "☁️ 登入同步";
        btn.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition";
      }
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

    // 將本機記錄上傳到 Firestore
    async pushToCloud() {
      if (!this.isConfigured || !this.currentUser || !this.db) return;
      this.isSyncing = true;
      this.updateBadgeUI();

      try {
        const localData = this.collectLocalData();
        const userDocRef = this.db.collection('users').doc(this.currentUser.uid);
        await userDocRef.set(localData, { merge: true });
        this.lastSyncTime = new Date();
        console.log("☁️ 雲端同步完成 (Push success):", this.lastSyncTime.toLocaleTimeString());
      } catch (err) {
        console.error("雲端上傳失敗:", err);
      } finally {
        this.isSyncing = false;
        this.updateBadgeUI();
      }
    },

    // 防抖上傳：答題時每 2 秒最多同步一次，避免頻繁寫入
    scheduleDebouncedPush() {
      if (!this.isConfigured || !this.currentUser) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.pushToCloud();
      }, 2000);
    },

    // 從 Firestore 拉取並與本機進行智慧合併 (Smart Merge)
    async pullAndMerge() {
      if (!this.isConfigured || !this.currentUser || !this.db) return;
      this.isSyncing = true;
      this.updateBadgeUI();

      try {
        const userDocRef = this.db.collection('users').doc(this.currentUser.uid);
        const docSnap = await userDocRef.get();

        if (docSnap.exists) {
          const remoteData = docSnap.data();
          const remoteSubjects = remoteData.subjects || {};
          const subjects = ['mid_maintenance_electrician', 'junior_maintenance_electrician', 'junior_equipment_installer'];

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
          this.lastSyncTime = new Date();
          console.log("☁️ 雲端資料拉取與智慧合併完成！");
        } else {
          // 雲端尚無資料，首次上傳本機現有進度
          console.log("☁️ 雲端尚無資料，正將本機進度首次備份至雲端...");
          await this.pushToCloud();
        }
      } catch (err) {
        console.error("雲端拉取失敗:", err);
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

    // Google 一鍵登入 (支援彈窗與跳轉)
    async signInWithGoogle(useRedirect = false) {
      if (!this.isConfigured || !this.auth) throw new Error("Firebase 尚未配置");
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (useRedirect || isMobile) {
        console.log("📲 檢測為行動裝置或指定跳轉模式，使用 signInWithRedirect...");
        return await this.auth.signInWithRedirect(provider);
      } else {
        try {
          return await this.auth.signInWithPopup(provider);
        } catch (popupErr) {
          if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
            console.warn("彈窗被封鎖，自動切換至跳轉模式 (signInWithRedirect)...");
            return await this.auth.signInWithRedirect(provider);
          }
          throw popupErr;
        }
      }
    },

    // 帳號登出
    async logout() {
      if (!this.isConfigured || !this.auth) return;
      await this.auth.signOut();
      this.currentUser = null;
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
        document.getElementById('sync-last-time').textContent = CloudSync.lastSyncTime ? CloudSync.lastSyncTime.toLocaleTimeString() : '剛剛';

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
      }
    } else {
      if (unconfiguredView) unconfiguredView.classList.add('hidden');
      if (authView) authView.classList.remove('hidden');
      if (userView) userView.classList.add('hidden');
      window.switchAuthTab('login');
    }
  };

  window.closeCloudSyncModal = function() {
    const modal = document.getElementById('cloud-sync-modal');
    if (modal) modal.classList.add('hidden');
    const errEl = document.getElementById('auth-error-msg');
    if (errEl) errEl.classList.add('hidden');
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
    const errEl = document.getElementById('auth-error-msg');
    const submitBtn = document.getElementById('auth-submit-btn');

    errEl.classList.add('hidden');
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
      errEl.classList.remove('hidden');
      let msg = err.message || "認證失敗";
      if (msg.includes("auth/user-not-found") || msg.includes("auth/wrong-password") || msg.includes("auth/invalid-credential")) {
        msg = "帳號或密碼錯誤，若尚未註冊請切換至「註冊」分頁。";
      } else if (msg.includes("auth/email-already-in-use")) {
        msg = "該信箱已被註冊，請直接切換至「登入」。";
      } else if (msg.includes("auth/weak-password")) {
        msg = "密碼長度需至少 6 個字元。";
      }
      errEl.textContent = msg;
    } finally {
      submitBtn.disabled = false;
      window.switchAuthTab(currentAuthTab);
    }
  };

  // Google 一鍵登入處理
  window.handleGoogleSignIn = async function(forceRedirect = false) {
    const googleBtn = document.getElementById('google-signin-btn');
    const errEl = document.getElementById('google-error-msg') || document.getElementById('auth-error-msg');
    if (errEl) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
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
      let msg = err.message || "Google 登入失敗";
      let isConfigIssue = false;

      if (err.code === 'auth/popup-closed-by-user') {
        msg = "登入視窗已關閉。若您使用的是手機或受到彈窗阻擋，請點擊下方「改用全頁跳轉登入」。";
      } else if (err.code === 'auth/popup-blocked') {
        msg = "瀏覽器封鎖了彈出式視窗，正為您自動切換至跳轉模式...";
        setTimeout(() => CloudSync.signInWithGoogle(true), 1000);
      } else if (err.code === 'auth/unauthorized-domain') {
        isConfigIssue = true;
        msg = "⚠️ 網域未授權：請至 Firebase 控制台 ➔ Authentication ➔ 設定 (Settings) ➔ 已授權網域，新增 594siscon.github.io";
      } else if (err.code === 'auth/operation-not-allowed') {
        isConfigIssue = true;
        msg = "⚠️ 尚未在 Firebase 啟用 Google 登入：請至 Firebase 控制台 ➔ Authentication ➔ 登入方法 (Sign-in method)，啟用 Google 提供者。";
      }

      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.textContent = msg;
      }
      if (isConfigIssue) {
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
    await CloudSync.pullAndMerge();
    await CloudSync.pushToCloud();
    const lastEl = document.getElementById('sync-last-time');
    if (lastEl) lastEl.textContent = new Date().toLocaleTimeString();
    alert("雲端雙向同步完成！所有紀錄已為最新狀態。");
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
