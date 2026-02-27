/**
 * macOS Notification Center integration.
 *
 * Bridges NotificationManager events to native macOS notifications.
 * - Inside Electron: uses Electron's Notification API so clicking the
 *   notification focuses/restores the app window.
 * - Standalone server: falls back to osascript.
 * No-op on non-darwin platforms.
 */

const { execFile } = require('child_process');
const { getNotificationManager } = require('./notifications');

// Subtitle and sound per notification level
const LEVEL_META = {
  success: { subtitle: 'Myrlin ✓', sound: 'Glass' },
  info:    { subtitle: 'Myrlin',   sound: null },
  warning: { subtitle: 'Myrlin ⚠', sound: 'Ping' },
  error:   { subtitle: 'Myrlin ✕', sound: 'Basso' },
};

/**
 * Fire a native macOS notification via osascript.
 * @param {string} title
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [level]
 */
function sendMacNotification(title, message, level) {
  if (process.env.ELECTRON === '1') {
    // Use Electron's Notification API — supports click to focus the window
    const { Notification, BrowserWindow, app } = require('electron');
    const meta = LEVEL_META[level] || LEVEL_META.info;
    const n = new Notification({ title, body: message, subtitle: meta.subtitle });
    n.on('click', () => {
      app.focus({ steal: true });
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { win.show(); win.focus(); }
    });
    n.show();
    return;
  }

  const t = title.replace(/"/g, '\\"');
  const m = message.replace(/"/g, '\\"');
  const meta = LEVEL_META[level] || LEVEL_META.info;
  const sub = meta.subtitle.replace(/"/g, '\\"');

  let script = `display notification "${m}" with title "${t}" subtitle "${sub}"`;
  if (meta.sound) script += ` sound name "${meta.sound}"`;

  execFile('osascript', ['-e', script], (err) => {
    if (err) console.warn('[mac-notifications] osascript error:', err.message);
  });
}

/**
 * Subscribe to NotificationManager and forward events to macOS Notification Center.
 * Only active on darwin (macOS). Safe to call on other platforms — will no-op.
 */
function initMacNotifications() {
  if (process.platform !== 'darwin') return;
  getNotificationManager().on('notification', (n) => sendMacNotification(n.title, n.message, n.level));
  console.log('[mac-notifications] macOS notification integration active');
}

module.exports = { initMacNotifications, sendMacNotification };
