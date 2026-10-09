#include "hooks.h"
#include "log.h"

static u32 apply_lock;
static int removed;
static u32 in_hook;

static void lock(void)
{
	while (__atomic_exchange_n(&apply_lock, 1, __ATOMIC_ACQUIRE))
		sys_ppu_thread_yield();
}

static void unlock(void)
{
	__atomic_store_n(&apply_lock, 0, __ATOMIC_RELEASE);
}

static u32 ours(const hook_t *h)
{
	return (u32)(uintptr_t)&h->opd;
}

void hooks_init(hook_t *hooks, u32 count)
{
	for (u32 i = 0; i < count; i++) {
		hook_t *h = &hooks[i];
		lv2_opd_t opd;
		prx_make_opd(&h->opd, h->fn);
		if (!h->wanted)
			continue;
		h->slot = prx_find_game_slot(h->lib, h->nid);
		if (!h->slot) {
			log_printf("%s (%s 0x%08x) isn't imported by this game", h->name, h->lib, h->nid);
			continue;
		}
		u32 now = *h->slot;
		if (prx_read_linked(now, &opd))
			log_printf("%s: slot@0x%08x = 0x%08x -> [0x%08x, toc 0x%08x]", h->name, (u32)(uintptr_t)h->slot,
				   now, opd.entry, opd.toc);
		else
			log_printf("%s: slot@0x%08x = 0x%08x, not linked yet", h->name, (u32)(uintptr_t)h->slot, now);
	}
}

u32 hooks_apply(hook_t *hooks, u32 count, const char *why)
{
	u32 changed = 0;
	lock();
	for (u32 i = 0; i < count && !removed; i++) {
		hook_t *h = &hooks[i];
		lv2_opd_t opd;
		if (!h->wanted || !h->slot)
			continue;
		u32 now = __atomic_load_n(h->slot, __ATOMIC_ACQUIRE);
		if (now == ours(h))
			continue;
		if (!prx_read_linked(now, &opd)) {
			if (h->hooked)
				log_printf("%s: its library was unloaded (the game does this when it quits); "
					   "hooked again if it's reloaded", h->name);
			h->hooked = 0;
			continue;
		}
		__atomic_store_n(&h->original, now, __ATOMIC_RELEASE);
		/* Only if the system hasn't changed the slot meanwhile; otherwise the next call retries. */
		if (!__atomic_compare_exchange_n(h->slot, &now, ours(h), 0, __ATOMIC_ACQ_REL, __ATOMIC_RELAXED))
			continue;
		changed++;
		h->hooked = 1;
		log_printf("hooked %s (%s): original 0x%08x -> [0x%08x, toc 0x%08x]", h->name, why, h->original,
			   opd.entry, opd.toc);
	}
	unlock();
	return changed;
}

int hook_active(const hook_t *h)
{
	return h->slot && *h->slot == ours(h);
}

void hooks_remove(hook_t *hooks, u32 count)
{
	lock();
	removed = 1;
	for (u32 i = 0; i < count; i++) {
		hook_t *h = &hooks[i];
		u32 expected = ours(h);
		if (h->wanted && h->slot &&
		    __atomic_compare_exchange_n(h->slot, &expected, h->original, 0, __ATOMIC_ACQ_REL, __ATOMIC_RELAXED))
			log_printf("unhooked %s", h->name);
	}
	unlock();
	/* A thread may have read a slot just before it changed and not reached hook_enter yet. */
	sys_timer_usleep(100000);
	u32 ms = 0;
	for (; __atomic_load_n(&in_hook, __ATOMIC_ACQUIRE) && ms < 5000; ms += 10)
		sys_timer_usleep(10000);
	if (ms >= 5000)
		log_printf("a thread is still inside a hook after 5 s, unloading anyway");
	sys_timer_usleep(50000); /* and for any thread that just left to get out of our code */
}

void hook_enter(void)
{
	__atomic_fetch_add(&in_hook, 1, __ATOMIC_ACQ_REL);
}

void hook_leave(void)
{
	__atomic_fetch_sub(&in_hook, 1, __ATOMIC_ACQ_REL);
}
