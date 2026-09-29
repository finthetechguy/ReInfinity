#include "logger.h"

#include <whb/log_module.h>
#include <whb/log_udp.h>

static bool sModuleLog = false;
static bool sUdpLog    = false;

// try to use LoggingModule
void initLogging() {
    if (sModuleLog || sUdpLog) {
        return;
    }
    sModuleLog = WHBLogModuleInit();
    if (!sModuleLog) {
        sUdpLog = WHBLogUdpInit();
    }
}

void deinitLogging() {
    if (sModuleLog) {
        WHBLogModuleDeinit();
        sModuleLog = false;
    }
    if (sUdpLog) {
        WHBLogUdpDeinit();
        sUdpLog = false;
    }
}
