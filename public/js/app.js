// ─── State ────────────────────────────────────────────────────────────────
let appConfig = {};
let currentUser = null;
let apiLogEntries = [];

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load config
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
  } catch (e) {
    console.error('Failed to load config:', e);
  }

  // Initialize Transmit Security SDK when loaded
  const sdkScript = document.getElementById('ts-platform-script');
  if (sdkScript) {
    sdkScript.addEventListener('load', initSDK);
  }

  // Check existing session
  await checkSession();

  // Setup OTP input behavior
  setupOtpInputs();
});

async function initSDK() {
  if (window.tsPlatform && appConfig.clientId) {
    try {
      await window.tsPlatform.initialize({
        clientId: appConfig.clientId,
        webauthn: {
          serverPath: 'https://api.transmitsecurity.io'
        }
      });
      console.log('Transmit Security SDK initialized');
    } catch (e) {
      console.error('SDK init error:', e);
    }
  }
}

// ─── Session Check ────────────────────────────────────────────────────────
async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    if (data.authenticated) {
      currentUser = data.user;
      showDashboard();
    }
  } catch (e) {
    console.error('Session check failed:', e);
  }
}

// ─── Tab Switching ────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));

  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');

  hideAlert();
}

// ─── Email OTP Flow ───────────────────────────────────────────────────────
async function sendEmailOtp() {
  const email = document.getElementById('otpEmail').value.trim();
  if (!email) return showAlert('Please enter your email address', 'error');

  const btn = document.getElementById('sendOtpBtn');
  setLoading(btn, true);
  hideAlert();

  try {
    const res = await apiCall('/api/auth/email-otp-backend/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (data.success) {
      document.getElementById('otpStep1').classList.add('hidden');
      document.getElementById('otpStep2').classList.remove('hidden');
      document.getElementById('otpSentEmail').textContent = email;
      document.querySelector('.otp-digit[data-index="0"]').focus();
      showAlert('One-time code sent! Check your inbox.', 'success');
    } else {
      showAlert(data.error || 'Failed to send OTP', 'error');
    }
  } catch (err) {
    showAlert('Network error. Please try again.', 'error');
  }

  setLoading(btn, false);
}

async function validateEmailOtp() {
  const email = document.getElementById('otpEmail').value.trim();
  const digits = document.querySelectorAll('.otp-digit');
  const code = Array.from(digits).map(d => d.value).join('');

  if (code.length !== 6) return showAlert('Please enter the complete 6-digit code', 'error');

  const btn = document.getElementById('validateOtpBtn');
  setLoading(btn, true);
  hideAlert();

  try {
    const res = await apiCall('/api/auth/email-otp-backend/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });

    const data = await res.json();
    if (data.success) {
      currentUser = data.user;
      showDashboard();
    } else {
      showAlert(data.error || 'Invalid code. Please try again.', 'error');
    }
  } catch (err) {
    showAlert('Network error. Please try again.', 'error');
  }

  setLoading(btn, false);
}

function resetOtpFlow() {
  document.getElementById('otpStep1').classList.remove('hidden');
  document.getElementById('otpStep2').classList.add('hidden');
  document.querySelectorAll('.otp-digit').forEach(d => d.value = '');
  hideAlert();
}

// ─── Password Flow ────────────────────────────────────────────────────────
async function passwordLogin() {
  const email = document.getElementById('pwEmail').value.trim();
  const password = document.getElementById('pwPassword').value;

  if (!email || !password) return showAlert('Please enter email and password', 'error');

  const btn = document.getElementById('pwLoginBtn');
  setLoading(btn, true);
  hideAlert();

  try {
    const res = await apiCall('/api/auth/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (data.success) {
      currentUser = data.user;
      showDashboard();
    } else {
      showAlert(data.error || 'Login failed. Check your credentials.', 'error');
    }
  } catch (err) {
    showAlert('Network error. Please try again.', 'error');
  }

  setLoading(btn, false);
}

async function passwordRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!email || !password) return showAlert('Please fill in all required fields', 'error');
  if (password.length < 8) return showAlert('Password must be at least 8 characters', 'error');

  const btn = document.getElementById('regBtn');
  setLoading(btn, true);
  hideAlert();

  try {
    const res = await apiCall('/api/auth/password/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });

    const data = await res.json();
    if (data.success) {
      showAlert('Account created! You can now sign in.', 'success');
      toggleRegister(false);
      document.getElementById('pwEmail').value = email;
    } else {
      showAlert(data.error || 'Registration failed', 'error');
    }
  } catch (err) {
    showAlert('Network error. Please try again.', 'error');
  }

  setLoading(btn, false);
}

function toggleRegister(show) {
  document.getElementById('passwordLoginForm').classList.toggle('hidden', show);
  document.getElementById('passwordRegisterForm').classList.toggle('hidden', !show);
  hideAlert();
}

// ─── Passkey Flow ─────────────────────────────────────────────────────────
async function passkeyAuth() {
  if (!window.tsPlatform) {
    return showAlert('Passkey SDK is still loading. Please wait.', 'error');
  }

  const btn = document.getElementById('passkeyBtn');
  setLoading(btn, true);
  hideAlert();

  try {
    // Prepare and execute passkey authentication via SDK
    await window.tsPlatform.webauthn.preparePasskeyAuthentication();
    const webauthnResult = await window.tsPlatform.webauthn.executePasskeyAuthentication();
    logApi('POST', '/webauthn/authenticate (SDK)', 200);

    // Send encoded result to backend for token exchange
    const res = await apiCall('/api/auth/webauthn/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webauthn_encoded_result: webauthnResult.result })
    });

    const data = await res.json();
    if (data.success) {
      currentUser = data.user;
      showDashboard();
    } else {
      showAlert(data.error || 'Passkey authentication failed', 'error');
    }

    // Reset SDK state after flow
    window.tsPlatform.webauthn.reset();
  } catch (err) {
    window.tsPlatform.webauthn.reset();
    if (err.name === 'NotAllowedError') {
      showAlert('Passkey request was cancelled.', 'error');
    } else {
      showAlert('Passkey authentication failed. You may need to register a passkey first.', 'error');
    }
  }

  setLoading(btn, false);
}

async function registerPasskey() {
  if (!window.tsPlatform) {
    return showAlert('Passkey SDK is still loading.', 'error');
  }

  const btn = document.getElementById('registerPasskeyBtn');
  setLoading(btn, true);

  try {
    // Prepare and execute WebAuthn registration via SDK
    await window.tsPlatform.webauthn.prepareWebauthnRegistration(
      currentUser.name || currentUser.email
    );
    const webauthnResult = await window.tsPlatform.webauthn.executeWebauthnRegistration();
    logApi('POST', '/webauthn/register (SDK)', 200);

    // Send encoded result to backend to complete registration
    const res = await apiCall('/api/auth/webauthn/register/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webauthn_encoded_result: webauthnResult.result })
    });

    const data = await res.json();
    if (data.success) {
      showDashboardAlert('Passkey registered successfully!', 'success');
      btn.textContent = 'Registered';
      btn.disabled = true;
    } else {
      showDashboardAlert(data.error || 'Passkey registration failed', 'error');
    }

    window.tsPlatform.webauthn.reset();
  } catch (err) {
    window.tsPlatform.webauthn.reset();
    showDashboardAlert('Passkey registration cancelled or failed.', 'error');
  }

  setLoading(btn, false);
}

// ─── Dashboard ────────────────────────────────────────────────────────────
function showDashboard() {
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('dashboardView').classList.remove('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');

  if (currentUser) {
    document.getElementById('userName').textContent = currentUser.name || currentUser.email;
    document.getElementById('profileUserId').textContent = truncate(currentUser.userId, 24);
    document.getElementById('profileEmail').textContent = currentUser.email || '-';
    document.getElementById('profileName').textContent = currentUser.name || '-';
    document.getElementById('profileAuthMethod').textContent = formatAuthMethod(currentUser.authMethod);

    const badge = document.getElementById('authBadge');
    badge.innerHTML = `&#10003; Authenticated via ${formatAuthMethod(currentUser.authMethod)}`;
  }

  refreshProfile();
}

function showAuthView() {
  document.getElementById('authView').classList.remove('hidden');
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('logoutBtn').classList.add('hidden');
  resetOtpFlow();
  currentUser = null;
}

async function refreshProfile() {
  try {
    const res = await apiCall('/api/user/profile', { method: 'GET' });
    const data = await res.json();

    if (data.user_id) {
      document.getElementById('profileUserId').textContent = truncate(data.user_id, 24);
      document.getElementById('profileEmail').textContent = data.email || '-';
      document.getElementById('profileName').textContent = data.name || '-';
      document.getElementById('profileStatus').textContent = data.status || 'Active';

      // Show token info
      document.getElementById('tokenDisplay').textContent = JSON.stringify(data, null, 2);

      // Update password status
      if (data.credentials?.password) {
        document.getElementById('passwordStatus').textContent = 'Active';
        document.getElementById('passwordStatus').className = 'auth-method-status active';
      }
    }
  } catch (err) {
    console.error('Profile refresh failed:', err);
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  showAuthView();
  apiLogEntries = [];
  updateApiLogDisplay();
}

// ─── API Call Wrapper (for logging) ───────────────────────────────────────
async function apiCall(url, options = {}) {
  const method = options.method || 'GET';
  const start = Date.now();

  const res = await fetch(url, options);
  const duration = Date.now() - start;

  logApi(method, url, res.status, duration);
  return res;
}

function logApi(method, path, status, duration) {
  apiLogEntries.unshift({
    method,
    path: path.replace(/^\/api/, ''),
    status,
    duration,
    time: new Date().toLocaleTimeString()
  });

  if (apiLogEntries.length > 50) apiLogEntries.pop();
  updateApiLogDisplay();
}

function updateApiLogDisplay() {
  const container = document.getElementById('apiLog');
  if (!container) return;

  if (apiLogEntries.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--ts-gray-400); font-size:13px; padding:20px;">API calls will appear here as you interact with the app.</p>';
    return;
  }

  container.innerHTML = apiLogEntries.map(entry => `
    <div class="api-log-entry">
      <span class="api-log-method ${entry.method}">${entry.method}</span>
      <span class="api-log-path">${entry.path}</span>
      <span class="api-log-status ${entry.status < 400 ? 'success' : 'error'}">${entry.status}${entry.duration ? ` (${entry.duration}ms)` : ''}</span>
      <span class="api-log-time">${entry.time}</span>
    </div>
  `).join('');
}

function clearApiLog() {
  apiLogEntries = [];
  updateApiLogDisplay();
}

// ─── OTP Input Setup ──────────────────────────────────────────────────────
function setupOtpInputs() {
  const digits = document.querySelectorAll('.otp-digit');
  digits.forEach((input, i) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val && i < digits.length - 1) {
        digits[i + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        digits[i - 1].focus();
      }
    });

    // Handle paste
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(text)) {
        digits.forEach((d, j) => { d.value = text[j]; });
        digits[5].focus();
      }
    });
  });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────
function showAlert(message, type) {
  const alert = document.getElementById('authAlert');
  alert.className = `alert alert-${type} show`;
  alert.textContent = message;
}

function hideAlert() {
  const alert = document.getElementById('authAlert');
  alert.className = 'alert';
}

function showDashboardAlert(message, type) {
  // Simple approach: reuse existing alert or log to console
  console.log(`[${type}] ${message}`);
}

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Please wait...';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

function formatAuthMethod(method) {
  const map = {
    'email_otp': 'Email OTP',
    'password': 'Password',
    'passkey': 'Passkey',
    'webauthn': 'Passkey'
  };
  return map[method] || method || 'Unknown';
}

function truncate(str, len) {
  if (!str) return '-';
  return str.length > len ? str.substring(0, len) + '...' : str;
}
