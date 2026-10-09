/* The settings page: a small HTTP/1.0 server on config.txt's web_port (8090 by default) that
   answers one browser at a time. Like webMAN's pages it has no login, so anyone on the LAN can
   use it.
     GET  /                         the form, plus the last game's result
     POST /save                     validates the form, then rewrites config.txt
     GET  /toggle?key=enabled       flips a setting (or key=psn_bypass), for the XMB items
     GET  /status                   shows the settings and last result as a notification */
#include "config.h"
#include "game.h"
#include "log.h"
#include "net.h"
#include "paths.h"
#include "settings.h"
#include "vsh.h"
#include "web.h"

#define REQUEST_MAX 4096
#define BODY_MAX    6144
#define WAIT_MS     100  /* how long web_poll waits for a browser */
#define CLIENT_MS   3000 /* how long a browser gets to send its request and read the reply */
#define REOPEN_S    5    /* seconds between tries to listen after a failure */
#define NET_ECONNABORTED 53
#define HTML "text/html; charset=utf-8"
#define TEXT "text/plain; charset=utf-8"

typedef struct {
	char *method, *path, *query, *body;
	char *headers, *headers_end; /* header lines, each ended by two NULs where its CRLF was */
} request_t;

static u32 port;
static s32 listener = -1;
static u64 reopen_at;
static const char *failed_step; /* the last failure logged, so a retry that fails the same way is quiet */
static s32 failed_errno;
static config_t cfg;
static char req[REQUEST_MAX];
static char body[BODY_MAX];
static u32 body_len;
static const char *reply_status, *reply_type;

static s32 net_errno(void)
{
	u32 loc = (u32)_sys_net_errno_loc();
	return loc ? *(volatile s32 *)PTR(loc) : 0;
}

static void failed(const char *step, s32 error)
{
	if (step != failed_step || error != failed_errno)
		log_printf("settings page: %s failed (errno %d), trying again every %u s", step, error, REOPEN_S);
	failed_step = step;
	failed_errno = error;
	if (listener >= 0)
		socketclose(listener);
	listener = -1;
	reopen_at = time_us() + REOPEN_S * 1000000ull;
}

static void open_listener(void)
{
	sockaddr_in_t addr;
	s32 on = 1;
	listener = (s32)socket(AF_INET, SOCK_STREAM, 0);
	if (listener < 0) {
		failed("socket", net_errno());
		return;
	}
	setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	/* So accept can't block if a browser gives up between socketpoll and accept. */
	if ((s32)setsockopt(listener, SOL_SOCKET, SO_NBIO, &on, sizeof(on)) < 0)
		log_printf("settings page: can't make the socket non-blocking (errno %d)", net_errno());
	memset(&addr, 0, sizeof(addr));
	addr.len = sizeof(addr);
	addr.family = AF_INET;
	addr.port = (u16)port;
	if ((s32)bind(listener, &addr, sizeof(addr)) < 0) {
		failed("bind", net_errno());
	} else if ((s32)listen(listener, 4) < 0) {
		failed("listen", net_errno());
	} else {
		failed_step = NULL;
		log_printf("settings page: listening on port %u", port);
	}
}

/* Waits until fd is ready for `events`. Returns 0 at the deadline, on an error, or when the
   thread is asked to stop. */
static int wait_for(s32 fd, s16 events, thread_t *t, u64 deadline)
{
	while (!t->stop && time_us() < deadline) {
		pollfd_t p = { fd, events, 0 };
		s32 ready = (s32)socketpoll(&p, 1, WAIT_MS);
		if (ready != 0)
			return ready > 0;
	}
	return 0;
}

static int send_all(s32 c, thread_t *t, u64 deadline, const char *data, u32 len)
{
	while (len) {
		if (!wait_for(c, POLLOUT, t, deadline))
			return 0;
		s32 sent = (s32)send(c, data, len, MSG_DONTWAIT);
		if (sent < 0 && net_errno() == NET_EWOULDBLOCK)
			continue;
		if (sent <= 0)
			return 0;
		data += sent;
		len -= sent;
	}
	return 1;
}

static char lower(char c)
{
	return c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c;
}

static int starts_with_ci(const char *s, const char *prefix)
{
	for (; *prefix; s++, prefix++)
		if (lower(*s) != lower(*prefix))
			return 0;
	return 1;
}

static char *find(const char *s, const char *needle)
{
	u32 n = strlen(needle);
	for (; *s; s++) {
		u32 i = 0;
		while (i < n && s[i] == needle[i])
			i++;
		if (i == n)
			return (char *)s;
	}
	return NULL;
}

/* Content-Length from the request's headers, which end at `end`. 0 if there's none. */
static u32 content_length(const char *end)
{
	for (const char *line = req; (line = find(line, "\r\n")) && line < end;) {
		line += 2;
		if (starts_with_ci(line, "content-length:")) {
			const char *v = line + 15;
			u32 n = 0;
			while (*v == ' ')
				v++;
			for (; *v >= '0' && *v <= '9' && n <= REQUEST_MAX; v++)
				n = n * 10 + (*v - '0');
			return n;
		}
	}
	return 0;
}

/* Reads a request into req until its headers and body are in, and ends it there. Returns its
   length, 0 if the browser closed the connection or went quiet, or -1 if it doesn't fit. */
static s32 read_request(s32 c, thread_t *t, u64 deadline)
{
	u32 len = 0, need = 0;
	while (!need || len < need) {
		if (len == REQUEST_MAX - 1)
			return -1;
		if (!wait_for(c, POLLIN, t, deadline))
			return 0;
		s32 got = (s32)recv(c, req + len, REQUEST_MAX - 1 - len, MSG_DONTWAIT);
		if (got < 0 && net_errno() == NET_EWOULDBLOCK)
			continue;
		if (got <= 0)
			return 0;
		len += got;
		req[len] = 0;
		char *end = need ? NULL : find(req, "\r\n\r\n");
		if (end) {
			u32 size = content_length(end);
			need = (u32)(end - req) + 4 + size;
			if (size > REQUEST_MAX || need > REQUEST_MAX - 1)
				return -1;
		}
	}
	req[need] = 0;
	return need;
}

/* Splits the request in req into its parts. Returns 0 if the request line isn't
   "<method> /<path> <version>". */
static int parse_request(request_t *r)
{
	char *end = find(req, "\r\n\r\n");
	*end = 0;
	r->body = end + 4;
	for (char *p = req; (p = find(p, "\r\n")); p += 2)
		p[0] = p[1] = 0;
	r->headers = req + strlen(req) + 2;
	r->headers_end = end;

	char *p = req;
	r->method = p;
	while (*p && *p != ' ')
		p++;
	if (!*p)
		return 0;
	*p++ = 0;
	r->path = p;
	while (*p && *p != ' ')
		p++;
	if (!*p)
		return 0;
	*p = 0;
	r->query = "";
	for (p = r->path; *p; p++) {
		if (*p == '?') {
			*p = 0;
			r->query = p + 1;
			break;
		}
	}
	return r->path[0] == '/';
}

static const char *header(const request_t *r, const char *name)
{
	u32 n = strlen(name);
	for (const char *line = r->headers; line < r->headers_end; line += strlen(line) + 2) {
		if (starts_with_ci(line, name) && line[n] == ':') {
			const char *v = line + n + 1;
			while (*v == ' ' || *v == '\t')
				v++;
			return v;
		}
	}
	return NULL;
}

static int hex(char c)
{
	if (c >= '0' && c <= '9')
		return c - '0';
	c = lower(c);
	return c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
}

/* Finds `key` in a query or form body ("a=1&b=2") and URL-decodes its value into out. Returns 1
   if it's there, 0 if not, or -1 if the value doesn't fit. */
static int form_value(const char *form, const char *key, char *out, u32 size)
{
	u32 n = strlen(key);
	while (*form) {
		const char *end = form;
		while (*end && *end != '&')
			end++;
		u32 i = 0;
		while (i < n && form[i] == key[i])
			i++;
		const char *v = form + n;
		if (i == n && (v == end || *v == '=')) {
			u32 len = 0;
			if (v < end)
				v++;
			while (v < end) {
				char ch = *v++;
				if (ch == '+') {
					ch = ' ';
				} else if (ch == '%' && end - v >= 2 && hex(v[0]) >= 0 && hex(v[1]) >= 0) {
					ch = (char)(hex(v[0]) * 16 + hex(v[1]));
					v += 2;
				}
				if (len + 1 >= size)
					return -1;
				out[len++] = ch;
			}
			out[len] = 0;
			return 1;
		}
		form = *end ? end + 1 : end;
	}
	return 0;
}

static char *trim(char *s)
{
	while (*s == ' ' || *s == '\t')
		s++;
	char *end = s + strlen(s);
	while (end > s && (end[-1] == ' ' || end[-1] == '\t'))
		*--end = 0;
	return s;
}

static void start(const char *status, const char *type)
{
	reply_status = status;
	reply_type = type;
	body_len = 0;
	body[0] = 0;
}

static void add_v(const char *fmt, va_list ap)
{
	body_len += str_vformat(body + body_len, sizeof(body) - body_len, fmt, ap);
}

static void add(const char *fmt, ...)
{
	va_list ap;
	va_start(ap, fmt);
	add_v(fmt, ap);
	va_end(ap);
}

static void add_html(const char *s)
{
	for (; *s; s++) {
		if (*s == '&')
			add("&amp;");
		else if (*s == '<')
			add("&lt;");
		else if (*s == '>')
			add("&gt;");
		else if (*s == '"')
			add("&quot;");
		else if (*s == '\'')
			add("&#39;");
		else
			add("%c", *s);
	}
}

static void text(const char *status, const char *fmt, ...)
{
	va_list ap;
	start(status, TEXT);
	va_start(ap, fmt);
	add_v(fmt, ap);
	va_end(ap);
	add("\n");
}

static u32 describe(char *buf, u32 size)
{
	const char *psn = cfg.psn_bypass ? "on" : "off";
	if (!cfg.enabled)
		return str_format(buf, size, "redirect off, PSN check bypass %s", psn);
	if (!cfg.server[0])
		return str_format(buf, size, "redirect on but no server is set, PSN check bypass %s", psn);
	return str_format(buf, size, "redirect to %s port %u, PSN check bypass %s", cfg.server, cfg.port, psn);
}

/* The form, filled from cfg's switches and the given text, then the last game's result. */
static void settings_page(const char *server, const char *port_text, const char *note)
{
	const game_status_t *g = game_status();
	start("200 OK", HTML);
	add("<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">\n"
	    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
	    "<title>ReInfinity</title></head><body>\n<h1>ReInfinity</h1>\n");
	if (note) {
		add("<p><b>");
		add_html(note);
		add("</b></p>\n");
	}
	add("<form method=\"post\" action=\"/save\">\n"
	    "<p><label><input type=\"checkbox\" name=\"enabled\" value=\"1\"%s> "
	    "Redirect Disney Infinity to this server</label></p>\n"
	    "<p>Server (IP address or domain, e.g. 192.168.0.18):<br>\n"
	    "<input type=\"text\" name=\"server\" size=\"30\" maxlength=\"253\" value=\"",
	    cfg.enabled ? " checked" : "");
	add_html(server);
	add("\"></p>\n<p>Port:<br>\n<input type=\"text\" name=\"port\" size=\"6\" maxlength=\"5\" value=\"");
	add_html(port_text);
	add("\"></p>\n"
	    "<p><label><input type=\"checkbox\" name=\"psn_bypass\" value=\"1\"%s> "
	    "PSN check bypass: go online without signing in to PSN</label></p>\n"
	    "<p><input type=\"submit\" value=\"Save\"></p>\n</form>\n"
	    "<p>Changes apply the next time Disney Infinity starts. The other settings (log, titles, "
	    "web_port) are in " RI_CONFIG ".</p>\n<h2>Status</h2>\n<p>",
	    cfg.psn_bypass ? " checked" : "");
	if (!g->id[0]) {
		add("No Disney Infinity game has started since the PS3 was turned on.");
	} else {
		add("Last game: ");
		add_html(g->id);
		add(" ");
		add_html(g->name);
		add("%s<br>\nResult: ", g->running ? " (running)" : " (ended)");
		add_html(g->result[0] ? g->result : "none yet");
	}
	add("</p>\n<p><a href=\"/\">Reload</a></p>\n</body></html>\n");
}

static void show_settings(void)
{
	char port_text[8];
	config_load(&cfg);
	str_format(port_text, sizeof(port_text), "%u", cfg.port);
	settings_page(cfg.server, port_text,
		      cfg.server_invalid ? "The server in config.txt isn't a valid IP address or domain, so it's ignored."
					 : NULL);
}

/* Any page in any browser on the LAN could post a form here, e.g. to change the server. Browsers
   say where a post came from in Origin, so refuse one that isn't this page. */
static int same_origin(const request_t *r)
{
	const char *origin = header(r, "origin"), *host = header(r, "host");
	if (!origin)
		return 1; /* older browsers don't send it */
	if (host && starts_with_ci(origin, "http://") && strcasecmp(origin + 7, host) == 0)
		return 1;
	log_printf("settings page: refused a save from %s", origin);
	return 0;
}

static void reject(const char *server, const char *port_text, const char *note)
{
	log_printf("settings page: server \"%s\", port \"%s\": %s", server, port_text, note);
	settings_page(server, port_text, note);
}

static void save(const request_t *r)
{
	char server_buf[CONFIG_HOST_MAX + 2], port_buf[8], flag[4], note[96], msg[384];
	u32 port_value = 0;
	if (!same_origin(r)) {
		text("403 Forbidden", "Not saved: the form was sent from another site.");
		return;
	}
	config_load(&cfg);
	cfg.enabled = form_value(r->body, "enabled", flag, sizeof(flag)) != 0;
	cfg.psn_bypass = form_value(r->body, "psn_bypass", flag, sizeof(flag)) != 0;
	int server_found = form_value(r->body, "server", server_buf, sizeof(server_buf));
	int port_found = form_value(r->body, "port", port_buf, sizeof(port_buf));
	const char *server = server_found == 1 ? trim(server_buf) : "";
	const char *port_text = port_found == 1 ? trim(port_buf) : "";
	if (server_found < 0 || (*server && !config_valid_host(server))) {
		reject(server, port_text, "Not saved: the server must be an IP address or domain only, "
					  "like 192.168.0.18 (no http:// and no :port).");
		return;
	}
	if (!config_parse_port(port_text, &port_value)) {
		reject(server, port_text, "Not saved: the port must be a number from 1 to 65535.");
		return;
	}
	memcpy(cfg.server, server, strlen(server) + 1);
	cfg.server_invalid = 0;
	cfg.port = port_value;
	s32 result = settings_save(&cfg);
	str_format(port_buf, sizeof(port_buf), "%u", cfg.port);
	if (result == CELL_OK) {
		u32 len = str_format(msg, sizeof(msg), "saved, ");
		describe(msg + len, sizeof(msg) - len);
		notify(msg);
		settings_page(cfg.server, port_buf, "Saved. Changes apply the next time Disney Infinity starts.");
	} else {
		str_format(note, sizeof(note), "Not saved: config.txt couldn't be written (0x%x). See vsh_log.txt.", result);
		settings_page(cfg.server, port_buf, note);
	}
}

static void toggle(const request_t *r)
{
	char key[16], msg[96];
	int *value = NULL;
	const char *name = "";
	config_load(&cfg);
	if (form_value(r->query, "key", key, sizeof(key)) == 1) {
		if (strcmp(key, "enabled") == 0) {
			value = &cfg.enabled;
			name = "redirect";
		} else if (strcmp(key, "psn_bypass") == 0) {
			value = &cfg.psn_bypass;
			name = "PSN check bypass";
		}
	}
	if (!value) {
		text("404 Not Found", "Unknown setting. Use /toggle?key=enabled or /toggle?key=psn_bypass.");
		return;
	}
	*value = !*value;
	s32 result = settings_save(&cfg);
	if (result == CELL_OK)
		str_format(msg, sizeof(msg), "%s %s from the next time Disney Infinity starts", name, *value ? "on" : "off");
	else
		str_format(msg, sizeof(msg), "couldn't save config.txt (0x%x)", result);
	notify(msg);
	text(result == CELL_OK ? "200 OK" : "500 Internal Server Error", "ReInfinity: %s", msg);
}

static void show_status(void)
{
	char msg[384];
	const game_status_t *g = game_status();
	config_load(&cfg);
	u32 len = describe(msg, sizeof(msg));
	if (g->id[0])
		str_format(msg + len, sizeof(msg) - len, ". %s: %s", g->id,
			   g->result[0] ? g->result : g->running ? "starting" : "no result");
	notify(msg);
	text("200 OK", "ReInfinity: %s", msg);
}

static void route(const request_t *r)
{
	int get = strcmp(r->method, "GET") == 0, post = strcmp(r->method, "POST") == 0;
	/* GET /save too: reloading the page after saving can land there. */
	if (get && (strcmp(r->path, "/") == 0 || strcmp(r->path, "/save") == 0))
		show_settings();
	else if (post && strcmp(r->path, "/save") == 0)
		save(r);
	else if (get && strcmp(r->path, "/toggle") == 0)
		toggle(r);
	else if (get && strcmp(r->path, "/status") == 0)
		show_status();
	else
		text("404 Not Found", "Not found.");
}

static void serve(s32 c, thread_t *t, const u8 ip[4])
{
	static request_t r;
	char head[192];
	const char *method = "?", *path = "?";
	u64 deadline = time_us() + CLIENT_MS * 1000ull;
	s32 len = read_request(c, t, deadline);
	if (len == 0)
		return;
	if (len < 0) {
		text("413 Request Entity Too Large", "The request is too big.");
	} else if (!parse_request(&r)) {
		text("400 Bad Request", "Bad request.");
	} else {
		method = r.method;
		path = r.path;
		route(&r);
	}
	u32 head_len = str_format(head, sizeof(head),
				  "HTTP/1.0 %s\r\nContent-Type: %s\r\nContent-Length: %u\r\n"
				  "Cache-Control: no-store\r\nConnection: close\r\n\r\n",
				  reply_status, reply_type, body_len);
	if (send_all(c, t, deadline, head, head_len))
		send_all(c, t, deadline, body, body_len);
	if (strcmp(path, "/favicon.ico") != 0)
		log_printf("settings page: %s %s from %u.%u.%u.%u: %s", method, path, ip[0], ip[1], ip[2], ip[3],
			   reply_status);
}

void web_start(void)
{
	config_load(&cfg);
	port = cfg.web_port;
	open_listener();
}

void web_poll(thread_t *t)
{
	u64 began = time_us();
	int served = 0;
	if (listener < 0 && began >= reopen_at)
		open_listener();
	if (listener >= 0) {
		pollfd_t p = { listener, POLLIN, 0 };
		s32 ready = (s32)socketpoll(&p, 1, WAIT_MS);
		if (ready < 0) {
			failed("socketpoll", net_errno());
		} else if (ready > 0) {
			sockaddr_in_t addr;
			u32 addr_len = sizeof(addr);
			memset(&addr, 0, sizeof(addr));
			s32 c = (s32)accept(listener, &addr, &addr_len);
			if (c >= 0) {
				serve(c, t, addr.addr);
				socketclose(c);
				served = 1;
			} else {
				s32 error = net_errno();
				if (error != NET_EWOULDBLOCK && error != NET_ECONNABORTED)
					failed("accept", error);
			}
		}
	}
	/* Never return straight away without serving anyone, so a socket that misbehaves can't make
	   this thread spin in the XMB. */
	if (!served && time_us() - began < WAIT_MS * 1000 / 2)
		thread_sleep(t, WAIT_MS);
}

void web_stop(void)
{
	if (listener >= 0)
		socketclose(listener);
	listener = -1;
}
