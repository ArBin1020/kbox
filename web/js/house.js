/* Kernel House orchestrator.
 *
 * Manages the penguin roster (resident Tux characters + guest pool),
 * drives the animation loop via requestAnimationFrame, and provides
 * the demo sequence for Milestone 1.
 */
'use strict';

var KHouse = {
  penguins: [],       /* all penguin instances */
  guests: [],         /* guest penguin pool (subset of penguins) */
  residents: {},      /* room id -> penguin instance */
  crowdCount: 0,      /* overflow guest count for badge */
  running: false,
  lastTick: 0,
  GUEST_POOL_SIZE: 8,

  /* Room -> resident penguin config */
  RESIDENT_CONFIG: {
    gate:    { acc: 'hat',       facing: 0 },
    vfs:     { acc: 'folder',    facing: 0 },
    process: { acc: 'stopwatch', facing: 0 },
    memory:  { acc: 'memblock',  facing: 0 },
    network: { acc: 'envelope',  facing: 0 },
    fdvault: { acc: null,        facing: 0 }
  },

  demoRunning: false,
  demoVersion: 0,
  demoTimers: [],
  boundLoop: null,

  init: function() {
    KPenguin.init();
    this.boundLoop = this.loop.bind(this);
    this.bindDemo();
    /* Defer penguin creation until canvas has real dimensions.
     * Tab is hidden at boot, so clientWidth is 0.  We create
     * penguins on first tab show (resize triggers reposition). */
    this.penguinsCreated = false;
  },

  ensurePenguins: function() {
    if (this.penguinsCreated || KScene.width === 0) return;
    this.createResidents();
    this.createGuestPool();
    this.penguinsCreated = true;
    KEducation.init();
    this.bindHover();
    this.start();
  },

  createResidents: function() {
    var ids = Object.keys(this.RESIDENT_CONFIG);
    for (var i = 0; i < ids.length; i++) {
      var roomId = ids[i];
      var cfg = this.RESIDENT_CONFIG[roomId];
      var center = this.roomCenter(roomId);
      var p = KPenguin.create({
        id: 'res-' + roomId,
        x: center.x,
        y: center.y,
        facing: cfg.facing,
        acc: cfg.acc,
        room: roomId,
        speed: 1.5
      });
      this.penguins.push(p);
      this.residents[roomId] = p;
    }
  },

  createGuestPool: function() {
    for (var i = 0; i < this.GUEST_POOL_SIZE; i++) {
      var center = this.roomCenter('attic');
      var p = KPenguin.create({
        id: 'guest-' + i,
        x: center.x + (i - this.GUEST_POOL_SIZE / 2) * 20,
        y: center.y,
        isGuest: true,
        visible: false,
        room: 'attic',
        speed: 2.5
      });
      this.penguins.push(p);
      this.guests.push(p);
    }
  },

  /* Room center with optional index offset to spread multiple penguins.
   * idx/total spreads penguins horizontally within the room. */
  roomCenter: function(roomId, idx, total) {
    var r = KScene.rooms[roomId];
    if (!r) return { x: KScene.width / 2, y: KScene.height / 2 };
    var cx = (r.x + r.w / 2) / 100 * KScene.width;
    var cy = (r.y + r.h * 0.75) / 100 * KScene.height;
    /* Gate room: offset the resident penguin to the right so it
     * doesn't cover the centered "Syscall Gate" label text. */
    if (roomId === 'gate') {
      cx = (r.x + r.w * 0.35) / 100 * KScene.width;
    }
    /* Horizontal spread when multiple penguins in same room */
    if (total && total > 1) {
      var roomW = r.w / 100 * KScene.width;
      var spacing = Math.min(50, roomW * 0.6 / total);
      cx += (idx - (total - 1) / 2) * spacing;
    }
    return { x: cx, y: cy };
  },

  /* Reposition all idle residents to their room centers (after resize) */
  repositionAll: function() {
    var ids = Object.keys(this.residents);
    for (var i = 0; i < ids.length; i++) {
      var p = this.residents[ids[i]];
      if (p.state === 'idle') {
        var c = this.roomCenter(ids[i]);
        p.x = c.x;
        p.y = c.y;
      }
    }
  },

  /* Get an available guest penguin from the pool, or null */
  acquireGuest: function() {
    for (var i = 0; i < this.guests.length; i++) {
      if (!this.guests[i].visible) {
        this.guests[i].visible = true;
        this.guests[i].gen++;
        return this.guests[i];
      }
    }
    this.crowdCount++;
    return null;
  },

  /* Reset a guest penguin's narrative state (tint, trail, labels).
   * Called before releasing or when cleaning up after demo/offline. */
  resetGuest: function(p) {
    p.tint = null;
    p.dispName = '';
    p.trail = [];
    p.label = '';
    p.pid = 0;
    p.cmd = '';
    p.onArrive = null;
  },

  releaseGuest: function(p) {
    p.visible = false;
    p.room = 'attic';
    KPenguin.setState(p, 'idle');
    if (this.crowdCount > 0) this.crowdCount--;
  },

  start: function() {
    if (this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    requestAnimationFrame(this.boundLoop);
  },

  stop: function() {
    this.running = false;
  },

  loop: function(now) {
    if (!this.running) return;
    requestAnimationFrame(this.boundLoop);

    /* When paused AND not running a demo, freeze animation.
     * Demo always runs regardless of pause state. */
    if (!KState.paused || this.demoRunning) {
      while (now - this.lastTick >= KPenguin.TICK_MS) {
        this.lastTick += KPenguin.TICK_MS;
        KPenguin.tick();
        KIntent.drain(KPenguin.clock);
        for (var i = 0; i < this.penguins.length; i++) {
          KPenguin.update(this.penguins[i]);
        }
        KBubble.cleanup();
      }
    } else {
      this.lastTick = now;
    }

    this.render();
  },

  render: function() {
    if (!KScene.ctx) return;
    KScene.drawHouse();

    /* Sort by Y for depth ordering */
    var visible = [];
    for (var i = 0; i < this.penguins.length; i++) {
      if (this.penguins[i].visible) visible.push(this.penguins[i]);
    }
    visible.sort(function(a, b) { return a.y - b.y; });

    for (var j = 0; j < visible.length; j++) {
      KPenguin.draw(KScene.ctx, visible[j]);
    }

    /* Educational overlays: flow arrows (only when rooms are active) */
    KEducation.drawActiveFlows(KScene.ctx);

    /* Crowd badge */
    if (this.crowdCount > 0) {
      this.drawCrowdBadge();
    }

    /* Reposition bubbles */
    KBubble.reposition(this.penguins);
  },

  drawCrowdBadge: function() {
    var center = this.roomCenter('attic');
    var ctx = KScene.ctx;
    var text = '+' + this.crowdCount;
    ctx.save();
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = KScene.theme.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, center.x + 60, center.y - 20);
    ctx.restore();
  },

  /* --- Offline detection --- */

  offlineEl: null,

  showOffline: function() {
    /* Hide all penguins and null their walk callbacks to prevent
     * stranded onArrive closures (update skips invisible penguins). */
    for (var i = 0; i < this.penguins.length; i++) {
      var p = this.penguins[i];
      p.visible = false;
      p.busyLevel = 0;
      this.resetGuest(p);
      KPenguin.setState(p, 'idle');
    }
    /* Clear bubbles, intent queue, and crowd counter */
    KBubble.clear();
    KIntent.queue = [];
    KIntent.activeWalks = 0;
    this.crowdCount = 0;
    /* Cancel any demo */
    if (this.demoRunning) {
      this.cancelDemo();
      this.updateDemoUI(false);
    }

    /* Draw one last frame showing empty rooms */
    this.render();
    /* Stop the animation loop */
    this.stop();

    /* Show offline overlay */
    if (!KScene.overlay) return;
    if (!this.offlineEl) {
      this.offlineEl = document.createElement('div');
      this.offlineEl.className = 'kh-offline';
      KScene.overlay.appendChild(this.offlineEl);
    }
    this.offlineEl.innerHTML =
      '<b>kbox offline</b><br>' +
      'The guest process has exited.<br>' +
      '<span style="color:#8b949e;font-size:0.85em">Waiting for reconnection\u2026</span>';
    this.offlineEl.style.display = 'block';
  },

  hideOffline: function() {
    if (this.offlineEl) this.offlineEl.style.display = 'none';
    if (!this.running && this.penguinsCreated) {
      /* Re-show resident penguins at their home positions */
      var ids = Object.keys(this.residents);
      for (var i = 0; i < ids.length; i++) {
        var p = this.residents[ids[i]];
        var c = this.roomCenter(ids[i]);
        p.x = c.x;
        p.y = c.y;
        p.visible = true;
        p.busyLevel = 0;
        p.label = '';
        KPenguin.setState(p, 'idle');
      }
      /* Guests stay hidden until new events arrive */
      this.start();
    }
  },

  /* --- Hover tooltip --- */

  tooltipEl: null,

  bindHover: function() {
    if (!KScene.canvas) return;
    var self = this;
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'kh-tooltip';
    this.tooltipEl.style.display = 'none';
    if (KScene.overlay) KScene.overlay.appendChild(this.tooltipEl);

    KScene.canvas.addEventListener('mousemove', function(e) {
      var rect = KScene.canvas.getBoundingClientRect();
      var sx = KScene.width / rect.width;
      var sy = KScene.height / rect.height;
      var cx = (e.clientX - rect.left) * sx;
      var cy = (e.clientY - rect.top) * sy;

      var found = null;
      for (var i = 0; i < self.penguins.length; i++) {
        if (KPenguin.hitTest(self.penguins[i], cx, cy)) {
          found = self.penguins[i];
          break;
        }
      }

      if (found) {
        self.showTooltip(found, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        self.hideTooltip();
      }
    });

    KScene.canvas.addEventListener('mouseleave', function() {
      self.hideTooltip();
    });
  },

  showTooltip: function(p, px, py) {
    if (!this.tooltipEl) return;
    var lines = [];

    if (p.isGuest) {
      lines.push('Guest Process');
      if (p.pid) lines.push('PID: ' + p.pid);
      if (p.cmd) lines.push('Command: ' + p.cmd);
      if (p.label) lines.push('Syscall: ' + p.label);
      if (p.dispName) {
        lines.push('Dispatch: ' + p.dispName);
      }
      lines.push('Room: ' + (KScene.str('rooms.' + p.room + '.name') || p.room));
    } else {
      /* Map room id to strings.json character key */
      var charKeys = {
        gate: 'dispatcher', vfs: 'file', process: 'sched',
        memory: 'memory', network: 'net', fdvault: 'storage'
      };
      var charKey = charKeys[p.room] || p.room;
      var role = KScene.str('characters.' + charKey) || p.id;
      lines.push(role);
      lines.push('Room: ' + (KScene.str('rooms.' + p.room + '.name') || p.room));
      if (p.label) lines.push('Last: ' + p.label);
      if (p.busyLevel > 0.05) lines.push('Load: ' + Math.round(p.busyLevel * 100) + '%');
      lines.push('State: ' + p.state);
    }

    this.tooltipEl.innerHTML = lines.join('<br>');
    this.tooltipEl.style.display = 'block';
    this.tooltipEl.style.left = (px + 12) + 'px';
    this.tooltipEl.style.top = (py - 10) + 'px';
  },

  hideTooltip: function() {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  },

  /* --- Demo sequence --- */

  demoBtn: null,
  demoBannerEl: null,

  bindDemo: function() {
    this.demoBtn = document.getElementById('btn-demo');
    if (this.demoBtn) {
      var self = this;
      this.demoBtn.addEventListener('click', function() {
        if (self.demoRunning) {
          self.stopDemo();
        } else {
          self.runDemo();
        }
      });
    }
  },

  updateDemoUI: function(running) {
    /* Button text */
    if (this.demoBtn) {
      this.demoBtn.textContent = running ? 'Stop Demo' : 'Demo';
      this.demoBtn.classList.toggle('active', running);
    }
    /* Canvas banner */
    if (running) {
      if (!this.demoBannerEl && KScene.overlay) {
        this.demoBannerEl = document.createElement('div');
        this.demoBannerEl.className = 'kh-demo-banner';
        KScene.overlay.appendChild(this.demoBannerEl);
      }
      if (this.demoBannerEl) {
        this.demoBannerEl.textContent = 'DEMO — cat /etc/hostname';
        this.demoBannerEl.style.display = 'block';
      }
    } else {
      if (this.demoBannerEl) this.demoBannerEl.style.display = 'none';
    }
  },

  /* Cancel a running demo, clean up guests, restore live state */
  cancelDemo: function() {
    for (var i = 0; i < this.demoTimers.length; i++) {
      clearTimeout(this.demoTimers[i]);
    }
    this.demoTimers = [];
    this.demoRunning = false;
    this.demoVersion++;
  },

  stopDemo: function() {
    this.cancelDemo();
    /* Release all demo guests */
    for (var i = 0; i < this.guests.length; i++) {
      if (this.guests[i].visible) {
        this.resetGuest(this.guests[i]);
        this.releaseGuest(this.guests[i]);
      }
    }
    /* Reset residents */
    var ids = Object.keys(this.residents);
    for (var j = 0; j < ids.length; j++) {
      this.residents[ids[j]].label = '';
      this.residents[ids[j]].busyLevel = 0;
      KPenguin.setState(this.residents[ids[j]], 'idle');
    }
    KBubble.clear();
    this.updateDemoUI(false);
  },

  demoDelay: function(fn, ms) {
    var ver = this.demoVersion;
    var self = this;
    this.demoTimers.push(setTimeout(function() {
      if (self.demoVersion === ver) fn();
    }, ms));
  },

  runDemo: function() {
    var self = this;

    /* Guard re-entry: cancel previous demo */
    if (this.demoRunning) this.cancelDemo();
    this.demoRunning = true;
    var ver = this.demoVersion;
    this.updateDemoUI(true);
    this.start();

    /* Reset: release all visible guests, clear bubbles and crowd counter */
    for (var g = 0; g < this.guests.length; g++) {
      if (this.guests[g].visible) {
        this.resetGuest(this.guests[g]);
        this.releaseGuest(this.guests[g]);
      }
    }
    this.crowdCount = 0;
    KBubble.clear();
    KIntent.queue = [];
    KIntent.activeWalks = 0;

    /* Reset resident positions and busyness */
    var ids = Object.keys(this.residents);
    for (var i = 0; i < ids.length; i++) {
      var c = this.roomCenter(ids[i]);
      var p = this.residents[ids[i]];
      p.x = c.x;
      p.y = c.y;
      p.busyLevel = 0;
      p.label = '';
      KPenguin.setState(p, 'idle');
    }

    /* --- Demo narrative: "A shell runs `cat /etc/hostname`" ---
     * Shows the full lifecycle: openat (LKL) -> read (LKL) -> write (CONTINUE)
     * plus a concurrent getpid (CONTINUE) and a rejected accept4 (ENOSYS). */

    var attic = this.roomCenter('attic');
    var gate = this.roomCenter('gate');

    /* Scene 1: openat -> VFS (LKL emulated, blue trail) */
    var g1 = this.acquireGuest();
    if (!g1) { this.demoRunning = false; this.updateDemoUI(false); return; }
    g1.x = attic.x - 30;
    g1.y = attic.y;
    g1.label = 'openat';
    g1.tint = null;
    g1.trail = [];
    KBubble.show(g1.id, 'openat', 2500);

    this.demoDelay(function() {
      /* Walk to gate */
      KPenguin.walkTo(g1, gate.x, gate.y, function() {
        if (self.demoVersion !== ver) return;
        g1.room = 'gate';
        /* Dispatcher routes to VFS */
        var disp = self.residents.gate;
        if (disp) {
          disp.facing = 2; disp.flipX = false;
          KPenguin.setState(disp, 'type');
          disp.busyLevel = 0.6;
          KBubble.show(disp.id, '\u2192 VFS', 2000);
        }
        g1.tint = KIntent.DISP_TINT['return']; /* blue: LKL */
        g1.trail = [];
        /* Walk to VFS */
        var vfs = self.roomCenter('vfs');
        KPenguin.walkTo(g1, vfs.x, vfs.y, function() {
          if (self.demoVersion !== ver) return;
          g1.room = 'vfs';
          g1.label = 'LKL';
          var res = self.residents.vfs;
          if (res) {
            KPenguin.setState(res, 'type');
            res.busyLevel = 0.7;
            res.label = 'openat';
            KBubble.show(res.id, 'openat 23.5\u00b5s', 2500);
          }
          /* Fade out after pause */
          self.demoDelay(function() {
            self.resetGuest(g1);
            self.releaseGuest(g1);
          }, 1800);
        });
      });
    }, 400);

    /* Scene 2 (t=1.5s): getpid -> Process (CONTINUE, green trail) */
    this.demoDelay(function() {
      var g2 = self.acquireGuest();
      if (!g2) return;
      g2.x = attic.x + 30;
      g2.y = attic.y;
      g2.label = 'getpid';
      g2.trail = [];
      KBubble.show(g2.id, 'getpid', 2000);
      self.demoDelay(function() {
        KPenguin.walkTo(g2, gate.x + 20, gate.y, function() {
          if (self.demoVersion !== ver) return;
          g2.room = 'gate';
          g2.tint = KIntent.DISP_TINT['continue']; /* green: CONTINUE */
          g2.trail = [];
          var proc = self.roomCenter('process');
          KPenguin.walkTo(g2, proc.x, proc.y, function() {
            if (self.demoVersion !== ver) return;
            g2.room = 'process';
            g2.label = 'HOST';
            var res = self.residents.process;
            if (res) {
              KPenguin.setState(res, 'type');
              res.busyLevel = 0.4;
              KBubble.show(res.id, 'getpid 0.3\u00b5s', 2000);
            }
            self.demoDelay(function() {
              self.resetGuest(g2);
              self.releaseGuest(g2);
            }, 1200);
          });
        });
      }, 300);
    }, 1500);

    /* Scene 3 (t=3s): accept4 -> Network (ENOSYS, orange trail) */
    this.demoDelay(function() {
      var g3 = self.acquireGuest();
      if (!g3) return;
      g3.x = attic.x;
      g3.y = attic.y;
      g3.label = 'accept4';
      g3.trail = [];
      KBubble.show(g3.id, 'accept4', 2000);
      self.demoDelay(function() {
        KPenguin.walkTo(g3, gate.x - 10, gate.y, function() {
          if (self.demoVersion !== ver) return;
          g3.room = 'gate';
          var disp = self.residents.gate;
          if (disp) {
            disp.facing = 2; disp.flipX = true;
            KPenguin.setState(disp, 'type');
            KBubble.show(disp.id, '\u2192 Network', 2000);
          }
          g3.tint = KIntent.DISP_TINT['enosys']; /* orange: ENOSYS */
          g3.trail = [];
          var net = self.roomCenter('network');
          KPenguin.walkTo(g3, net.x, net.y, function() {
            if (self.demoVersion !== ver) return;
            g3.room = 'network';
            g3.label = 'ENOSYS';
            var res = self.residents.network;
            if (res) {
              KPenguin.setState(res, 'error');
              res.busyLevel = 0.5;
              KBubble.show(res.id, 'ENOSYS: accept4', 2500);
            }
            self.demoDelay(function() {
              self.resetGuest(g3);
              self.releaseGuest(g3);
            }, 1500);
          });
        });
      }, 300);
    }, 3000);

    /* Scene 4 (t=4s): mmap -> Memory (LKL, blue trail) */
    this.demoDelay(function() {
      var g4 = self.acquireGuest();
      if (!g4) return;
      g4.x = attic.x + 15;
      g4.y = attic.y;
      g4.label = 'mmap';
      g4.trail = [];
      KPenguin.walkTo(g4, gate.x, gate.y, function() {
        if (self.demoVersion !== ver) return;
        g4.room = 'gate';
        g4.tint = KIntent.DISP_TINT['return'];
        g4.trail = [];
        var mem = self.roomCenter('memory');
        KPenguin.walkTo(g4, mem.x, mem.y, function() {
          if (self.demoVersion !== ver) return;
          g4.room = 'memory';
          g4.label = 'LKL';
          var res = self.residents.memory;
          if (res) {
            KPenguin.setState(res, 'type');
            res.busyLevel = 0.6;
            KBubble.show(res.id, 'mmap 18.7\u00b5s', 2000);
          }
          self.demoDelay(function() {
            if (res) KPenguin.setState(res, 'celebrate');
            self.demoDelay(function() {
              self.resetGuest(g4);
              self.releaseGuest(g4);
            }, 1000);
          }, 1200);
        });
      });
    }, 4000);

    /* Auto-clear demo: release remaining guests, reset state, resume live */
    this.demoDelay(function() {
      /* Release any demo guests still visible */
      for (var gi = 0; gi < self.guests.length; gi++) {
        if (self.guests[gi].visible) {
          self.resetGuest(self.guests[gi]);
          self.releaseGuest(self.guests[gi]);
        }
      }
      /* Reset resident labels and state */
      var rids = Object.keys(self.residents);
      for (var j = 0; j < rids.length; j++) {
        self.residents[rids[j]].label = '';
        self.residents[rids[j]].busyLevel = 0;
        KPenguin.setState(self.residents[rids[j]], 'idle');
      }
      KBubble.clear();
      self.demoRunning = false;
      self.demoTimers = [];
      self.updateDemoUI(false);
    }, 8000);
  }
};
