/* The VSH (XMB) plugin, Stage 1: proves it loads, logs, shows a notification and unloads
   cleanly. Later stages add the game watcher, the settings page and the config file. */
#include "log.h"
#include "paths.h"
#include "thread.h"

#define MAIN_PRIO  3000
#define MAIN_STACK 0x4000

/* vshtask_A02D46E7: shows a notification on the XMB or over a game. The first argument is 0. */
s32 vshtask_notify(s32 unk, const char *msg);

static thread_t main_thread;

static void plugin_main(thread_t *t)
{
	log_printf("main thread running");
	if (!thread_sleep(t, 3000)) /* let the XMB settle first */
		return;
	log_printf("showing notification");
	s32 result = vshtask_notify(0, "ReInfinity: VSH plugin loaded (Stage 1 test)");
	log_printf("notification shown (0x%x)", result);
}

/* Cobra runs this on a kernel-made thread, so it may only use what lv2.h allows. */
int module_start(u64 args, u64 argp)
{
	(void)args;
	(void)argp;
	s32 mkdir_result = sys_fs_mkdir(RI_DIR, 0777);
	log_init(RI_VSH_LOG);
	log_printf("ReInfinity VSH plugin loaded (build " __DATE__ " " __TIME__ "), Stage 1 test");
	log_printf("mkdir " RI_DIR ": 0x%x (0x80010014 = already there)", mkdir_result);
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
