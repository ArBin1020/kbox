/* Speech bubble system (DOM overlay).
 *
 * Bubbles are positioned absolutely over the canvas, anchored to a
 * penguin's canvas position.  They auto-expire after a timeout and
 * animate in/out via CSS.
 */
'use strict';

var KBubble = {
  MAX_BUBBLES: 12,
  DEFAULT_TTL: 3000,  /* ms */
  bubbles: [],         /* { el, penguinId, expires } */

  /* Show a bubble above a penguin.  Text is plain string. */
  show: function(penguinId, text, ttl) {
    if (!KScene.overlay) return;
    ttl = ttl || this.DEFAULT_TTL;

    /* Reuse existing bubble for same penguin if still visible */
    for (var i = 0; i < this.bubbles.length; i++) {
      if (this.bubbles[i].penguinId === penguinId) {
        this.bubbles[i].el.textContent = text;
        this.bubbles[i].expires = Date.now() + ttl;
        return;
      }
    }

    /* Evict oldest if at capacity */
    if (this.bubbles.length >= this.MAX_BUBBLES) {
      this.remove(0);
    }

    var el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    el.style.transform = 'translateX(-50%)';
    KScene.overlay.appendChild(el);

    this.bubbles.push({
      el: el,
      penguinId: penguinId,
      expires: Date.now() + ttl
    });
  },

  /* Cached canvas layout (updated by updateLayout, not every frame) */
  canvasRect: null,
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,

  /* Call after canvas resize or tab switch */
  updateLayout: function() {
    if (!KScene.canvas || !KScene.overlay) return;
    var canvasRect = KScene.canvas.getBoundingClientRect();
    var overlayRect = KScene.overlay.getBoundingClientRect();
    this.scaleX = canvasRect.width / (KScene.width || 1);
    this.scaleY = canvasRect.height / (KScene.height || 1);
    this.offsetX = canvasRect.left - overlayRect.left;
    this.offsetY = canvasRect.top - overlayRect.top;
    this.canvasRect = canvasRect;
  },

  /* Penguin id -> penguin map for O(1) lookup */
  penguinMap: null,

  buildPenguinMap: function(penguins) {
    this.penguinMap = {};
    for (var i = 0; i < penguins.length; i++) {
      this.penguinMap[penguins[i].id] = penguins[i];
    }
  },

  /* Reposition all bubbles to track their penguin's canvas position */
  reposition: function(penguins) {
    if (!this.canvasRect) this.updateLayout();
    if (!this.penguinMap) this.buildPenguinMap(penguins);

    for (var i = 0; i < this.bubbles.length; i++) {
      var b = this.bubbles[i];
      var p = this.penguinMap[b.penguinId];
      if (!p) continue;

      var bx = this.offsetX + p.x * this.scaleX;
      var by = this.offsetY + (p.y - KPenguin.FRAME_H * KPenguin.SCALE - 8) * this.scaleY;

      /* Skip rewrite if position unchanged (within 1px) */
      var prevLeft = parseFloat(b.el.style.left) || 0;
      var prevTop = parseFloat(b.el.style.top) || 0;
      if (Math.abs(bx - prevLeft) < 1 && Math.abs(by - prevTop) < 1) continue;

      b.el.style.left = bx + 'px';
      b.el.style.top = by + 'px';
    }
  },

  /* Expire old bubbles */
  cleanup: function() {
    var now = Date.now();
    var self = this;
    for (var i = this.bubbles.length - 1; i >= 0; i--) {
      if (now >= this.bubbles[i].expires) {
        this.bubbles[i].el.classList.add('out');
        /* IIFE captures `el` per-iteration (var is function-scoped in ES5) */
        (function(el) {
          setTimeout(function() { self.removeByEl(el); }, 300);
        })(this.bubbles[i].el);
        this.bubbles[i].expires = Infinity;
      }
    }
  },

  /* Remove by DOM element reference (stable across splice shifts) */
  removeByEl: function(el) {
    for (var i = 0; i < this.bubbles.length; i++) {
      if (this.bubbles[i].el === el) {
        if (el.parentNode) el.parentNode.removeChild(el);
        this.bubbles.splice(i, 1);
        return;
      }
    }
    /* Element already removed (e.g. clear() called during fade-out) */
    if (el.parentNode) el.parentNode.removeChild(el);
  },

  remove: function(idx) {
    if (idx < 0 || idx >= this.bubbles.length) return;
    var b = this.bubbles[idx];
    if (b.el.parentNode) b.el.parentNode.removeChild(b.el);
    this.bubbles.splice(idx, 1);
  },

  clear: function() {
    for (var i = this.bubbles.length - 1; i >= 0; i--) {
      this.remove(i);
    }
  }
};
