/* Hooks on the game's imports. Each import slot holds the address of the system's LV2
   descriptor for the function. A hook puts the address of ours there instead and keeps the
   system's as the original, so the hook can call it. */
#pragma once

#include "prx.h"

typedef struct {
	const char *lib;
	u32 nid;
	const char *name;
	void (*fn)(void); /* our replacement */
	int wanted; /* set before hooks_init */
	u32 *slot; /* NULL if the game doesn't import it */
	lv2_opd_t opd; /* our descriptor: its address goes in the slot */
	volatile u32 original; /* the system's descriptor, for lv2_call */
	int hooked; /* until the slot is found reset, i.e. its library was unloaded */
} hook_t;

/* Finds each wanted hook's slot in the game and logs it. */
void hooks_init(hook_t *hooks, u32 count);

/* Points each wanted slot that the system has linked at our hook, keeping what was there as
   the original. Each change is logged with `why`. Returns how many slots it changed. */
u32 hooks_apply(hook_t *hooks, u32 count, const char *why);

/* Whether h's slot points at our hook right now. */
int hook_active(const hook_t *h);

/* Puts the originals back, stops hooks_apply for good, and waits until no thread is inside
   a hook, so the module can be unloaded. */
void hooks_remove(hook_t *hooks, u32 count);

/* Every hook starts with hook_enter and ends with hook_leave, for hooks_remove. */
void hook_enter(void);
void hook_leave(void);
