/* Animation intent queue.
 *
 * Decouples telemetry event arrival (SSE callbacks, snapshot deltas)
 * from the render loop.  Producers push "intents" into a FIFO queue;
 * the fixed-timestep consumer drains them at a capped rate inside the
 * requestAnimationFrame loop.
 *
 * Intent types:
 *   { type: 'move',   penguin: id, room: roomId, onArrive: fn }
 *   { type: 'action', penguin: id, state: 'type'|'celebrate'|'error' }
 *   { type: 'bubble', penguin: id, text: string, ttl: ms }
 *   { type: 'glow',   room: roomId, level: 0..1 }
 *   { type: 'guest',  room: roomId, syscall: string, disp: string, latNs: number }
 *
 * Subsystem-weighted selection: when the queue has more entries than
 * can be processed per tick, prefer intents targeting rooms not recently
 * animated (round-robin fairness).
 */
'use strict';

var KIntent = {
  queue: [],
  MAX_QUEUE: 128,
  MAX_PER_TICK: 3,          /* max intents consumed per animation tick */
  MAX_CONCURRENT_WALKS: 4,  /* max simultaneous penguin walks */
  activeWalks: 0,

  /* Track last-animated room for weighted selection */
  lastAnimatedRoom: {},     /* roomId -> tick number */

  push: function(intent) {
    if (this.queue.length >= this.MAX_QUEUE) {
      /* Drop oldest non-glow intent; if all are glow, drop oldest glow */
      var victim = -1;
      for (var i = 0; i < this.queue.length; i++) {
        if (this.queue[i].type !== 'glow') { victim = i; break; }
      }
      if (victim === -1) victim = 0;
      this.queue.splice(victim, 1);
    }
    this.queue.push(intent);
  },

  /* Consume up to MAX_PER_TICK intents.  Called once per animation tick. */
  drain: function(tick) {
    if (this.queue.length === 0) return;

    /* Partition: glow intents are instant (always process all) */
    var glows = [];
    var pending = [];
    for (var i = 0; i < this.queue.length; i++) {
      if (this.queue[i].type === 'glow') {
        glows.push(this.queue[i]);
      } else {
        pending.push(this.queue[i]);
      }
    }

    /* Apply all glow intents immediately */
    for (var g = 0; g < glows.length; g++) {
      this.execGlow(glows[g]);
    }

    /* Room-fair FIFO: pick the next intent from the room least recently
     * animated, but preserve FIFO order within each room.  This prevents
     * a flood of VFS events from starving other rooms while keeping
     * causal ordering (move before action/bubble) intact per room. */
    var consumed = 0;
    var remaining = [];
    var skippedRooms = {}; /* rooms that hit walk cap this tick */

    while (consumed < this.MAX_PER_TICK && pending.length > 0) {
      /* Find the pending intent whose room was least recently animated */
      var bestIdx = -1;
      var bestTick = Infinity;
      for (var j = 0; j < pending.length; j++) {
        var room = pending[j].room || '';
        if (skippedRooms[room]) continue;
        var lastTick = this.lastAnimatedRoom[room] || 0;
        if (lastTick < bestTick) {
          bestTick = lastTick;
          bestIdx = j;
        }
      }
      if (bestIdx === -1) break; /* all remaining rooms are blocked */

      var intent = pending[bestIdx];

      /* Check walk concurrency cap */
      if ((intent.type === 'move' || intent.type === 'guest') &&
          this.activeWalks >= this.MAX_CONCURRENT_WALKS) {
        skippedRooms[intent.room || ''] = true;
        continue; /* retry with next best room */
      }

      pending.splice(bestIdx, 1);
      this.exec(intent, tick);
      consumed++;
    }

    this.queue = pending;
  },

  exec: function(intent, tick) {
    var room = intent.room || '';
    if (room) this.lastAnimatedRoom[room] = tick;

    switch (intent.type) {
    case 'move':
      this.execMove(intent);
      break;
    case 'action':
      this.execAction(intent);
      break;
    case 'bubble':
      this.execBubble(intent);
      break;
    case 'guest':
      this.execGuest(intent, tick);
      break;
    }
  },

  execGlow: function(intent) {
    if (KScene.glow.hasOwnProperty(intent.room)) {
      KScene.glow[intent.room] = intent.level;
    }
  },

  /* Deduplicate glow: update existing glow intent for same room instead of pushing */
  pushGlow: function(room, level) {
    for (var i = 0; i < this.queue.length; i++) {
      if (this.queue[i].type === 'glow' && this.queue[i].room === room) {
        this.queue[i].level = level;
        return;
      }
    }
    this.push({ type: 'glow', room: room, level: level });
  },

  decrementWalks: function() {
    this.activeWalks = Math.max(0, this.activeWalks - 1);
  },

  execMove: function(intent) {
    var p = this.findPenguin(intent.penguin);
    if (!p) return;
    var center = KHouse.roomCenter(intent.room);
    /* Slight random offset to avoid stacking */
    var ox = (Math.random() - 0.5) * 20;
    this.activeWalks++;
    var self = this;
    KPenguin.walkTo(p, center.x + ox, center.y, function() {
      self.decrementWalks();
      p.room = intent.room;
      if (intent.onArrive) intent.onArrive(p);
    });
  },

  execAction: function(intent) {
    var p = this.findPenguin(intent.penguin);
    if (!p) return;
    KPenguin.setState(p, intent.state);
  },

  execBubble: function(intent) {
    KBubble.show(intent.penguin, intent.text, intent.ttl || 3000);
  },

  /* Disposition -> tint color */
  DISP_TINT: {
    'continue': '#3fb950',   /* green: host kernel handles */
    'return':   '#58a6ff',   /* blue: LKL emulated */
    'enosys':   '#d29922'    /* orange: rejected */
  },

  fmtLat: function(ns) {
    if (ns <= 0) return '';
    if (ns < 1000) return ns + 'ns';
    if (ns < 1000000) return (ns / 1000).toFixed(1) + '\u00b5s';
    return (ns / 1000000).toFixed(1) + 'ms';
  },

  /* Guest syscall narrative lifecycle:
   *   1. Appear in attic with syscall label
   *   2. Walk to gate (dispatcher routing stop)
   *   3. Dispatcher faces target room, shows routing info
   *   4. Guest gets disposition tint, walks gate -> target room (trail visible)
   *   5. Resident shows sustained busyness
   *   6. Guest fades out in-place (no noisy return walk) */
  execGuest: function(intent, tick) {
    var guest = KHouse.acquireGuest();
    if (!guest) return;

    var attic = KHouse.roomCenter('attic');
    var gate = KHouse.roomCenter('gate');
    var targetRoom = intent.room || 'gate';
    var syscall = intent.syscall || '?';
    var disp = intent.disp || 'return';
    var latNs = intent.latNs || 0;
    var tint = this.DISP_TINT[disp] || '#58a6ff';

    var pid = intent.pid || 0;

    /* Phase 1: appear in attic, spread across the room width */
    var atticRect = KScene.roomRect('attic');
    var spreadW = atticRect ? atticRect.w * 0.6 : 60;
    guest.x = attic.x + (Math.random() - 0.5) * spreadW;
    guest.y = attic.y;
    guest.room = 'attic';
    guest.tint = null;
    guest.trail = [];
    guest.pid = pid;
    var pidInfo = KScene.userSpace.pidCmds[pid];
    guest.cmd = (pidInfo && pidInfo.label) ? pidInfo.label : '';
    guest.label = syscall;
    KBubble.show(guest.id, (pid ? 'PID ' + pid + ': ' : '') + syscall, 2500);

    /* Phase 2: walk to gate */
    this.activeWalks++;
    var self = this;
    var gateRect = KScene.roomRect('gate');
    var gateSpread = gateRect ? gateRect.w * 0.4 : 40;
    KPenguin.walkTo(guest, gate.x + (Math.random() - 0.5) * gateSpread, gate.y, function() {
      self.decrementWalks();
      guest.room = 'gate';

      /* Phase 3: dispatcher routing */
      var dispatcher = KHouse.residents.gate;
      if (dispatcher) {
        var targetCenter = KHouse.roomCenter(targetRoom);
        var ddx = targetCenter.x - dispatcher.x;
        if (Math.abs(ddx) > 10) {
          dispatcher.facing = 2;
          dispatcher.flipX = ddx > 0;
        } else {
          dispatcher.facing = 0;
        }
        KPenguin.setState(dispatcher, 'type');
        dispatcher.busyLevel = Math.min(1, dispatcher.busyLevel + 0.3);
        var roomName = KScene.str('rooms.' + targetRoom + '.name') || targetRoom;
        KBubble.show(dispatcher.id, '\u2192 ' + roomName, 2000);
      }

      /* Phase 4: apply tint + disposition name, walk to target */
      guest.tint = tint;
      guest.dispName = disp === 'continue' ? 'CONTINUE (host)' :
                       disp === 'enosys' ? 'ENOSYS (rejected)' : 'LKL emulated';
      guest.trail = [];

      if (targetRoom === 'gate') {
        self.finishGuest(guest, targetRoom, syscall, disp, latNs);
        return;
      }

      self.activeWalks++;
      var dest = KHouse.roomCenter(targetRoom);
      var destRect = KScene.roomRect(targetRoom);
      var destSpread = destRect ? destRect.w * 0.4 : 30;
      KPenguin.walkTo(guest, dest.x + (Math.random() - 0.5) * destSpread, dest.y, function() {
        self.decrementWalks();
        guest.room = targetRoom;
        self.finishGuest(guest, targetRoom, syscall, disp, latNs);
      });
    });
  },

  /* Phase 5-6: resident reacts, guest fades */
  finishGuest: function(guest, room, syscall, disp, latNs) {
    var resident = KHouse.residents[room];
    if (resident) {
      KPenguin.setState(resident, disp === 'enosys' ? 'error' : 'type');
      resident.busyLevel = Math.min(1, resident.busyLevel + 0.25);
      resident.label = syscall;
      var latStr = this.fmtLat(latNs);
      KBubble.show(resident.id, latStr ? syscall + ' ' + latStr : syscall, 2500);
    }

    /* Guest shows disposition result label */
    guest.label = disp === 'continue' ? 'HOST' : disp === 'enosys' ? 'ENOSYS' : 'LKL';

    /* Fade out in-place. Use generation counter to avoid releasing a
     * guest that was already recycled into a newer flow. */
    var gen = guest.gen;
    setTimeout(function() {
      if (!guest.visible || guest.gen !== gen) return;
      KHouse.resetGuest(guest);
      KHouse.releaseGuest(guest);
    }, 1500);
  },

  findPenguin: function(id) {
    for (var i = 0; i < KHouse.penguins.length; i++) {
      if (KHouse.penguins[i].id === id) return KHouse.penguins[i];
    }
    return null;
  }
};
