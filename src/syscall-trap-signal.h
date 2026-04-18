/* SPDX-License-Identifier: MIT */
#ifndef KBOX_SYSCALL_TRAP_SIGNAL_H
#define KBOX_SYSCALL_TRAP_SIGNAL_H

#include <stddef.h>
#include <stdint.h>

struct kbox_syscall_trap_ip_range {
    uintptr_t start;
    uintptr_t end;
};

int kbox_syscall_trap_reserved_signal(void);
int kbox_syscall_trap_signal_is_reserved(int signum);
int kbox_syscall_trap_sigset_blocks_reserved(const void *mask, size_t len);
void kbox_syscall_trap_sigset_strip_reserved(void *mask, size_t len);
uintptr_t kbox_syscall_trap_host_syscall_ip(void);
int kbox_syscall_trap_host_syscall_range(
    struct kbox_syscall_trap_ip_range *out);
int kbox_syscall_trap_internal_ip_ranges(struct kbox_syscall_trap_ip_range *out,
                                         size_t cap,
                                         size_t *count);
int64_t kbox_syscall_trap_host_syscall6(long nr,
                                        uint64_t a0,
                                        uint64_t a1,
                                        uint64_t a2,
                                        uint64_t a3,
                                        uint64_t a4,
                                        uint64_t a5);
int64_t kbox_syscall_trap_host_futex_wait_private(int *addr, int expected);
int64_t kbox_syscall_trap_host_futex_wake_private(int *addr, int count);
int64_t kbox_syscall_trap_host_exit_group_now(int status);
int64_t kbox_syscall_trap_host_execve_now(const char *pathname,
                                          char *const argv[],
                                          char *const envp[]);
int64_t kbox_syscall_trap_host_execveat_now(int dirfd,
                                            const char *pathname,
                                            char *const argv[],
                                            char *const envp[],
                                            int flags);
int64_t kbox_syscall_trap_host_clone_now(uint64_t a0,
                                         uint64_t a1,
                                         uint64_t a2,
                                         uint64_t a3,
                                         uint64_t a4);
int64_t kbox_syscall_trap_host_clone3_now(const void *uargs, size_t size);
#if defined(__x86_64__)
int64_t kbox_syscall_trap_host_fork_now(void);
int64_t kbox_syscall_trap_host_vfork_now(void);
#endif
#if defined(__x86_64__)
int64_t kbox_syscall_trap_host_arch_prctl_get_fs(uint64_t *out);
int64_t kbox_syscall_trap_host_arch_prctl_set_fs(uint64_t val);
#endif
int64_t kbox_syscall_trap_host_rt_sigprocmask_unblock(const uint64_t *mask,
                                                      size_t sigset_size);

#endif /* KBOX_SYSCALL_TRAP_SIGNAL_H */
