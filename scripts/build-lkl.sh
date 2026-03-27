#!/bin/sh
# SPDX-License-Identifier: MIT
# Build liblkl.a from source (lkl/linux) and populate lkl-<ARCH>/.
#
# Usage: ./scripts/build-lkl.sh [ARCH]
#   ARCH defaults to the host architecture (x86_64 or aarch64).
#   Override LKL_DIR   to change the output directory.
#   Override LKL_SRC   to reuse an existing source tree (skip clone).
#   Override LKL_REF   to check out a specific branch/tag/commit
#                      (default: HEAD of master).

set -eu

case "${1:-$(uname -m)}" in
    x86_64 | amd64)  ARCH="x86_64"  ;;
    aarch64 | arm64) ARCH="aarch64" ;;
    *)
        echo "error: unsupported architecture: ${1:-$(uname -m)}" >&2
        exit 1
        ;;
esac

LKL_DIR="${LKL_DIR:-lkl-${ARCH}}"
LKL_SRC="${LKL_SRC:-build/lkl-src}"
LKL_UPSTREAM="https://github.com/lkl/linux"

die() { echo "error: $*" >&2; exit 1; }

# ---- Clone or update source tree ----------------------------------------

if [ -d "${LKL_SRC}/.git" ]; then
    echo "  SRC     ${LKL_SRC} (exists, skipping clone)"
    if [ -n "${LKL_REF:-}" ]; then
        echo "  CHECKOUT ${LKL_REF}"
        git -C "${LKL_SRC}" fetch --depth=1 origin "${LKL_REF}"
        git -C "${LKL_SRC}" checkout FETCH_HEAD
    fi
else
    echo "  CLONE   ${LKL_UPSTREAM} -> ${LKL_SRC}"
    mkdir -p "$(dirname "${LKL_SRC}")"

    if [ -n "${LKL_REF:-}" ]; then
        # Shallow clone of a specific ref.
        git clone --depth=1 --branch "${LKL_REF}" \
            "${LKL_UPSTREAM}" "${LKL_SRC}"
    else
        # Shallow clone of default branch.
        git clone --depth=1 "${LKL_UPSTREAM}" "${LKL_SRC}"
    fi
fi

# ---- Configure -----------------------------------------------------------

echo "  CONFIG  ARCH=lkl defconfig"
make -C "${LKL_SRC}" ARCH=lkl defconfig

# Enable features required by kbox (mirrors build-lkl.yml).
for opt in \
    CONFIG_DEVTMPFS \
    CONFIG_DEVTMPFS_MOUNT \
    CONFIG_DEVPTS_FS \
    CONFIG_DEBUG_INFO \
    CONFIG_GDB_SCRIPTS \
    CONFIG_SCHED_DEBUG \
    CONFIG_PROC_SYSCTL \
    CONFIG_PRINTK \
    CONFIG_TRACEPOINTS \
    CONFIG_FTRACE \
    CONFIG_DEBUG_FS \
; do
    "${LKL_SRC}/scripts/config" --file "${LKL_SRC}/.config" --enable "${opt}"
done

"${LKL_SRC}/scripts/config" --file "${LKL_SRC}/.config" \
    --set-val CONFIG_DEBUG_INFO_DWARF_TOOLCHAIN_DEFAULT y

for opt in \
    CONFIG_MODULES \
    CONFIG_SOUND \
    CONFIG_USB_SUPPORT \
    CONFIG_INPUT \
    CONFIG_NFS_FS \
    CONFIG_CIFS \
; do
    "${LKL_SRC}/scripts/config" --file "${LKL_SRC}/.config" --disable "${opt}"
done

make -C "${LKL_SRC}" ARCH=lkl olddefconfig

# ---- Build ---------------------------------------------------------------

NPROC=$(nproc 2>/dev/null || echo 1)

echo "  BUILD   ARCH=lkl kernel (-j${NPROC})"
make -C "${LKL_SRC}" ARCH=lkl -j"${NPROC}"

echo "  BUILD   tools/lkl (-j${NPROC})"
make -C "${LKL_SRC}/tools/lkl" -j"${NPROC}"

# ---- Verify --------------------------------------------------------------

test -f "${LKL_SRC}/tools/lkl/liblkl.a" \
    || die "build succeeded but liblkl.a not found"

echo "  VERIFY  symbols"
for sym in lkl_init lkl_start_kernel lkl_cleanup lkl_syscall \
           lkl_strerror lkl_disk_add lkl_mount_dev \
           lkl_host_ops lkl_dev_blk_ops; do
    if ! nm "${LKL_SRC}/tools/lkl/liblkl.a" 2>/dev/null \
         | awk -v s="$sym" '$3==s && $2~/^[TtDdBbRr]$/{found=1} END{exit !found}'; then
        die "MISSING symbol: ${sym}"
    fi
done

# ---- Install into lkl-<ARCH>/ -------------------------------------------

echo "  INSTALL ${LKL_DIR}/"
mkdir -p "${LKL_DIR}"

cp "${LKL_SRC}/tools/lkl/liblkl.a"               "${LKL_DIR}/"
cp "${LKL_SRC}/tools/lkl/include/lkl.h"          "${LKL_DIR}/" 2>/dev/null || true
cp "${LKL_SRC}/tools/lkl/include/lkl/autoconf.h" "${LKL_DIR}/" 2>/dev/null || true
cp "${LKL_SRC}/scripts/gdb/vmlinux-gdb.py"        "${LKL_DIR}/" 2>/dev/null || true

printf 'commit=%s\ndate=%s\narch=%s\n' \
    "$(git -C "${LKL_SRC}" rev-parse HEAD)" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${ARCH}" \
    > "${LKL_DIR}/BUILD_INFO"

( cd "${LKL_DIR}" && sha256sum ./* > sha256sums.txt )

echo "OK: ${LKL_DIR}/liblkl.a"
