/* sys_net (libnet): the PS3's BSD sockets, imported by name like the game's own sys_net table
   (prx/vsh.json). They return -1 on failure and set sys_net_errno; the returns are u64 for the
   same reason as in vsh.h. Constants are the BSD values the PS3 uses. */
#pragma once

#include "lv2.h"

#define AF_INET          2
#define SOCK_STREAM      1
#define SOL_SOCKET       0xffff
#define SO_REUSEADDR     0x0004
#define SO_NBIO          0x1100 /* non-blocking, the PS3's own option */
#define MSG_DONTWAIT     0x0080
#define POLLIN           0x0001
#define POLLOUT          0x0004
#define NET_EWOULDBLOCK  35

typedef struct {
	u8 len;
	u8 family;
	u16 port;
	u8 addr[4];
	u8 zero[8];
} sockaddr_in_t;

typedef struct {
	s32 fd;
	s16 events;
	s16 revents;
} pollfd_t;

u64 socket(s32 family, s32 type, s32 protocol);
u64 setsockopt(s32 s, s32 level, s32 name, const void *value, u32 len);
u64 bind(s32 s, const sockaddr_in_t *addr, u32 len);
u64 listen(s32 s, s32 backlog);
u64 accept(s32 s, sockaddr_in_t *addr, u32 *len);
u64 recv(s32 s, void *buf, u32 len, s32 flags);
u64 send(s32 s, const void *buf, u32 len, s32 flags);
u64 socketpoll(pollfd_t *fds, u32 count, s32 timeout_ms);
u64 socketclose(s32 s);
u64 _sys_net_errno_loc(void); /* this thread's sys_net_errno */
