#include "log.h"
#include "paths.h"
#include "settings.h"

static const char *bool_text(int v)
{
	return v ? "true" : "false";
}

u32 settings_format(const config_t *c, char *buf, u32 size)
{
	char titles[CONFIG_TITLES_MAX * 11];
	u32 len = 0;
	titles[0] = 0;
	for (u32 i = 0; i < c->title_count; i++)
		len += str_format(titles + len, sizeof(titles) - len, "%s%s", i ? ", " : "", c->titles[i]);
	return str_format(
		buf, size,
		"# ReInfinity PS3 plugin settings: " RI_CONFIG "\r\n"
		"# Change them on the settings page, http://<ps3-ip>:%u/, or edit this file.\r\n"
		"# Saving on the page rewrites this file, so comments you add here are lost.\r\n"
		"# One \"key = value\" per line; lines starting with # are comments.\r\n"
		"# Changes apply the next time Disney Infinity starts.\r\n"
		"\r\n"
		"# false: the plugin leaves the game alone.\r\n"
		"enabled = %s\r\n"
		"\r\n"
		"# The ReInfinity server's IP address or domain, e.g. 192.168.0.18 (no http:// and no port).\r\n"
		"server =%s%s\r\n"
		"\r\n"
		"# The server's port (1-65535).\r\n"
		"port = %u\r\n"
		"\r\n"
		"# Tell the game it's signed in to PSN when the console isn't, so it goes online.\r\n"
		"# A console that really is signed in is unaffected.\r\n"
		"psn_bypass = %s\r\n"
		"\r\n"
		"# true: log every request to log.txt, not just the first of each URL.\r\n"
		"log = %s\r\n"
		"\r\n"
		"# The settings page's port. A change applies after the PS3 restarts.\r\n"
		"web_port = %u\r\n"
		"\r\n"
		"# Which games the plugin loads into, as title IDs separated by commas. Leave it commented out\r\n"
		"# to use the built-in list: every Disney Infinity 1.0, 2.0 and 3.0 release.\r\n"
		"%s%s\r\n",
		c->web_port, bool_text(c->enabled), c->server[0] ? " " : "", c->server, c->port,
		bool_text(c->psn_bypass), bool_text(c->log_all), c->web_port,
		c->title_count ? "titles = " : "# titles = BLUS30977, BLES01843", titles);
}

s32 settings_save(const config_t *c)
{
	static char text[2048];
	u32 len = settings_format(c, text, sizeof(text));
	s32 fd;
	u64 written = 0;
	s32 result = sys_fs_open(RI_CONFIG_TMP, CELL_FS_O_WRONLY | CELL_FS_O_CREAT | CELL_FS_O_TRUNC, &fd, 0666);
	if (result == CELL_OK) {
		result = sys_fs_write(fd, text, len, &written);
		s32 closed = sys_fs_close(fd);
		if (result == CELL_OK)
			result = written == len ? closed : -1;
	}
	if (result != CELL_OK) {
		log_printf("can't write " RI_CONFIG_TMP " (0x%x, %u of %u bytes)", result, (u32)written, len);
		return result;
	}
	result = sys_fs_rename(RI_CONFIG_TMP, RI_CONFIG);
	if (result != CELL_OK) {
		/* In case the PS3's rename won't replace an existing file. */
		s32 removed = sys_fs_unlink(RI_CONFIG);
		s32 renamed = sys_fs_rename(RI_CONFIG_TMP, RI_CONFIG);
		log_printf("config.txt: renaming over it gave 0x%x, so it was deleted first (0x%x) then renamed (0x%x)",
			   result, removed, renamed);
		result = renamed;
	}
	log_printf("config.txt: %s (0x%x): enabled %s, server \"%s\", port %u, psn_bypass %s",
		   result == CELL_OK ? "saved" : "not saved", result, bool_text(c->enabled), c->server, c->port,
		   bool_text(c->psn_bypass));
	return result;
}
