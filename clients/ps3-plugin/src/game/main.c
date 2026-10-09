/* The game module, loaded into Disney Infinity's process: reads config.txt, hooks the game's
   online imports (redirect.c), and keeps status.txt up to date for the VSH plugin. */
#include "log.h"
#include "paths.h"
#include "redirect.h"
#include "thread.h"

#define WATCH_PRIO  3000
#define WATCH_STACK 0x4000

static config_t cfg;
static thread_t watcher;
static char title[10] = "?";
static u32 pid;

/* Rewritten only when it changes. Never called from two threads at once. */
static void write_status(void)
{
	static char text[1024], written[1024];
	static int failed;
	u32 len = str_format(text, sizeof(text), "# ReInfinity game module status, read by the VSH plugin\n"
						 "title = %s\npid = %u\n", title, pid);
	len += redirect_status(text + len, sizeof(text) - len);
	if (strcmp(text, written) == 0)
		return;
	s32 fd;
	u64 done;
	s32 result = sys_fs_open(RI_STATUS, CELL_FS_O_WRONLY | CELL_FS_O_CREAT | CELL_FS_O_TRUNC, &fd, 0666);
	if (result != CELL_OK) {
		if (!failed)
			log_printf("can't write " RI_STATUS " (0x%x)", result);
		failed = 1;
		return;
	}
	sys_fs_write(fd, text, len, &done);
	sys_fs_close(fd);
	memcpy(written, text, len + 1);
}

static void watch(thread_t *t)
{
	while (thread_sleep(t, 1000)) {
		redirect_check();
		write_status();
	}
}

/* Under PS3MAPI this runs on a kernel-made thread, so it may only use what lv2.h allows. */
int module_start(u64 args, u64 argp)
{
	log_init(RI_GAME_LOG);
	log_printf("ReInfinity game module loaded (build " __DATE__ " " __TIME__ ")");

	u8 sfo[0x80];
	memset(sfo, 0, sizeof(sfo));
	s32 result = sys_process_get_paramsfo(sfo);
	if (result == CELL_OK)
		memcpy(title, sfo + 1, 9); /* the title ID is 9 characters at +1 */
	pid = sys_process_getpid();
	log_printf("process %u, title ID %s (paramsfo 0x%x), start args 0x%lx 0x%lx", pid, title, result, args, argp);
	prx_log_layout();

	config_load(&cfg);
	int linked = prx_check_imports();
	int active = redirect_start(&cfg);
	write_status();
	if (active && linked) {
		result = thread_start(&watcher, watch, WATCH_PRIO, WATCH_STACK, "reinfinity_watch");
		log_printf("1 s check: %s (0x%x)", result == CELL_OK ? "started" : "failed", result);
	} else if (active) {
		log_printf("no 1 s check or status updates: our imports weren't linked");
	}
	prx_end_start();
}

int module_stop(u64 args, u64 argp)
{
	(void)args;
	(void)argp;
	log_printf("module_stop: 1 s check %s", thread_stop(&watcher) ? "stopped" : "still running");
	redirect_stop();
	write_status();
	prx_end_stop();
}
