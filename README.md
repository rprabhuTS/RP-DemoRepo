# Transmit Security B2C Identity Demo

A demo web application showcasing Transmit Security's (Mosaic) B2C Identity platform capabilities. Built for Sales Engineering demos to demonstrate authentication solutions to prospects and customers.

## Features

- **Email OTP Authentication** — Passwordless login via one-time passcode sent to email
- **Password Authentication** — Traditional email + password registration and login
- **Passkey / WebAuthn** — Biometric and hardware key authentication (FIDO2)
- **User Management** — Profile viewing and management via Mosaic APIs
- **API Activity Log** — Real-time visibility into all API calls made during the demo
- **Token Viewer** — Inspect decoded JWT tokens from your authentication session

## Architecture

```
Browser                         Express Server                  Transmit Security
┌─────────────┐                ┌──────────────┐                ┌─────────────────┐
│  Frontend    │──── REST ────▶│  Backend     │──── REST ────▶│  Mosaic APIs     │
│  (HTML/JS)  │               │  (Node.js)   │               │                  │
│  + TS SDK   │               │  + Sessions  │               │  api.transmit    │
│             │               │              │               │  security.io     │
└─────────────┘                └──────────────┘                └─────────────────┘
```

**Backend-to-Backend pattern**: All sensitive API calls (token exchange, user creation, OTP validation) go through the Express server. Client credentials are never exposed to the browser.

## Prerequisites

- **Node.js** 18+ installed
- A **Transmit Security** account ([portal.transmitsecurity.io](https://portal.transmitsecurity.io/))
- An **Application** configured in the Mosaic Admin Portal

## Quick Start

### 1. Clone and Install

```bash
git clone <this-repo>
cd transmit-security-demo
npm install
```

### 2. Configure Your Application in Mosaic

1. Log into [portal.transmitsecurity.io](https://portal.transmitsecurity.io/)
2. Navigate to **B2C Identity** > **Applications**
3. Create a new application (or use an existing one)
4. Note your **Client ID** and **Client Secret**
5. Add `http://localhost:3000/api/auth/callback` as a **Redirect URI**
6. Under **Authentication Methods**, enable:
   - Email OTP
   - Passwords
   - WebAuthn / Passkeys

### 3. Set Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
TS_CLIENT_ID=your_client_id_here
TS_CLIENT_SECRET=your_client_secret_here
TS_TENANT_ID=9x6egrq3wzjp4hbg5fh02
TS_API_BASE=https://api.transmitsecurity.io
PORT=3000
SESSION_SECRET=generate-a-random-string-here
APP_URL=http://localhost:3000
```

### 4. Run the App

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Demo Walkthrough

### Email OTP (Passwordless)
1. Select the **Email OTP** tab
2. Enter an email address and click **Send One-Time Code**
3. Check the email inbox for the OTP
4. Enter the 6-digit code to authenticate
5. View the dashboard with user profile and API activity

### Password Authentication
1. Select the **Password** tab
2. Click **Create one** to register a new user with email + password
3. After registration, sign in with the same credentials
4. Explore the dashboard and token viewer

### Passkey Registration (Post-Login)
1. Authenticate via Email OTP or Password first
2. On the dashboard, find **Auth Methods** card
3. Click **Register** next to Passkey
4. Complete the biometric prompt on your device
5. Next time, you can sign in directly with your passkey

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Get client configuration |
| `GET` | `/api/session` | Check authentication status |
| `POST` | `/api/auth/email-otp-backend/send` | Send email OTP |
| `POST` | `/api/auth/email-otp-backend/authenticate` | Validate OTP and get tokens |
| `POST` | `/api/auth/password/register` | Register user with password |
| `POST` | `/api/auth/password/login` | Login with password |
| `POST` | `/api/auth/webauthn/register/init` | Init passkey registration |
| `POST` | `/api/auth/webauthn/register/complete` | Complete passkey registration |
| `GET` | `/api/user/profile` | Get user profile |
| `PUT` | `/api/user/profile` | Update user profile |
| `POST` | `/api/auth/logout` | End session |

## Transmit Security Resources

- **Admin Portal**: [portal.transmitsecurity.io](https://portal.transmitsecurity.io/)
- **Developer Docs**: [developer.transmitsecurity.com](https://developer.transmitsecurity.com/)
- **Platform SDK Reference**: [SDK Docs](https://developer.transmitsecurity.com/sdk-ref/platform/introduction)
- **API Reference**: [OpenAPI Docs](https://developer.transmitsecurity.com/openapi/user/user-management/)

## Regional API Endpoints

| Region | Base URL |
|--------|----------|
| US (default) | `https://api.transmitsecurity.io` |
| EU | `https://api.eu.transmitsecurity.io` |
| Canada | `https://api.ca.transmitsecurity.io` |
| Australia | `https://api.au.transmitsecurity.io` |

Update `TS_API_BASE` in your `.env` file to use a different region.

## Tenant Info

- **Tenant ID**: `9x6egrq3wzjp4hbg5fh02`
