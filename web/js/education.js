/* Educational overlays for the Kernel House.
 *
 * - Clickable rooms: info panels from strings.json
 * - Syscall flow arrows: animated dotted lines on canvas
 * - Disposition legend: color-coded key
 * - Narrator mode: opt-in text overlay for interesting transitions
 */
'use strict';

var KEducation = {
  activePanel: null,    /* currently open room panel element */
  narratorEnabled: false,
  narratorCooldown: 0,  /* timestamp of next allowed narrator message */
  narratorFadeTimer: 0, /* pending fade setTimeout id */
  narratorHideTimer: 0, /* pending hide setTimeout id */
  NARRATOR_COOLDOWN_MS: 5000,
  seenFamilies: {},     /* track first-seen syscall families */
  lastErrorCount: 0,    /* for error spike detection */

  init: function() {
    this.bindRoomClicks();
    this.bindNarrator();
  },

  /* --- Room info panels --- */

  bindRoomClicks: function() {
    if (!KScene.canvas) return;
    var self = this;
    KScene.canvas.addEventListener('click', function(e) {
      var rect = KScene.canvas.getBoundingClientRect();
      var scaleX = KScene.width / rect.width;
      var scaleY = KScene.height / rect.height;
      var cx = (e.clientX - rect.left) * scaleX;
      var cy = (e.clientY - rect.top) * scaleY;
      var roomId = KScene.hitTest(cx, cy);
      if (roomId) {
        self.showRoomPanel(roomId, e.clientX, e.clientY);
      } else {
        self.closePanel();
      }
    });
  },

  showRoomPanel: function(roomId, screenX, screenY) {
    this.closePanel();
    if (!KScene.overlay) return;

    var name = KScene.str('rooms.' + roomId + '.name') || roomId;
    var desc = KScene.str('rooms.' + roomId + '.desc') || '';
    var src = KScene.str('rooms.' + roomId + '.source') || '';

    var panel = document.createElement('div');
    panel.className = 'room-panel';

    var h3 = document.createElement('h3');
    h3.textContent = name;
    panel.appendChild(h3);

    if (desc) {
      var p = document.createElement('p');
      p.textContent = desc;
      panel.appendChild(p);
    }

    if (src) {
      var srcEl = document.createElement('div');
      srcEl.className = 'src';
      srcEl.textContent = src;
      panel.appendChild(srcEl);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '\u00d7';
    var self = this;
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.closePanel();
    });
    panel.appendChild(closeBtn);

    /* Position near click, clamped to overlay bounds */
    var overlayRect = KScene.overlay.getBoundingClientRect();
    var left = screenX - overlayRect.left + 10;
    var top = screenY - overlayRect.top - 20;
    left = Math.max(0, Math.min(left, overlayRect.width - 310));
    top = Math.max(0, Math.min(top, overlayRect.height - 200));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.pointerEvents = 'auto';

    KScene.overlay.appendChild(panel);
    this.activePanel = panel;
  },

  closePanel: function() {
    if (this.activePanel && this.activePanel.parentNode) {
      this.activePanel.parentNode.removeChild(this.activePanel);
    }
    this.activePanel = null;
  },

  /* --- Disposition legend (drawn on canvas) --- */

  drawLegend: function(ctx, x, y) {
    var items = [
      { color: KScene.theme.ok, label: KScene.str('legend.continue') || 'CONTINUE (host)' },
      { color: KScene.theme.accent, label: KScene.str('legend.return') || 'LKL emulated' },
      { color: KScene.theme.warn, label: KScene.str('legend.enosys') || 'ENOSYS (rejected)' },
      { color: KScene.theme.err, label: KScene.str('legend.error') || 'Error' }
    ];
    var textColor = KScene.theme.fg2 || '#8b949e';
    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < items.length; i++) {
      var iy = y + i * 14;
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = items[i].color;
      ctx.fillRect(x, iy - 4, 8, 8);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = textColor;
      ctx.fillText(items[i].label, x + 12, iy);
    }
    ctx.restore();
  },

  /* --- Syscall flow arrows (canvas) --- */

  drawFlowArrow: function(ctx, fromRoom, toRoom, color) {
    var from = KScene.roomRect(fromRoom);
    var to = KScene.roomRect(toRoom);
    if (!from || !to) return;

    /* Vertical drop from gate into the target room (inset both ends
     * to avoid zero-length lines when gate.bottom == room.top) */
    var tx = to.x + to.w / 2;
    var fy = from.y + from.h - 4;
    var ty = to.y + 10;

    ctx.save();
    ctx.strokeStyle = color || '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -((KPenguin.clock * 2) % 8);

    ctx.beginPath();
    ctx.moveTo(tx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    /* Small arrowhead */
    ctx.setLineDash([]);
    ctx.fillStyle = color || '#58a6ff';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 3, ty - 5);
    ctx.lineTo(tx + 3, ty - 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  /* Draw active flow arrows based on recent intent activity */
  drawActiveFlows: function(ctx) {
    /* Show flow from gate to rooms that have recent glow */
    /* Only draw arrows to rooms directly below gate (y=24%).
     * fdvault is at y=64%, below the subsystem band -- skip it
     * to avoid a tall vertical line cutting through other rooms. */
    var rooms = ['vfs', 'process', 'memory', 'network'];
    var t = KScene.theme;
    var colors = {
      vfs: t.ok, process: t.accent, memory: t.accent,
      network: t.warn
    };
    for (var i = 0; i < rooms.length; i++) {
      var glow = KScene.glow[rooms[i]] || 0;
      if (glow > 0.1) {
        ctx.globalAlpha = Math.min(1, glow * 1.5);
        this.drawFlowArrow(ctx, 'gate', rooms[i], colors[rooms[i]]);
        ctx.globalAlpha = 1;
      }
    }
  },

  /* --- Narrator mode --- */

  bindNarrator: function() {
    /* Narrator toggle button in kh-controls */
    var controls = document.querySelector('.kh-controls');
    if (!controls) return;
    var btn = document.createElement('button');
    btn.id = 'btn-narrator';
    btn.textContent = 'Narrator';
    btn.title = 'Toggle narrator mode';
    var self = this;
    btn.addEventListener('click', function() {
      self.narratorEnabled = !self.narratorEnabled;
      btn.classList.toggle('active', self.narratorEnabled);
      if (self.narratorEnabled) {
        self.showNarrator(KScene.str('narrator.welcome') || 'Welcome to the Kernel House.');
      }
    });
    controls.insertBefore(btn, controls.firstChild);
  },

  showNarrator: function(text) {
    if (!this.narratorEnabled) return;
    var now = Date.now();
    if (now < this.narratorCooldown) return;
    this.narratorCooldown = now + this.NARRATOR_COOLDOWN_MS;

    /* Cancel any pending fade/hide from a previous message */
    clearTimeout(this.narratorFadeTimer);
    clearTimeout(this.narratorHideTimer);

    /* Reuse or create narrator overlay */
    var el = document.getElementById('kh-narrator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kh-narrator';
      el.className = 'narrator-bar';
      if (KScene.overlay) KScene.overlay.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    el.style.opacity = '1';

    /* Auto-fade after 4s */
    var self = this;
    this.narratorFadeTimer = setTimeout(function() {
      el.style.opacity = '0';
      self.narratorHideTimer = setTimeout(function() {
        el.style.display = 'none';
      }, 500);
    }, 4000);
  },

  /* Called each tick to detect interesting transitions */
  checkNarration: function(evt) {
    if (!this.narratorEnabled) return;

    /* First syscall of a new family */
    var room = KTelemetry.classifyRoom(evt);
    if (!this.seenFamilies[room]) {
      this.seenFamilies[room] = true;
      var roomName = KScene.str('rooms.' + room + '.name') || room;
      var tmpl = KScene.str('narrator.firstFamily') || 'First {family} syscall observed this session';
      this.showNarrator(tmpl.replace('{family}', evt.name || 'syscall') + ' \u2192 ' + roomName);
    }
  },

  /* Check for error spikes from snapshot data */
  checkErrorSpike: function(snap) {
    if (!this.narratorEnabled || !snap || !snap.dispatch) return;
    var enosys = snap.dispatch.enosys || 0;
    if (enosys > this.lastErrorCount + 5) {
      var tmpl = KScene.str('narrator.errorSpike') || 'Error spike detected in {room}';
      this.showNarrator(tmpl.replace('{room}', (enosys - this.lastErrorCount) + ' ENOSYS'));
    }
    this.lastErrorCount = enosys;
  }
};
