# OpenClaw Dashboard Pro Usage Guide

A quick-start guide for first-time users.

## 1. Overview
OpenClaw Dashboard Pro is a local dashboard that lets you manage OpenClaw from your browser. After the server starts, most tasks are done in the UI without using OpenClaw CLI commands:

- Install and view install logs
- Configure models and run connectivity tests
- Start/stop/restart gateway and check status
- View and clean up sessions
- Check updates and run one-click update
- Skill recommendations and ClawHub entry

## 2. Requirements
- macOS / Linux (Windows via WSL)
- Node.js 18+
- `openclaw` installed (can be installed from the UI)

Check:
```bash
node -v
openclaw --version
```

## 3. Get the project
```bash
cd /path/to/your/workspace
git clone <your-repo-url> openclaw-dashboard-pro
cd openclaw-dashboard-pro
```

## 4. Start the server
```bash
node server.mjs
```

Expected log:
```text
OpenClaw Dashboard Pro (local) running at http://0.0.0.0:19190
```

## 5. Open in browser
- Local: `http://127.0.0.1:19190`
- LAN: `http://your-ip:19190`

Notes:
- Use `http`, not `https`
- If you have a proxy enabled, try disabling it when accessing local addresses

## 6. Features by tab

### Install
- One-click install OpenClaw
- Install status and logs
- Update maintenance:
  - Check updates
  - One-click update

### Configure
- Switch default model
- Connectivity test
- Add OpenAI Chat (Base URL / Model / API Key)
- View aliases / fallbacks

### Manage
- Gateway controls: start / restart / stop / status
- Channels status
- Create / clean up sessions
- Recent sessions list

### Optimize
- Optimization tips
- Skill recommendations & one-click install
- ClawHub marketplace entry

## 6.1 No-CLI workflow (recommended)
Once the server is running, do the following in the browser:
- Install OpenClaw from the “Install” tab
- Configure models from the “Configure” tab
- Use gateway controls and session tools in “Manage”
- Use “Check updates” and “One-click update” in “Install”

## 7. FAQ

### Q1: Page doesn't load
Check order:
1. Make sure the server is still running
2. Use `http://127.0.0.1:19190`
3. Check port 19190:
```bash
lsof -nP -iTCP:19190 -sTCP:LISTEN
```

### Q2: Buttons do nothing
- Check "Command Output" log at the bottom of the page
- Ensure `openclaw --version` works
- Some actions may need system permissions

### Q3: LAN devices can't access
- Ensure devices are in the same LAN
- Use your actual IP (e.g. `192.168.x.x`)
- Check firewall settings for port 19190

## 8. Update project
```bash
cd /path/to/openclaw-dashboard-pro
git pull
node server.mjs
```

## 9. Stop server
Press `Ctrl + C` in the terminal running `node server.mjs`.
