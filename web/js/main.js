/* Bootstrap: wire everything together */
'use strict';

document.addEventListener('DOMContentLoaded', function() {
  KEvents.init();
  KCharts.init();
  KControls.init();
  KScene.init('kh-canvas', 'kh-overlay');
  KHouse.init();
  KPolling.start();
});
