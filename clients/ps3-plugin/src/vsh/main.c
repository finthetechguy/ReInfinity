/* The VSH (XMB) plugin, loaded at boot from boot_plugins.txt: watches for Disney Infinity and
   loads the game module into it (game.c). Stage 4 adds the settings page. */
#include "game.h"
#include "log.h"
#include "paths.h"
#include "thread.h"

#define MAIN_PRIO  3000
#define MAIN_STACK 0x4000
#define POLL_MS    1000

static thread_t main_thread;

static void plugin_main(thread_t *t)
{
	log_printf("watching for Disney Infinity");
	while (thread_sleep(t, POLL_MS))
		game_poll();
}

/* Cobra runs this on a kernel-made thread, so it may only use what lv2.h allows. */
int module_start(u64 args, u64 argp)
{
	(void)args;
	(void)argp;
	s32 mkdir_result = sys_fs_mkdir(RI_DIR, 0777);
	sys_fs_unlink(RI_VSH_PREV); /* so the rename never has to replace a file */
	s32 rename_result = sys_fs_rename(RI_VSH_LOG, RI_VSH_PREV);
	log_init(RI_VSH_LOG);
	log_printf("ReInfinity VSH plugin loaded (build " __DATE__ " " __TIME__ ")");
	log_printf("mkdir " RI_DIR ": 0x%x (0x80010014 = already there)", mkdir_result);
	log_printf("previous log kept as " RI_VSH_PREV ": 0x%x (0x80010006 = there was none)", rename_result);
	prx_log_layout();
	if (!prx_check_imports()) {
		log_printf("staying idle: our imports weren't linked");
		prx_end_start();
	}
	s32 result = thread_start(&main_thread, plugin_main, MAIN_PRIO, MAIN_STACK, "reinfinity_vsh");
	log_printf("main thread: %s (0x%x)", result == CELL_OK ? "started" : "failed", result);
	prx_end_start();
}

int module_stop(u64 args, u64 argp)
{
	(void)args;
	(void)argp;
	log_printf("module_stop: main thread %s", thread_stop(&main_thread) ? "stopped" : "still running");
	prx_end_stop();
}
