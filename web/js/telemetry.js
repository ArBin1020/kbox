/* Telemetry bridge: maps kbox SSE events and /api/snapshot data
 * to animation intents for the Kernel House.
 *
 * Two data channels:
 *   1. SSE sampled syscall events -> individual character animations
 *   2. /api/snapshot deltas -> ambient room state (glow, indicators)
 *
 * The SSE stream is sampled at 1% server-side.  This module does NOT
 * attempt to reconstruct full syscall traces; it creates an
 * impressionistic view of subsystem activity.
 */
'use strict';

var KTelemetry = {
  /* Syscall number -> room mapping for network detection (fallback only).
   * The primary classifier is SYSCALL_ROOM by name; this table is a
   * safety net for the rare case where evt.name is missing.
   * x86_64-only; aarch64 has different NRs but the name path handles it. */
  NETWORK_NRS: {
    /* x86_64 syscall numbers */
    41: true,   /* socket */
    42: true,   /* connect */
    43: true,   /* accept */
    44: true,   /* sendto */
    45: true,   /* recvfrom */
    46: true,   /* sendmsg */
    47: true,   /* recvmsg */
    48: true,   /* shutdown */
    49: true,   /* bind */
    50: true,   /* listen */
    51: true,   /* getsockname */
    52: true,   /* getpeername */
    53: true,   /* socketpair */
    54: true,   /* setsockopt */
    55: true,   /* getsockopt */
    288: true,  /* accept4 */
    299: true,  /* recvmmsg */
    307: true   /* sendmmsg */
  },

  /* Syscall family -> room mapping.
   * Family names come from the SSE event or can be derived from the
   * snapshot counters.  We classify by syscall name patterns. */
  SYSCALL_ROOM: {
    /* File I/O */
    'openat': 'vfs', 'open': 'vfs', 'read': 'vfs', 'write': 'vfs',
    'pread64': 'vfs', 'pwrite64': 'vfs', 'readv': 'vfs', 'writev': 'vfs',
    'preadv': 'vfs', 'preadv2': 'vfs', 'pwritev': 'vfs', 'pwritev2': 'vfs',
    'lseek': 'vfs', 'sendfile': 'vfs', 'ftruncate': 'vfs',
    'fallocate': 'vfs', 'readlinkat': 'vfs', 'readlink': 'vfs',
    'access': 'vfs', 'faccessat': 'vfs', 'faccessat2': 'vfs',
    'getcwd': 'vfs', 'chdir': 'vfs', 'fchdir': 'vfs',
    'chmod': 'vfs', 'fchmod': 'vfs', 'fchmodat': 'vfs',
    'chown': 'vfs', 'fchown': 'vfs', 'fchownat': 'vfs',
    'utimensat': 'vfs', 'copy_file_range': 'vfs',
    'mount': 'vfs', 'umount2': 'vfs',
    /* Stat */
    'stat': 'vfs', 'fstat': 'vfs', 'lstat': 'vfs', 'newfstatat': 'vfs',
    'statx': 'vfs', 'statfs': 'vfs', 'fstatfs': 'vfs',
    /* Directory */
    'getdents': 'vfs', 'getdents64': 'vfs', 'mkdir': 'vfs',
    'mkdirat': 'vfs', 'rmdir': 'vfs', 'unlink': 'vfs',
    'unlinkat': 'vfs', 'rename': 'vfs', 'renameat': 'vfs',
    'renameat2': 'vfs', 'symlink': 'vfs', 'symlinkat': 'vfs',
    'link': 'vfs', 'linkat': 'vfs',
    /* FD ops */
    'close': 'fdvault', 'dup': 'fdvault', 'dup2': 'fdvault',
    'dup3': 'fdvault', 'fcntl': 'fdvault', 'pipe': 'fdvault',
    'pipe2': 'fdvault', 'ioctl': 'fdvault',
    'epoll_create': 'fdvault', 'epoll_create1': 'fdvault',
    'epoll_ctl': 'fdvault', 'epoll_wait': 'fdvault',
    'epoll_pwait': 'fdvault', 'epoll_pwait2': 'fdvault',
    'poll': 'fdvault', 'ppoll': 'fdvault',
    'select': 'fdvault', 'pselect6': 'fdvault',
    'eventfd': 'fdvault', 'eventfd2': 'fdvault',
    'timerfd_create': 'fdvault', 'timerfd_settime': 'fdvault',
    'timerfd_gettime': 'fdvault', 'signalfd': 'fdvault',
    'signalfd4': 'fdvault',
    /* Process / scheduler */
    'clone': 'process', 'clone3': 'process', 'fork': 'process',
    'vfork': 'process', 'execve': 'process', 'execveat': 'process',
    'exit': 'process', 'exit_group': 'process', 'wait4': 'process',
    'waitid': 'process', 'sched_yield': 'process',
    'sched_getscheduler': 'process', 'sched_setscheduler': 'process',
    'sched_getparam': 'process', 'sched_setparam': 'process',
    'sched_get_priority_max': 'process', 'sched_get_priority_min': 'process',
    'sched_getaffinity': 'process', 'sched_setaffinity': 'process',
    'getpid': 'process', 'getppid': 'process', 'gettid': 'process',
    'getuid': 'process', 'geteuid': 'process',
    'getgid': 'process', 'getegid': 'process',
    'setuid': 'process', 'setgid': 'process',
    'getresuid': 'process', 'getresgid': 'process',
    'setresuid': 'process', 'setresgid': 'process',
    'set_tid_address': 'process', 'set_robust_list': 'process',
    'prlimit64': 'process', 'getrlimit': 'process', 'setrlimit': 'process',
    'prctl': 'process', 'arch_prctl': 'process',
    'nanosleep': 'process', 'clock_nanosleep': 'process',
    'clock_gettime': 'process', 'clock_getres': 'process',
    'gettimeofday': 'process',
    'rt_sigaction': 'process', 'rt_sigprocmask': 'process',
    'rt_sigreturn': 'process', 'sigaltstack': 'process',
    'kill': 'process', 'tgkill': 'process', 'tkill': 'process',
    'getrusage': 'process', 'times': 'process', 'uname': 'process',
    'getrandom': 'process',
    /* Memory */
    'mmap': 'memory', 'mprotect': 'memory', 'munmap': 'memory',
    'brk': 'memory', 'mremap': 'memory', 'madvise': 'memory',
    'msync': 'memory', 'mlock': 'memory', 'munlock': 'memory',
    'mlock2': 'memory', 'mlockall': 'memory', 'munlockall': 'memory',
    'futex': 'memory', 'get_robust_list': 'memory',
    /* Network */
    'socket': 'network', 'connect': 'network', 'accept': 'network',
    'accept4': 'network', 'bind': 'network', 'listen': 'network',
    'sendto': 'network', 'recvfrom': 'network', 'sendmsg': 'network',
    'recvmsg': 'network', 'setsockopt': 'network', 'getsockopt': 'network',
    'socketpair': 'network', 'shutdown': 'network',
    'getsockname': 'network', 'getpeername': 'network',
    'sendmmsg': 'network', 'recvmmsg': 'network'
  },

  /* Classify a syscall event to a target room */
  classifyRoom: function(evt) {
    /* Try by name first (most reliable) */
    if (evt.name && this.SYSCALL_ROOM[evt.name]) {
      return this.SYSCALL_ROOM[evt.name];
    }
    /* Fallback: check if it's a network syscall by nr */
    if (evt.nr !== undefined && this.NETWORK_NRS[evt.nr]) {
      return 'network';
    }
    /* Default to gate (unclassified) */
    return 'gate';
  },

  /* Called when a SSE syscall event arrives.
   * Pushes animation intents into the queue. */
  onSyscallEvent: function(evt) {
    /* Don't queue events during demo or pause */
    if (KHouse.demoRunning || KState.paused) return;

    var room = this.classifyRoom(evt);
    var name = evt.name || 'syscall#' + evt.nr;

    /* Track PID activity and command names */
    var pid = evt.pid || 0;
    if (pid) {
      KScene.trackPid(pid, name);
    }

    KIntent.push({
      type: 'guest',
      room: room,
      syscall: name,
      disp: evt.disp || 'return',
      latNs: evt.lat_ns || 0,
      pid: evt.pid || 0
    });

    /* Narrator check */
    KEducation.checkNarration(evt);
  },

  /* Called when a new /api/snapshot arrives.
   * Computes deltas and pushes ambient glow intents. */
  onSnapshot: function(snap, prev) {
    if (!prev || !snap) return;

    /* Compute per-family rates for glow */
    var fileRate = KState.rate(snap, prev, 'family.file_io') +
                   KState.rate(snap, prev, 'family.dir');
    var otherRate = KState.rate(snap, prev, 'family.other');
    var scRate = KState.rate(snap, prev, 'dispatch.total');

    /* User space stats */
    KScene.userSpace.syscallRate = scRate;

    /* Glow intents from rates computed above */
    KIntent.pushGlow('gate', this.rateToGlow(scRate, 5000));
    KIntent.pushGlow('vfs', this.rateToGlow(fileRate, 2000));

    var csRate = KState.rate(snap, prev, 'context_switches');
    KIntent.pushGlow('process', this.rateToGlow(csRate, 5000));

    /* Memory pressure -> Memory glow */
    var memPct = 0;
    if (snap.mem && snap.mem.total > 0)
      memPct = 1 - (snap.mem.free / snap.mem.total);
    KIntent.pushGlow('memory', memPct);

    /* FD usage -> FD Vault glow + detail stats */
    if (snap.fd) {
      KScene.fdStats.used = snap.fd.used || 0;
      KScene.fdStats.max = snap.fd.max || 1;
    }
    var fdPct = 0;
    if (snap.fd && snap.fd.max > 0)
      fdPct = snap.fd.used / snap.fd.max;
    KIntent.pushGlow('fdvault', fdPct);

    /* Network (family.other rate, already computed) */
    KIntent.pushGlow('network', this.rateToGlow(otherRate, 1000));

    /* Attic: overall activity */
    KIntent.pushGlow('attic', this.rateToGlow(scRate, 3000));

    /* Basement stays at 0 (no data source) */

    /* Narrator: error spike detection */
    KEducation.checkErrorSpike(snap);
  },

  /* Map a rate (events/sec) to a glow level 0..1 */
  rateToGlow: function(rate, maxRate) {
    if (rate <= 0) return 0;
    return Math.min(1, rate / maxRate);
  }
};
