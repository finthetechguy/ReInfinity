#include "log.h"

/* Only system calls, no liblv2: the log must work on threads without TLS (see lv2.h). */
static u32 log_lock;
static const char *log_path;
static u64 timebase_hz;

typedef struct {
	char *buf;
	u32 len, cap;
} out_t;

static void put(out_t *o, char c)
{
	if (o->len + 1 < o->cap) /* keep room for the newline or terminator */
		o->buf[o->len++] = c;
}

static void put_str(out_t *o, const char *s)
{
	while (*s)
		put(o, *s++);
}

static void put_num(out_t *o, u64 v, u32 base, int width, char pad, int neg, int upper)
{
	const char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
	char tmp[24];
	int n = 0;
	do {
		tmp[n++] = digits[v % base];
		v /= base;
	} while (v);
	if (neg)
		tmp[n++] = '-';
	while (width-- > n)
		put(o, pad);
	while (n)
		put(o, tmp[--n]);
}

/* A small printf: %s %c %d %i %u %x %X %p, with '0', a width and 'l'/'ll'. */
static void format(out_t *o, const char *fmt, va_list ap)
{
	for (; *fmt; fmt++) {
		if (*fmt != '%') {
			put(o, *fmt);
			continue;
		}
		fmt++;
		char pad = ' ';
		int width = 0, lng = 0;
		if (*fmt == '0') {
			pad = '0';
			fmt++;
		}
		while (*fmt >= '0' && *fmt <= '9')
			width = width * 10 + (*fmt++ - '0');
		while (*fmt == 'l') {
			lng++;
			fmt++;
		}
		switch (*fmt) {
		case 's': {
			const char *s = va_arg(ap, const char *);
			put_str(o, s ? s : "(null)");
			break;
		}
		case 'c':
			put(o, (char)va_arg(ap, int));
			break;
		case 'd':
		case 'i': {
			s64 v = lng ? va_arg(ap, s64) : va_arg(ap, int);
			put_num(o, v < 0 ? -(u64)v : (u64)v, 10, width, pad, v < 0, 0);
			break;
		}
		case 'u':
		case 'x':
		case 'X': {
			u64 v = lng ? va_arg(ap, u64) : va_arg(ap, unsigned);
			put_num(o, v, *fmt == 'u' ? 10 : 16, width, pad, 0, *fmt == 'X');
			break;
		}
		case 'p':
			put_str(o, "0x");
			put_num(o, (uintptr_t)va_arg(ap, void *), 16, 8, '0', 0, 0);
			break;
		case '\0':
			return;
		default:
			put(o, *fmt);
			break;
		}
	}
}

static void write_file(const char *data, u32 len, s32 flags)
{
	s32 fd;
	u64 written;
	if (sys_fs_open(log_path, CELL_FS_O_WRONLY | CELL_FS_O_CREAT | flags, &fd, 0666) != 0)
		return;
	sys_fs_write(fd, data, len, &written);
	sys_fs_close(fd);
}

u32 str_format(char *buf, u32 size, const char *fmt, ...)
{
	out_t o = { buf, 0, size };
	va_list ap;
	va_start(ap, fmt);
	format(&o, fmt, ap);
	va_end(ap);
	buf[o.len] = 0;
	return o.len;
}

void log_init(const char *path)
{
	log_path = path;
	write_file("", 0, CELL_FS_O_TRUNC);
}

void log_printf(const char *fmt, ...)
{
	char buf[512];
	out_t o = { buf, 0, sizeof(buf) };
	u64 ticks = 0;
	if (!timebase_hz)
		timebase_hz = sys_time_get_timebase_frequency();
	while (ticks == 0) /* the Cell can briefly read 0 here; liblv2 retries too */
		__asm__ volatile("mftb %0" : "=r"(ticks));
	u64 us = timebase_hz ? ticks / timebase_hz * 1000000 + ticks % timebase_hz * 1000000 / timebase_hz : 0;

	put(&o, '[');
	put_num(&o, us / 1000000, 10, 0, ' ', 0, 0);
	put(&o, '.');
	put_num(&o, us % 1000000, 10, 6, '0', 0, 0);
	put_str(&o, "] ");

	va_list ap;
	va_start(ap, fmt);
	format(&o, fmt, ap);
	va_end(ap);
	o.buf[o.len++] = '\n';

	if (!log_path)
		return;
	while (__atomic_exchange_n(&log_lock, 1, __ATOMIC_ACQUIRE))
		sys_ppu_thread_yield();
	write_file(buf, o.len, CELL_FS_O_APPEND);
	__atomic_store_n(&log_lock, 0, __ATOMIC_RELEASE);
}
