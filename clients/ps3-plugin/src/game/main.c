/* The game module, Stage 1 (read-only): logs which game it was loaded into and the import
   slots the redirect will hook, then watches for the system to fill them. It changes nothing. */
#include "log.h"
#include "paths.h"
#include "thread.h"

#define WATCH_PRIO  3000
#define WATCH_STACK 0x4000

typedef struct {
	const char *lib;
	u32 nid; /* from the function's name, so the same in every game */
	const char *name;
	u32 *slot;
	u32 last;
} watched_t;

static watched_t watched[] = {
	{ "cellHttp", 0x052a80d9, "cellHttpCreateTransaction", NULL, 0 },
	{ "cellHttpUtil", 0x32faaf58, "cellHttpUtilParseUri", NULL, 0 },
	{ "sceNp", 0xa7bff757, "sceNpManagerGetStatus", NULL, 0 },
	{ "cellSysmodule", 0x32267a31, "cellSysmoduleLoadModule", NULL, 0 },
};
#define WATCHED_COUNT (sizeof(watched) / sizeof(watched[0]))

static thread_t watcher;

static void log_slot(const char *when, const watched_t *w)
{
	lv2_opd_t opd;
	u32 now = *w->slot;
	if (prx_read_opd(now, &opd))
		log_printf("%s %s slot@0x%08x = 0x%08x -> [0x%08x, toc 0x%08x]", when, w->name,
			   (u32)(uintptr_t)w->slot, now, opd.entry, opd.toc);
	else
		log_printf("%s %s slot@0x%08x = 0x%08x (not mapped)", when, w->name, (u32)(uintptr_t)w->slot, now);
}

static void watch_slots(thread_t *t)
{
	while (thread_sleep(t, 1000)) {
		for (u32 i = 0; i < WATCHED_COUNT; i++) {
			watched_t *w = &watched[i];
			if (w->slot && *w->slot != w->last) {
				w->last = *w->slot;
				log_slot("changed:", w);
			}
		}
	}
}

/* Under PS3MAPI this runs on a kernel-made thread, so it may only use what lv2.h allows. */
int module_start(u64 args, u64 argp)
{
	log_init(RI_GAME_LOG);
	log_printf("ReInfinity game module loaded (build " __DATE__ " " __TIME__ "), Stage 1: read-only");

	u8 sfo[0x80];
	memset(sfo, 0, sizeof(sfo));
	s32 result = sys_process_get_paramsfo(sfo);
	sfo[10] = 0; /* the title ID is 9 characters at +1 */
	log_printf("process %u, title ID %s (paramsfo 0x%x), start args 0x%lx 0x%lx", sys_process_getpid(),
		   result == CELL_OK ? (const char *)sfo + 1 : "?", result, args, argp);
	prx_log_layout();

	for (u32 i = 0; i < WATCHED_COUNT; i++) {
		watched_t *w = &watched[i];
		w->slot = prx_find_game_slot(w->lib, w->nid);
		if (!w->slot) {
			log_printf("at start: %s (%s 0x%08x) isn't imported by this game", w->name, w->lib, w->nid);
			continue;
		}
		w->last = *w->slot;
		log_slot("at start:", w);
	}

	if (!prx_check_imports()) {
		log_printf("staying idle: our imports weren't linked");
		prx_end_start();
	}
	result = thread_start(&watcher, watch_slots, WATCH_PRIO, WATCH_STACK, "reinfinity_watch");
	log_printf("slot watcher: %s (0x%x)", result == CELL_OK ? "started" : "failed", result);
	prx_end_start();
}

int module_stop(u64 args, u64 argp)
{
	(void)args;
	(void)argp;
	log_printf("module_stop: watcher %s", thread_stop(&watcher) ? "stopped" : "still running");
	prx_end_stop();
}
