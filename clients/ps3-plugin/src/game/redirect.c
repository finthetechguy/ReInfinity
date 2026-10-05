#include "redirect.h"
#include "hooks.h"
#include "log.h"

#define DISNEY_HOST      "api.disney.com"
#define NP_STATUS_ONLINE 3
#define FNV_BASIS        2166136261u
#define SEEN_MAX         128

/* CellHttpUri as the game passes it: 32-bit pointers, then the port. */
typedef struct {
	u32 scheme, hostname, username, password, path;
	u32 port;
	u8 reserved[4];
} http_uri_t;

enum { HOOK_HTTP, HOOK_NP, HOOK_RATING, HOOK_SYSMODULE, HOOK_COUNT };

static u64 create_transaction(u64 trans_id, u64 client_id, u64 method, u64 uri);
static u64 np_get_status(u64 status);
static u64 content_rating(u64 restricted, u64 age);
static u64 load_module(u64 id);

static hook_t hooks[HOOK_COUNT] = {
	[HOOK_HTTP] = { .lib = "cellHttp", .nid = 0x052a80d9, .name = "cellHttpCreateTransaction",
			.fn = (void (*)(void))create_transaction },
	[HOOK_NP] = { .lib = "sceNp", .nid = 0xa7bff757, .name = "sceNpManagerGetStatus",
		      .fn = (void (*)(void))np_get_status },
	[HOOK_RATING] = { .lib = "sceNp", .nid = 0x6ee62ed2, .name = "sceNpManagerGetContentRatingFlag",
			  .fn = (void (*)(void))content_rating },
	[HOOK_SYSMODULE] = { .lib = "cellSysmodule", .nid = 0x32267a31, .name = "cellSysmoduleLoadModule",
			     .fn = (void (*)(void))load_module },
};

static const config_t *cfg;
static const char *problem = ""; /* why the redirect is off, for the status file */
static char target[CONFIG_HOST_MAX + 16]; /* http://server:port */
static int stopped;
static u32 redirected, passed;
static u64 np_last = ~0ull; /* the last result and status, high and low word */
static u64 rating_last = ~0ull; /* the last result and restricted flag, likewise */
static u32 seen[SEEN_MAX], seen_count;

static const char *str(u64 addr)
{
	return (u32)addr ? (const char *)PTR(addr) : "";
}

/* FNV-1a, stopping at '?' so a URL's query doesn't count. */
static u32 hash(u32 h, const char *s)
{
	for (; *s && *s != '?'; s++)
		h = (h ^ (u8)*s) * 16777619u;
	return h;
}

/* Whether this is the first request with `key`. Racing threads may both see it as new, which
   only repeats a log line. After SEEN_MAX different ones, new ones aren't logged. */
static int first_time(u32 key)
{
	u32 n = __atomic_load_n(&seen_count, __ATOMIC_ACQUIRE);
	for (u32 i = 0; i < n && i < SEEN_MAX; i++)
		if (seen[i] == key)
			return 0;
	u32 at = __atomic_fetch_add(&seen_count, 1, __ATOMIC_ACQ_REL);
	if (at >= SEEN_MAX)
		return 0;
	seen[at] = key;
	return 1;
}

/* The path is cut at its query, which can carry tokens; the server's log has the full URL.
   Not inlined, so the buffers are only on the game thread's stack when a line is logged. */
__attribute__((noinline)) static void log_request(u64 method, const http_uri_t *uri, int redirect, u64 result)
{
	char path[160];
	const char *p = str(uri->path);
	u32 i = 0;
	for (; p[i] && p[i] != '?' && i + 1 < sizeof(path); i++)
		path[i] = p[i];
	path[i] = 0;
	log_printf("%s: %s %s://%s:%u%s%s%s%s (0x%x)", redirect ? "redirected" : "not redirected", str(method),
		   str(uri->scheme), str(uri->hostname), uri->port, path, p[i] == '?' ? "?..." : "",
		   redirect ? " -> " : "", redirect ? target : "", (u32)result);
}

/* The game parses each URL and passes it here. An api.disney.com one is sent to a copy with
   our server instead; libhttp copies the URI, so the copy can live on the stack. */
static u64 create_transaction(u64 trans_id, u64 client_id, u64 method, u64 uri_addr)
{
	hook_enter();
	const http_uri_t *uri = PTR(uri_addr);
	http_uri_t copy;
	int redirect = uri && strcasecmp(str(uri->hostname), DISNEY_HOST) == 0;
	if (redirect) {
		copy = *uri;
		copy.scheme = (u32)(uintptr_t)"http";
		copy.hostname = (u32)(uintptr_t)cfg->server;
		copy.port = cfg->port;
	}
	u64 result = lv2_call(hooks[HOOK_HTTP].original, trans_id, client_id, method,
			      redirect ? (uintptr_t)&copy : uri_addr);
	if (uri) {
		__atomic_fetch_add(redirect ? &redirected : &passed, 1, __ATOMIC_RELAXED);
		u32 key = hash(hash(hash(FNV_BASIS, str(method)), str(uri->hostname)), str(uri->path));
		if (cfg->log_all || first_time(key))
			log_request(method, uri, redirect, result);
	}
	hook_leave();
	return result;
}

/* The game only goes online when this reports 3 (signed in to PSN). A console that really is
   signed in is passed through unchanged. */
static u64 np_get_status(u64 status_addr)
{
	hook_enter();
	u64 result = lv2_call(hooks[HOOK_NP].original, status_addr, 0, 0, 0);
	s32 *status = PTR(status_addr);
	s32 real = 0;
	if ((s32)result == CELL_OK && status) {
		real = *status;
		if (real != NP_STATUS_ONLINE)
			*status = NP_STATUS_ONLINE;
	}
	u64 now = (u64)(u32)result << 32 | (u32)real;
	if (__atomic_exchange_n(&np_last, now, __ATOMIC_ACQ_REL) != now) {
		if ((s32)result != CELL_OK)
			log_printf("sceNpManagerGetStatus failed (0x%x), passed on", (u32)result);
		else if (real == NP_STATUS_ONLINE)
			log_printf("sceNpManagerGetStatus: PSN status 3 (signed in), passed on");
		else
			log_printf("sceNpManagerGetStatus: PSN status %d, reported to the game as 3 (signed in)", real);
	}
	hook_leave();
	return result;
}

/* PSN_UpdateContentRating only allows online features if this succeeds and the account isn't
   restricted. It fails when the console isn't signed in to PSN, so the game would then say
   parental controls disabled online services. A real answer is passed through unchanged. */
static u64 content_rating(u64 restricted_addr, u64 age_addr)
{
	hook_enter();
	u64 result = lv2_call(hooks[HOOK_RATING].original, restricted_addr, age_addr, 0, 0);
	s32 *restricted = PTR(restricted_addr), *age = PTR(age_addr);
	int fake = (s32)result != CELL_OK && restricted && age;
	if (fake) {
		*restricted = 0;
		*age = 18; /* the game only reads it for a restricted account */
	}
	u64 now = (u64)(u32)result << 32 | (u32)(fake || !restricted ? 0 : *restricted);
	if (__atomic_exchange_n(&rating_last, now, __ATOMIC_ACQ_REL) != now) {
		if (fake)
			log_printf("sceNpManagerGetContentRatingFlag failed (0x%x), reported to the game as not restricted",
				   (u32)result);
		else
			log_printf("sceNpManagerGetContentRatingFlag: 0x%x, restricted %d, passed on", (u32)result, (s32)now);
	}
	hook_leave();
	return fake ? CELL_OK : result;
}

/* Loading a library fills (and so overwrites) its slots, so hook them again after each load. */
static u64 load_module(u64 id)
{
	hook_enter();
	u64 result = lv2_call(hooks[HOOK_SYSMODULE].original, id, 0, 0, 0);
	log_printf("cellSysmoduleLoadModule(0x%04x) = 0x%x", (u32)(u16)id, (u32)result);
	hooks_apply(hooks, HOOK_COUNT, "after cellSysmoduleLoadModule");
	hook_leave();
	return result;
}

int redirect_start(const config_t *config)
{
	cfg = config;
	if (!cfg->enabled) {
		log_printf("redirect off (enabled = false)");
		return 0;
	}
	if (!cfg->server[0]) {
		problem = cfg->server_invalid ? "the server in config.txt isn't a valid IP address or domain"
					      : "no server is set in config.txt";
		log_printf("redirect off: %s", problem);
		return 0;
	}
	hooks[HOOK_HTTP].wanted = 1;
	hooks[HOOK_NP].wanted = cfg->psn_bypass;
	hooks[HOOK_RATING].wanted = cfg->psn_bypass;
	hooks[HOOK_SYSMODULE].wanted = 1;
	hooks_init(hooks, HOOK_COUNT);
	if (!hooks[HOOK_HTTP].slot) {
		problem = "this game doesn't import cellHttpCreateTransaction";
		log_printf("redirect off: %s", problem);
		return 0;
	}
	str_format(target, sizeof(target), "http://%s:%u", cfg->server, cfg->port);
	log_printf("redirecting https://" DISNEY_HOST " to %s, PSN bypass %s", target, cfg->psn_bypass ? "on" : "off");
	hooks_apply(hooks, HOOK_COUNT, "at start");
	return 1;
}

void redirect_check(void)
{
	hooks_apply(hooks, HOOK_COUNT, "by the 1 s check");
}

void redirect_stop(void)
{
	hooks_remove(hooks, HOOK_COUNT);
	stopped = 1;
}

static const char *state(void)
{
	if (stopped)
		return "stopped";
	if (!cfg->enabled)
		return "off";
	if (*problem)
		return "error";
	return hook_active(&hooks[HOOK_HTTP]) ? "redirecting" : "waiting";
}

u32 redirect_status(char *buf, u32 size)
{
	char active[160], psn[64], parental[64];
	u32 len = 0;
	active[0] = 0;
	for (u32 i = 0; i < HOOK_COUNT; i++)
		if (hook_active(&hooks[i]))
			len += str_format(active + len, sizeof(active) - len, "%s%s", len ? ", " : "", hooks[i].name);

	u64 np = __atomic_load_n(&np_last, __ATOMIC_ACQUIRE);
	if (!hooks[HOOK_NP].wanted)
		str_format(psn, sizeof(psn), "bypass off");
	else if (np == ~0ull)
		str_format(psn, sizeof(psn), "not checked yet");
	else if ((u32)(np >> 32) != CELL_OK)
		str_format(psn, sizeof(psn), "error 0x%x", (u32)(np >> 32));
	else if ((s32)np == NP_STATUS_ONLINE)
		str_format(psn, sizeof(psn), "signed in");
	else
		str_format(psn, sizeof(psn), "bypassed (real status %d)", (s32)np);

	u64 rating = __atomic_load_n(&rating_last, __ATOMIC_ACQUIRE);
	if (!hooks[HOOK_RATING].wanted)
		str_format(parental, sizeof(parental), "bypass off");
	else if (rating == ~0ull)
		str_format(parental, sizeof(parental), "not checked yet");
	else if ((u32)(rating >> 32) != CELL_OK)
		str_format(parental, sizeof(parental), "bypassed (error 0x%x)", (u32)(rating >> 32));
	else
		str_format(parental, sizeof(parental), "%s", (s32)rating ? "restricted" : "not restricted");

	return str_format(buf, size,
			  "state = %s\nmessage = %s\nurl = %s\nhooks = %s\nredirected = %u\npassed_through = %u\npsn = %s\n"
			  "parental = %s\n",
			  state(), problem, target, active, redirected, passed, psn, parental);
}
