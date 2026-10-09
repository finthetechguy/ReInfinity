#!/usr/bin/env python3
"""Dump a PS3 PPU PRX (or an executable's imports): module info, exports, imports, relocations.

Usage: prxinfo.py <decrypted .prx/.elf> [--names extra_names.txt]
"""
import hashlib
import struct
import sys
from collections import Counter

NID_SUFFIX = bytes.fromhex("6759659904250490566427499489741A")

# Names we know, so NIDs print as text. NIDs are derived from names, so any list works.
KNOWN_NAMES = """
module_start module_stop module_exit module_info module_prologue module_epilogue
sys_ppu_thread_create sys_ppu_thread_exit sys_ppu_thread_get_id sys_ppu_thread_once
sys_lwmutex_create sys_lwmutex_destroy sys_lwmutex_lock sys_lwmutex_trylock sys_lwmutex_unlock
sys_lwcond_create sys_lwcond_destroy sys_lwcond_wait sys_lwcond_signal sys_lwcond_signal_all
sys_prx_load_module sys_prx_start_module sys_prx_stop_module sys_prx_unload_module sys_prx_exitspawn_with_level
sys_time_get_system_time sys_process_exit sys_process_is_stack sys_timer_usleep sys_timer_sleep
sys_heap_create_heap sys_heap_malloc sys_heap_memalign sys_heap_free sys_heap_delete_heap
sys_mmapper_allocate_memory sys_memory_allocate sys_memory_free
_sys_malloc _sys_free _sys_memalign _sys_memset _sys_memcpy _sys_memcmp _sys_memmove _sys_memchr
_sys_strlen _sys_strcmp _sys_strncmp _sys_strcpy _sys_strncpy _sys_strcat _sys_strncat _sys_strchr _sys_strrchr
_sys_sprintf _sys_snprintf _sys_printf _sys_vsprintf _sys_vsnprintf _sys_vprintf _sys_toupper _sys_tolower
_sys_lwmutex_lock_spin _sys_spu_printf_initialize sys_spu_image_import sys_spu_image_close
sys_event_queue_create sys_event_queue_destroy sys_event_queue_receive sys_event_port_create sys_event_port_send
cellSysmoduleLoadModule cellSysmoduleUnloadModule cellSysmoduleInitialize cellSysmoduleFinalize
cellFsOpen cellFsRead cellFsWrite cellFsClose cellFsStat cellFsFstat cellFsLseek cellFsMkdir cellFsUnlink cellFsRename
cellFsOpendir cellFsReaddir cellFsClosedir
cellHttpInit cellHttpEnd cellHttpCreateClient cellHttpDestroyClient cellHttpCreateTransaction
cellHttpDestroyTransaction cellHttpSendRequest cellHttpRecvResponse cellHttpResponseGetStatusCode
cellHttpClientSetHeader cellHttpRequestSetHeader cellHttpRequestAddHeader cellHttpUtilParseUri cellHttpUtilBuildUri
sceNpInit sceNpTerm sceNpManagerGetStatus sceNpManagerGetNpId sceNpManagerGetOnlineId sceNpManagerRegisterCallback
sceNpManagerRequestTicket sceNpManagerRequestTicket2 sceNpManagerGetTicket
cellNetCtlInit cellNetCtlTerm cellNetCtlGetState cellNetCtlGetInfo
""".split()


def nid(name):
    return struct.unpack("<I", hashlib.sha1(name.encode() + NID_SUFFIX).digest()[:4])[0]


class Elf:
    def __init__(self, data):
        self.d = data
        assert data[:4] == b"\x7fELF", "not an ELF (decrypt the SELF first)"
        (self.type, self.machine, _, self.entry, self.phoff, _, self.flags, _, _, self.phnum) = struct.unpack_from(
            ">HHIQQQIHHH", data, 0x10)
        self.phdrs = [struct.unpack_from(">IIQQQQQQ", data, self.phoff + i * 56) for i in range(self.phnum)]
        self.loads = [p for p in self.phdrs if p[0] == 1]

    def off(self, vaddr):
        for (_, _, off, va, _, filesz, memsz, _) in self.loads:
            if va <= vaddr < va + memsz:
                return off + (vaddr - va) if vaddr - va < filesz else None
        return None

    def u32(self, va):
        return struct.unpack_from(">I", self.d, self.off(va))[0]

    def cstr(self, va):
        o = self.off(va)
        return self.d[o:self.d.index(b"\0", o)].decode("latin-1") if o is not None else "?"


def libents(elf, start, end, names, is_import):
    out = []
    addr = start
    while addr < end:
        o = elf.off(addr)
        (size, _, ver, attr, nfunc, nvar, ntls, _, _, _, name_p, nids_p, addrs_p, vnids_p, vstubs_p, unk4,
         unk5) = struct.unpack_from(">BBHHHHHBB2sIIIIIII", elf.d, o)
        lname = elf.cstr(name_p) if name_p else "<module>"
        print(f"  {'import' if is_import else 'export'} lib '{lname}' size=0x{size:x} ver=0x{ver:x} attr=0x{attr:04x}"
              f" funcs={nfunc} vars={nvar} tls={ntls} @0x{addr:x}")
        for i in range(nfunc + (0 if is_import else nvar)):
            n = elf.u32(nids_p + 4 * i)
            a = elf.u32(addrs_p + 4 * i) if not is_import else addrs_p + 4 * i
            extra = ""
            if not is_import and i < nfunc:
                extra = f" opd=[0x{elf.u32(a):x}, toc 0x{elf.u32(a + 4):x}]"
            print(f"    0x{n:08x} {names.get(n, '?'):34s} {'slot' if is_import else 'addr'}=0x{a:x}{extra}")
        if is_import and nvar:
            for i in range(nvar):
                print(f"    var 0x{elf.u32(vnids_p + 4 * i):08x} {names.get(elf.u32(vnids_p + 4 * i), '?')}")
        out.append(lname)
        addr += size or 0x2c
    return out


def main():
    data = open(sys.argv[1], "rb").read()
    names = {nid(n): n for n in KNOWN_NAMES}
    if "--names" in sys.argv:
        for n in open(sys.argv[sys.argv.index("--names") + 1]).read().split():
            names[nid(n)] = n
    elf = Elf(data)
    print(f"type=0x{elf.type:x} flags=0x{elf.flags:x} entry=0x{elf.entry:x}")
    for p in elf.phdrs:
        print("  phdr type=0x%08x flags=0x%x off=0x%x vaddr=0x%x paddr=0x%x filesz=0x%x memsz=0x%x align=0x%x" % p)

    if elf.type == 0xFFA4:  # PRX
        p0 = elf.phdrs[0]
        mi_va = p0[3] + p0[4] - p0[2]
        o = elf.off(mi_va)
        attr, v0, v1, mname, toc, es, ee, is_, ie = struct.unpack_from(">HBB28sIIIII", data, o)
        print(f"module info @0x{mi_va:x}: name='{mname.rstrip(bytes(1)).decode()}' attr=0x{attr:04x} ver={v0}.{v1}"
              f" toc=0x{toc:x} exports=0x{es:x}-0x{ee:x} imports=0x{is_:x}-0x{ie:x}")
        libents(elf, es, ee, names, False)
        libents(elf, is_, ie, names, True)
        for p in elf.phdrs:
            if p[0] == 0x700000A4:
                types = Counter()
                for i in range(0, p[5], 24):
                    off, _, iv, ia, rtype, ptr = struct.unpack_from(">QHBBIQ", data, p[2] + i)
                    types[(rtype, ia, iv)] += 1
                print("relocations (type, seg patched, seg of target): count")
                for k, v in sorted(types.items()):
                    print(f"  {k}: {v}")
    else:  # executable: imports via the PRX param segment
        for p in elf.phdrs:
            if p[0] == 0x60000002:
                size, magic, ver, _, ls, le, ss, se = struct.unpack_from(">IIIIIIII", data, p[2])
                print(f"proc prx param magic=0x{magic:x} libent=0x{ls:x}-0x{le:x} libstub=0x{ss:x}-0x{se:x}")
                libents(elf, ss, se, names, True)


if __name__ == "__main__":
    main()
