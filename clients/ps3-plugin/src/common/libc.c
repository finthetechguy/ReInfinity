/* The few libc functions gcc may call on its own (struct copies, zeroing). Built with
   -fno-tree-loop-distribute-patterns so these loops don't turn into calls to themselves. */
#include "lv2.h"

void *memset(void *dst, int c, size_t n)
{
	u8 *d = dst;
	while (n--)
		*d++ = (u8)c;
	return dst;
}

void *memcpy(void *dst, const void *src, size_t n)
{
	u8 *d = dst;
	const u8 *s = src;
	while (n--)
		*d++ = *s++;
	return dst;
}

size_t strlen(const char *s)
{
	size_t n = 0;
	while (s[n])
		n++;
	return n;
}

int strcmp(const char *a, const char *b)
{
	while (*a && *a == *b)
		a++, b++;
	return (u8)*a - (u8)*b;
}

static u8 lower(u8 c)
{
	return c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c;
}

int strcasecmp(const char *a, const char *b)
{
	while (*a && lower(*a) == lower(*b))
		a++, b++;
	return lower(*a) - lower(*b);
}
