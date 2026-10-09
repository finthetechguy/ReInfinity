/* When a listed game's process appears, this reads config.txt, loads the game module into the
   game through PS3MAPI, then reads the module's status.txt until the redirect is in (or has
   failed) and shows the result as a notification. */
#include "config.h"
#include "game.h"
#include "log.h"
#include "paths.h"
#include "prx.h"
#include "vsh.h"

#define GAME_MODULE "ReInfinity_Game" /* module_name in prx/game.json */
#define GAME_INFO   8                 /* gameInfo's index in game_plugin's interface */
#define TITLE_WAIT  10                /* seconds to wait for the title ID, as webMAN does */
#define LOAD_TRIES  3
#define START_WAIT  15 /* seconds for the module to write status.txt */
#define HOOK_WAIT   60 /* seconds for the redirect to be in */

static const char builtin_titles[][10] = {
	"BLES01842", "BLUS30977", "BLES01844", "BLES01843",                           /* 1.0 */
	"BLES02065", "BLES02066", "BLUS31418", "BLES02064", "NPUB31465", "BLES02100", /* 2.0 */
	"BLJS10323", "NPUB31657", "BLUS31522", "BLES02147", "BLES02148",              /* 3.0 */
};

enum phase { IDLE, TITLE, LOAD, WATCH, DONE };

static struct {
	enum phase phase;
	u32 pid;
	u32 seconds; /* polls since the phase began */
	u32 tries;
	int warned;
	char state[16]; /* the last state read from status.txt */
} g;

static config_t cfg;
static game_status_t last;

typedef struct {
	const char *pid, *state, *message, *url;
} status_t;

static void set_phase(enum phase phase)
{
	g.phase = phase;
	g.seconds = 0;
	g.tries = 0;
}

static void report(const char *msg)
{
	str_format(last.result, sizeof(last.result), "%s", msg);
	notify(msg);
}

/* The running game's title ID and name, from game_plugin's gameInfo as webMAN reads them. */
static int read_title(char id[10], char name[64])
{
	static u8 info[0x120];
	sys_page_attr_t attr;
	lv2_opd_t opd;
	u32 view = (u32)paf_view_find("game_plugin");
	if (!view)
		return 0;
	u32 iface = (u32)paf_view_get_interface(view, 1);
	if (!iface || sys_memory_get_page_attribute(iface + GAME_INFO * 4, &attr) != CELL_OK)
		return 0;
	u32 game_info = ((const u32 *)PTR(iface))[GAME_INFO];
	if (!prx_read_linked(game_info, &opd))
		return 0;
	memset(info, 0, sizeof(info));
	lv2_call(game_info, (uintptr_t)info, 0, 0, 0);
	memcpy(id, info + 0x04, 9);
	id[9] = 0;
	memcpy(name, info + 0x14, 63);
	name[63] = 0;
	return id[0] != 0;
}

static int is_listed(const char *id)
{
	if (cfg.title_count) {
		for (u32 i = 0; i < cfg.title_count; i++)
			if (strcmp(cfg.titles[i], id) == 0)
				return 1;
		return 0;
	}
	for (u32 i = 0; i < sizeof(builtin_titles) / sizeof(builtin_titles[0]); i++)
		if (strcmp(builtin_titles[i], id) == 0)
			return 1;
	return 0;
}

/* Whether the game already has our module, e.g. loaded by hand or before this plugin restarted. */
static int module_loaded(void)
{
	static u32 ids[PS3MAPI_MAX_MODULES];
	static char name[64];
	memset(ids, 0, sizeof(ids));
	s32 result = ps3mapi_module_ids(g.pid, ids);
	if (result != CELL_OK) {
		log_printf("can't list the game's modules (0x%x)", result);
		return 0;
	}
	for (u32 i = 0; i < PS3MAPI_MAX_MODULES; i++) {
		if (ids[i] <= 1)
			continue;
		memset(name, 0, sizeof(name));
		if (ps3mapi_module_name(g.pid, ids[i], name) == CELL_OK && strcmp(name, GAME_MODULE) == 0)
			return 1;
	}
	return 0;
}

static void load(void)
{
	s32 fd;
	if (module_loaded()) {
		log_printf(GAME_MODULE " is already in the game, so it isn't loaded again");
		set_phase(WATCH);
		return;
	}
	s32 result = sys_fs_open(RI_GAME_PRX, CELL_FS_O_RDONLY, &fd, 0);
	if (result != CELL_OK) {
		log_printf("can't open " RI_GAME_PRX " (0x%x)", result);
		report("can't find " RI_GAME_PRX);
		set_phase(DONE);
		return;
	}
	sys_fs_close(fd);
	/* Process IDs repeat after a reboot, so an old status.txt could look like this game's. */
	sys_fs_unlink(RI_STATUS);
	result = ps3mapi_load_module(g.pid, RI_GAME_PRX);
	log_printf("loading " RI_GAME_PRX " into process %u: 0x%x", g.pid, result);
	if (result == CELL_OK) {
		set_phase(WATCH);
	} else if (++g.tries >= LOAD_TRIES) {
		char msg[64];
		str_format(msg, sizeof(msg), "couldn't load the game module (0x%x)", result);
		report(msg);
		set_phase(DONE);
	}
}

static void found_title(const char *id, const char *name)
{
	config_load(&cfg);
	if (!is_listed(id)) {
		log_printf("%s \"%s\" isn't in the title list, so it's left alone", id, name);
		set_phase(DONE);
		return;
	}
	log_printf("%s \"%s\" is Disney Infinity", id, name);
	memcpy(last.id, id, sizeof(last.id));
	memcpy(last.name, name, sizeof(last.name));
	last.running = 1;
	last.result[0] = 0;
	if (!cfg.enabled) {
		report("off (enabled = false in config.txt)");
		set_phase(DONE);
	} else if (!cfg.server[0]) {
		report(cfg.server_invalid ? "the server in config.txt isn't a valid IP address or domain"
					  : "no server is set in config.txt");
		set_phase(DONE);
	} else {
		set_phase(LOAD);
		load();
	}
}

static void find_title(void)
{
	char id[10], name[64];
	if (read_title(id, name)) {
		found_title(id, name);
	} else if (g.seconds >= TITLE_WAIT) {
		log_printf("no title ID after %u s, so the game is left alone", TITLE_WAIT);
		set_phase(DONE);
	}
}

static u32 parse_u32(const char *s)
{
	u32 n = 0;
	while (*s >= '0' && *s <= '9')
		n = n * 10 + (*s++ - '0');
	return n;
}

/* Reads status.txt's "key = value" lines. Returns 0 if it's missing or has no pid and state. */
static int read_status(status_t *s)
{
	static char text[1024];
	s32 fd;
	u64 got = 0;
	s->pid = s->state = NULL;
	s->message = s->url = "";
	if (sys_fs_open(RI_STATUS, CELL_FS_O_RDONLY, &fd, 0) != CELL_OK)
		return 0;
	sys_fs_read(fd, text, sizeof(text) - 1, &got);
	sys_fs_close(fd);
	text[got] = 0;
	for (char *line = text; *line;) {
		char *end = line;
		while (*end && *end != '\n')
			end++;
		char *next = *end ? end + 1 : end;
		*end = 0;
		char *eq = line;
		while (*eq && *eq != '=')
			eq++;
		if (*eq && eq > line && eq[-1] == ' ' && eq[1] == ' ') {
			eq[-1] = 0;
			const char *value = eq + 2;
			if (strcmp(line, "pid") == 0)
				s->pid = value;
			else if (strcmp(line, "state") == 0)
				s->state = value;
			else if (strcmp(line, "message") == 0)
				s->message = value;
			else if (strcmp(line, "url") == 0)
				s->url = value;
		}
		line = next;
	}
	return s->pid && s->state;
}

static void watch(void)
{
	status_t s;
	char msg[300];
	if (!read_status(&s) || parse_u32(s.pid) != g.pid) {
		if (g.seconds >= START_WAIT && !g.warned) {
			if (s.pid)
				log_printf("status.txt is from process %s, not %u", s.pid, g.pid);
			report("the game module didn't start (see log.txt)");
			g.warned = 1;
		}
		return;
	}
	if (strcmp(s.state, g.state) != 0) {
		log_printf("status: %s%s%s", s.state, *s.message ? ", " : "", s.message);
		str_format(g.state, sizeof(g.state), "%s", s.state);
	}
	if (strcmp(s.state, "redirecting") == 0) {
		str_format(msg, sizeof(msg), "redirecting to %s", s.url);
		report(msg);
		set_phase(DONE);
	} else if (strcmp(s.state, "error") == 0) {
		report(s.message);
		set_phase(DONE);
	} else if (strcmp(s.state, "off") == 0) {
		report("off (enabled = false in config.txt)");
		set_phase(DONE);
	} else if (strcmp(s.state, "stopped") == 0) {
		set_phase(DONE);
	} else if (g.seconds >= HOOK_WAIT && !g.warned) {
		report("the game isn't hooked yet (see log.txt)");
		g.warned = 1;
	}
}

void game_poll(void)
{
	u32 pid = (u32)vsh_game_pid();
	if (pid != g.pid) {
		if (g.pid)
			log_printf("game process %u ended", g.pid);
		if (pid)
			log_printf("game process %u started", pid);
		g.pid = pid;
		g.warned = 0;
		last.running = 0;
		g.state[0] = 0;
		set_phase(pid ? TITLE : IDLE);
	}
	g.seconds++;
	switch (g.phase) {
	case TITLE:
		find_title();
		break;
	case LOAD:
		load();
		break;
	case WATCH:
		watch();
		break;
	default:
		break;
	}
}

const game_status_t *game_status(void)
{
	return &last;
}
