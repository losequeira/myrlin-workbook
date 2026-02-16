#!/usr/bin/env node
/**
 * Claude Workspace Manager - GUI Entry Point
 *
 * Starts the Express web server and opens the browser.
 * Use --demo to seed sample workspaces and sessions on first run.
 *
 * Usage:
 *   node src/gui.js           Launch the web GUI
 *   node src/gui.js --demo    Launch with demo data (if store is empty)
 *
 * Environment:
 *   PORT=3456                 Override the default port
 */

const { getStore } = require('./state/store');
const { startServer, getPtyManager } = require('./web/server');
const { backupFrontend } = require('./web/backup');

// ─── Initialize Store ──────────────────────────────────────

const store = getStore();

// ─── Demo Data Seeding ─────────────────────────────────────

if (process.argv.includes('--demo')) {
  // Only seed if there are no existing workspaces
  if (store.getAllWorkspacesList().length === 0) {
    const ws1 = store.createWorkspace({
      name: 'Project Alpha',
      description: 'Frontend application',
    });
    const ws2 = store.createWorkspace({
      name: 'Backend API',
      description: 'Backend services',
    });
    const ws3 = store.createWorkspace({
      name: 'Documentation',
      description: 'Docs & guides',
    });

    store.createSession({
      name: 'ui-components',
      workspaceId: ws1.id,
      workingDir: 'C:\\Projects\\project-alpha',
      topic: 'React components',
    });
    store.createSession({
      name: 'state-mgmt',
      workspaceId: ws1.id,
      workingDir: 'C:\\Projects\\project-alpha\\state',
      topic: 'State management',
    });
    store.createSession({
      name: 'api-routes',
      workspaceId: ws2.id,
      workingDir: 'C:\\Projects\\backend-api',
      topic: 'REST endpoints',
    });
    store.createSession({
      name: 'db-migrations',
      workspaceId: ws2.id,
      workingDir: 'C:\\Projects\\backend-api\\db',
      topic: 'Database schema',
    });
    store.createSession({
      name: 'readme-update',
      workspaceId: ws3.id,
      workingDir: 'C:\\Projects\\docs',
      topic: 'README overhaul',
    });
    store.createSession({
      name: 'api-docs',
      workspaceId: ws3.id,
      workingDir: 'C:\\Projects\\docs\\api',
      topic: 'API reference',
    });

    store.save();
    console.log('Demo data seeded.');
  }
}

// ─── Start Server ──────────────────────────────────────────

const port = parseInt(process.env.PORT, 10) || 3456;
const host = process.env.CWM_HOST || '127.0.0.1';
const server = startServer(port, host);

console.log(`CWM GUI running at http://${host}:${port}`);
console.log('Press Ctrl+C to stop.');

// Snapshot frontend files as "last known good" on successful start
backupFrontend();

// ─── Open Browser (Windows) ────────────────────────────────
// Skip auto-open when running headless (e.g., marketing capture pipeline)
// --cdp flag launches browser with Chrome DevTools Protocol remote debugging
// so the visual-qa MCP server can screenshot and inspect the UI.

if (!process.env.CWM_NO_OPEN) {
  const { exec } = require('child_process');
  const cdpEnabled = process.argv.includes('--cdp');
  const cdpPort = parseInt(process.env.CDP_PORT, 10) || 9222;

  if (cdpEnabled) {
    // Launch Chrome/Edge with remote debugging enabled for CDP inspection
    exec(`start chrome --remote-debugging-port=${cdpPort} http://localhost:${port}`, (err) => {
      if (err) {
        // Chrome not found — try Edge (common on Windows)
        exec(`start msedge --remote-debugging-port=${cdpPort} http://localhost:${port}`, (err2) => {
          if (err2) {
            console.log(`Could not launch browser with CDP. Open manually with --remote-debugging-port=${cdpPort}`);
            exec(`start http://localhost:${port}`);
          }
        });
      }
    });
    console.log(`CDP remote debugging enabled on port ${cdpPort}`);
    console.log(`Visual QA MCP can connect at localhost:${cdpPort}`);
  } else {
    exec(`start http://localhost:${port}`);
  }
}

// ─── Graceful Shutdown ─────────────────────────────────────

process.on('SIGINT', () => {
  const ptyManager = getPtyManager();
  if (ptyManager) ptyManager.destroyAll();
  store.save();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  const ptyManager = getPtyManager();
  if (ptyManager) ptyManager.destroyAll();
  store.save();
  server.close();
  process.exit(0);
});
