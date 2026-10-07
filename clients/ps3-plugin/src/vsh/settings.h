/* Writes config.txt for the settings page. */
#pragma once

#include "config.h"

/* The file's text: install/config.example.txt's layout with c's values. Returns the length. */
u32 settings_format(const config_t *c, char *buf, u32 size);

/* Replaces config.txt through a temporary file. Returns CELL_OK or the failing call's error. */
s32 settings_save(const config_t *c);
