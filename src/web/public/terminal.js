/**
 * TerminalPane — xterm.js terminal connected via WebSocket to server-side PTY
 * Performance-critical: raw binary I/O, no JSON wrapping for terminal data
 */
class TerminalPane {
  constructor(containerId, sessionId, sessionName) {
    this.containerId = containerId;
    this.sessionId = sessionId;
    this.sessionName = sessionName || 'Terminal';
    this.term = null;
    this.fitAddon = null;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
  }

  mount() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error('[Terminal] Container not found:', this.containerId);
      return;
    }
    container.innerHTML = ''; // clear placeholder

    // Verify xterm.js is loaded
    if (typeof Terminal === 'undefined') {
      console.error('[Terminal] xterm.js (Terminal) is not loaded. Check vendor scripts.');
      container.innerHTML = '<div style="padding:16px;color:#f38ba8;font-size:13px;">Error: xterm.js not loaded. Check browser console.</div>';
      return;
    }
    if (typeof FitAddon === 'undefined') {
      console.error('[Terminal] xterm-addon-fit (FitAddon) is not loaded. Check vendor scripts.');
      container.innerHTML = '<div style="padding:16px;color:#f38ba8;font-size:13px;">Error: FitAddon not loaded. Check browser console.</div>';
      return;
    }

    try {
      this.term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: '#1e1e2e',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          cursorAccent: '#1e1e2e',
          selectionBackground: 'rgba(203, 166, 247, 0.25)',
          selectionForeground: '#cdd6f4',
          black: '#45475a',
          red: '#f38ba8',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#cba6f7',
          cyan: '#94e2d5',
          white: '#bac2de',
          brightBlack: '#585b70',
          brightRed: '#f38ba8',
          brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af',
          brightBlue: '#89b4fa',
          brightMagenta: '#cba6f7',
          brightCyan: '#94e2d5',
          brightWhite: '#a6adc8',
        },
      });

      this.fitAddon = new FitAddon.FitAddon();
      this.term.loadAddon(this.fitAddon);

      // Load web links addon if available
      if (typeof WebLinksAddon !== 'undefined') {
        this.term.loadAddon(new WebLinksAddon.WebLinksAddon());
      }

      this.term.open(container);
      console.log('[Terminal] xterm opened in', this.containerId, 'for session', this.sessionId);

      // Show connecting message
      this.term.write('\x1b[1;34mConnecting to session...\x1b[0m\r\n');

      // Small delay to ensure container has dimensions before fitting
      requestAnimationFrame(() => {
        try {
          this.fitAddon.fit();
          console.log('[Terminal] Fitted:', this.term.cols, 'x', this.term.rows);
        } catch (e) {
          console.error('[Terminal] fitAddon.fit() failed:', e.message);
        }
        this.connect();
      });

      // Forward user input to WebSocket
      this.term.onData((data) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Auto-resize on container size change
      this._resizeObserver = new ResizeObserver(() => {
        if (this.fitAddon) {
          try {
            this.fitAddon.fit();
          } catch (_) {}
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
          }
        }
      });
      this._resizeObserver.observe(container);
    } catch (err) {
      console.error('[Terminal] Failed to initialize xterm:', err);
      container.innerHTML = '<div style="padding:16px;color:#f38ba8;font-size:13px;">Terminal init failed: ' + err.message + '</div>';
    }
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const token = localStorage.getItem('cwm_token');
    if (!token) {
      console.error('[Terminal] No auth token in localStorage (cwm_token)');
      if (this.term) this.term.write('\x1b[1;31mNo auth token. Please log in again.\x1b[0m\r\n');
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/terminal?token=${encodeURIComponent(token)}&sessionId=${this.sessionId}`;
    console.log('[Terminal] Connecting WebSocket for session', this.sessionId);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this._reconnectAttempts = 0;
      console.log('[Terminal] WebSocket connected for session', this.sessionId);
      // Send initial terminal size
      this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
    };

    this.ws.onmessage = (event) => {
      // Check if it's a control message (JSON) or raw terminal output
      const data = event.data;
      if (typeof data === 'string' && data.charAt(0) === '{') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'exit') {
            this.term.write('\r\n\x1b[1;31m[Process exited with code ' + msg.exitCode + ']\x1b[0m\r\n');
            this.connected = false;
          } else if (msg.type === 'error') {
            this.term.write('\r\n\x1b[1;31m[Error: ' + msg.message + ']\x1b[0m\r\n');
          } else if (msg.type === 'output') {
            // Fallback: server sent JSON-wrapped output
            this.term.write(msg.data);
          }
          return;
        } catch (_) { /* not JSON, treat as raw output */ }
      }
      // Raw terminal output — write directly (fastest path)
      this.term.write(data);
    };

    this.ws.onclose = (event) => {
      this.connected = false;
      console.log('[Terminal] WebSocket closed for session', this.sessionId, 'code:', event.code);

      if (this._reconnectAttempts < this._maxReconnectAttempts) {
        this._reconnectAttempts++;
        const delay = Math.min(2000 * this._reconnectAttempts, 10000);
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      } else {
        if (this.term) {
          this.term.write('\r\n\x1b[1;31m[Connection lost. Click terminal and press Enter to retry.]\x1b[0m\r\n');
        }
      }
    };

    this.ws.onerror = (err) => {
      console.error('[Terminal] WebSocket error for session', this.sessionId, err);
    };
  }

  dispose() {
    clearTimeout(this.reconnectTimer);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    if (this.term) this.term.dispose();
    this.term = null;
    this.ws = null;
  }
}

// Export for use by app.js
if (typeof window !== 'undefined') window.TerminalPane = TerminalPane;
