/* SPDX-License-Identifier: MIT */

/* Filesystem mount helpers for the LKL guest.
 *
 * Sets up the recommended virtual filesystems (proc, sysfs, devtmpfs, devpts,
 * tmpfs) and applies user-specified bind mounts. All operations go through LKL
 * syscall wrappers; nothing touches the host kernel.
 */

#include <errno.h>
#include <stdio.h>
#include <string.h>

#include "kbox/mount.h"
#include "lkl-wrap.h"

/* MS_BIND from <linux/mount.h> without pulling the full header. */
#define KBOX_MS_BIND 0x1000

/* Bind-mount spec parser. */

int kbox_parse_bind_spec(const char *spec, struct kbox_bind_spec *out)
{
    const char *colon;
    size_t src_len, dst_len;

    if (!spec || !out) {
        fprintf(stderr, "kbox_parse_bind_spec: NULL argument\n");
        return -1;
    }

    colon = strchr(spec, ':');
    if (!colon) {
        fprintf(stderr, "bind spec missing ':': %s\n", spec);
        return -1;
    }

    src_len = (size_t) (colon - spec);
    dst_len = strlen(colon + 1);

    if (src_len == 0 || dst_len == 0) {
        fprintf(stderr, "bind spec has empty component: %s\n", spec);
        return -1;
    }
    if (src_len >= sizeof(out->source)) {
        fprintf(stderr, "bind spec source too long: %s\n", spec);
        return -1;
    }
    if (dst_len >= sizeof(out->target)) {
        fprintf(stderr, "bind spec target too long: %s\n", spec);
        return -1;
    }

    memcpy(out->source, spec, src_len);
    out->source[src_len] = '\0';

    memcpy(out->target, colon + 1, dst_len);
    out->target[dst_len] = '\0';

    return 0;
}

/* Internal: mkdir + mount, tolerating EEXIST on mkdir. */

static int do_mkdir_mount(const struct kbox_sysnrs *s,
                          const char *target,
                          const char *fstype,
                          const char *source)
{
    long ret;

    ret = kbox_lkl_mkdir(s, target, 0755);
    if (ret < 0 && ret != -EEXIST) {
        fprintf(stderr, "mkdir(%s): %s\n", target, kbox_err_text(ret));
        return -1;
    }

    ret = kbox_lkl_mount(s, source, target, fstype, 0, NULL);
    if (ret < 0) {
        fprintf(stderr, "mount(%s on %s): %s\n", fstype, target,
                kbox_err_text(ret));
        return -1;
    }

    return 0;
}

/* Recommended mounts. */

int kbox_apply_recommended_mounts(const struct kbox_sysnrs *s,
                                  enum kbox_mount_profile profile)
{
    /* proc is always mounted; needed for /proc/self/fd, /proc/sys */
    if (do_mkdir_mount(s, "/proc", "proc", "proc") < 0)
        return -1;

    if (profile == KBOX_MOUNT_FULL) {
        if (do_mkdir_mount(s, "/sys", "sysfs", "sysfs") < 0)
            return -1;

        /* devtmpfs and devpts require CONFIG_DEVTMPFS / CONFIG_DEVPTS_FS
         * in the LKL kernel. Warn on failure instead of aborting; the guest
         * can operate without them.
         */
        if (do_mkdir_mount(s, "/dev", "devtmpfs", "devtmpfs") < 0)
            fprintf(stderr,
                    "warning: devtmpfs unavailable (CONFIG_DEVTMPFS?)\n");

        if (do_mkdir_mount(s, "/dev/pts", "devpts", "devpts") < 0)
            fprintf(stderr,
                    "warning: devpts unavailable (CONFIG_DEVPTS_FS?)\n");
    }

    /* tmpfs on /tmp is always useful */
    if (do_mkdir_mount(s, "/tmp", "tmpfs", "tmpfs") < 0)
        return -1;

    return 0;
}

/* Bind mounts. */

int kbox_apply_bind_mounts(const struct kbox_sysnrs *s,
                           const struct kbox_bind_spec *specs,
                           int count)
{
    int i;
    long ret;

    for (i = 0; i < count; i++) {
        ret = kbox_lkl_mkdir(s, specs[i].target, 0755);
        if (ret < 0 && ret != -EEXIST) {
            fprintf(stderr, "mkdir(%s): %s\n", specs[i].target,
                    kbox_err_text(ret));
            return -1;
        }

        ret = kbox_lkl_mount(s, specs[i].source, specs[i].target, NULL,
                             KBOX_MS_BIND, NULL);
        if (ret < 0) {
            fprintf(stderr, "bind mount %s -> %s: %s\n", specs[i].source,
                    specs[i].target, kbox_err_text(ret));
            return -1;
        }
    }

    return 0;
}
