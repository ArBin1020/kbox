/* UI controls: theme, pause/resume, filters, export */
'use strict';

var KControls = {
  init: function() {
    /* Tab switching */
    var tabs = document.querySelectorAll('.tab-bar .tab');
    var contents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function() {
        var target = this.getAttribute('data-tab');
        /* Deactivate all tabs and contents */
        for (var j = 0; j < tabs.length; j++)
          tabs[j].classList.remove('active');
        for (var k = 0; k < contents.length; k++)
          contents[k].classList.remove('visible');
        /* Activate selected */
        this.classList.add('active');
        var el = document.getElementById('tab-' + target);
        if (el) el.classList.add('visible');
        /* Resize scene canvas when switching to kernel house */
        if (target === 'kernel-house' && KScene.canvas) {
          KScene.resize();
          KBubble.updateLayout();
          KBubble.penguinMap = null;
          KHouse.ensurePenguins();
          KHouse.repositionAll();
        }
      });
    }
    /* Show default tab */
    var defaultTab = document.querySelector('.tab-bar .tab.active');
    if (defaultTab) defaultTab.click();

    /* Theme toggle */
    var btn = document.getElementById('btn-theme');
    if (btn) btn.addEventListener('click', function() {
      document.body.classList.toggle('light');
      localStorage.setItem('kbox-theme',
        document.body.classList.contains('light') ? 'light' : 'dark');
      KScene.readTheme();
    });

    /* Restore theme */
    if (localStorage.getItem('kbox-theme') === 'light')
      document.body.classList.add('light');

    /* Pause/resume */
    var pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', function() {
      var want = !KState.paused;
      /* Apply optimistically so animation freezes/resumes immediately */
      KState.paused = want;
      pauseBtn.textContent = want ? 'Resume' : 'Pause';
      pauseBtn.disabled = true;
      fetch('/api/control', {
        method: 'POST',
        body: JSON.stringify({ action: want ? 'pause' : 'resume' })
      }).then(function(res) {
        if (!res.ok) throw new Error('server error');
      }).catch(function() {
        /* Server may be dead (offline); keep the client-side state as-is
         * so the user can still pause/resume the animation locally. */
      }).then(function() {
        pauseBtn.disabled = false;
      });
    });

    /* Event filters */
    var fSc = document.getElementById('f-syscall');
    var fProc = document.getElementById('f-process');
    var fErr = document.getElementById('f-errors');
    if (fSc) fSc.addEventListener('change', function() {
      KEvents.filters.syscall = fSc.checked;
    });
    if (fProc) fProc.addEventListener('change', function() {
      KEvents.filters.process = fProc.checked;
    });
    if (fErr) fErr.addEventListener('change', function() {
      KEvents.filters.errorsOnly = fErr.checked;
    });

    /* Screenshot (kernel house canvas) */
    var ssBtn = document.getElementById('btn-screenshot');
    if (ssBtn) ssBtn.addEventListener('click', function() {
      if (!KScene.canvas) return;
      var a = document.createElement('a');
      a.href = KScene.canvas.toDataURL('image/png');
      a.download = 'kbox-kernel-house.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    /* Export CSV (chart data from snapshot history) */
    var csvBtn = document.getElementById('btn-export-csv');
    if (csvBtn) csvBtn.addEventListener('click', KControls.exportCSV.bind(KControls));

    /* Export JSON (event feed) */
    var jsonBtn = document.getElementById('btn-export-json');
    if (jsonBtn) jsonBtn.addEventListener('click', KControls.exportJSON.bind(KControls));
  },

  exportCSV: function() {
    var rows = ['timestamp_ns,uptime_s,syscalls,continue,return,enosys,' +
                'ctx_switches,mem_free_kb,mem_cached_kb,pgfault,loadavg_1'];
    for (var i = 0; i < KState.snapHistory.length; i++) {
      var s = KState.snapHistory[i];
      var d = s.dispatch || {};
      rows.push([
        s.timestamp_ns,
        (s.uptime_ns / 1e9).toFixed(1),
        d.total || 0, d['continue'] || 0, d['return'] || 0, d.enosys || 0,
        s.context_switches || 0,
        s.mem ? s.mem.free : 0,
        s.mem ? s.mem.cached : 0,
        s.pgfault || 0,
        s.loadavg ? s.loadavg[0] : 0
      ].join(','));
    }
    KControls._download('kbox-telemetry.csv', rows.join('\n'), 'text/csv');
  },

  exportJSON: function() {
    var data = JSON.stringify(KState.events, null, 2);
    KControls._download('kbox-events.json', data, 'application/json');
  },

  _download: function(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
