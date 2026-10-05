#include "thread.h"

static void trampoline(u64 arg)
{
	thread_t *t = PTR(arg);
	t->fn(t);
	t->running = 0;
	sys_ppu_thread_exit(0);
}

s32 thread_start(thread_t *t, void (*fn)(thread_t *t), s32 prio, u64 stack_size, const char *name)
{
	t->fn = fn;
	t->stop = 0;
	t->running = 1;
	prx_make_opd(&t->opd, (void (*)(void))trampoline);
	s32 result = sys_ppu_thread_create(&t->id, &t->opd, (uintptr_t)t, prio, stack_size,
					   SYS_PPU_THREAD_CREATE_JOINABLE, name);
	if (result != CELL_OK) {
		t->running = 0;
		t->id = 0;
	}
	return result;
}

int thread_stop(thread_t *t)
{
	if (!t->id)
		return 1;
	t->stop = 1;
	for (int ms = 0; t->running && ms < 2000; ms += 10)
		sys_timer_usleep(10000);
	if (t->running)
		return 0;
	u64 value;
	sys_ppu_thread_join(t->id, &value);
	t->id = 0;
	return 1;
}

int thread_sleep(thread_t *t, u32 ms)
{
	for (; ms && !t->stop; ms -= ms < 100 ? ms : 100)
		sys_timer_usleep((ms < 100 ? ms : 100) * 1000);
	return !t->stop;
}
