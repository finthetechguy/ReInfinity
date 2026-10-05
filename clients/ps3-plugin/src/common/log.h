/* A log file, truncated by log_init. Each module has its own (paths.h). */
#pragma once

#include "lv2.h"

void log_init(const char *path);
void log_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));

/* The log's printf into a buffer, cut to fit and always terminated. Returns the length. */
u32 str_format(char *buf, u32 size, const char *fmt, ...) __attribute__((format(printf, 3, 4)));
