/* Joinable worker threads that stop when asked, so module_stop never leaves one running. */
#pragma once

#include "prx.h"

typedef struct thread thread_t;
struct thread {
	void (*fn)(thread_t *t);
	lv2_opd_t opd;
	u64 id;
	volatile int stop;
	volatile int running;
};

/* Runs fn(t) on a new thread. Returns CELL_OK or the system's error. */
s32 thread_start(thread_t *t, void (*fn)(thread_t *t), s32 prio, u64 stack_size, const char *name);

/* Asks the thread to stop and waits up to 2 s. Returns 0 if it's still running. */
int thread_stop(thread_t *t);

/* Sleeps for `ms`, waking early if the thread is asked to stop. Returns 0 once it should stop. */
int thread_sleep(thread_t *t, u32 ms);
