require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'demo-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 3600000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const TS_API_BASE = process.env.TS_API_BASE || 'https://api.transmitsecurity.io';
const TS_CLIENT_ID = process.env.TS_CLIENT_ID;
const TS_CLIENT_SECRET = process.env.TS_CLIENT_SECRET;

// Cache for client access token
let clientTokenCache = { token: null, expiresAt: 0 };

// ─── Helper: Get Client Access Token ────────────────────────────────────────
async function getClientAccessToken() {
  if (clientTokenCache.token && Date.now() < clientTokenCache.expiresAt) {
    return clientTokenCache.token;
  }

  const res = await fetch(`${TS_API_BASE}/oidc/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: TS_CLIENT_ID,
      client_secret: TS_CLIENT_SECRET
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get client token: ${res.status} ${err}`);
  }

  const data = await res.json();
  clientTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000
  };
  return data.access_token;
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// ─── Health & Config ─────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    clientId: TS_CLIENT_ID,
    tenantId: process.env.TS_TENANT_ID
  });
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// ─── Email OTP Flow ─────────────────────────────────────────────────────────

// Step 1: Send OTP to email
app.post('/api/auth/email-otp/send', async (req, res) => {
  try {
    const { email } = req.body;
    const clientToken = await getClientAccessToken();

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/otp/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        email,
        redirect_uri: `${process.env.APP_URL || `http://localhost:${PORT}`}/api/auth/callback`,
        create_new_user: true
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to send OTP', details: data });
    }

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Email OTP send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Validate OTP code
app.post('/api/auth/email-otp/validate', async (req, res) => {
  try {
    const { email, code } = req.body;
    const clientToken = await getClientAccessToken();

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/otp/email/validation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({ email, passcode: code })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Invalid OTP', details: data });
    }

    // Exchange the result URI for tokens
    if (data.result) {
      const tokenRes = await fetch(data.result, {
        method: 'GET',
        redirect: 'manual'
      });

      // The result redirects with a code parameter
      const location = tokenRes.headers.get('location');
      if (location) {
        const url = new URL(location);
        const authCode = url.searchParams.get('code');

        if (authCode) {
          // Exchange code for tokens
          const tokenResponse = await fetch(`${TS_API_BASE}/oidc/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: authCode,
              client_id: TS_CLIENT_ID,
              client_secret: TS_CLIENT_SECRET,
              redirect_uri: `${process.env.APP_URL || `http://localhost:${PORT}`}/api/auth/callback`
            })
          });

          const tokens = await tokenResponse.json();
          if (tokenResponse.ok) {
            // Decode ID token to get user info
            const userInfo = decodeJwt(tokens.id_token);
            req.session.user = {
              userId: userInfo.sub,
              email: userInfo.email || email,
              name: userInfo.name || email.split('@')[0],
              authMethod: 'email_otp'
            };
            req.session.tokens = tokens;
            return res.json({ success: true, user: req.session.user });
          }
        }
      }
    }

    res.status(400).json({ error: 'Failed to complete authentication' });
  } catch (err) {
    console.error('Email OTP validate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Backend Email OTP Flow (Alternative) ───────────────────────────────────

app.post('/api/auth/email-otp-backend/send', async (req, res) => {
  try {
    const { email } = req.body;
    const clientToken = await getClientAccessToken();

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/otp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        channel: 'email',
        identifier: email,
        identifier_type: 'email',
        create_new_user: true
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to send OTP', details: data });
    }

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Backend Email OTP send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/email-otp-backend/authenticate', async (req, res) => {
  try {
    const { email, code } = req.body;
    const clientToken = await getClientAccessToken();

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/otp/authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        passcode: code,
        identifier: email,
        identifier_type: 'email'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Authentication failed', details: data });
    }

    const userInfo = decodeJwt(data.id_token);
    req.session.user = {
      userId: userInfo.sub,
      email: userInfo.email || email,
      name: userInfo.name || email.split('@')[0],
      authMethod: 'email_otp'
    };
    req.session.tokens = {
      access_token: data.access_token,
      id_token: data.id_token,
      refresh_token: data.refresh_token
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Backend Email OTP auth error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Password Authentication ────────────────────────────────────────────────

app.post('/api/auth/password/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const clientToken = await getClientAccessToken();

    // Create the user
    const createRes = await fetch(`${TS_API_BASE}/cis/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        email,
        name: name || email.split('@')[0],
        credentials: { password }
      })
    });

    const userData = await createRes.json();
    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: userData.message || 'Registration failed', details: userData });
    }

    res.json({ success: true, message: 'User registered successfully', userId: userData.user_id });
  } catch (err) {
    console.error('Password register error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/password/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientToken = await getClientAccessToken();

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/password/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        identifier: email,
        identifier_type: 'email',
        password,
        client_id: TS_CLIENT_ID
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Login failed', details: data });
    }

    const userInfo = decodeJwt(data.id_token);
    req.session.user = {
      userId: userInfo.sub,
      email: userInfo.email || email,
      name: userInfo.name || email.split('@')[0],
      authMethod: 'password'
    };
    req.session.tokens = {
      access_token: data.access_token,
      id_token: data.id_token,
      refresh_token: data.refresh_token
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Password login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WebAuthn / Passkeys ────────────────────────────────────────────────────

app.post('/api/auth/webauthn/register/init', requireAuth, async (req, res) => {
  try {
    const clientToken = await getClientAccessToken();
    const userToken = req.session.tokens?.access_token;

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/webauthn/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken || clientToken}`
      },
      body: JSON.stringify({
        user_id: req.session.user.userId
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'WebAuthn registration init failed', details: data });
    }

    res.json(data);
  } catch (err) {
    console.error('WebAuthn register init error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/webauthn/register/complete', requireAuth, async (req, res) => {
  try {
    const clientToken = await getClientAccessToken();
    const userToken = req.session.tokens?.access_token;

    const response = await fetch(`${TS_API_BASE}/cis/v1/auth/webauthn/register/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken || clientToken}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'WebAuthn registration failed', details: data });
    }

    res.json({ success: true, message: 'Passkey registered successfully' });
  } catch (err) {
    console.error('WebAuthn register complete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── User Management ────────────────────────────────────────────────────────

app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const clientToken = await getClientAccessToken();
    const userId = req.session.user.userId;

    const response = await fetch(`${TS_API_BASE}/cis/v1/users/${userId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${clientToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to fetch profile', details: data });
    }

    res.json(data);
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const clientToken = await getClientAccessToken();
    const userId = req.session.user.userId;

    const response = await fetch(`${TS_API_BASE}/cis/v1/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to update profile', details: data });
    }

    // Update session
    if (req.body.name) req.session.user.name = req.body.name;
    if (req.body.email) req.session.user.email = req.body.email;

    res.json({ success: true, user: data });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Logout ─────────────────────────────────────────────────────────────────

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ─── OIDC Callback ──────────────────────────────────────────────────────────

app.get('/api/auth/callback', (req, res) => {
  res.redirect('/');
});

// ─── Catch-all: serve index.html for SPA routes ────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── JWT Decode Helper ──────────────────────────────────────────────────────
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return {};
  }
}

// ─── Start Server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Transmit Security Demo App`);
  console.log(`  ─────────────────────────`);
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  Tenant ID:  ${process.env.TS_TENANT_ID || 'not set'}`);
  console.log(`  Client ID:  ${TS_CLIENT_ID ? TS_CLIENT_ID.substring(0, 8) + '...' : 'not set'}`);
  console.log(`  API Base:   ${TS_API_BASE}\n`);

  if (!TS_CLIENT_ID || !TS_CLIENT_SECRET) {
    console.log('  ⚠  Set TS_CLIENT_ID and TS_CLIENT_SECRET in .env');
    console.log('  Get them from: https://portal.transmitsecurity.io/\n');
  }
});
