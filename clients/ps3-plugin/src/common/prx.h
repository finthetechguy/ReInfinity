/* Our module's place in memory, LV2 function descriptors, and the game's import slots. */
#pragma once

#include "lv2.h"

/* An LV2 function descriptor: what PS3 code means by a function pointer. */
typedef struct {
	u32 entry;
	u32 toc;
} lv2_opd_t;

/* Fills an LV2 descriptor for one of our (gcc) functions, e.g. a thread entry. */
void prx_make_opd(lv2_opd_t *opd, void (*fn)(void));

/* Logs where our module was loaded. */
void prx_log_layout(void);

/* The game's import slot for function `nid` of library `lib`, or NULL if the game doesn't
   import it. Found through the game's ELF header, so it works for any region or version. */
u32 *prx_find_game_slot(const char *lib, u32 nid);

/* Reads the LV2 descriptor a slot points at. Returns 0 if `addr` isn't mapped memory. */
int prx_read_opd(u32 addr, lv2_opd_t *out);

/* Cobra and PS3MAPI run module_start and module_stop on threads the kernel creates, with
   nothing to return to. Like SDK-built plugins, module_start must end with prx_end_start()
   and module_stop with prx_end_stop(), which also tells the kernel the stop is complete. */
void prx_end_start(void) __attribute__((noreturn));
void prx_end_stop(void) __attribute__((noreturn));

/* Logs where each of our imports was linked. Returns 0 if any slot isn't, in which case
   calling it would crash, so the module must stay idle. */
int prx_check_imports(void);
