/* The redirect: hooks on cellHttpCreateTransaction (api.disney.com to the configured server),
   sceNpManagerGetStatus, sceNpManagerGetContentRatingFlag and cellNetCtlNetStartDialogLoadAsync
   (the PSN bypass), and cellSysmoduleLoadModule (hooking again after a library load). */
#pragma once

#include "config.h"

/* Hooks what `cfg` asks for. Returns 0 if there's nothing to hook (off, or a problem). */
int redirect_start(const config_t *cfg);

/* Re-applies any hook the system has overwritten. Called every second. */
void redirect_check(void);

/* Removes the hooks before the module unloads. */
void redirect_stop(void);

/* The status file's lines (state, url, message, hooks, counts). Returns the length. */
u32 redirect_status(char *buf, u32 size);
