/* Where the plugin keeps its files on the PS3. A game can't create folders in /dev_hdd0,
   so the VSH plugin (or FTP) creates RI_DIR. */
#pragma once

#define RI_DIR      "/dev_hdd0/reinfinity"
#define RI_GAME_LOG RI_DIR "/log.txt"
#define RI_VSH_LOG  RI_DIR "/vsh_log.txt"
#define RI_VSH_PREV RI_DIR "/vsh_log_prev.txt" /* the previous boot's, kept for after a restart */
#define RI_CONFIG   RI_DIR "/config.txt"
#define RI_CONFIG_TMP RI_DIR "/config.tmp" /* the settings page writes this, then renames it */
#define RI_STATUS   RI_DIR "/status.txt" /* written by the game module, read by the VSH plugin */
#define RI_GAME_PRX RI_DIR "/reinfinity_game.sprx" /* loaded into the game by the VSH plugin */
