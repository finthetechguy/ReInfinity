/* The VSH (XMB) plugin, loaded at boot from boot_plugins.txt: watches for Disney Infinity and
   loads the game module into it (game.c), and serves the settings page (web.c). */
#include "game.h"
#include "log.h"
#include "paths.h"
#include "thread.h"
#include "vsh.h"
#include "web.h"

#define MAIN_PRIO  3000
#define MAIN_STACK 0x4000
#define POLL_US    1000000 /* how often game_poll runs */

static thread_t main_thread;

void notify(const char *msg)
{
	char text[384];
	str_format(text, sizeof(text), "ReInfinity: %s", msg);
	log_printf("notification: %s", text);
	vshtask_notify(0, text);
}

/* One thread does both jobs, so the page and the game watcher never run at the same time. */
static void plugin_main(thread_t *t)
{
	web_start();
	log_printf("watching for Disney Infinity");
	u64 last_poll = time_us();
	while (!t->stop) {
		web_poll(t);
		if (time_us() - last_poll >= POLL_US) {
			last_poll = time_us();
			game_poll();
		}
	}
	web_stop();
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
