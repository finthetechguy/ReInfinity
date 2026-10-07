/* VSH functions imported by NID (prx/vsh.json; NIDs from webMAN MOD's headers) and the PS3MAPI
   calls. The imports return u64 so that callers cut the result to 32 bits themselves rather
   than trust VSH code to clear the upper half. */
#pragma once

#include "lv2.h"

/* vshtask_A02D46E7: shows a notification on the XMB or over a game. The first argument is 0. */
u64 vshtask_notify(s32 unk, const char *msg);

/* Shows "ReInfinity: <msg>" that way and logs it (main.c). */
void notify(const char *msg);

/* vshmain_0624D3AE: the running game's process ID, or 0 when there's none. */
u64 vsh_game_pid(void);

/* paf_F21655F3 (paf::View::Find): a loaded VSH plugin's view by name, or 0. */
u64 paf_view_find(const char *name);

/* paf_23AFB290 (paf::View::GetInterface): a plugin's table of function descriptors. */
u64 paf_view_get_interface(u32 view, s32 id);

/* PS3MAPI: Cobra's syscall 8 with opcode 0x7777. */
#define PS3MAPI_MAX_MODULES 128 /* webMAN's largest module list buffer */

static inline s32 ps3mapi_load_module(u32 pid, const char *path)
{
	return (s32)lv2_syscall(8, 0x7777, 0x0044, pid, (uintptr_t)path, 0, 0);
}
static inline s32 ps3mapi_module_ids(u32 pid, u32 ids[PS3MAPI_MAX_MODULES])
{
	return (s32)lv2_syscall(8, 0x7777, 0x0041, pid, (uintptr_t)ids, 0, 0);
}
static inline s32 ps3mapi_module_name(u32 pid, u32 id, char *name)
{
	return (s32)lv2_syscall(8, 0x7777, 0x0042, pid, id, (uintptr_t)name, 0);
}
