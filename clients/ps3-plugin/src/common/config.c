// config.txt: one "key = value" per line, and lines starting with '#' are comments.
#include "config.h"
#include "log.h"
#include "paths.h"

static void defaults(config_t *c)
{
	memset(c, 0, sizeof(*c));
	c->enabled = 1;
	c->port = 8080;
	c->psn_bypass = 1;
	c->web_port = 8090;
}

int config_valid_host(const char *s)
{
	size_t n = strlen(s);
	if (n == 0 || n > CONFIG_HOST_MAX)
		return 0;
	for (; *s; s++) {
		char ch = *s;
		if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '.' ||
		      ch == '-'))
			return 0;
	}
	return 1;
}

static char *trim(char *s)
{
	while (*s == ' ' || *s == '\t')
		s++;
	char *end = s + strlen(s);
	while (end > s && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\r'))
		*--end = 0;
	return s;
}

static int parse_bool(const char *v, int *out)
{
	if (strcasecmp(v, "true") == 0 || strcmp(v, "1") == 0)
		*out = 1;
	else if (strcasecmp(v, "false") == 0 || strcmp(v, "0") == 0)
		*out = 0;
	else
		return 0;
	return 1;
}

int config_parse_port(const char *v, u32 *out)
{
	u32 n = 0;
	if (!*v)
		return 0;
	for (; *v; v++) {
		if (*v < '0' || *v > '9' || n > 65535)
			return 0;
		n = n * 10 + (*v - '0');
	}
	if (n < 1 || n > 65535)
		return 0;
	*out = n;
	return 1;
}

static int valid_title(const char *id)
{
	for (int i = 0; i < 9; i++)
		if (!((id[i] >= 'A' && id[i] <= 'Z') || (id[i] >= '0' && id[i] <= '9')))
			return 0;
	return 1;
}

/* Title IDs separated by commas or spaces, e.g. "BLUS30977, BLES01843". */
static void parse_titles(config_t *c, char *v, u32 number)
{
	c->title_count = 0;
	for (;;) {
		while (*v == ',' || *v == ' ' || *v == '\t')
			v++;
		if (!*v)
			return;
		char *id = v;
		while (*v && *v != ',' && *v != ' ' && *v != '\t')
			v++;
		char end = *v;
		*v = 0;
		for (char *ch = id; *ch; ch++)
			if (*ch >= 'a' && *ch <= 'z')
				*ch -= 'a' - 'A';
		if (v - id != 9 || !valid_title(id)) {
			log_printf("config.txt line %u: \"%s\" isn't a title ID like BLUS30977, so it's ignored", number, id);
		} else if (c->title_count == CONFIG_TITLES_MAX) {
			log_printf("config.txt line %u: only the first %u titles are used", number, CONFIG_TITLES_MAX);
			return;
		} else {
			memcpy(c->titles[c->title_count++], id, 10);
		}
		*v = end;
	}
}

static void parse_line(config_t *c, char *line, u32 number)
{
	if (!*line || *line == '#')
		return;
	char *eq = line;
	while (*eq && *eq != '=')
		eq++;
	if (!*eq) {
		log_printf("config.txt line %u: no '=' in \"%s\"", number, line);
		return;
	}
	*eq = 0;
	char *key = trim(line), *value = trim(eq + 1);
	int ok;
	if (strcasecmp(key, "enabled") == 0) {
		ok = parse_bool(value, &c->enabled);
	} else if (strcasecmp(key, "psn_bypass") == 0) {
		ok = parse_bool(value, &c->psn_bypass);
	} else if (strcasecmp(key, "log") == 0) {
		ok = parse_bool(value, &c->log_all);
	} else if (strcasecmp(key, "port") == 0) {
		ok = config_parse_port(value, &c->port);
	} else if (strcasecmp(key, "web_port") == 0) {
		ok = config_parse_port(value, &c->web_port);
	} else if (strcasecmp(key, "server") == 0) {
		c->server[0] = 0;
		c->server_invalid = *value && !config_valid_host(value);
		if (c->server_invalid)
			log_printf("config.txt line %u: server \"%s\" isn't a plain IP address or domain "
				   "(no http:// or :port; the port goes in port =)",
				   number, value);
		else
			memcpy(c->server, value, strlen(value) + 1);
		return;
	} else if (strcasecmp(key, "titles") == 0) {
		parse_titles(c, value, number);
		return;
	} else {
		log_printf("config.txt line %u: unknown setting \"%s\"", number, key);
		return;
	}
	if (!ok)
		log_printf("config.txt line %u: \"%s\" isn't a valid value for %s, so it's ignored", number, value, key);
}

void config_parse(config_t *c, char *text)
{
	char *line = text;
	u32 number = 1;
	if ((u8)line[0] == 0xEF && (u8)line[1] == 0xBB && (u8)line[2] == 0xBF)
		line += 3; /* a UTF-8 byte order mark, as Notepad writes */
	while (*line) {
		char *end = line;
		while (*end && *end != '\n')
			end++;
		char *next = *end ? end + 1 : end;
		*end = 0;
		parse_line(c, trim(line), number++);
		line = next;
	}
}

void config_load(config_t *c)
{
	static char text[4096];
	s32 fd;
	defaults(c);
	s32 result = sys_fs_open(RI_CONFIG, CELL_FS_O_RDONLY, &fd, 0);
	if (result != CELL_OK) {
		log_printf("config.txt: %s (0x%x), so the defaults apply",
			   (u32)result == CELL_FS_ERROR_ENOENT ? "not found" : "can't open it", result);
	} else {
		u64 got = 0;
		result = sys_fs_read(fd, text, sizeof(text) - 1, &got);
		sys_fs_close(fd);
		text[got] = 0;
		log_printf("config.txt: read %u bytes (0x%x)%s", (u32)got, result,
			   got == sizeof(text) - 1 ? ", only the first 4 KB are used" : "");
		config_parse(c, text);
	}
	log_printf("config: enabled %s, server \"%s\", port %u, psn_bypass %s, log %s, web_port %u",
		   c->enabled ? "true" : "false", c->server, c->port, c->psn_bypass ? "true" : "false",
		   c->log_all ? "true" : "false", c->web_port);
	if (c->title_count) {
		char list[CONFIG_TITLES_MAX * 11];
		u32 len = 0;
		for (u32 i = 0; i < c->title_count; i++)
			len += str_format(list + len, sizeof(list) - len, "%s%s", i ? " " : "", c->titles[i]);
		log_printf("config: titles %s", list);
	}
}
