/* Where the plugin keeps its files on the PS3. A game can't create folders in /dev_hdd0,
   so the VSH plugin (or FTP) creates RI_DIR. */
#pragma once

#define RI_DIR      "/dev_hdd0/reinfinity"
#define RI_GAME_LOG RI_DIR "/log.txt"
#define RI_VSH_LOG  RI_DIR "/vsh_log.txt"
