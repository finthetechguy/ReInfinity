/* The plugin's settings, from /dev_hdd0/reinfinity/config.txt (install/config.example.txt). */
#pragma once

#include "lv2.h"

#define CONFIG_HOST_MAX   253
#define CONFIG_TITLES_MAX 32

typedef struct {
	int enabled;
	char server[CONFIG_HOST_MAX + 1]; /* "" if unset or invalid */
	int server_invalid;
	u32 port;
	int psn_bypass;
	u32 web_port;
	int log_all;
	u32 title_count; /* 0: the VSH plugin's built-in list */
	char titles[CONFIG_TITLES_MAX][10];
} config_t;

/* The defaults, then the file's values. Problems are logged, and a bad value is ignored. */
void config_load(config_t *c);

/* Parses the file's text (changed in place) over the values already in *c. */
void config_parse(config_t *c, char *text);

/* Whether s is a bare IP address or domain: letters, digits, '.' and '-'. */
int config_valid_host(const char *s);

/* Parses a port, 1-65535, digits only. Returns 0 (leaving *out alone) if v isn't one. */
int config_parse_port(const char *v, u32 *out);
