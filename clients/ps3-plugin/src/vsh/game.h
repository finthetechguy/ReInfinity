/* Watches for Disney Infinity starting, loads the game module into it, and shows the result. */
#pragma once

#include "lv2.h"

/* What the settings page shows about the last listed game since boot. */
typedef struct {
	char id[10];      /* "" until a listed game starts */
	char name[64];
	int running;
	char result[300]; /* its last notification, without "ReInfinity: " ("" if none yet) */
} game_status_t;

/* Called once a second by the plugin's thread. */
void game_poll(void);

/* Only for the plugin's thread, like game_poll. */
const game_status_t *game_status(void);
