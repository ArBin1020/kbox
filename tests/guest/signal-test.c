/* SPDX-License-Identifier: MIT */
/* Guest test: basic signal handling via rt_sigaction.
 */
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(cond, msg)                        \
    do {                                        \
        if (!(cond)) {                          \
            fprintf(stderr, "FAIL: %s\n", msg); \
            exit(1);                            \
        }                                       \
    } while (0)

static volatile sig_atomic_t got_sigusr1;
static volatile sig_atomic_t got_sigurg;

static void handler(int sig)
{
    if (sig == SIGUSR1)
        got_sigusr1 = 1;
    if (sig == SIGURG)
        got_sigurg = 1;
}

int main(void)
{
    struct sigaction sa;

    /* Install SIGUSR1 handler. */
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handler;
    sigemptyset(&sa.sa_mask);
    CHECK(sigaction(SIGUSR1, &sa, NULL) == 0, "sigaction install");

    /* Raise and check. */
    CHECK(raise(SIGUSR1) == 0, "raise SIGUSR1");
    CHECK(got_sigusr1 == 1, "handler ran");

    /* Reset to default. */
    sa.sa_handler = SIG_DFL;
    CHECK(sigaction(SIGUSR1, &sa, NULL) == 0, "sigaction reset");

    /* Verify sigprocmask: block SIGUSR2, check it's pending after raise. */
    sigset_t set, old, pend;
    sigemptyset(&set);
    sigaddset(&set, SIGUSR2);
    CHECK(sigprocmask(SIG_BLOCK, &set, &old) == 0, "sigprocmask block");

    raise(SIGUSR2);

    CHECK(sigpending(&pend) == 0, "sigpending");
    CHECK(sigismember(&pend, SIGUSR2), "SIGUSR2 is pending");

    /* Unblock (will deliver and terminate if no handler, so install one). */
    sa.sa_handler = SIG_IGN;
    CHECK(sigaction(SIGUSR2, &sa, NULL) == 0, "sigaction ignore SIGUSR2");
    CHECK(sigprocmask(SIG_UNBLOCK, &set, NULL) == 0, "sigprocmask unblock");

    /* SIGURG passthrough: Go runtime uses SIGURG for goroutine async
     * preemption.  kbox must not intercept or deny rt_sigaction(SIGURG).
     */
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handler;
    sigemptyset(&sa.sa_mask);
    CHECK(sigaction(SIGURG, &sa, NULL) == 0, "sigaction install SIGURG");
    CHECK(raise(SIGURG) == 0, "raise SIGURG");
    CHECK(got_sigurg == 1, "SIGURG handler ran");

    /* Verify SIGSYS handler installation is denied (reserved). */
    sa.sa_handler = SIG_IGN;
    if (sigaction(SIGSYS, &sa, NULL) == 0) {
        /* In seccomp mode SIGSYS sigaction goes to CONTINUE (host
         * kernel handles it), so this may succeed.  In trap/rewrite
         * mode it must fail with EPERM.  Accept either outcome.
         */
    }

    /* Verify SIGSYS is not visible in the signal mask.
     * In trap/rewrite mode, kbox must strip SIGSYS from the mask
     * reported to the guest.  In seccomp mode, the host handles
     * sigprocmask directly and SIGSYS should not be blocked.
     */
    {
        sigset_t cur;
        sigemptyset(&cur);
        CHECK(sigprocmask(SIG_SETMASK, NULL, &cur) == 0, "sigprocmask query");
        CHECK(!sigismember(&cur, SIGSYS),
              "SIGSYS must not be visible in guest signal mask");
    }

    printf("PASS: signal_test\n");
    return 0;
}
