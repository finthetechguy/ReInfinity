/* A log file, truncated by log_init. Each module has its own (paths.h). */
#pragma once

#include "lv2.h"

void log_init(const char *path);
void log_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
