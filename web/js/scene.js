/* Kernel House scene layout engine.
 *
 * Draws the "kernel house" cross-section on a <canvas>.  Each room is a
 * rectangular region with a flat-color background.  Room coordinates are
 * stored as percentages of the canvas so the layout scales with viewport.
 */
'use strict';

var KScene = {
  canvas: null,
  ctx: null,
  overlay: null,    /* DOM overlay for speech bubbles / panels */
  strings: null,    /* loaded from strings.json */
  width: 0,
  height: 0,

  /* Room layout: dynamic -- subsystem rooms sized to fit penguins.
   * Heights adapt based on canvas size via adjustRoomLayout(). */
  rooms: {
    attic:   { x: 0,  y: 0,  w: 100, h: 12, color: '#2a2520', label: 'User Space',    active: true  },
    gate:    { x: 0,  y: 12, w: 100, h: 10, color: '#332e28', label: 'Syscall Gate',   active: true  },
    vfs:     { x: 0,  y: 22, w: 25,  h: 50, color: '#2d2822', label: 'VFS',            active: true  },
    process: { x: 25, y: 22, w: 25,  h: 50, color: '#2a2428', label: 'Process Mgmt',   active: true  },
    memory:  { x: 50, y: 22, w: 25,  h: 50, color: '#28282d', label: 'Memory Mgmt',    active: true  },
    network: { x: 75, y: 22, w: 25,  h: 50, color: '#2a2525', label: 'Network',        active: true  },
    basement:{ x: 0,  y: 72, w: 70,  h: 28, color: '#1e1a18', label: 'Block I/O',      active: false },
    fdvault: { x: 70, y: 72, w: 30,  h: 28, color: '#252020', label: 'FD Table',       active: true  }
  },

  /* Room glow intensities 0..1, driven by telemetry */
  glow: {},

  /* User space stats */
  userSpace: {
    syscallRate: 0,
    recentSyscalls: [],
    /* PID -> command name mapping (learned from execve events) */
    pidCmds: {},         /* pid -> 'ash' | 'cat' | 'ps' | ... */
    activePids: {},      /* pid -> last-seen timestamp */
    processNames: []     /* visible process names for display */
  },

  /* Track a PID's activity. Infer a human-readable label from syscall
   * patterns since the SSE payload doesn't include the binary name.
   * - execve: mark PID as "launching" (next syscalls reveal behavior)
   * - file I/O heavy: "reader" / "writer"
   * - scheduling: "worker"
   * - Default: classify by most-frequent syscall family */
  /* Activity labels: map syscall names to short human-readable actions.
   * We show WHAT each PID is doing, not a guessed command name --
   * guessing is unreliable (find and ls both do getdents64). */
  ACT_LABELS: {
    'wait4': 'shell', 'waitid': 'shell',
    'read': 'reading', 'pread64': 'reading', 'readv': 'reading',
    'write': 'writing', 'writev': 'writing', 'pwrite64': 'writing',
    'getdents64': 'scanning', 'getdents': 'scanning',
    'clone': 'forking', 'clone3': 'forking', 'fork': 'forking',
    'execve': 'exec', 'execveat': 'exec',
    'nanosleep': 'sleeping', 'clock_nanosleep': 'sleeping',
    'stat': 'stat', 'newfstatat': 'stat', 'fstat': 'stat', 'lstat': 'stat',
    'openat': 'opening', 'open': 'opening', 'close': 'closing',
    'poll': 'polling', 'epoll_wait': 'polling', 'ppoll': 'polling',
    'select': 'polling', 'pselect6': 'polling',
    'sendto': 'sending', 'recvfrom': 'receiving', 'connect': 'connecting',
    'socket': 'socket', 'mmap': 'mapping', 'brk': 'alloc',
    'ioctl': 'ioctl', 'fcntl': 'fcntl',
    'rt_sigaction': 'signal', 'rt_sigprocmask': 'signal'
  },

  trackPid: function(pid, syscallName) {
    if (!pid) return;
    var us = this.userSpace;
    us.activePids[pid] = Date.now();
    if (!us.pidCmds[pid]) us.pidCmds[pid] = { calls: {}, label: '', total: 0 };
    var info = us.pidCmds[pid];
    info.calls[syscallName] = (info.calls[syscallName] || 0) + 1;
    info.total++;

    /* Reset on execve */
    if (syscallName === 'execve' || syscallName === 'execveat') {
      info.label = 'exec';
      info.calls = {};
      info.total = 0;
      return;
    }

    /* Re-evaluate on every event (short-lived processes may only
     * generate 1-2 events at 1% sampling -- can't wait for 5) */
    var best = '', bestN = 0;
    for (var k in info.calls) {
      if (info.calls[k] > bestN) { bestN = info.calls[k]; best = k; }
    }
    info.label = this.ACT_LABELS[best] || best || '';
  },

  /* Update visible process list (expire old PIDs) */
  refreshProcessNames: function() {
    var cutoff = Date.now() - 5000; /* 5s window */
    var pids = this.userSpace.activePids;
    var cmds = this.userSpace.pidCmds;
    /* Aggregate: count PIDs per activity label */
    var counts = {};
    for (var pid in pids) {
      if (pids[pid] < cutoff) { delete pids[pid]; continue; }
      var info = cmds[pid];
      var label = (info && info.label) ? info.label : '';
      if (!label || label === 'signal' || label === 'alloc') continue; /* noise */
      counts[label] = (counts[label] || 0) + 1;
    }
    /* Format: "scanning x3", "reading x2", "shell" */
    var entries = [];
    for (var act in counts) {
      entries.push({ label: act, n: counts[act] });
    }
    entries.sort(function(a, b) { return b.n - a.n; });
    var names = [];
    for (var i = 0; i < Math.min(entries.length, 8); i++) {
      var e = entries[i];
      names.push(e.n > 1 ? e.label + ' x' + e.n : e.label);
    }
    this.userSpace.processNames = names;
  },

  /* Theme-aware colors (read from CSS custom properties) */
  theme: {
    bg: '#0d1117', fg: '#c9d1d9', fg2: '#8b949e',
    accent: '#58a6ff', border: '#30363d', bg2: '#161b22',
    ok: '#3fb950', warn: '#d29922', err: '#f85149'
  },

  readTheme: function() {
    var style = getComputedStyle(document.body);
    this.theme.bg = style.getPropertyValue('--bg').trim() || '#0d1117';
    this.theme.fg = style.getPropertyValue('--fg').trim() || '#c9d1d9';
    this.theme.fg2 = style.getPropertyValue('--fg2').trim() || '#8b949e';
    this.theme.accent = style.getPropertyValue('--accent').trim() || '#58a6ff';
    this.theme.border = style.getPropertyValue('--border').trim() || '#30363d';
    this.theme.bg2 = style.getPropertyValue('--bg2').trim() || '#161b22';
    this.theme.ok = style.getPropertyValue('--ok').trim() || '#3fb950';
    this.theme.warn = style.getPropertyValue('--warn').trim() || '#d29922';
    this.theme.err = style.getPropertyValue('--err').trim() || '#f85149';

    /* Lighten room colors for light theme */
    var isLight = document.body.classList.contains('light');
    KPenguin.isLight = isLight;
    var roomIds = Object.keys(this.rooms);
    for (var i = 0; i < roomIds.length; i++) {
      var r = this.rooms[roomIds[i]];
      /* Save the original dark-mode color on first access (before any lightening) */
      if (!r._darkColor) r._darkColor = r.color;
      r.color = isLight ? this.lightenColor(r._darkColor) : r._darkColor;
    }
    this.staticDirty = true;
  },

  lightenColor: function(hex) {
    /* Shift warm dark browns to light beige equivalents */
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, r + 170);
    g = Math.min(255, g + 160);
    b = Math.min(255, b + 150);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  },

  init: function(canvasId, overlayId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.overlay = document.getElementById(overlayId);

    /* Initialize glow map */
    var ids = Object.keys(this.rooms);
    for (var i = 0; i < ids.length; i++) {
      this.glow[ids[i]] = 0;
    }

    var self = this;
    this.readTheme();
    this.resize();
    window.addEventListener('resize', function() {
      self.resize();
      KBubble.updateLayout();
      KBubble.penguinMap = null; /* rebuild on next reposition */
    });

    /* Load strings */
    this.loadStrings();
  },

  loadStrings: function() {
    var self = this;
    fetch('/js/strings.json')
      .then(function(r) { return r.json(); })
      .then(function(data) { self.strings = data; self.staticDirty = true; })
      .catch(function() { self.strings = {}; });
  },

  str: function(path) {
    if (!this.strings) return null;
    var parts = path.split('.');
    var obj = this.strings;
    for (var i = 0; i < parts.length; i++) {
      obj = obj && obj[parts[i]];
    }
    return obj || null;
  },

  /* Cached room pixel rects (rebuilt on resize) */
  cachedRects: {},
  staticCanvas: null,  /* offscreen canvas for static room layer */
  staticDirty: true,   /* true = must redraw static layer */

  resize: function() {
    if (!this.canvas) return;
    var container = this.canvas.parentElement;
    var w = container.clientWidth;
    /* Rooms fill 100% of canvas. Subsystem rooms at 50% need ~130px.
     * 130/0.50 = 260. Use 0.4 aspect for compact layout. */
    var h = Math.max(260, Math.round(w * 0.4));
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.ctx.imageSmoothingEnabled = false;
    /* Rebuild cached rects */
    var ids = Object.keys(this.rooms);
    for (var i = 0; i < ids.length; i++) {
      var r = this.rooms[ids[i]];
      this.cachedRects[ids[i]] = {
        x: Math.round(r.x / 100 * w),
        y: Math.round(r.y / 100 * h),
        w: Math.round(r.w / 100 * w),
        h: Math.round(r.h / 100 * h)
      };
    }
    /* Rebuild static offscreen canvas */
    this.staticDirty = true;
    if (!this.staticCanvas) {
      this.staticCanvas = document.createElement('canvas');
    }
    this.staticCanvas.width = w;
    this.staticCanvas.height = h;
  },

  roomRect: function(id) {
    return this.cachedRects[id] || null;
  },

  invalidateStatic: function() {
    this.staticDirty = true;
  },

  /* Tinyoffice-style floor tile size (in canvas pixels) */
  TILE_SIZE: 20,

  renderStatic: function() {
    var sctx = this.staticCanvas.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    var w = this.width, h = this.height;

    /* Background adapts to theme */
    sctx.fillStyle = this.theme.bg;
    sctx.fillRect(0, 0, w, h);

    var ids = Object.keys(this.rooms);
    var fontSize = Math.max(10, Math.round(h * 0.022));
    sctx.font = fontSize + 'px monospace';
    var isLightTheme = KPenguin.isLight; /* use cached theme state */

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var room = this.rooms[id];
      var rect = this.cachedRects[id];

      /* Room fill */
      sctx.globalAlpha = room.active ? 1 : 0.4;
      sctx.fillStyle = room.color;
      sctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      /* Floor tile grid */
      if (room.active) {
        sctx.strokeStyle = isLightTheme ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
        sctx.lineWidth = 0.5;
        var tile = this.TILE_SIZE;
        for (var tx = rect.x + tile; tx < rect.x + rect.w; tx += tile) {
          sctx.beginPath();
          sctx.moveTo(tx, rect.y);
          sctx.lineTo(tx, rect.y + rect.h);
          sctx.stroke();
        }
        for (var ty = rect.y + tile; ty < rect.y + rect.h; ty += tile) {
          sctx.beginPath();
          sctx.moveTo(rect.x, ty);
          sctx.lineTo(rect.x + rect.w, ty);
          sctx.stroke();
        }
      }
      sctx.globalAlpha = 1;

      /* Wall-band top border */
      sctx.fillStyle = isLightTheme ? 'rgba(0,0,0,0.08)' : 'rgba(180,150,120,0.15)';
      sctx.fillRect(rect.x, rect.y, rect.w, 2);

      /* Room border */
      sctx.strokeStyle = isLightTheme ? 'rgba(0,0,0,0.12)' : 'rgba(120,100,80,0.3)';
      sctx.lineWidth = 1;
      sctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

      /* Label with text shadow */
      var label = this.str('rooms.' + id + '.name') || room.label;
      sctx.textAlign = 'center';
      sctx.textBaseline = 'top';
      /* Shadow text */
      sctx.fillStyle = isLightTheme ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
      sctx.fillText(label, rect.x + rect.w / 2 + 1, rect.y + 5);
      /* Foreground label */
      sctx.fillStyle = room.active ?
        (isLightTheme ? '#5a4a30' : '#d4a76a') :
        (isLightTheme ? 'rgba(80,70,60,0.5)' : 'rgba(120,100,80,0.5)');
      sctx.fillText(label, rect.x + rect.w / 2, rect.y + 4);

      if (!room.active) {
        sctx.font = (fontSize - 2) + 'px monospace';
        sctx.fillStyle = isLightTheme ? 'rgba(80,70,60,0.5)' : 'rgba(120,100,80,0.5)';
        sctx.fillText('(no data)', rect.x + rect.w / 2, rect.y + 4 + fontSize + 4);
        sctx.font = fontSize + 'px monospace';
      }
    }

    /* Disposition legend -- positioned inside the basement room */
    var basementRect = this.cachedRects.basement;
    if (basementRect) {
      KEducation.drawLegend(sctx, basementRect.x + 8, basementRect.y + 18);
    }

    this.staticDirty = false;
  },

  /* Draw the house scene. Static layer is cached; only glow + user space are live. */
  drawHouse: function() {
    var ctx = this.ctx;
    if (!ctx) return;

    /* Rebuild static layer if needed */
    if (this.staticDirty) this.renderStatic();

    /* Blit static layer */
    ctx.drawImage(this.staticCanvas, 0, 0);

    /* Live overlays: room glow (only for active, glowing rooms) */
    var ids = Object.keys(this.rooms);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var glowVal = this.glow[id] || 0;
      if (glowVal > 0.02 && this.rooms[id].active) {
        var rect = this.cachedRects[id];
        var glowColor = KPenguin.isLight ?
          'rgba(180, 140, 80, ' + (glowVal * 0.1) + ')' :
          'rgba(212, 167, 106, ' + (glowVal * 0.08) + ')';
        ctx.fillStyle = glowColor;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      }
    }

    /* FD Table detail gauge */
    this.drawFdDetail(ctx);

    /* User space stats in attic */
    this.drawUserSpace(ctx);
  },

  /* FD Table: show fd.used / fd.max as a mini bar gauge */
  fdStats: { used: 0, max: 1 },

  drawFdDetail: function(ctx) {
    var rect = this.roomRect('fdvault');
    if (!rect || this.fdStats.max <= 0) return;

    var used = this.fdStats.used;
    var max = this.fdStats.max;
    var pct = Math.max(0, Math.min(1, used / max));

    ctx.save();
    var fontSize = Math.max(9, Math.round(this.height * 0.016));
    ctx.font = fontSize + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    /* Usage text */
    ctx.fillStyle = this.theme.fg2;
    ctx.globalAlpha = 0.7;
    ctx.fillText(used + ' / ' + max, rect.x + rect.w / 2, rect.y + 20);

    /* Mini bar gauge */
    var barW = rect.w * 0.6;
    var barH = 6;
    var barX = rect.x + (rect.w - barW) / 2;
    var barY = rect.y + 20 + fontSize + 4;

    /* Background */
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barW, barH);

    /* Fill (color changes with usage) */
    var fillColor = pct < 0.5 ? this.theme.ok :
                    pct < 0.8 ? this.theme.warn : this.theme.err;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, barW * pct, barH);

    ctx.restore();
  },

  /* Draw user space info: process names + syscall rate */
  drawUserSpace: function(ctx) {
    var rect = this.roomRect('attic');
    if (!rect) return;
    var us = this.userSpace;
    this.refreshProcessNames();

    ctx.save();
    var fontSize = Math.max(9, Math.round(this.height * 0.018));

    /* Syscall rate (bottom-left of attic) */
    if (us.syscallRate > 0) {
      ctx.font = fontSize + 'px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = this.theme.fg2;
      ctx.globalAlpha = 0.5;
      var rateStr = us.syscallRate < 1000 ?
        Math.round(us.syscallRate) + '/s' :
        (us.syscallRate / 1000).toFixed(1) + 'k/s';
      ctx.fillText('syscalls: ' + rateStr, rect.x + 8, rect.y + rect.h - 4);
    }

    /* Active process names (right side of attic, like a task bar) */
    if (us.processNames.length > 0) {
      ctx.font = (fontSize - 1) + 'px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      var px = rect.x + rect.w - 8;
      var py = rect.y + rect.h - 4;
      for (var i = 0; i < us.processNames.length; i++) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = this.theme.fg2;
        ctx.fillText(us.processNames[i], px, py - i * (fontSize + 1));
      }
    }

    ctx.restore();
  },

  /* Hit-test: which room was clicked? Returns room id or null */
  hitTest: function(canvasX, canvasY) {
    var ids = Object.keys(this.rooms);
    for (var i = 0; i < ids.length; i++) {
      var rect = this.roomRect(ids[i]);
      if (canvasX >= rect.x && canvasX < rect.x + rect.w &&
          canvasY >= rect.y && canvasY < rect.y + rect.h) {
        return ids[i];
      }
    }
    return null;
  }
};
