/* The settings page, served by the plugin's thread between game checks (web.c). */
#pragma once

#include "thread.h"

/* Reads web_port from config.txt and listens on it, retrying every few seconds if that fails. */
void web_start(void);

/* Waits about 100 ms for a browser, and answers its request if one connects. */
void web_poll(thread_t *t);

void web_stop(void);
