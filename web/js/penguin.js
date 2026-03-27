/* Penguin sprite animation engine.
 *
 * Renders pixel-art penguins on KScene's canvas.  Each penguin has a
 * state machine (idle/walk/type/celebrate/error), position, facing
 * direction, and optional accessory overlay.
 *
 * Style: star-office-ui-v2 inspired -- smooth sinusoidal wobble,
 * quadratic ease-out movement, bouncy celebrate, elastic error shake.
 *
 * Sprite sheet layout: 7 columns x 3 rows, each frame 20x20 px.
 *   Columns: 0=idle, 1-3=walk cycle, 4=type1, 5=type2, 6=error
 *   Rows:    0=down(front), 1=up(back), 2=side(left)
 *
 * Side-facing sprites face left; mirror via scaleX(-1) for right.
 */
'use strict';

var KPenguin = {
  FRAME_W: 16,
  FRAME_H: 28,
  COLS: 7,
  SCALE: 2.5,       /* render scale (16*2.5=40w, 28*2.5=70h, matches tinyoffice's 35x70) */
  TICK_MS: 100,     /* faster tick for smoother animation */

  /* Sprite images (loaded in init) */
  imgBase: null,
  imgGuest: null,
  accImages: {},

  /* Animation sequences: state -> frame index array */
  ANIMS: {
    idle:      [0],
    walk:      [1, 2, 3, 2],
    type:      [4, 5],
    celebrate: [4, 5],
    error:     [6, 4]
  },

  DURATIONS: {
    idle: 0,
    walk: 0,
    type: 10,       /* ~1s */
    celebrate: 8,
    error: 10
  },

  loaded: false,
  clock: 0,
  timeMs: 0,        /* continuous time for smooth sin/cos */
  isLight: false,    /* cached theme state, updated by KScene.readTheme() */

  init: function() {
    var self = this;
    var pending = 7;
    var done = function() { if (--pending === 0) self.loaded = true; };

    this.imgBase = new Image();
    this.imgBase.onload = done;
    this.imgBase.src = '/art/penguin-base.png';

    this.imgGuest = new Image();
    this.imgGuest.onload = done;
    this.imgGuest.src = '/art/penguin-guest.png';

    var accNames = ['hat', 'folder', 'stopwatch', 'memblock', 'envelope'];
    for (var i = 0; i < accNames.length; i++) {
      var img = new Image();
      img.onload = done;
      img.src = '/art/acc-' + accNames[i] + '.png';
      this.accImages[accNames[i]] = img;
    }
  },

  tick: function() {
    this.clock++;
    this.timeMs += this.TICK_MS;
  },

  create: function(opts) {
    return {
      id: opts.id || '',
      x: opts.x || 0,
      y: opts.y || 0,
      targetX: opts.x || 0,
      targetY: opts.y || 0,
      state: 'idle',
      facing: opts.facing || 0,
      flipX: false,
      frameIdx: 0,
      stateTimer: 0,
      acc: opts.acc || null,
      isGuest: opts.isGuest || false,
      visible: opts.visible !== undefined ? opts.visible : true,
      room: opts.room || 'gate',
      speed: opts.speed || 2,
      walkProgress: 0,           /* 0..1 for eased movement */
      startX: 0, startY: 0,     /* walk origin for easing */
      onArrive: null,
      /* Narrative state */
      tint: null,                /* disposition color */
      dispName: '',              /* disposition label for tooltip */
      trail: [],                 /* recent positions for motion trail */
      label: '',                 /* short label shown below */
      busyLevel: 0,             /* 0..1: sustained busyness for residents */
      pid: 0,                   /* tracee PID (from SSE event) */
      cmd: '',                  /* command name (e.g. 'ash', 'cat') */
      gen: 0                   /* generation counter for timer guards */
    };
  },

  setState: function(p, state) {
    if (p.state === state) return;
    p.state = state;
    p.frameIdx = 0;
    p.stateTimer = this.DURATIONS[state] || 0;
    /* Clear trail when leaving walk state to prevent stale ghost dots */
    if (state !== 'walk') p.trail = [];
  },

  /* Quadratic ease-out: fast start, smooth deceleration */
  easeOut: function(t) {
    return t * (2 - t);
  },

  walkTo: function(p, tx, ty, onArrive) {
    p.startX = p.x;
    p.startY = p.y;
    p.targetX = tx;
    p.targetY = ty;
    p.walkProgress = 0;
    p.onArrive = onArrive || null;
    this.setState(p, 'walk');

    var dx = tx - p.x;
    var dy = ty - p.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      p.facing = 2;
      p.flipX = dx > 0;
    } else if (dy < 0) {
      p.facing = 1;
      p.flipX = false;
    } else {
      p.facing = 0;
      p.flipX = false;
    }
  },

  update: function(p) {
    if (!p.visible) return;

    /* Record trail for walking tinted guests (every 4th tick, max 3 dots) */
    if (p.state === 'walk' && p.tint && this.clock % 4 === 0) {
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 3) p.trail.shift();
    }

    /* Decay resident busyness toward 0 */
    if (p.busyLevel > 0) {
      p.busyLevel = Math.max(0, p.busyLevel - 0.008);
    }

    /* Walk: eased interpolation instead of fixed-speed linear */
    if (p.state === 'walk') {
      var totalDist = Math.sqrt(
        Math.pow(p.targetX - p.startX, 2) +
        Math.pow(p.targetY - p.startY, 2));
      /* Speed as progress per tick (faster for shorter distances) */
      var step = totalDist > 0 ? (p.speed / totalDist) : 1;
      p.walkProgress = Math.min(1, p.walkProgress + step);
      var t = this.easeOut(p.walkProgress);

      p.x = p.startX + (p.targetX - p.startX) * t;
      p.y = p.startY + (p.targetY - p.startY) * t;

      if (p.walkProgress >= 1) {
        p.x = p.targetX;
        p.y = p.targetY;
        this.setState(p, 'idle');
        if (p.onArrive) {
          var cb = p.onArrive;
          p.onArrive = null;
          cb(p);
        }
        return;
      }
    }

    if (p.stateTimer > 0) {
      p.stateTimer--;
      if (p.stateTimer === 0) {
        this.setState(p, 'idle');
      }
    }

    var anim = this.ANIMS[p.state] || this.ANIMS.idle;
    p.frameIdx = (p.frameIdx + 1) % anim.length;
  },

  draw: function(ctx, p) {
    if (!p.visible || !this.loaded) return;

    var anim = this.ANIMS[p.state] || this.ANIMS.idle;
    var col = anim[p.frameIdx % anim.length];
    var row = p.facing;
    var img = p.isGuest ? this.imgGuest : this.imgBase;

    var sw = this.FRAME_W;
    var sh = this.FRAME_H;
    var sx = col * sw;
    var sy = row * sh;
    var dw = sw * this.SCALE;
    var dh = sh * this.SCALE;

    /* Animation offsets.
     * Walk: penguin waddle -- side-to-side sway + vertical bob, like a
     * real penguin rocking from foot to foot. The sway is perpendicular
     * to the travel direction (horizontal if walking vertically, etc). */
    var bob = 0;   /* vertical offset */
    var sway = 0;  /* horizontal offset (waddle) */
    var tilt = 0;  /* rotation in radians (body lean) */

    if (p.state === 'walk') {
      var phase = this.timeMs / 180; /* waddle cycle */
      bob = Math.abs(Math.sin(phase)) * -4; /* up on each step (pronounced) */
      sway = Math.sin(phase) * 2.5;        /* side-to-side rock */
      tilt = Math.sin(phase) * 0.06;       /* slight body lean toward foot */
    } else if (p.state === 'idle') {
      bob = Math.sin(this.timeMs / 800) * 0.5; /* gentle breathing */
    } else if (p.state === 'celebrate') {
      bob = -Math.abs(Math.sin(this.timeMs / 150)) * 5;
    } else if (p.state === 'type') {
      bob = Math.sin(this.timeMs / 300) * 0.8;
    }
    bob = Math.round(bob);
    sway = Math.round(sway);

    var shake = 0;
    if (p.state === 'error') {
      shake = Math.sin(this.timeMs / 50) * 3 * Math.exp(-((this.clock % 20) / 15));
    }
    shake = Math.round(shake);

    var dx = Math.round(p.x - dw / 2) + shake + sway;
    var dy = Math.round(p.y - dh) + bob;

    /* Motion trail (3 dots max, only for walking tinted guests) */
    if (p.trail.length > 0 && p.tint) {
      ctx.save();
      ctx.fillStyle = p.tint;
      for (var ti = 0; ti < p.trail.length; ti++) {
        ctx.globalAlpha = (ti + 1) / p.trail.length * 0.18;
        ctx.beginPath();
        ctx.arc(p.trail[ti].x, p.trail[ti].y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* Ground shadow -- single clean ellipse, no layering.
     * Use slightly lighter color in dark mode for visibility. */
    var shadowW = dw * 0.35;
    var shadowH = Math.max(3, dh * 0.06);
    var shadowX = Math.round(p.x) + sway;
    var shadowY = Math.round(p.y);
    ctx.save();
    ctx.globalAlpha = this.isLight ? 0.3 : 0.4;
    ctx.fillStyle = this.isLight ? '#000' : '#1a1510';
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY + 2, shadowW, shadowH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* Sprite + accessory -- apply waddle tilt during walk */
    ctx.save();
    if (tilt !== 0) {
      /* Rotate around penguin's feet, tracking bob for accurate pivot */
      var pivotX = Math.round(p.x) + sway;
      var pivotY = Math.round(p.y) + bob;
      ctx.translate(pivotX, pivotY);
      ctx.rotate(tilt);
      ctx.translate(-pivotX, -pivotY);
    }
    if (p.flipX) {
      ctx.translate(Math.round(p.x) + shake + sway, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, 0, dw, dh);
      if (p.acc && this.accImages[p.acc]) {
        ctx.drawImage(this.accImages[p.acc], sx, 0, sw, sh, -dw / 2, 0, dw, dh);
      }
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      if (p.acc && this.accImages[p.acc]) {
        ctx.drawImage(this.accImages[p.acc], sx, 0, sw, sh, dx, dy, dw, dh);
      }
    }
    ctx.restore();

    /* Labels removed -- info shown via hover tooltip to avoid clutter
     * when multiple penguins are close together. */
  },

  /* Hit-test: is canvas point (cx, cy) over this penguin? */
  hitTest: function(p, cx, cy) {
    if (!p.visible) return false;
    var dw = this.FRAME_W * this.SCALE;
    var dh = this.FRAME_H * this.SCALE;
    var left = p.x - dw / 2;
    var top = p.y - dh;
    return cx >= left && cx < left + dw && cy >= top && cy < top + dh;
  }
};
